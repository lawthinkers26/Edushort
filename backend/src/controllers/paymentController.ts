import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { requireUser } from '../middleware/authenticate';
import { getOrCreateProfile } from '../services/profileService';
import {
  cancelSubscription,
  createCheckoutSession,
  getPlanDisplay,
  verifyCheckout,
} from '../services/subscriptionService';
import { validate } from '../utils/validate';

const VerifyBody = z.object({
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/, 'Invalid payment id'),
  razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/, 'Invalid subscription id'),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid signature'),
});

/** GET /api/payments/plan — what the paywall displays. */
export function getPlan(_req: Request, res: Response): void {
  res.json({ plan: getPlanDisplay(), keyId: env.RAZORPAY_KEY_ID });
}

/** POST /api/payments/subscriptions — start Razorpay Standard Checkout. */
export async function postSubscription(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await getOrCreateProfile(user);
  res.status(201).json(await createCheckoutSession(profile));
}

/** POST /api/payments/verify — Checkout `handler` response → instant unlock. */
export async function postVerify(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = validate(VerifyBody, req.body);

  await getOrCreateProfile(user);
  const result = await verifyCheckout({
    uid: user.uid,
    paymentId: body.razorpay_payment_id,
    subscriptionId: body.razorpay_subscription_id,
    signature: body.razorpay_signature,
  });
  res.json({ subscription: result });
}

/** POST /api/payments/subscriptions/cancel — cancel at the end of the current cycle. */
export async function postCancel(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await getOrCreateProfile(user);
  res.json(await cancelSubscription(profile));
}
