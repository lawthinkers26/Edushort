import type { AccessDecision, AuthUser } from './auth';
import type { ProfileRow } from './database';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `authenticate` middleware. */
      user?: AuthUser;
    }

    interface Locals {
      /** Populated by the `subscriptionGuard` middleware. */
      access?: AccessDecision;
      /** Caller's profile, loaded by `subscriptionGuard`. */
      profile?: ProfileRow;
    }
  }
}

export {};
