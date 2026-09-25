import type { CheckoutSession, PlanDisplay, RazorpaySuccessPayload } from '../types/api';
import { apiRequest } from './client';

export function fetchPlan(): Promise<{ plan: PlanDisplay; keyId: string }> {
  return apiRequest('/api/payments/plan', { authenticated: false });
}

export function createCheckoutSession(): Promise<CheckoutSession> {
  return apiRequest<CheckoutSession>('/api/payments/subscriptions', { method: 'POST' });
}

export function verifyCheckout(
  payload: RazorpaySuccessPayload,
): Promise<{ subscription: { active: boolean; expiresAt: string | null } }> {
  return apiRequest('/api/payments/verify', { method: 'POST', body: payload });
}

export function cancelSubscription(): Promise<{ status: string }> {
  return apiRequest('/api/payments/subscriptions/cancel', { method: 'POST' });
}
