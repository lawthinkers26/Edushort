import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config/env';
import { logger } from '../lib/logger';
import { HttpError } from '../utils/httpError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(HttpError.notFound(`Route ${req.method} ${req.path} does not exist`));
}

function isBodyParserError(error: unknown): error is { type: string; status: number; message: string } {
  return typeof error === 'object' && error !== null && 'type' in error && 'status' in error;
}

// Express recognises error handlers by their 4-argument signature.
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    logger.error({ err: error }, 'Error after response was sent');
    return;
  }

  if (error instanceof HttpError) {
    if (error.status >= 500) logger.error({ err: error, details: error.details, path: req.path }, error.message);
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && (error.status < 500 || !isProduction) ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (isBodyParserError(error)) {
    const status = error.type === 'entity.too.large' ? 413 : 400;
    res.status(status).json({
      error: { code: 'BAD_REQUEST', message: status === 413 ? 'Request body too large' : 'Malformed request body' },
    });
    return;
  }

  logger.error({ err: error, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      ...(!isProduction && error instanceof Error ? { details: error.message } : {}),
    },
  });
}
