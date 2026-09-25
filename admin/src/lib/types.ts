export const REEL_CATEGORIES = ['History', 'Polity', 'Geography', 'Science'] as const;
export type ReelCategory = (typeof REEL_CATEGORIES)[number];

export function isReelCategory(value: string): value is ReelCategory {
  return (REEL_CATEGORIES as readonly string[]).includes(value);
}

export interface SystemConfig {
  id: number;
  free_reel_limit: number;
  updated_at: string;
  updated_by: string | null;
}

export interface AdminReel {
  id: string;
  bunnyVideoId: string;
  bunnyLibraryId: string;
  title: string;
  description: string;
  category: ReelCategory;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  durationSeconds: number | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string;
}

export interface ReelListResponse {
  items: AdminReel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  totalReels: number;
  totalUsers: number;
  activeSubscribers: number;
  freeUsersAtLimit: number;
  freeReelLimit: number;
}

export interface TusUploadCredentials {
  endpoint: string;
  videoId: string;
  libraryId: string;
  authorizationSignature: string;
  authorizationExpire: number;
}

export interface CreateUploadResponse {
  upload: TusUploadCredentials;
  video: { guid: string; libraryId: string; title: string };
}

export interface BunnyVideoStatus {
  guid: string;
  libraryId: string;
  title: string;
  status: string;
  statusCode: number;
  encodeProgress: number;
  durationSeconds: number;
  ready: boolean;
}

export interface ReelInput {
  title: string;
  description: string;
  category: ReelCategory;
  bunnyVideoId: string;
  bunnyLibraryId: string;
  isPublished: boolean;
}

export interface FieldIssue {
  path: string;
  message: string;
}
