import 'dotenv/config';
import { z } from 'zod';

const numeric = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return fallback;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: 'custom', message: `Expected a number, received "${value}"` });
        return z.NEVER;
      }
      return parsed;
    });

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: numeric(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.email(),
  FIREBASE_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((key) => key.replace(/\\n/g, '\n')),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  RAZORPAY_PLAN_ID: z.string().min(1),
  RAZORPAY_TOTAL_COUNT: numeric(12),
  RAZORPAY_PLAN_DISPLAY_AMOUNT_PAISE: numeric(19900),
  RAZORPAY_PLAN_DISPLAY_INTERVAL: z.string().default('month'),
  RAZORPAY_BRAND_NAME: z.string().default('EduShorts'),

  BUNNY_STREAM_LIBRARY_ID: z.string().regex(/^\d+$/, 'BUNNY_STREAM_LIBRARY_ID must be numeric'),
  BUNNY_STREAM_API_KEY: z.string().min(1),
  BUNNY_CDN_HOSTNAME: z
    .string()
    .min(1)
    .transform((host) => host.replace(/^https?:\/\//, '').replace(/\/+$/, '')),
  BUNNY_CDN_TOKEN_KEY: optionalSecret,
  BUNNY_EMBED_TOKEN_KEY: optionalSecret,
  BUNNY_URL_TTL_SECONDS: numeric(3600),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

export const env: Env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
