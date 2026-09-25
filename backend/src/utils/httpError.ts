export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SUBSCRIPTION_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_SIGNATURE'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, 'BAD_REQUEST', message, details);
  }

  static unauthenticated(message = 'Authentication required'): HttpError {
    return new HttpError(401, 'UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have access to this resource'): HttpError {
    return new HttpError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): HttpError {
    return new HttpError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, 'CONFLICT', message, details);
  }

  static upstream(message: string, details?: unknown): HttpError {
    return new HttpError(502, 'UPSTREAM_ERROR', message, details);
  }
}

/** Supabase/PostgREST error shape (kept structural to avoid version coupling). */
export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Translate a Supabase error into an HttpError. Custom exceptions raised in
 * our plpgsql functions (e.g. `REEL_NOT_FOUND`) surface as their message.
 */
export function fromDbError(error: DbError, context: string): HttpError {
  if (error.message === 'REEL_NOT_FOUND') return HttpError.notFound('Reel not found');
  if (error.message === 'PROFILE_NOT_FOUND') return HttpError.notFound('Profile not found');
  if (error.code === '23505') return HttpError.conflict(`${context}: duplicate value`, error.details);
  if (error.code === '23503') return HttpError.notFound(`${context}: referenced record does not exist`);
  if (error.code === '23514' || error.code === '22P02') {
    return new HttpError(422, 'VALIDATION_FAILED', `${context}: invalid value`, error.details ?? error.message);
  }
  return new HttpError(500, 'INTERNAL_ERROR', `${context} failed`, {
    code: error.code,
    message: error.message,
  });
}
