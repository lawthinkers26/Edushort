import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { adminApi, describeError } from '../lib/api';
import type { DashboardStats } from '../lib/types';

export function OverviewPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getStats()
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(describeError(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = stats
    ? [
        { label: 'Published & draft reels', value: stats.totalReels, to: '/reels' },
        { label: 'Registered learners', value: stats.totalUsers, to: null },
        { label: 'Active subscribers', value: stats.activeSubscribers, to: null },
        { label: 'Free reel limit', value: stats.freeReelLimit, to: '/paywall' },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Health of the EduShorts catalogue and subscription funnel."
        actions={
          <Link to="/upload" className="btn-primary">
            Upload a reel
          </Link>
        }
      />

      {error ? <p className="card p-6 text-sm text-red-600">{error}</p> : null}
      {!stats && !error ? (
        <div className="flex justify-center py-24 text-brand-600">
          <Spinner className="h-8 w-8" />
        </div>
      ) : null}

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => {
            const content = (
              <>
                <p className="text-sm text-slate-500">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{card.value.toLocaleString()}</p>
              </>
            );
            return card.to ? (
              <Link key={card.label} to={card.to} className="card p-5 transition hover:border-brand-200 hover:shadow">
                {content}
              </Link>
            ) : (
              <div key={card.label} className="card p-5">
                {content}
              </div>
            );
          })}
        </div>
      ) : null}

      {stats ? (
        <div className="card mt-6 p-6">
          <h2 className="text-base font-semibold text-slate-900">Paywall pressure</h2>
          <p className="mt-1 text-sm text-slate-500">
            {stats.freeUsersAtLimit.toLocaleString()} free learner{stats.freeUsersAtLimit === 1 ? ' is' : 's are'}{' '}
            currently blocked by the paywall at a limit of {stats.freeReelLimit}.
          </p>
          <Link to="/paywall" className="btn-secondary mt-4">
            Adjust free reel limit
          </Link>
        </div>
      ) : null}
    </>
  );
}
