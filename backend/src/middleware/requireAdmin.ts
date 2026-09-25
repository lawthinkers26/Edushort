import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';
import { requireUser } from './authenticate';

/** Allows only users carrying the Firebase custom claim `admin: true`. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = requireUser(req);
  if (!user.isAdmin) throw HttpError.forbidden('Administrator access required');
  next();
}
