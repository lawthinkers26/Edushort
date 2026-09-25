import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPlan, postCancel, postSubscription, postVerify } from '../controllers/paymentController';
import { authenticate } from '../middleware/authenticate';

export const paymentRouter = Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid ?? req.ip ?? 'anonymous',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many payment attempts, please try again later.' } },
});

paymentRouter.get('/plan', getPlan);
paymentRouter.post('/subscriptions', authenticate(), checkoutLimiter, postSubscription);
paymentRouter.post('/verify', authenticate(), checkoutLimiter, postVerify);
paymentRouter.post('/subscriptions/cancel', authenticate(), checkoutLimiter, postCancel);
