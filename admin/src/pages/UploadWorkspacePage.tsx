import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useToast } from '../context/ToastContext';
import { ApiError, adminApi, describeError } from '../lib/api';
import { createBunnyUpload, type BunnyUploadHandle } from '../lib/bunnyUpload';
import { REEL_CATEGORIES, isReelCategory, type AdminReel, type BunnyVideoStatus } from '../lib/types';
import {
  DESCRIPTION_MAX,
  GUID_RE,
  TITLE_MAX,
  formatBytes,
  toReelInput,
  validateReelForm,
  validateVideoFile,
  type ReelFormErrors,
  type ReelFormValues,
} from '../lib/validation';

type Mode = 'upload' | 'link';
type UploadPhase = 'idle' | 'creating' | 'uploading' | 'paused' | 'uploaded' | 'error';

const EMPTY_FORM: ReelFormValues = {
  title: '',
  description: '',
  category: '',
  bunnyVideoId: '',
  bunnyLibraryId: '',
  isPublished: true,
};

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(['finished', 'error', 'upload_failed']);

function EncodingBadge({ video }: { video: BunnyVideoStatus }) {
  const failed = video.status === 'error' || video.status === 'upload_failed';
  const tone = video.ready
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    : failed
      ? 'bg-red-50 text-red-700 ring-red-600/20'
      : 'bg-amber-50 text-amber-800 ring-amber-600/20';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {!video.ready && !failed ? <Spinner className="h-3 w-3" /> : null}
      {video.ready ? 'Ready to stream' : failed ? 'Encoding failed' : `Encoding ${video.encodeProgress}%`}
    </span>
  );
}

