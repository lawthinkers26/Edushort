import type { AccessDecision } from '../types/auth';
import type { ProfileRow } from '../types/database';

type SubscriptionFields = Pick<ProfileRow, 'subscription_status' | 'subscription_expires_at'>;

/** Mirrors public.is_subscription_active(): NULL expiry means "no expiry". */
export function isSubscriptionActive(profile: SubscriptionFields, now: Date = new Date()): boolean {
  if (!profile.subscription_status) return false;
  if (profile.subscription_expires_at === null) return true;
  return new Date(profile.subscription_expires_at).getTime() > now.getTime();
}

/**
 * The metered-paywall rule: subscribers always pass; free users pass while
 * free_reels_watched_count < free_reel_limit.
 */
export function evaluateAccess(
  profile: SubscriptionFields & Pick<ProfileRow, 'free_reels_watched_count'>,
  freeReelLimit: number,
  now: Date = new Date(),
): AccessDecision {
  const subscribed = isSubscriptionActive(profile, now);
  const watched = profile.free_reels_watched_count;
  const remaining = Math.max(freeReelLimit - watched, 0);

  return {
    allowed: subscribed || watched < freeReelLimit,
    subscribed,
    freeReelLimit,
    freeReelsWatched: watched,
    freeReelsRemaining: subscribed ? Number.POSITIVE_INFINITY : remaining,
  };
}

/** JSON-safe view of an AccessDecision (Infinity is not representable in JSON). */
export function serializeAccess(access: AccessDecision) {
  return {
    subscribed: access.subscribed,
    freeReelLimit: access.freeReelLimit,
    freeReelsWatched: access.freeReelsWatched,
    freeReelsRemaining: access.subscribed ? null : access.freeReelsRemaining,
  };
}
