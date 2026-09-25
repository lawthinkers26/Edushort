import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useToast } from '../context/ToastContext';
import { ApiError, adminApi, describeError } from '../lib/api';
import { REEL_CATEGORIES, isReelCategory, type AdminReel, type ReelCategory } from '../lib/types';
import { DESCRIPTION_MAX, TITLE_MAX, TITLE_MIN } from '../lib/validation';

const PAGE_SIZE = 20;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function EditReelDialog({
  reel,
  onClose,
  onSaved,
}: {
  reel: AdminReel;
  onClose: () => void;
  onSaved: (reel: AdminReel) => void;
}) {
  const { notify } = useToast();
  const [title, setTitle] = useState(reel.title);
  const [description, setDescription] = useState(reel.description);
  const [category, setCategory] = useState<ReelCategory>(reel.category);
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    const trimmed = title.trim();
    if (trimmed.length < TITLE_MIN || trimmed.length > TITLE_MAX) {
      nextErrors.title = `Title must be ${TITLE_MIN}–${TITLE_MAX} characters.`;
    }
    if (description.trim().length > DESCRIPTION_MAX) {
      nextErrors.description = `Description must be at most ${DESCRIPTION_MAX} characters.`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const updated = await adminApi.updateReel(reel.id, { title: trimmed, description: description.trim(), category });
      onSaved(updated);
      notify('Reel updated.', 'success');
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors: typeof errors = {};
        error.fieldIssues.forEach((issue) => {
          if (issue.path === 'title' || issue.path === 'description') fieldErrors[issue.path] = issue.message;
        });
        setErrors(fieldErrors);
      }
      notify(describeError(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal>
      <form onSubmit={submit} className="card w-full max-w-lg p-6" noValidate>
        <h2 className="text-lg font-semibold text-slate-900">Edit reel</h2>
        <div className="mt-5 space-y-4">
          <FormField id="edit-title" label="Title" error={errors.title}>
            <input
              id="edit-title"
              className={`input ${errors.title ? 'input-error' : ''}`}
              value={title}
              maxLength={TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField id="edit-description" label="Description" error={errors.description}>
            <textarea
              id="edit-description"
              rows={4}
              className={`input ${errors.description ? 'input-error' : ''}`}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <FormField id="edit-category" label="Category">
            <select
              id="edit-category"
              className="input"
              value={category}
              onChange={(event) => {
                if (isReelCategory(event.target.value)) setCategory(event.target.value);
              }}
            >
              {REEL_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Spinner className="h-4 w-4" /> : null}
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteReelDialog({
  reel,
  onClose,
  onDeleted,
}: {
  reel: AdminReel;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const { notify } = useToast();
  const [alsoBunny, setAlsoBunny] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirm = async () => {
    setDeleting(true);
    try {
      const result = await adminApi.deleteReel(reel.id, alsoBunny);
      onDeleted(reel.id);
      notify(
        alsoBunny && !result.bunnyDeleted
          ? 'Reel deleted, but the Bunny video could not be removed. Delete it from the Bunny dashboard.'
          : 'Reel deleted.',
        alsoBunny && !result.bunnyDeleted ? 'error' : 'success',
      );
    } catch (error) {
      notify(describeError(error), 'error');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" role="alertdialog" aria-modal>
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-slate-900">Delete “{reel.title}”?</h2>
        <p className="mt-2 text-sm text-slate-500">
          This removes the reel, its comments, and all likes/saves. This cannot be undone.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={alsoBunny}
            onChange={(event) => setAlsoBunny(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Also delete the video file from Bunny Stream
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={() => void confirm()} disabled={deleting}>
            {deleting ? <Spinner className="h-4 w-4" /> : null}
            Delete reel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReelsPage() {
  const { notify } = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ReelCategory | ''>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminReel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminReel | null>(null);
  const [deleting, setDeleting] = useState<AdminReel | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search.trim(), 300);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.listReels({
        search: debouncedSearch || undefined,
        category: category || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(response.items);
      setTotal(response.total);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, category, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setPage(1), [debouncedSearch, category]);

  const replaceItem = (updated: AdminReel) =>
    setItems((current) => current.map((reel) => (reel.id === updated.id ? updated : reel)));

  const togglePublished = async (reel: AdminReel) => {
    setTogglingId(reel.id);
    try {
      replaceItem(await adminApi.updateReel(reel.id, { isPublished: !reel.isPublished }));
      notify(reel.isPublished ? 'Reel unpublished.' : 'Reel published.', 'success');
    } catch (toggleError) {
      notify(describeError(toggleError), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Reels Library"
        description={`${total.toLocaleString()} reel${total === 1 ? '' : 's'} in the catalogue.`}
        actions={
          <Link to="/upload" className="btn-primary">
            New reel
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          className="input sm:max-w-xs"
          placeholder="Search titles…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search reels"
        />
        <select
          className="input sm:max-w-[200px]"
          value={category}
          onChange={(event) => setCategory(isReelCategory(event.target.value) ? event.target.value : '')}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {REEL_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20 text-brand-600">
            <Spinner className="h-7 w-7" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" className="btn-secondary mt-4" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No reels match your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reel</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Views</th>
                  <th className="px-4 py-3 text-right">Likes</th>
                  <th className="px-4 py-3 text-right">Comments</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((reel) => (
                  <tr key={reel.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={reel.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-16 w-9 shrink-0 rounded-md bg-slate-200 object-cover"
                          onError={(event) => {
                            event.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{reel.title}</p>
                          <p className="truncate font-mono text-xs text-slate-400">
                            {reel.bunnyVideoId} · {formatDuration(reel.durationSeconds)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                        {reel.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{reel.viewsCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{reel.likesCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{reel.commentsCount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void togglePublished(reel)}
                        disabled={togglingId === reel.id}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          reel.isPublished
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                            : 'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                        title={reel.isPublished ? 'Click to unpublish' : 'Click to publish'}
                      >
                        {togglingId === reel.id ? <Spinner className="h-3 w-3" /> : null}
                        {reel.isPublished ? 'Published' : 'Draft'}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setEditing(reel)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ml-4 text-sm font-medium text-red-600 hover:underline"
                        onClick={() => setDeleting(reel)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button type="button" className="btn-secondary" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <EditReelDialog
          reel={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            replaceItem(updated);
            setEditing(null);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteReelDialog
          reel={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setItems((current) => current.filter((reel) => reel.id !== id));
            setTotal((current) => Math.max(current - 1, 0));
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}
