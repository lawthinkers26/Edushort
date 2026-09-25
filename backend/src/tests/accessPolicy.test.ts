import './setupEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateAccess, isSubscriptionActive, serializeAccess } from '../services/accessPolicy';

const now = new Date('2026-09-25T00:00:00Z');

describe('evaluateAccess (metered paywall rule)', () => {
  it('allows a free user below the limit', () => {
    const access = evaluateAccess(
      { subscription_status: false, subscription_expires_at: null, free_reels_watched_count: 4 },
      5,
      now,
    );
    assert.equal(access.allowed, true);
    assert.equal(access.freeReelsRemaining, 1);
  });

  it('blocks a free user whose count equals the limit', () => {
    const access = evaluateAccess(
      { subscription_status: false, subscription_expires_at: null, free_reels_watched_count: 5 },
      5,
      now,
    );
    assert.equal(access.allowed, false);
    assert.equal(access.freeReelsRemaining, 0);
  });

  it('blocks a free user whose count exceeds a lowered limit', () => {
    const access = evaluateAccess(
      { subscription_status: false, subscription_expires_at: null, free_reels_watched_count: 9 },
      3,
      now,
    );
    assert.equal(access.allowed, false);
  });

  it('always allows an active subscriber', () => {
    const access = evaluateAccess(
      { subscription_status: true, subscription_expires_at: '2026-10-25T00:00:00Z', free_reels_watched_count: 99 },
      5,
      now,
    );
    assert.equal(access.allowed, true);
    assert.equal(serializeAccess(access).freeReelsRemaining, null);
  });

  it('treats an expired subscription as free', () => {
    const profile = { subscription_status: true, subscription_expires_at: '2026-09-24T23:59:59Z' };
    assert.equal(isSubscriptionActive(profile, now), false);
    assert.equal(evaluateAccess({ ...profile, free_reels_watched_count: 5 }, 5, now).allowed, false);
  });

  it('treats a null expiry on an active subscription as lifetime access', () => {
    assert.equal(isSubscriptionActive({ subscription_status: true, subscription_expires_at: null }, now), true);
  });
});
