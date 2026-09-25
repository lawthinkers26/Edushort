import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { FirebaseAuthError } from 'firebase-admin/auth';
import { firebaseAuth } from '../lib/firebaseAdmin';
import { logger } from '../lib/logger';
import type { AuthUser } from '../types/auth';
import { HttpError } from '../utils/httpError';

interface AuthenticateOptions {
  /**
   * Also check that the token has not been revoked (extra round-trip to
   * Firebase). Enabled for admin routes; user routes rely on the 1h token TTL.
   */
  checkRevoked?: boolean;
}

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header) throw HttpError.unauthenticated('Missing Authorization header');

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw HttpError.unauthenticated('Authorization header must be "Bearer <Firebase ID token>"');
  }
  return token.trim();
}

/**
 * Verifies the Firebase ID token in `Authorization: Bearer <token>` and injects
 * `req.user` ({ uid, email, ... }) for downstream handlers.
 */
export function authenticate(options: AuthenticateOptions = {}): RequestHandler {
  const { checkRevoked = false } = options;

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);

    try {
      const decoded = await firebaseAuth.verifyIdToken(token, checkRevoked);
      req.user = {
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: decoded.email_verified === true,
        name: typeof decoded.name === 'string' ? decoded.name : null,
        isAdmin: decoded.admin === true,
      };
      next();
    } catch (error) {
      if (error instanceof FirebaseAuthError) {
        const expired = error.code === 'auth/id-token-expired';
        const revoked = error.code === 'auth/id-token-revoked' || error.code === 'auth/user-disabled';
        logger.debug({ code: error.code }, 'Firebase token rejected');
        throw HttpError.unauthenticated(
          expired ? 'ID token expired' : revoked ? 'Session revoked, please sign in again' : 'Invalid ID token',
        );
      }
      throw error;
    }
  };
}

/** Narrow `req.user` for handlers mounted behind `authenticate`. */
export function requireUser(req: Request): AuthUser {
  if (!req.user) throw HttpError.unauthenticated();
  return req.user;
}
