import { generateKeyPairSync } from 'node:crypto';

// Deterministic configuration for unit tests (no real services are contacted).
// firebase-admin parses the service-account key at startup, so use a throwaway one.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-000000000000',
  FIREBASE_PROJECT_ID: 'edushorts-test',
  FIREBASE_CLIENT_EMAIL: 'svc@edushorts-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
  RAZORPAY_PLAN_ID: 'plan_test',
  BUNNY_STREAM_LIBRARY_ID: '123456',
  BUNNY_STREAM_API_KEY: 'bunny-api-key',
  BUNNY_CDN_HOSTNAME: 'vz-test-001.b-cdn.net',
  BUNNY_CDN_TOKEN_KEY: 'cdn-token-key',
  BUNNY_EMBED_TOKEN_KEY: 'embed-token-key',
  BUNNY_URL_TTL_SECONDS: '3600',
});
