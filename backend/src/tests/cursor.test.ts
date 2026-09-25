import './setupEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeCursor, encodeCursor, keysetFilter } from '../utils/cursor';
import { HttpError } from '../utils/httpError';

describe('keyset cursor', () => {
  const cursor = { createdAt: '2026-09-25T06:00:00.123456+00:00', id: '9f1c2b7e-4d3a-4f8e-9b1a-2c3d4e5f6a7b' };

  it('round-trips', () => {
    assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  });

  it('returns null when absent and rejects garbage', () => {
    assert.equal(decodeCursor(undefined), null);
    assert.throws(() => decodeCursor('not-a-cursor'), HttpError);
    assert.throws(() => decodeCursor(Buffer.from('["x","y"]').toString('base64url')), HttpError);
  });

  it('builds a quoted PostgREST keyset filter', () => {
    assert.equal(
      keysetFilter(cursor),
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
    );
  });
});
