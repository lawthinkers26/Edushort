import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { HttpError } from '../utils/httpError';

const BUNNY_API_BASE = 'https://video.bunnycdn.com';
const BUNNY_TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';
const BUNNY_EMBED_BASE = 'https://iframe.mediadelivery.net/embed';
const REQUEST_TIMEOUT_MS = 15_000;
/** How long an admin has to finish a resumable (TUS) upload. */
const TUS_UPLOAD_WINDOW_SECONDS = 6 * 60 * 60;

/** Bunny Stream video status codes. */
export const BunnyVideoStatus = {
  Created: 0,
  Uploaded: 1,
  Processing: 2,
  Transcoding: 3,
  Finished: 4,
  Error: 5,
  UploadFailed: 6,
  JitSegmenting: 7,
  JitPlaylistsCreated: 8,
} as const;

export interface BunnyVideo {
  guid: string;
  videoLibraryId: number;
  title: string;
  length: number;
  status: number;
  encodeProgress: number;
  thumbnailFileName: string | null;
  width: number;
  height: number;
  dateUploaded: string;
}

export interface PlaybackUrls {
  /** Adaptive HLS manifest — what the mobile player streams. */
  hlsUrl: string;
  /** Poster frame. */
  thumbnailUrl: string;
  /** Animated WebP preview (useful for grids). */
  previewUrl: string;
  /** Bunny's hosted iframe player (fallback / web). */
  embedUrl: string;
  /** Unix seconds after which signed URLs stop working (null when unsigned). */
  expiresAt: number | null;
}

export interface TusUploadCredentials {
  endpoint: string;
  videoId: string;
  libraryId: string;
  /** SHA256(library_id + api_key + expiration_time + video_id) */
  authorizationSignature: string;
  authorizationExpire: number;
}

// -----------------------------------------------------------------------------
// URL signing
// -----------------------------------------------------------------------------

function toUrlSafeBase64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\n/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Bunny CDN "advanced" token authentication (SHA256), directory mode.
 *
 * Signing the directory `/{videoId}/` and placing the token in the *path*
 * (`/bcdn_token=...&expires=...&token_path=.../{videoId}/playlist.m3u8`) means
 * every relative URL inside the HLS manifest (renditions, .ts segments)
 * inherits the token — query-string tokens would be dropped by the player.
 */
export function signBunnyCdnDirectoryUrl(params: {
  hostname: string;
  filePath: string;
  tokenPath: string;
  securityKey: string;
  expires: number;
}): string {
  const { hostname, filePath, tokenPath, securityKey, expires } = params;
  const parameterData = `token_path=${tokenPath}`;
  const hashableBase = `${securityKey}${tokenPath}${expires}${parameterData}`;
  const token = toUrlSafeBase64(createHash('sha256').update(hashableBase).digest());
  const encodedTokenPath = encodeURIComponent(tokenPath);
  return `https://${hostname}/bcdn_token=${token}&token_path=${encodedTokenPath}&expires=${expires}${filePath}`;
}

/** Bunny Stream embed-view token: hex(SHA256(token_security_key + video_id + expires)). */
export function signEmbedToken(securityKey: string, videoId: string, expires: number): string {
  return createHash('sha256').update(`${securityKey}${videoId}${expires}`).digest('hex');
}

