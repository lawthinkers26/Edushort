import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { requireUser } from '../middleware/authenticate';
import {
  BunnyVideoStatus,
  createTusUploadCredentials,
  createVideo,
  deleteVideo,
  describeVideoStatus,
  getVideo,
} from '../services/bunnyService';
import { getSystemConfig, updateFreeReelLimit } from '../services/configService';
import {
  createReel,
  deleteReel,
  getReelById,
  listReelsForAdmin,
  toAdminReelDto,
  updateReel,
} from '../services/reelService';
import { REEL_CATEGORIES } from '../types/database';
import { fromDbError, HttpError } from '../utils/httpError';
import { validate } from '../utils/validate';

const BUNNY_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ConfigBody = z.object({
  free_reel_limit: z
    .number({ message: 'free_reel_limit must be a number' })
    .int('free_reel_limit must be a whole number')
    .min(0, 'free_reel_limit cannot be negative')
    .max(10_000, 'free_reel_limit is capped at 10,000'),
});

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`));

const ReelBody = z.object({
  title: trimmed(3, 120, 'Title'),
  description: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000, 'Description must be at most 2000 characters'))
    .default(''),
  category: z.enum(REEL_CATEGORIES, { message: `Category must be one of ${REEL_CATEGORIES.join(', ')}` }),
  bunnyVideoId: z.string().trim().regex(BUNNY_GUID, 'Bunny video ID must be a GUID'),
  bunnyLibraryId: z.string().trim().regex(/^\d+$/, 'Bunny library ID must be numeric'),
  isPublished: z.boolean().default(true),
});

const ReelPatchBody = z
  .object({
    title: trimmed(3, 120, 'Title').optional(),
    description: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(2000, 'Description must be at most 2000 characters'))
      .optional(),
    category: z.enum(REEL_CATEGORIES).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });

const ReelListQuery = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.enum(REEL_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const IdParams = z.object({ id: z.uuid() });
const VideoIdParams = z.object({ videoId: z.string().regex(BUNNY_GUID, 'Bunny video ID must be a GUID') });
const CreateUploadBody = z.object({ title: trimmed(3, 120, 'Title') });
const DeleteQuery = z.object({
  deleteFromBunny: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

// -----------------------------------------------------------------------------
// Paywall configuration
// -----------------------------------------------------------------------------

/** GET /api/admin/config */
export async function getConfig(_req: Request, res: Response): Promise<void> {
  const config = await getSystemConfig();
  res.json({ config });
}

/** PUT /api/admin/config — { free_reel_limit } */
export async function putConfig(req: Request, res: Response): Promise<void> {
  const admin = requireUser(req);
  const { free_reel_limit } = validate(ConfigBody, req.body);

  const config = await updateFreeReelLimit(free_reel_limit, admin.email ?? admin.uid);
  logger.info({ admin: admin.uid, free_reel_limit }, 'Free reel limit updated');
  res.json({ config });
}

/** GET /api/admin/stats — headline numbers for the dashboard. */
export async function getStats(_req: Request, res: Response): Promise<void> {
  const nowIso = new Date().toISOString();
  const [reels, users, subscribers, config] = await Promise.all([
    supabase.from('reels').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('firebase_uid', { count: 'exact', head: true }),
    supabase
      .from('profiles')
      .select('firebase_uid', { count: 'exact', head: true })
      .eq('subscription_status', true)
      .or(`subscription_expires_at.is.null,subscription_expires_at.gt."${nowIso}"`),
    getSystemConfig(),
  ]);

  for (const result of [reels, users, subscribers]) {
    if (result.error) throw fromDbError(result.error, 'Loading stats');
  }

  const freeUsersAtLimit = await supabase
    .from('profiles')
    .select('firebase_uid', { count: 'exact', head: true })
    .gte('free_reels_watched_count', config.free_reel_limit)
    .or(`subscription_status.eq.false,subscription_expires_at.lte."${nowIso}"`);
  if (freeUsersAtLimit.error) throw fromDbError(freeUsersAtLimit.error, 'Loading stats');

  res.json({
    stats: {
      totalReels: reels.count ?? 0,
      totalUsers: users.count ?? 0,
      activeSubscribers: subscribers.count ?? 0,
      freeUsersAtLimit: freeUsersAtLimit.count ?? 0,
      freeReelLimit: config.free_reel_limit,
    },
  });
}

// -----------------------------------------------------------------------------
// Bunny Stream uploads
// -----------------------------------------------------------------------------

/**
 * POST /api/admin/uploads — creates the Bunny video object and returns
 * presigned TUS credentials so the browser uploads directly to Bunny.
 */
export async function postUpload(req: Request, res: Response): Promise<void> {
  const { title } = validate(CreateUploadBody, req.body);
  const video = await createVideo(title);
  res.status(201).json({
    upload: createTusUploadCredentials(video.guid),
    video: { guid: video.guid, libraryId: String(video.videoLibraryId), title: video.title },
  });
}

/** GET /api/admin/uploads/:videoId — encoding progress for the upload workspace. */
export async function getUploadStatus(req: Request, res: Response): Promise<void> {
  const { videoId } = validate(VideoIdParams, req.params);
  const video = await getVideo(videoId);
  res.json({
    video: {
      guid: video.guid,
      libraryId: String(video.videoLibraryId),
      title: video.title,
      status: describeVideoStatus(video.status),
      statusCode: video.status,
      encodeProgress: video.encodeProgress,
      durationSeconds: Math.round(video.length),
      ready: video.status === BunnyVideoStatus.Finished,
    },
  });
}

// -----------------------------------------------------------------------------
// Reel CRUD
// -----------------------------------------------------------------------------

/** GET /api/admin/reels */
export async function listReels(req: Request, res: Response): Promise<void> {
  const query = validate(ReelListQuery, req.query);
  const { rows, total } = await listReelsForAdmin(query);
  res.json({ items: rows.map(toAdminReelDto), total, page: query.page, pageSize: query.pageSize });
}

/** GET /api/admin/reels/:id */
export async function getReel(req: Request, res: Response): Promise<void> {
  const { id } = validate(IdParams, req.params);
  res.json({ reel: toAdminReelDto(await getReelById(id)) });
}

/**
 * POST /api/admin/reels — publishes a reel for a Bunny video. The video must
 * exist in the configured library (verified against the Bunny API) so the
 * feed never serves dead streams.
 */
export async function postReel(req: Request, res: Response): Promise<void> {
  const body = validate(ReelBody, req.body);

  if (body.bunnyLibraryId !== env.BUNNY_STREAM_LIBRARY_ID) {
    throw new HttpError(
      422,
      'VALIDATION_FAILED',
      `Bunny library ${body.bunnyLibraryId} is not the configured library (${env.BUNNY_STREAM_LIBRARY_ID})`,
    );
  }

  const video = await getVideo(body.bunnyVideoId);
  if (video.status === BunnyVideoStatus.Error || video.status === BunnyVideoStatus.UploadFailed) {
    throw new HttpError(422, 'VALIDATION_FAILED', `Bunny reports this video as "${describeVideoStatus(video.status)}"`);
  }

  const reel = await createReel({
    title: body.title,
    description: body.description,
    category: body.category,
    bunny_video_id: body.bunnyVideoId,
    bunny_library_id: body.bunnyLibraryId,
    is_published: body.isPublished,
    duration_seconds: video.length > 0 ? Math.round(video.length) : null,
  });

  res.status(201).json({ reel: toAdminReelDto(reel) });
}

/** PATCH /api/admin/reels/:id */
export async function patchReel(req: Request, res: Response): Promise<void> {
  const { id } = validate(IdParams, req.params);
  const body = validate(ReelPatchBody, req.body);

  const reel = await updateReel(id, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.category !== undefined ? { category: body.category } : {}),
    ...(body.isPublished !== undefined ? { is_published: body.isPublished } : {}),
  });
  res.json({ reel: toAdminReelDto(reel) });
}

/** DELETE /api/admin/reels/:id?deleteFromBunny=true */
export async function removeReel(req: Request, res: Response): Promise<void> {
  const { id } = validate(IdParams, req.params);
  const { deleteFromBunny } = validate(DeleteQuery, req.query);

  const reel = await deleteReel(id);
  if (deleteFromBunny) {
    try {
      await deleteVideo(reel.bunny_video_id);
    } catch (error) {
      // The reel row is already gone; surface the partial failure to the admin.
      logger.error({ err: error, videoId: reel.bunny_video_id }, 'Reel deleted but Bunny video removal failed');
      res.json({ deleted: true, bunnyDeleted: false });
      return;
    }
  }
  res.json({ deleted: true, bunnyDeleted: deleteFromBunny });
}
