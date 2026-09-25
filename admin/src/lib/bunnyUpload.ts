import { Upload } from 'tus-js-client';
import type { TusUploadCredentials } from './types';

export interface BunnyUploadHandle {
  start: () => void;
  pause: () => Promise<void>;
  abort: () => Promise<void>;
}

interface BunnyUploadCallbacks {
  onProgress: (uploadedBytes: number, totalBytes: number) => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}

/**
 * Resumable upload straight from the browser to Bunny Stream over TUS using
 * presigned credentials from the API (the library API key never reaches the
 * browser). Resumes automatically after network drops.
 */
export function createBunnyUpload(
  file: File,
  credentials: TusUploadCredentials,
  callbacks: BunnyUploadCallbacks,
): BunnyUploadHandle {
  const upload = new Upload(file, {
    endpoint: credentials.endpoint,
    retryDelays: [0, 3_000, 5_000, 10_000, 20_000, 60_000],
    chunkSize: 50 * 1024 * 1024,
    headers: {
      AuthorizationSignature: credentials.authorizationSignature,
      AuthorizationExpire: String(credentials.authorizationExpire),
      VideoId: credentials.videoId,
      LibraryId: credentials.libraryId,
    },
    metadata: {
      filetype: file.type || 'video/mp4',
      title: file.name,
    },
    removeFingerprintOnSuccess: true,
    onProgress: (uploaded, total) => callbacks.onProgress(uploaded, total),
    onSuccess: () => callbacks.onSuccess(),
    onError: (error) => {
      const detail = 'originalResponse' in error && error.originalResponse ? error.originalResponse.getBody() : '';
      callbacks.onError(detail ? `${error.message} — ${detail}` : error.message);
    },
  });

  return {
    start: () => {
      upload
        .findPreviousUploads()
        .then((previous) => {
          const resumable = previous[0];
          if (resumable) upload.resumeFromPreviousUpload(resumable);
          upload.start();
        })
        .catch(() => upload.start());
    },
    pause: () => upload.abort(false),
    abort: () => upload.abort(true),
  };
}
