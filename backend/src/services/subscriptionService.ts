import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { razorpay } from '../lib/razorpay';
import { supabase } from '../lib/supabase';
import type { ProfileRow } from '../types/database';
import { fromDbError, HttpError } from '../utils/httpError';
import { isSubscriptionActive } from './accessPolicy';

/**
 * Grace window granted right after a verified checkout when Razorpay has not
 * yet populated `current_end`. The `subscription.activated/charged` webhooks
 * replace it with the real billing-cycle end (expiry only moves forward).
 */
const PROVISIONAL_ACCESS_MS = 24 * 60 * 60 * 1000;

/** Subscription states that can still be completed through Checkout. */
const REUSABLE_STATES = new Set(['created']);

export interface RazorpaySubscriptionEntity {
  id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  /** Razorpay returns an object, or an empty array when no notes were set. */
  notes?: unknown;
}

export interface CheckoutSession {
  keyId: string;
  subscriptionId: string;
  plan: PlanDisplay;
  prefill: { email: string | null; name: string | null };
}

export interface PlanDisplay {
  planId: string;
  amountPaise: number;
  currency: 'INR';
  interval: string;
  brandName: string;
}

// -----------------------------------------------------------------------------
// Signature helpers
// -----------------------------------------------------------------------------

function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'utf8');
  const received = Buffer.from(receivedHex, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Verifies `x-razorpay-signature` = hex(HMAC_SHA256(raw_body, webhook_secret)). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature.trim());
}

/** Checkout handler signature = hex(HMAC_SHA256(payment_id + "|" + subscription_id, key_secret)). */
export function verifyCheckoutSignature(params: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret: string;
}): boolean {
  const expected = createHmac('sha256', params.secret)
    .update(`${params.paymentId}|${params.subscriptionId}`)
    .digest('hex');
  return safeEqualHex(expected, params.signature.trim());
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function getPlanDisplay(): PlanDisplay {
  return {
    planId: env.RAZORPAY_PLAN_ID,
    amountPaise: env.RAZORPAY_PLAN_DISPLAY_AMOUNT_PAISE,
    currency: 'INR',
    interval: env.RAZORPAY_PLAN_DISPLAY_INTERVAL,
    brandName: env.RAZORPAY_BRAND_NAME,
  };
}

export function unixToIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export function readFirebaseUidFromNotes(entity: Pick<RazorpaySubscriptionEntity, 'notes'>): string | null {
  const notes = entity.notes;
  if (typeof notes !== 'object' || notes === null || Array.isArray(notes)) return null;
  const uid = (notes as Record<string, unknown>).firebase_uid;
  return typeof uid === 'string' && uid.length > 0 ? uid : null;
}

function describeRazorpayError(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const inner = (error as { error?: { description?: string } }).error;
    if (inner?.description) return inner.description;
  }
  return error instanceof Error ? error.message : 'Unknown Razorpay error';
}

