import express, { Router } from 'express';
import { handleRazorpayWebhook } from '../controllers/webhookController';

export const webhookRouter = Router();

// Raw body is required: the HMAC must be computed over the exact bytes received.
webhookRouter.post('/razorpay', express.raw({ type: '*/*', limit: '1mb' }), handleRazorpayWebhook);