export function buildPlaybackUrls(
  videoId: string,
  libraryId: string,
  options: { now?: number; thumbnailFileName?: string | null } = {},
): PlaybackUrls {
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const host = env.BUNNY_CDN_HOSTNAME;
  const thumbnailFile = options.thumbnailFileName || 'thumbnail.jpg';
  const needsExpiry = Boolean(env.BUNNY_CDN_TOKEN_KEY || env.BUNNY_EMBED_TOKEN_KEY);
  const expires = needsExpiry ? nowSeconds + env.BUNNY_URL_TTL_SECONDS : null;

  const cdnUrl = (file: string): string => {
    const filePath = `/${videoId}/${file}`;
    if (env.BUNNY_CDN_TOKEN_KEY && expires !== null) {
      return signBunnyCdnDirectoryUrl({
        hostname: host,
        filePath,
        tokenPath: `/${videoId}/`,
        securityKey: env.BUNNY_CDN_TOKEN_KEY,
        expires,
      });
    }
    return `https://${host}${filePath}`;
  };

  let embedUrl = `${BUNNY_EMBED_BASE}/${libraryId}/${videoId}?autoplay=true&loop=true&muted=false&preload=true&responsive=true`;
  if (env.BUNNY_EMBED_TOKEN_KEY && expires !== null) {
    embedUrl += `&token=${signEmbedToken(env.BUNNY_EMBED_TOKEN_KEY, videoId, expires)}&expires=${expires}`;
  }

  return {
    hlsUrl: cdnUrl('playlist.m3u8'),
    thumbnailUrl: cdnUrl(thumbnailFile),
    previewUrl: cdnUrl('preview.webp'),
    embedUrl,
    expiresAt: expires,
  };
}

// -----------------------------------------------------------------------------
// Stream API
// -----------------------------------------------------------------------------

async function bunnyRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const url = `${BUNNY_API_BASE}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        AccessKey: env.BUNNY_STREAM_API_KEY,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logger.error({ err: error, method, path }, 'Bunny Stream request failed');
    throw HttpError.upstream('Could not reach Bunny Stream');
  }

  if (response.status === 404) throw HttpError.notFound('Video not found in Bunny Stream library');

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error({ status: response.status, body: text.slice(0, 500), method, path }, 'Bunny Stream API error');
    throw HttpError.upstream(`Bunny Stream responded with HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Creates an empty video object; the file itself is then uploaded via TUS. */
export async function createVideo(title: string): Promise<BunnyVideo> {
  return bunnyRequest<BunnyVideo>('POST', `/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos`, { title });
}

export async function getVideo(videoId: string): Promise<BunnyVideo> {
  return bunnyRequest<BunnyVideo>(
    'GET',
    `/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${encodeURIComponent(videoId)}`,
  );
}

export async function deleteVideo(videoId: string): Promise<void> {
  await bunnyRequest<unknown>('DELETE', `/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${encodeURIComponent(videoId)}`);
}

/**
 * Presigned credentials that let the admin browser upload straight to Bunny
 * over TUS without ever seeing the library API key.
 */
export function createTusUploadCredentials(videoId: string, now: number = Date.now()): TusUploadCredentials {
  const authorizationExpire = Math.floor(now / 1000) + TUS_UPLOAD_WINDOW_SECONDS;
  const authorizationSignature = createHash('sha256')
    .update(`${env.BUNNY_STREAM_LIBRARY_ID}${env.BUNNY_STREAM_API_KEY}${authorizationExpire}${videoId}`)
    .digest('hex');

  return {
    endpoint: BUNNY_TUS_ENDPOINT,
    videoId,
    libraryId: env.BUNNY_STREAM_LIBRARY_ID,
    authorizationSignature,
    authorizationExpire,
  };
}

export function describeVideoStatus(status: number): string {
  switch (status) {
    case BunnyVideoStatus.Created:
      return 'created';
    case BunnyVideoStatus.Uploaded:
      return 'uploaded';
    case BunnyVideoStatus.Processing:
      return 'processing';
    case BunnyVideoStatus.Transcoding:
      return 'transcoding';
    case BunnyVideoStatus.Finished:
      return 'finished';
    case BunnyVideoStatus.Error:
      return 'error';
    case BunnyVideoStatus.UploadFailed:
      return 'upload_failed';
    case BunnyVideoStatus.JitSegmenting:
      return 'jit_segmenting';
    case BunnyVideoStatus.JitPlaylistsCreated:
      return 'jit_playlists_created';
    default:
      return 'unknown';
  }
}
