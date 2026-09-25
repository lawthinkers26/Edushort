import type { CategoryFilter } from '../constants/categories';
import type {
  Comment,
  CommentsResponse,
  FeedResponse,
  LikeResponse,
  ReelResponse,
  SaveResponse,
  SavedResponse,
  ViewResponse,
} from '../types/api';
import { apiRequest } from './client';

export function fetchFeed(params: {
  category: CategoryFilter;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<FeedResponse> {
  return apiRequest<FeedResponse>('/api/reels/feed', {
    query: { category: params.category ?? undefined, cursor: params.cursor ?? undefined, limit: params.limit ?? 8 },
    signal: params.signal,
  });
}

export function fetchReel(id: string): Promise<ReelResponse> {
  return apiRequest<ReelResponse>(`/api/reels/${encodeURIComponent(id)}`);
}

export function fetchSavedReels(): Promise<SavedResponse> {
  return apiRequest<SavedResponse>('/api/reels/saved');
}

export function recordView(id: string): Promise<ViewResponse> {
  return apiRequest<ViewResponse>(`/api/reels/${encodeURIComponent(id)}/view`, { method: 'POST' });
}

export function setLiked(id: string, liked: boolean): Promise<LikeResponse> {
  return apiRequest<LikeResponse>(`/api/reels/${encodeURIComponent(id)}/like`, {
    method: liked ? 'POST' : 'DELETE',
  });
}

export function setSaved(id: string, saved: boolean): Promise<SaveResponse> {
  return apiRequest<SaveResponse>(`/api/reels/${encodeURIComponent(id)}/save`, {
    method: saved ? 'POST' : 'DELETE',
  });
}

export function fetchComments(id: string, cursor?: string | null): Promise<CommentsResponse> {
  return apiRequest<CommentsResponse>(`/api/reels/${encodeURIComponent(id)}/comments`, {
    query: { cursor: cursor ?? undefined, limit: 20 },
  });
}

export async function postComment(id: string, body: string): Promise<Comment> {
  const response = await apiRequest<{ comment: Comment }>(`/api/reels/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    body: { body },
  });
  return response.comment;
}
