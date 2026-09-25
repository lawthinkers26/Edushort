import { supabase } from '../lib/supabase';
import type { ProfileRow, ReelCategory, ReelRow, TablesInsert, TablesUpdate } from '../types/database';
import { decodeCursor, encodeCursor, keysetFilter } from '../utils/cursor';
import { fromDbError, HttpError } from '../utils/httpError';
import { buildPlaybackUrls, type PlaybackUrls } from './bunnyService';

const REEL_COLUMNS =
  'id, bunny_video_id, bunny_library_id, title, description, category, likes_count, comments_count, views_count, duration_seconds, is_published, created_at, updated_at';

export interface ReelDto {
  id: string;
  title: string;
  description: string;
  category: ReelCategory;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  durationSeconds: number | null;
  createdAt: string;
  isLiked: boolean;
  isSaved: boolean;
  /** Null when the viewer is not entitled to play this reel. */
  playback: PlaybackUrls | null;
  locked: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type ViewerState = Pick<ProfileRow, 'liked_reels' | 'saved_reels'>;

export function toReelDto(reel: ReelRow, viewer: ViewerState | null, options: { locked?: boolean } = {}): ReelDto {
  const locked = options.locked ?? false;
  return {
    id: reel.id,
    title: reel.title,
    description: reel.description,
    category: reel.category,
    likesCount: reel.likes_count,
    commentsCount: reel.comments_count,
    viewsCount: reel.views_count,
    durationSeconds: reel.duration_seconds,
    createdAt: reel.created_at,
    isLiked: viewer ? viewer.liked_reels.includes(reel.id) : false,
    isSaved: viewer ? viewer.saved_reels.includes(reel.id) : false,
    playback: locked ? null : buildPlaybackUrls(reel.bunny_video_id, reel.bunny_library_id),
    locked,
  };
}

// -----------------------------------------------------------------------------
// Feed
// -----------------------------------------------------------------------------

export async function listFeed(params: {
  category?: ReelCategory;
  cursor?: string;
  limit: number;
}): Promise<{ rows: ReelRow[]; nextCursor: string | null }> {
  const cursor = decodeCursor(params.cursor);

  let query = supabase
    .from('reels')
    .select(REEL_COLUMNS)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(params.limit + 1); // fetch one extra row to know whether another page exists

  if (params.category) query = query.eq('category', params.category);
  if (cursor) query = query.or(keysetFilter(cursor));

  const { data, error } = await query;
  if (error) throw fromDbError(error, 'Loading feed');

  const hasMore = data.length > params.limit;
  const rows = hasMore ? data.slice(0, params.limit) : data;
  const last = rows.at(-1);

  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

export async function getReelById(id: string, options: { publishedOnly?: boolean } = {}): Promise<ReelRow> {
  let query = supabase.from('reels').select(REEL_COLUMNS).eq('id', id);
  if (options.publishedOnly) query = query.eq('is_published', true);

  const { data, error } = await query.maybeSingle();
  if (error) throw fromDbError(error, 'Loading reel');
  if (!data) throw HttpError.notFound('Reel not found');
  return data;
}

/** Reels the user has saved, most recently saved first. */
export async function listSavedReels(profile: ProfileRow): Promise<ReelRow[]> {
  if (profile.saved_reels.length === 0) return [];

  const { data, error } = await supabase
    .from('reels')
    .select(REEL_COLUMNS)
    .in('id', profile.saved_reels)
    .eq('is_published', true);
  if (error) throw fromDbError(error, 'Loading saved reels');

  const position = new Map(profile.saved_reels.map((id, index) => [id, index]));
  return data.sort((a, b) => (position.get(b.id) ?? 0) - (position.get(a.id) ?? 0));
}

/** Which of `reelIds` has this user already unlocked (viewed)? */
export async function findViewedReelIds(uid: string, reelIds: string[]): Promise<Set<string>> {
  if (reelIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('reel_views')
    .select('reel_id')
    .eq('user_id', uid)
    .in('reel_id', reelIds);
  if (error) throw fromDbError(error, 'Loading view history');
  return new Set(data.map((row) => row.reel_id));
}

// -----------------------------------------------------------------------------
// Engagement (all mutations go through atomic RPCs)
// -----------------------------------------------------------------------------

export interface ViewResult {
  status: 'OK' | 'LIMIT_REACHED';
  counted: boolean;
  subscribed: boolean;
  freeReelsWatched: number;
  freeReelLimit: number;
}

export async function recordView(uid: string, reelId: string): Promise<ViewResult> {
  const { data, error } = await supabase
    .rpc('increment_reel_view', { p_firebase_uid: uid, p_reel_id: reelId })
    .single();
  if (error) throw fromDbError(error, 'Recording view');

  return {
    status: data.status,
    counted: data.counted,
    subscribed: data.subscribed,
    freeReelsWatched: data.watched_count,
    freeReelLimit: data.reel_limit,
  };
}

export async function setLike(uid: string, reelId: string, liked: boolean): Promise<{ liked: boolean; likesCount: number }> {
  const { data, error } = await supabase
    .rpc('set_reel_like', { p_firebase_uid: uid, p_reel_id: reelId, p_liked: liked })
    .single();
  if (error) throw fromDbError(error, 'Updating like');
  return { liked: data.is_liked, likesCount: data.total_likes };
}

export async function setSave(uid: string, reelId: string, saved: boolean): Promise<{ saved: boolean }> {
  const { data, error } = await supabase.rpc('set_reel_save', {
    p_firebase_uid: uid,
    p_reel_id: reelId,
    p_saved: saved,
  });
  if (error) throw fromDbError(error, 'Updating saved reels');
  return { saved: data };
}

// -----------------------------------------------------------------------------
// Admin CRUD
// -----------------------------------------------------------------------------

export async function listReelsForAdmin(params: {
  search?: string;
  category?: ReelCategory;
  page: number;
  pageSize: number;
}): Promise<{ rows: ReelRow[]; total: number }> {
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;

  let query = supabase
    .from('reels')
    .select(REEL_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.category) query = query.eq('category', params.category);
  if (params.search) {
    // Escape LIKE wildcards and PostgREST reserved characters in user input.
    const term = params.search.replace(/[%_\\]/g, (ch) => `\\${ch}`).replace(/[,()"]/g, ' ');
    query = query.ilike('title', `%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) throw fromDbError(error, 'Listing reels');
  return { rows: data, total: count ?? data.length };
}

export async function createReel(input: TablesInsert<'reels'>): Promise<ReelRow> {
  const { data, error } = await supabase.from('reels').insert(input).select(REEL_COLUMNS).single();
  if (error) {
    if (error.code === '23505') throw HttpError.conflict('A reel already exists for this Bunny video ID');
    throw fromDbError(error, 'Creating reel');
  }
  return data;
}

export async function updateReel(id: string, patch: TablesUpdate<'reels'>): Promise<ReelRow> {
  const { data, error } = await supabase.from('reels').update(patch).eq('id', id).select(REEL_COLUMNS).maybeSingle();
  if (error) throw fromDbError(error, 'Updating reel');
  if (!data) throw HttpError.notFound('Reel not found');
  return data;
}

export async function deleteReel(id: string): Promise<ReelRow> {
  const { data, error } = await supabase.from('reels').delete().eq('id', id).select(REEL_COLUMNS).maybeSingle();
  if (error) throw fromDbError(error, 'Deleting reel');
  if (!data) throw HttpError.notFound('Reel not found');
  return data;
}

export function toAdminReelDto(reel: ReelRow) {
  return {
    id: reel.id,
    bunnyVideoId: reel.bunny_video_id,
    bunnyLibraryId: reel.bunny_library_id,
    title: reel.title,
    description: reel.description,
    category: reel.category,
    likesCount: reel.likes_count,
    commentsCount: reel.comments_count,
    viewsCount: reel.views_count,
    durationSeconds: reel.duration_seconds,
    isPublished: reel.is_published,
    createdAt: reel.created_at,
    updatedAt: reel.updated_at,
    thumbnailUrl: buildPlaybackUrls(reel.bunny_video_id, reel.bunny_library_id).thumbnailUrl,
  };
}
