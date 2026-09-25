import './setupEnv';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app';
import {
  readFirebaseUidFromNotes,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/subscriptionService';

describe('Razorpay signatures', () => {
  const body = Buffer.from(JSON.stringify({ event: 'subscription.charged', created_at: 1, payload: {} }));

  it('accepts a correct webhook signature', () => {
    const signature = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    assert.equal(verifyWebhookSignature(body, signature, 'whsec_test'), true);
  });

  it('rejects a tampered body, a wrong secret and an empty signature', () => {
    const signature = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    assert.equal(verifyWebhookSignature(Buffer.concat([body, Buffer.from(' ')]), signature, 'whsec_test'), false);
    assert.equal(verifyWebhookSignature(body, signature, 'other'), false);
    assert.equal(verifyWebhookSignature(body, '', 'whsec_test'), false);
    assert.equal(verifyWebhookSignature(body, 'short', 'whsec_test'), false);
  });

  it('verifies the checkout handler signature (payment_id|subscription_id)', () => {
    const signature = createHmac('sha256', 'rzp_test_secret').update('pay_ABC|sub_XYZ').digest('hex');
    assert.equal(
      verifyCheckoutSignature({ paymentId: 'pay_ABC', subscriptionId: 'sub_XYZ', signature, secret: 'rzp_test_secret' }),
      true,
    );
    assert.equal(
      verifyCheckoutSignature({ paymentId: 'pay_ABC', subscriptionId: 'sub_OTHER', signature, secret: 'rzp_test_secret' }),
      false,
    );
  });

  it('reads the Firebase UID from subscription notes', () => {
    assert.equal(readFirebaseUidFromNotes({ notes: { firebase_uid: 'abc' } }), 'abc');
    assert.equal(readFirebaseUidFromNotes({ notes: [] }), null);
    assert.equal(readFirebaseUidFromNotes({ notes: null }), null);
  });
});

describe('HTTP surface (no external services needed)', () => {
  const app = createApp();

  it('rejects webhooks with a bad signature before touching the database', async () => {
    const response = await request(app)
      .post('/api/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', 'deadbeef')
      .send(JSON.stringify({ event: 'subscription.charged', created_at: 1, payload: {} }));

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_SIGNATURE');
  });

  it('acknowledges correctly signed events it does not act on', async () => {
    const payload = JSON.stringify({ event: 'payment.authorized', created_at: 1, payload: {} });
    const signature = createHmac('sha256', 'whsec_test').update(payload).digest('hex');
    const response = await request(app)
      .post('/api/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', signature)
      .send(payload);

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ignored');
  });

  it('requires a bearer token for the feed', async () => {
    const response = await request(app).get('/api/reels/feed');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });

  it('requires a bearer token for admin configuration', async () => {
    const response = await request(app).put('/api/admin/config').send({ free_reel_limit: 3 });
    assert.equal(response.status, 401);
  });

  it('serves the category list publicly', async () => {
    const response = await request(app).get('/api/categories');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.categories, ['History', 'Polity', 'Geography', 'Science']);
  });
});