export function UploadWorkspacePage() {
  const { notify } = useToast();
  const [mode, setMode] = useState<Mode>('upload');
  const [form, setForm] = useState<ReelFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<ReelFormErrors>({});
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<BunnyVideoStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<AdminReel | null>(null);

  const uploadRef = useRef<BunnyUploadHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setField = <K extends keyof ReelFormValues>(key: K, value: ReelFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  // Abort any in-flight upload when leaving the page.
  useEffect(() => () => void uploadRef.current?.abort().catch(() => undefined), []);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (phase !== 'uploading') return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // Poll Bunny for encoding progress once a video ID is known.
  const videoIdToPoll =
    (mode === 'upload' && phase === 'uploaded') || (mode === 'link' && encoding) ? form.bunnyVideoId : null;

  useEffect(() => {
    if (!videoIdToPoll || (encoding && TERMINAL_STATUSES.has(encoding.status))) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await adminApi.getUploadStatus(videoIdToPoll);
        if (!cancelled) setEncoding(status);
      } catch (error) {
        if (!cancelled && error instanceof ApiError && error.status === 404) {
          setEncoding(null);
          setUploadError('Bunny no longer has this video.');
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [videoIdToPoll, encoding?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFile = (candidate: File | undefined) => {
    if (!candidate) return;
    const problem = validateVideoFile(candidate);
    if (problem) {
      setErrors((current) => ({ ...current, file: problem }));
      return;
    }
    setFile(candidate);
    setErrors((current) => ({ ...current, file: undefined }));
    setUploadError(null);
    if (!form.title.trim()) {
      setField('title', candidate.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, TITLE_MAX));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (phase === 'idle' || phase === 'error') chooseFile(event.dataTransfer.files[0]);
  };

  const startUpload = useCallback(async () => {
    if (!file) {
      setErrors((current) => ({ ...current, file: 'Choose a video to upload.' }));
      return;
    }
    const title = form.title.trim();
    if (title.length < 3) {
      setErrors((current) => ({ ...current, title: 'Enter a title before uploading (used as the Bunny video name).' }));
      return;
    }

    setUploadError(null);
    setPhase('creating');
    setProgress(0);
    setEncoding(null);

    try {
      const { upload, video } = await adminApi.createUpload(title);
      setForm((current) => ({ ...current, bunnyVideoId: video.guid, bunnyLibraryId: video.libraryId }));

      const handle = createBunnyUpload(file, upload, {
        onProgress: (sent, total) => setProgress(total > 0 ? sent / total : 0),
        onSuccess: () => {
          setPhase('uploaded');
          setProgress(1);
          notify('Upload complete — Bunny is encoding the video.', 'success');
        },
        onError: (message) => {
          setPhase('error');
          setUploadError(message);
        },
      });
      uploadRef.current = handle;
      setPhase('uploading');
      handle.start();
    } catch (error) {
      setPhase('error');
      setUploadError(describeError(error));
    }
  }, [file, form.title, notify]);

  const pauseUpload = async () => {
    await uploadRef.current?.pause();
    setPhase('paused');
  };

  const resumeUpload = () => {
    uploadRef.current?.start();
    setPhase('uploading');
  };

  const cancelUpload = async () => {
    await uploadRef.current?.abort().catch(() => undefined);
    uploadRef.current = null;
    setPhase('idle');
    setProgress(0);
    setForm((current) => ({ ...current, bunnyVideoId: '', bunnyLibraryId: '' }));
  };

  const verifyExisting = async () => {
    const videoId = form.bunnyVideoId.trim();
    if (!GUID_RE.test(videoId)) {
      setErrors((current) => ({ ...current, bunnyVideoId: 'Enter a valid Bunny video GUID first.' }));
      return;
    }
    setVerifying(true);
    try {
      const status = await adminApi.getUploadStatus(videoId);
      setEncoding(status);
      setForm((current) => ({
        ...current,
        bunnyLibraryId: status.libraryId,
        title: current.title.trim() ? current.title : status.title.slice(0, TITLE_MAX),
      }));
      setErrors((current) => ({ ...current, bunnyVideoId: undefined, bunnyLibraryId: undefined }));
    } catch (error) {
      setEncoding(null);
      setErrors((current) => ({
        ...current,
        bunnyVideoId: error instanceof ApiError && error.status === 404 ? 'No video with this ID in the library.' : describeError(error),
      }));
    } finally {
      setVerifying(false);
    }
  };

  const resetWorkspace = () => {
    uploadRef.current = null;
    setForm(EMPTY_FORM);
    setErrors({});
    setFile(null);
    setPhase('idle');
    setProgress(0);
    setUploadError(null);
    setEncoding(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateReelForm(form);
    if (mode === 'upload' && phase !== 'uploaded') {
      nextErrors.file = phase === 'uploading' ? 'Wait for the upload to finish.' : 'Upload the video to Bunny first.';
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitting(true);
    try {
      const reel = await adminApi.createReel(toReelInput(form));
      setCreated(reel);
      notify(`“${reel.title}” is ${reel.isPublished ? 'live in the feed' : 'saved as a draft'}.`, 'success');
      resetWorkspace();
    } catch (error) {
      if (error instanceof ApiError && error.fieldIssues.length > 0) {
        const serverErrors: ReelFormErrors = {};
        error.fieldIssues.forEach((issue) => {
          const key = issue.path as keyof ReelFormValues;
          if (key in EMPTY_FORM) serverErrors[key] = issue.message;
        });
        setErrors(serverErrors);
      }
      notify(describeError(error), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadLocked = phase === 'creating' || phase === 'uploading' || phase === 'paused' || phase === 'uploaded';

  return (
    <>
      <PageHeader
        title="Upload Workspace"
        description="Upload a lesson straight to Bunny Stream (or link an existing Bunny video), describe it, and publish it to the feed."
      />

      {created ? (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span>
            Published <strong>{created.title}</strong> in {created.category}.
          </span>
          <Link to="/reels" className="font-semibold underline">
            View library
          </Link>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-5">
        {/* Video source */}
        <section className="card p-6 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">1. Video source</h2>

          <div className="mt-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
            {(['upload', 'link'] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={uploadLocked && phase !== 'uploaded'}
                onClick={() => {
                  if (option === mode) return;
                  resetWorkspace();
                  setMode(option);
                }}
                className={`rounded-md px-3 py-1.5 transition ${mode === option ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {option === 'upload' ? 'Upload file' : 'Link existing'}
              </button>
            ))}
          </div>

          {mode === 'upload' ? (
            <div className="mt-5 space-y-4">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
                  dragging ? 'border-brand-500 bg-brand-50' : errors.file ? 'border-red-300' : 'border-slate-300'
                }`}
              >
                <span className="text-3xl" aria-hidden>
                  🎞️
                </span>
                {file ? (
                  <>
                    <p className="mt-2 max-w-full truncate text-sm font-medium text-slate-900">{file.name}</p>
                    <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">Drag a vertical (9:16) video here</p>
                )}
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  disabled={uploadLocked}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {file ? 'Choose another' : 'Browse files'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0])}
                />
              </div>
              {errors.file ? <p className="text-sm text-red-600">{errors.file}</p> : null}

              {phase !== 'idle' ? (
                <div>
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>
                      {phase === 'creating' && 'Preparing upload…'}
                      {phase === 'uploading' && 'Uploading to Bunny Stream…'}
                      {phase === 'paused' && 'Paused'}
                      {phase === 'uploaded' && 'Uploaded'}
                      {phase === 'error' && 'Upload failed'}
                    </span>
                    <span>{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${phase === 'error' ? 'bg-red-500' : 'bg-brand-600'}`}
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {uploadError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</p> : null}

              <div className="flex flex-wrap gap-2">
                {phase === 'idle' || phase === 'error' ? (
                  <button type="button" className="btn-primary" onClick={() => void startUpload()} disabled={!file}>
                    {phase === 'error' ? 'Retry upload' : 'Upload to Bunny'}
                  </button>
                ) : null}
                {phase === 'creating' ? (
                  <button type="button" className="btn-primary" disabled>
                    <Spinner className="h-4 w-4" /> Preparing…
                  </button>
                ) : null}
                {phase === 'uploading' ? (
                  <button type="button" className="btn-secondary" onClick={() => void pauseUpload()}>
                    Pause
                  </button>
                ) : null}
                {phase === 'paused' ? (
                  <button type="button" className="btn-primary" onClick={resumeUpload}>
                    Resume
                  </button>
                ) : null}
                {phase === 'uploading' || phase === 'paused' ? (
                  <button type="button" className="btn-secondary" onClick={() => void cancelUpload()}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-slate-500">
                Paste the GUID of a video already in your Bunny Stream library, then verify it.
              </p>
              <button type="button" className="btn-secondary" onClick={() => void verifyExisting()} disabled={verifying}>
                {verifying ? <Spinner className="h-4 w-4" /> : null}
                Verify with Bunny
              </button>
            </div>
          )}

          <div className="mt-6 space-y-4 border-t border-slate-100 pt-5">
            <FormField id="bunnyVideoId" label="Bunny video ID" error={errors.bunnyVideoId}>
              <input
                id="bunnyVideoId"
                className={`input font-mono ${errors.bunnyVideoId ? 'input-error' : ''}`}
                value={form.bunnyVideoId}
                onChange={(event) => {
                  setField('bunnyVideoId', event.target.value);
                  setEncoding(null);
                }}
                readOnly={mode === 'upload'}
                placeholder={mode === 'upload' ? 'Filled automatically after upload' : 'e.g. 0f1e2d3c-4b5a-…'}
                aria-invalid={Boolean(errors.bunnyVideoId)}
              />
            </FormField>
            <FormField id="bunnyLibraryId" label="Bunny library ID" error={errors.bunnyLibraryId}>
              <input
                id="bunnyLibraryId"
                className={`input font-mono ${errors.bunnyLibraryId ? 'input-error' : ''}`}
                value={form.bunnyLibraryId}
                onChange={(event) => setField('bunnyLibraryId', event.target.value)}
                readOnly={mode === 'upload'}
                inputMode="numeric"
                placeholder={mode === 'upload' ? 'Filled automatically' : 'e.g. 123456'}
                aria-invalid={Boolean(errors.bunnyLibraryId)}
              />
            </FormField>
            {encoding ? (
              <div className="flex items-center justify-between text-sm">
                <EncodingBadge video={encoding} />
                {encoding.durationSeconds > 0 ? <span className="text-slate-500">{encoding.durationSeconds}s</span> : null}
              </div>
            ) : null}
          </div>
        </section>

        {/* Metadata */}
        <section className="card p-6 lg:col-span-3">
          <h2 className="text-base font-semibold text-slate-900">2. Reel details</h2>

          <div className="mt-5 space-y-5">
            <FormField
              id="title"
              label="Title"
              error={errors.title}
              hint={`${form.title.trim().length}/${TITLE_MAX} characters`}
            >
              <input
                id="title"
                className={`input ${errors.title ? 'input-error' : ''}`}
                value={form.title}
                maxLength={TITLE_MAX}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="The Preamble in 60 seconds"
                aria-invalid={Boolean(errors.title)}
              />
            </FormField>

            <FormField
              id="description"
              label="Description"
              error={errors.description}
              hint={`${form.description.length}/${DESCRIPTION_MAX} characters`}
            >
              <textarea
                id="description"
                rows={5}
                className={`input resize-y ${errors.description ? 'input-error' : ''}`}
                value={form.description}
                maxLength={DESCRIPTION_MAX}
                onChange={(event) => setField('description', event.target.value)}
                placeholder="Key facts, exam relevance, sources…"
                aria-invalid={Boolean(errors.description)}
              />
            </FormField>

            <FormField id="category" label="Category" error={errors.category}>
              <select
                id="category"
                className={`input ${errors.category ? 'input-error' : ''}`}
                value={form.category}
                onChange={(event) => {
                  const value = event.target.value;
                  setField('category', isReelCategory(value) ? value : '');
                }}
                aria-invalid={Boolean(errors.category)}
              >
                <option value="">Select a category…</option>
                {REEL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </FormField>

            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isPublished}
                onChange={(event) => setField('isPublished', event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Publish to the feed immediately
            </label>

            {encoding && !encoding.ready ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Bunny is still encoding this video. You can publish now — it becomes playable as soon as encoding
                finishes — or wait for “Ready to stream”.
              </p>
            ) : null}
          </div>

          <div className="mt-8 flex justify-end gap-3 border-t border-slate-100 pt-5">
            <button type="button" className="btn-secondary" onClick={resetWorkspace} disabled={submitting || phase === 'uploading'}>
              Reset
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? <Spinner className="h-4 w-4" /> : null}
              {form.isPublished ? 'Publish reel' : 'Save draft'}
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
