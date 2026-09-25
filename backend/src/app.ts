import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { getCategories } from './controllers/reelController';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { adminRouter } from './routes/adminRoutes';
import { paymentRouter } from './routes/paymentRoutes';
import { profileRouter } from './routes/profileRoutes';
import { reelRouter } from './routes/reelRoutes';
import { webhookRouter } from './routes/webhookRoutes';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      // Native mobile clients send no Origin header; browsers must be allow-listed.
      origin: (origin, callback) => {
        if (!origin || env.CORS_ORIGINS.includes(origin)) callback(null, true);
        else callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, error) => (error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  // Webhooks need the raw body, so they are mounted BEFORE express.json().
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/categories', getCategories);
  app.use('/api/me', profileRouter);
  app.use('/api/reels', reelRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
