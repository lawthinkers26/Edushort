import type { ReelCategory } from '../constants/categories';

export interface PlaybackUrls {
  hlsUrl: string;
  thumbnailUrl: string;
  previewUrl: string;
  embedUrl: string;
  /** Unix seconds; null when URLs are unsigned. */
  expiresAt: number | null;
}

export interface Reel {
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
  playback: PlaybackUrls | null;
  locked: boolean;
}

export interface AccessInfo {
  subscribed: boolean;
  freeReelLimit: number;
  freeReelsWatched: number;
  /** null for subscribers (unlimited). */
  freeReelsRemaining: number | null;
}

export interface FeedResponse {
  items: Reel[];
  nextCursor: string | null;
  access: AccessInfo;
}

export interface SavedResponse {
  items: Reel[];
  access: AccessInfo;
}

export interface ReelResponse {
  reel: Reel;
  access: AccessInfo;
}

export interface ViewResponse {
  counted: boolean;
  access: AccessInfo;
}

export interface LikeResponse {
  liked: boolean;
  likesCount: number;
}

export interface SaveResponse {
  saved: boolean;
}

export interface Comment {
  id: string;
  reelId: string;
  body: string;
  createdAt: string;
  author: { uid: string; displayName: string };
  isMine: boolean;
}

export interface CommentsResponse {
  items: Comment[];
  nextCursor: string | null;
}

export interface Profile {
  uid: string;
  email: string | null;
  displayName: string | null;
  subscription: {
    active: boolean;
    status: boolean;
    expiresAt: string | null;
    razorpayState: string | null;
  };
  access: AccessInfo;
  likedCount: number;
  savedCount: number;
  createdAt: string;
}

export interface PlanDisplay {
  planId: string;
  amountPaise: number;
  currency: 'INR';
  interval: string;
  brandName: string;
}

export interface CheckoutSession {
  keyId: string;
  subscriptionId: string;
  plan: PlanDisplay;
  prefill: { email: string | null; name: string | null };
}

/** Payload Razorpay Checkout passes to `handler` for subscriptions. */
export interface RazorpaySuccessPayload {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}
