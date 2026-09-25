import type { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { findProfileBySubscriptionId } from '../services/profileService';
import {
  applySubscriptionState,
  readFirebaseUidFromNotes,
  unixToIso,
  verifyWebhookSignature,
  type RazorpaySubscriptionEntity,
} from '../services/subscriptionService';
import type { Json } from '../types/database';
import { HttpError } from '../utils/httpError';

interface RazorpayWebhookEvent {
  entity: 'event';
  account_id: string;
  event: string;
  contains: string[];
  created_at: number;
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
    payment?: { entity: { id: string; amount: number; currency: string; status: string } };
  };
}

/** Events that grant / extend access. */
const ACTIVATING_EVENTS = new Set(['subscription.activated', 'subscription.charged', 'subscription.resumed']);
/** Events that revoke access. */
const DEACTIVATING_EVENTS = new Set([
  'subscription.cancelled',
  'subscription.completed',
  'subscription.expired',
  'subscription.halted',
  'subscription.paused',
]);

function isRazorpayEvent(value: unknown): value is RazorpayWebhookEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RazorpayWebhookEvent>;
  return (
    typeof candidate.event === 'string' &&
    typeof candidate.created_at === 'number' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}

async function resolveOwner(subscription: RazorpaySubscriptionEntity): Promise<string | null> {
  const fromNotes = readFirebaseUidFromNotes(subscription);
  if (fromNotes) return fromNotes;
  const profile = await findProfileBySubscriptionId(subscription.id);
  return profile?.firebase_uid ?? null;
}

/**
 * POST /api/webhooks/razorpay
 *
 * Mounted with `express.raw()` so the HMAC is computed over the exact bytes
 * Razorpay signed. Flow:
 *   1. Verify `x-razorpay-signature` (timing-safe).
 *   2. Record `x-razorpay-event-id` in an idempotency ledger (duplicates → 200).
 *   3. Apply the subscription state change through an ordered RPC.
 * If step 3 fails, the ledger row is removed and 500 is returned so Razorpay
 * retries the delivery.
 */
export async function handleRazorpayWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.header('x-razorpay-signature') ?? '';
  const rawBody = req.body;

  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw HttpError.badRequest('Webhook body must be the raw JSON payload');
  }

  if (!verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
    logger.warn({ ip: req.ip }, 'Rejected Razorpay webhook with invalid signature');
    throw new HttpError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw HttpError.badRequest('Webhook body is not valid JSON');
  }
  if (!isRazorpayEvent(event)) throw HttpError.badRequest('Unrecognised webhook payload');

  const subscription = event.payload.subscription?.entity;
  const eventId =
    req.header('x-razorpay-event-id') ?? `${event.event}:${subscription?.id ?? 'none'}:${event.created_at}`;

  const handled = ACTIVATING_EVENTS.has(event.event) || DEACTIVATING_EVENTS.has(event.event);
  if (!handled || !subscription) {
    logger.info({ event: event.event, eventId }, 'Razorpay webhook acknowledged (no action)');
    res.json({ status: 'ignored' });
    return;
  }

  const uid = await resolveOwner(subscription);

  // Idempotency: the primary key rejects a second delivery of the same event.
  const { error: ledgerError } = await supabase.from('payment_webhook_events').insert({
    event_id: eventId,
    event_type: event.event,
    firebase_uid: uid,
    payload: event as unknown as Json,
  });
  if (ledgerError) {
    if (ledgerError.code === '23505') {
      logger.info({ eventId }, 'Duplicate Razorpay webhook ignored');
      res.json({ status: 'duplicate' });
      return;
    }
    throw new HttpError(500, 'INTERNAL_ERROR', 'Could not record webhook event', ledgerError.message);
  }

  if (!uid) {
    // Nothing we can attach this to (e.g. subscription created outside the app).
    logger.warn({ eventId, subscriptionId: subscription.id }, 'Razorpay webhook for unknown subscription');
    res.json({ status: 'unmatched' });
    return;
  }

  const active = ACTIVATING_EVENTS.has(event.event);
  const expiresAt = active
    ? unixToIso(subscription.current_end)
    : (unixToIso(subscription.ended_at) ?? new Date(event.created_at * 1000).toISOString());

  try {
    const applied = await applySubscriptionState({
      uid,
      subscriptionId: subscription.id,
      active,
      expiresAt,
      razorpayState: subscription.status,
      eventAt: new Date(event.created_at * 1000).toISOString(),
    });

    logger.info(
      { eventId, event: event.event, uid, subscriptionId: subscription.id, active, expiresAt, applied },
      applied ? 'Subscription updated from webhook' : 'Stale webhook skipped (newer state already applied)',
    );
    res.json({ status: applied ? 'processed' : 'stale' });
  } catch (error) {
    // Release the idempotency key so Razorpay's retry can be processed.
    const { error: cleanupError } = await supabase.from('payment_webhook_events').delete().eq('event_id', eventId);
    if (cleanupError) logger.error({ err: cleanupError, eventId }, 'Failed to release webhook idempotency key');
    throw error;
  }
}
