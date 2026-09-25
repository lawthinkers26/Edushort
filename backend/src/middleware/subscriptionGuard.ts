import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { evaluateAccess, serializeAccess } from '../services/accessPolicy';
import { getSystemConfig } from '../services/configService';
import { getOrCreateProfile } from '../services/profileService';
import { requireUser } from './authenticate';

/**
 * Metered paywall for the video feed.
 *
 * Loads the caller's profile and the admin-controlled `free_reel_limit`. A user
 * who is not subscribed and has watched >= free_reel_limit reels is rejected
 * with 403 SUBSCRIPTION_REQUIRED. Otherwise the decision is exposed on
 * `res.locals.access` for the handler (e.g. to cap page size).
 */
export async function subscriptionGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = requireUser(req);

  const [profile, config] = await Promise.all([getOrCreateProfile(user), getSystemConfig()]);
  const access = evaluateAccess(profile, config.free_reel_limit);

  if (!access.allowed) {
    logger.info(
      { uid: user.uid, watched: access.freeReelsWatched, limit: access.freeReelLimit },
      'Feed blocked by paywall',
    );
    res.status(403).json({
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: `You've watched all ${access.freeReelLimit} free reels. Subscribe to unlock unlimited learning.`,
        details: serializeAccess(access),
      },
    });
    return;
  }

  res.locals.access = access;
  res.locals.profile = profile;
  next();
}
