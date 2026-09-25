export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Set via Firebase custom claim `{ admin: true }` (see scripts/setAdminClaim.ts). */
  isAdmin: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  subscribed: boolean;
  freeReelLimit: number;
  freeReelsWatched: number;
  freeReelsRemaining: number;
}
