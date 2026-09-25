import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useToast } from '../context/ToastContext';
import { adminApi, describeError } from '../lib/api';
import type { DashboardStats, SystemConfig } from '../lib/types';

const MIN_LIMIT = 0;
const MAX_LIMIT = 10_000;
const SLIDER_MAX = 50;
const PRESETS = [0, 3, 5, 10, 20];

function validateLimit(raw: string): { value: number | null; error: string | null } {
  if (raw.trim() === '') return { value: null, error: 'Enter a number.' };
  if (!/^\d+$/.test(raw.trim())) return { value: null, error: 'Use a whole number (0 or more).' };
  const value = Number(raw);
  if (value < MIN_LIMIT || value > MAX_LIMIT) {
    return { value: null, error: `Must be between ${MIN_LIMIT} and ${MAX_LIMIT.toLocaleString()}.` };
  }
  return { value, error: null };
}

/**
 * Global Paywall Controller: edits system_config.free_reel_limit through
 * PUT /api/admin/config. Takes effect for every free user within seconds.
 */
export function PaywallSettingsPage() {
  const { notify } = useToast();
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextConfig, nextStats] = await Promise.all([adminApi.getConfig(), adminApi.getStats()]);
      setConfig(nextConfig);
      setStats(nextStats);
      setDraft(String(nextConfig.free_reel_limit));
    } catch (error) {
      setLoadError(describeError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { value, error } = validateLimit(draft);
  const dirty = config !== null && value !== null && value !== config.free_reel_limit;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (value === null || !dirty) return;
    if (
      value === 0 &&
      !window.confirm('A limit of 0 turns EduShorts into a hard paywall: free users cannot watch any reel. Continue?')
    ) {
      return;
    }

    setSaving(true);
    try {
      const updated = await adminApi.updateFreeReelLimit(value);
      setConfig(updated);
      setDraft(String(updated.free_reel_limit));
      notify(`Free reel limit set to ${updated.free_reel_limit}.`, 'success');
      adminApi
        .getStats()
        .then(setStats)
        .catch(() => undefined);
    } catch (saveError) {
      notify(describeError(saveError), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-red-600">{loadError ?? 'Configuration unavailable.'}</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  const sliderValue = Math.min(value ?? config.free_reel_limit, SLIDER_MAX);

  return (
    <>
      <PageHeader
        title="Global Paywall Controller"
        description="Decide how many reels a signed-in user can watch for free before the subscription paywall appears. Changes apply to all free users immediately."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={save} className="card p-6 lg:col-span-2" noValidate>
          <label htmlFor="free_reel_limit" className="label">
            Free reels per user
          </label>

          <div className="mt-2 flex items-center gap-4">
            <input
              id="free_reel_limit"
              type="number"
              inputMode="numeric"
              min={MIN_LIMIT}
              max={MAX_LIMIT}
              step={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className={`input w-32 text-center text-2xl font-bold ${error ? 'input-error' : ''}`}
              aria-invalid={Boolean(error)}
              aria-describedby="limit-help"
            />
            <input
              type="range"
              min={MIN_LIMIT}
              max={SLIDER_MAX}
              value={sliderValue}
              onChange={(event) => setDraft(event.target.value)}
              className="flex-1 accent-brand-600"
              aria-label="Free reel limit slider"
            />
          </div>

          {error ? (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          ) : (
            <p id="limit-help" className="mt-2 text-sm text-slate-500">
              {value === 0
                ? 'Hard paywall — every reel requires a subscription.'
                : `Free users get ${value} reel${value === 1 ? '' : 's'}; the paywall appears on reel ${(value ?? 0) + 1}.`}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDraft(String(preset))}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  value === preset
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                {preset === 0 ? 'Hard paywall' : `${preset} reels`}
              </button>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <p className="text-xs text-slate-500">
              Last updated {new Date(config.updated_at).toLocaleString()}
              {config.updated_by ? ` by ${config.updated_by}` : ''}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={!dirty || saving}
                onClick={() => setDraft(String(config.free_reel_limit))}
              >
                Discard
              </button>
              <button type="submit" className="btn-primary" disabled={!dirty || saving || Boolean(error)}>
                {saving ? <Spinner className="h-4 w-4" /> : null}
                Save limit
              </button>
            </div>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-sm text-slate-500">Current limit</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{config.free_reel_limit}</p>
          </div>
          {stats ? (
            <>
              <div className="card p-5">
                <p className="text-sm text-slate-500">Free users at the paywall</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">{stats.freeUsersAtLimit.toLocaleString()}</p>
                <p className="mt-1 text-xs text-slate-500">Have used every free reel at the current limit.</p>
              </div>
              <div className="card p-5">
                <p className="text-sm text-slate-500">Active subscribers</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">{stats.activeSubscribers.toLocaleString()}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {stats.totalUsers > 0
                    ? `${((stats.activeSubscribers / stats.totalUsers) * 100).toFixed(1)}% of ${stats.totalUsers.toLocaleString()} users`
                    : 'No users yet'}
                </p>
              </div>
            </>
          ) : null}
          <div className="rounded-2xl bg-brand-50 p-5 text-sm text-brand-900">
            Lowering the limit blocks users who have already watched more than the new value on their next feed
            request. Raising it lets blocked free users continue straight away.
          </div>
        </aside>
      </div>
    </>
  );
}