export async function applySubscriptionState(params: {
  uid: string;
  subscriptionId: string;
  active: boolean;
  expiresAt: string | null;
  razorpayState: string;
  /** Razorpay event time; null for checkout verification (no ordering guard). */
  eventAt: string | null;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc('apply_subscription_event', {
    p_firebase_uid: params.uid,
    p_subscription_id: params.subscriptionId,
    p_active: params.active,
    p_expires_at: params.expiresAt,
    p_razorpay_state: params.razorpayState,
    p_event_at: params.eventAt,
  });
  if (error) throw fromDbError(error, 'Updating subscription');
  return data;
}

// -----------------------------------------------------------------------------
// Checkout flow
// -----------------------------------------------------------------------------

/**
 * Creates (or reuses an unpaid) Razorpay subscription for the user and returns
 * everything the client needs to open Razorpay Standard Checkout.
 */
export async function createCheckoutSession(profile: ProfileRow): Promise<CheckoutSession> {
  if (isSubscriptionActive(profile)) {
    throw HttpError.conflict('You already have an active subscription');
  }

  const base = {
    keyId: env.RAZORPAY_KEY_ID,
    plan: getPlanDisplay(),
    prefill: { email: profile.email, name: profile.display_name },
  };

  // Reuse a subscription that was created but never paid (user closed checkout).
  if (profile.razorpay_subscription_id) {
    try {
      const existing = await razorpay.subscriptions.fetch(profile.razorpay_subscription_id);
      if (REUSABLE_STATES.has(existing.status) && existing.plan_id === env.RAZORPAY_PLAN_ID) {
        return { ...base, subscriptionId: existing.id };
      }
    } catch (error) {
      logger.warn(
        { err: describeRazorpayError(error), subscriptionId: profile.razorpay_subscription_id },
        'Could not fetch previous Razorpay subscription; creating a new one',
      );
    }
  }

  let subscriptionId: string;
  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: env.RAZORPAY_PLAN_ID,
      total_count: env.RAZORPAY_TOTAL_COUNT,
      customer_notify: 1,
      notes: {
        firebase_uid: profile.firebase_uid,
        email: profile.email ?? '',
      },
    });
    subscriptionId = subscription.id;
  } catch (error) {
    logger.error({ err: describeRazorpayError(error) }, 'Razorpay subscription creation failed');
    throw HttpError.upstream(`Could not start checkout: ${describeRazorpayError(error)}`);
  }

  const { error } = await supabase
    .from('profiles')
    .update({ razorpay_subscription_id: subscriptionId, razorpay_subscription_state: 'created' })
    .eq('firebase_uid', profile.firebase_uid);
  if (error) throw fromDbError(error, 'Saving subscription reference');

  return { ...base, subscriptionId };
}

/**
 * Called by the app right after Checkout succeeds so access unlocks instantly,
 * without waiting for the webhook. The webhook remains the source of truth for
 * renewals and cancellations.
 */
export async function verifyCheckout(params: {
  uid: string;
  paymentId: string;
  subscriptionId: string;
  signature: string;
}): Promise<{ active: boolean; expiresAt: string | null }> {
  const validSignature = verifyCheckoutSignature({
    paymentId: params.paymentId,
    subscriptionId: params.subscriptionId,
    signature: params.signature,
    secret: env.RAZORPAY_KEY_SECRET,
  });
  if (!validSignature) {
    throw new HttpError(400, 'INVALID_SIGNATURE', 'Payment signature verification failed');
  }

  let subscription: RazorpaySubscriptionEntity;
  try {
    subscription = await razorpay.subscriptions.fetch(params.subscriptionId);
  } catch (error) {
    throw HttpError.upstream(`Could not confirm subscription: ${describeRazorpayError(error)}`);
  }

  const owner = readFirebaseUidFromNotes(subscription);
  if (owner !== params.uid) {
    throw HttpError.forbidden('This subscription belongs to a different account');
  }

  if (!['active', 'authenticated'].includes(subscription.status)) {
    throw HttpError.conflict(`Subscription is ${subscription.status}; payment has not been captured yet`);
  }

  const expiresAt =
    unixToIso(subscription.current_end) ?? new Date(Date.now() + PROVISIONAL_ACCESS_MS).toISOString();

  await applySubscriptionState({
    uid: params.uid,
    subscriptionId: subscription.id,
    active: true,
    expiresAt,
    razorpayState: subscription.status,
    eventAt: null,
  });

  return { active: true, expiresAt };
}

/** Cancels at the end of the current billing cycle; the webhook flips access off then. */
export async function cancelSubscription(profile: ProfileRow): Promise<{ status: string }> {
  if (!profile.razorpay_subscription_id) throw HttpError.notFound('No subscription to cancel');

  try {
    const subscription = await razorpay.subscriptions.cancel(profile.razorpay_subscription_id, true);
    const { error } = await supabase
      .from('profiles')
      .update({ razorpay_subscription_state: subscription.status })
      .eq('firebase_uid', profile.firebase_uid);
    if (error) throw fromDbError(error, 'Saving subscription state');
    return { status: subscription.status };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw HttpError.upstream(`Could not cancel subscription: ${describeRazorpayError(error)}`);
  }
}
