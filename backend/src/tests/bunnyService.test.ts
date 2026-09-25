import './setupEnv';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildPlaybackUrls,
  createTusUploadCredentials,
  signBunnyCdnDirectoryUrl,
  signEmbedToken,
} from '../services/bunnyService';

const VIDEO_ID = '9f1c2b7e-4d3a-4f8e-9b1a-2c3d4e5f6a7b';

describe('Bunny token authentication', () => {
  it('signs a directory URL with the token in the path (HLS-safe)', () => {
    const url = signBunnyCdnDirectoryUrl({
      hostname: 'vz-test-001.b-cdn.net',
      filePath: `/${VIDEO_ID}/playlist.m3u8`,
      tokenPath: `/${VIDEO_ID}/`,
      securityKey: 'cdn-token-key',
      expires: 1_900_000_000,
    });

    const expectedToken = createHash('sha256')
      .update(`cdn-token-key/${VIDEO_ID}/1900000000token_path=/${VIDEO_ID}/`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    assert.equal(
      url,
      `https://vz-test-001.b-cdn.net/bcdn_token=${expectedToken}&token_path=%2F${VIDEO_ID}%2F&expires=1900000000/${VIDEO_ID}/playlist.m3u8`,
    );
  });

  it('builds signed playback URLs with a shared expiry', () => {
    const now = Date.UTC(2026, 8, 25);
    const urls = buildPlaybackUrls(VIDEO_ID, '123456', { now });
    const expires = Math.floor(now / 1000) + 3600;

    assert.equal(urls.expiresAt, expires);
    assert.match(urls.hlsUrl, new RegExp(`/bcdn_token=[A-Za-z0-9_-]+&token_path=%2F${VIDEO_ID}%2F&expires=${expires}/${VIDEO_ID}/playlist\\.m3u8$`));
    assert.match(urls.thumbnailUrl, /\/thumbnail\.jpg$/);
    assert.ok(urls.embedUrl.startsWith(`https://iframe.mediadelivery.net/embed/123456/${VIDEO_ID}?`));
    assert.ok(urls.embedUrl.includes(`token=${signEmbedToken('embed-token-key', VIDEO_ID, expires)}&expires=${expires}`));
  });

  it('presigns TUS uploads with SHA256(library + key + expiry + video)', () => {
    const now = Date.UTC(2026, 8, 25);
    const credentials = createTusUploadCredentials(VIDEO_ID, now);
    const expected = createHash('sha256')
      .update(`123456bunny-api-key${credentials.authorizationExpire}${VIDEO_ID}`)
      .digest('hex');

    assert.equal(credentials.authorizationSignature, expected);
    assert.equal(credentials.libraryId, '123456');
    assert.equal(credentials.endpoint, 'https://video.bunnycdn.com/tusupload');
    assert.ok(credentials.authorizationExpire > Math.floor(now / 1000));
  });
});
