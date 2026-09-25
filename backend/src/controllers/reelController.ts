import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireUser } from '../middleware/authenticate';
import { evaluateAccess, serializeAccess } from '../services/accessPolicy';
import { addComment, listComments } from '../services/commentService';
import { getSystemConfig } from '../services/configService';
import { getOrCreateProfile } from '../services/profileService';
import {
  findViewedReelIds,
  getReelById,
  listFeed,
  listSavedReels,
  recordView,
  setLike,
  setSave,
  toReelDto,
} from '../services/reelService';
import { REEL_CATEGORIES } from '../types/database';
import { HttpError } from '../utils/httpError';
import { validate } from '../utils/validate';

const ReelIdParams = z.object({ id: z.uuid({ message: 'Reel id must be a UUID' }) });

const FeedQuery = z.object({
  category: z.enum(REEL_CATEGORIES).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const CommentsQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const CommentBody = z.object({
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'Comment cannot be empty').max(500, 'Comment is limited to 500 characters')),
});

/** GET /api/categories — public list powering the category chips. */
export function getCategories(_req: Request, res: Response): void {
  res.json({ categories: REEL_CATEGORIES });
}

/**
 * GET /api/reels/feed?category=&cursor=&limit=
 * Mounted behind `subscriptionGuard`, so `res.locals.access` is always set.
 * Free users never receive more playable reels in one page than they have
 * free views left.
 */
export async function getFeed(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = res.locals.access;
  if (!access) throw new HttpError(500, 'INTERNAL_ERROR', 'subscriptionGuard must run before getFeed');

  const query = validate(FeedQuery, req.query);
  const limit = access.subscribed ? query.limit : Math.max(1, Math.min(query.limit, access.freeReelsRemaining));

  const [profile, page] = await Promise.all([
    res.locals.profile ?? getOrCreateProfile(user),
    listFeed({ category: query.category, cursor: query.cursor, limit }),
  ]);

  res.json({
    items: page.rows.map((row) => toReelDto(row, profile)),
    nextCursor: page.nextCursor,
    access: serializeAccess(access),
  });
}

/** GET /api/reels/saved — the user's bookmarks. Free users only get playback for reels they already unlocked. */
export async function getSavedReels(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const [profile, config] = await Promise.all([getOrCreateProfile(user), getSystemConfig()]);
  const access = evaluateAccess(profile, config.free_reel_limit);

  const rows = await listSavedReels(profile);
  const unlocked = access.subscribed
    ? null
    : await findViewedReelIds(
        user.uid,
        rows.map((row) => row.id),
      );

  res.json({
    items: rows.map((row) =>
      toReelDto(row, profile, { locked: unlocked !== null && !unlocked.has(row.id) && !access.allowed }),
    ),
    access: serializeAccess(access),
  });
}

/** GET /api/reels/:id — single reel (deep links / share targets). Gated like a view. */
export async function getReel(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = validate(ReelIdParams, req.params);

  const [profile, config, reel] = await Promise.all([
    getOrCreateProfile(user),
    getSystemConfig(),
    getReelById(id, { publishedOnly: true }),
  ]);
  const access = evaluateAccess(profile, config.free_reel_limit);
  const alreadyUnlocked = access.subscribed || (await findViewedReelIds(user.uid, [id])).has(id);

  res.json({
    reel: toReelDto(reel, profile, { locked: !alreadyUnlocked && !access.allowed }),
    access: serializeAccess(access),
  });
}

/**
 * POST /api/reels/:id/view — records a view. For free users this atomically
 * burns one free view (Postgres row lock inside `increment_reel_view`), so
 * parallel requests can never exceed the limit.
 */
export async function postView(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = validate(ReelIdParams, req.params);

  // Ensures the profile row exists before the RPC locks it.
  await getOrCreateProfile(user);
  const result = await recordView(user.uid, id);

  const remaining = result.subscribed ? null : Math.max(result.freeReelLimit - result.freeReelsWatched, 0);

  if (result.status === 'LIMIT_REACHED') {
    res.status(403).json({
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: `You've used all ${result.freeReelLimit} free reels. Subscribe to keep learning.`,
        details: {
          subscribed: false,
          freeReelLimit: result.freeReelLimit,
          freeReelsWatched: result.freeReelsWatched,
          freeReelsRemaining: 0,
        },
      },
    });
    return;
  }

  res.json({
    counted: result.counted,
    access: {
      subscribed: result.subscribed,
      freeReelLimit: result.freeReelLimit,
      freeReelsWatched: result.freeReelsWatched,
      freeReelsRemaining: remaining,
    },
  });
}

async function changeLike(req: Request, res: Response, liked: boolean): Promise<void> {
  const user = requireUser(req);
  const { id } = validate(ReelIdParams, req.params);
  await getOrCreateProfile(user);
  res.json(await setLike(user.uid, id, liked));
}

/** POST /api/reels/:id/like */
export const likeReel = (req: Request, res: Response) => changeLike(req, res, true);
/** DELETE /api/reels/:id/like */
export const unlikeReel = (req: Request, res: Response) => changeLike(req, res, false);

async function changeSave(req: Request, res: Response, saved: boolean): Promise<void> {
  const user = requireUser(req);
  const { id } = validate(ReelIdParams, req.params);
  await getOrCreateProfile(user);
  res.json(await setSave(user.uid, id, saved));
}

/** POST /api/reels/:id/save */
export const saveReel = (req: Request, res: Response) => changeSave(req, res, true);
/** DELETE /api/reels/:id/save */
export const unsaveReel = (req: Request, res: Response) => changeSave(req, res, false);

/** GET /api/reels/:id/comments */
export async function getComments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = validate(ReelIdParams, req.params);
  const query = validate(CommentsQuery, req.query);

  res.json(await listComments({ reelId: id, viewerUid: user.uid, cursor: query.cursor, limit: query.limit }));
}

/** POST /api/reels/:id/comments */
export async function postComment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = validate(ReelIdParams, req.params);
  const { body } = validate(CommentBody, req.body);

  await Promise.all([getOrCreateProfile(user), getReelById(id, { publishedOnly: true })]);
  const comment = await addComment({ reelId: id, uid: user.uid, body });
  res.status(201).json({ comment });
}
