import { config } from '../config';
import { auth } from './firebase';
import type {
  AdminReel,
  BunnyVideoStatus,
  CreateUploadResponse,
  DashboardStats,
  FieldIssue,
  ReelCategory,
  ReelInput,
  ReelListResponse,
  SystemConfig,
} from './types';

const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level issues from a 422 VALIDATION_FAILED response. */
  get fieldIssues(): FieldIssue[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (issue): issue is FieldIssue =>
        typeof issue === 'object' && issue !== null && 'path' in issue && 'message' in issue,
    );
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');

  const url = new URL(`${config.apiUrl}${path}`);
  Object.entries(options.query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });

  const send = async (forceRefresh: boolean): Promise<Response> => {
    const token = await user.getIdToken(forceRefresh);
    try {
      return await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond.');
      }
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the EduShorts API. Check your connection.');
    }
  };

  let response = await send(false);
  if (response.status === 401) response = await send(true);

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `Request failed (${response.status})`,
      error?.details,
    );
  }

  return payload as T;
}

export const adminApi = {
  getConfig: () => request<{ config: SystemConfig }>('GET', '/api/admin/config').then((r) => r.config),

  updateFreeReelLimit: (freeReelLimit: number) =>
    request<{ config: SystemConfig }>('PUT', '/api/admin/config', { body: { free_reel_limit: freeReelLimit } }).then(
      (r) => r.config,
    ),

  getStats: () => request<{ stats: DashboardStats }>('GET', '/api/admin/stats').then((r) => r.stats),

  createUpload: (title: string) => request<CreateUploadResponse>('POST', '/api/admin/uploads', { body: { title } }),

  getUploadStatus: (videoId: string) =>
    request<{ video: BunnyVideoStatus }>('GET', `/api/admin/uploads/${encodeURIComponent(videoId)}`).then(
      (r) => r.video,
    ),

  listReels: (params: { search?: string; category?: ReelCategory; page: number; pageSize: number }) =>
    request<ReelListResponse>('GET', '/api/admin/reels', { query: params }),

  createReel: (input: ReelInput) =>
    request<{ reel: AdminReel }>('POST', '/api/admin/reels', { body: input }).then((r) => r.reel),

  updateReel: (
    id: string,
    patch: Partial<Pick<AdminReel, 'title' | 'description' | 'category' | 'isPublished'>>,
  ) => request<{ reel: AdminReel }>('PATCH', `/api/admin/reels/${id}`, { body: patch }).then((r) => r.reel),

  deleteReel: (id: string, deleteFromBunny: boolean) =>
    request<{ deleted: boolean; bunnyDeleted: boolean }>('DELETE', `/api/admin/reels/${id}`, {
      query: { deleteFromBunny },
    }),
};
