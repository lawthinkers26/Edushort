import type { z } from 'zod';
import { HttpError } from './httpError';

/** Parse `input` with `schema`, throwing a 422 HttpError listing every issue. */
export function validate<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      422,
      'VALIDATION_FAILED',
      'Request validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
