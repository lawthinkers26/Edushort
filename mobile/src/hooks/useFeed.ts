import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../api/client';
import { fetchFeed, fetchReel } from '../api/reels';
import type { CategoryFilter } from '../constants/categories';
import type { AccessInfo, Reel } from '../types/api';

const PAGE_SIZE = 8;

type FeedStatus = 'loading' | 'ready' | 'error' | 'blocked';

export interface FeedState {
  items: Reel[];
  status: FeedStatus;
  error: string | null;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  access: AccessInfo | null;
}

const INITIAL_STATE: FeedState = {
  items: [],
  status: 'loading',
  error: null,
  refreshing: false,
  loadingMore: false,
  hasMore: true,
  access: null,
};

export type ReelUpdater = (reel: Reel) => Reel;

/**
 * Cursor-paginated, category-filtered feed. Switching category clears the list
 * at once and discards any in-flight response for the previous category.
 */
export function useFeed(category: CategoryFilter, reloadKey: number) {
  const [state, setState] = useState<FeedState>(INITIAL_STATE);
  const cursorRef = useRef<string | null>(null);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'more') => {
      if (mode === 'more' && (loadingMoreRef.current || !cursorRef.current)) return;

      if (mode !== 'more') {
        abortRef.current?.abort();
        cursorRef.current = null;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;

      if (mode === 'more') loadingMoreRef.current = true;
      setState((current) => {
        if (mode === 'initial') return { ...INITIAL_STATE, access: current.access };
        if (mode === 'refresh') return { ...current, refreshing: true, error: null };
        return { ...current, loadingMore: true };
      });

      try {
        const page = await fetchFeed({
          category,
          cursor: mode === 'more' ? cursorRef.current : null,
          limit: PAGE_SIZE,
          signal: controller.signal,
        });
        if (seq !== requestSeq.current) return;

        cursorRef.current = page.nextCursor;
        setState((current) => {
          const base = mode === 'more' ? current.items : [];
          const seen = new Set(base.map((reel) => reel.id));
          return {
            items: [...base, ...page.items.filter((reel) => !seen.has(reel.id))],
            status: 'ready',
            error: null,
            refreshing: false,
            loadingMore: false,
            hasMore: page.nextCursor !== null,
            access: page.access,
          };
        });
      } catch (error) {
        if (seq !== requestSeq.current) return;
        if (error instanceof ApiError && error.code === 'ABORTED') return;

        const blocked = error instanceof ApiError && error.isSubscriptionRequired;
        setState((current) => ({
          ...current,
          // Keep already-loaded reels on a failed "load more"; the paywall covers them if blocked.
          status: blocked ? 'blocked' : mode === 'more' && current.items.length > 0 ? current.status : 'error',
          error: blocked ? null : describeError(error),
          refreshing: false,
          loadingMore: false,
          hasMore: blocked ? false : current.hasMore,
        }));
      } finally {
        if (mode === 'more') loadingMoreRef.current = false;
      }
    },
    [category],
  );

  // Category (or entitlement) changed → instant reset + fetch.
  useEffect(() => {
    void load('initial');
    return () => abortRef.current?.abort();
  }, [load, reloadKey]);

  const refresh = useCallback(() => load('refresh'), [load]);
  const loadMore = useCallback(() => load('more'), [load]);
  const retry = useCallback(() => load('initial'), [load]);

  const updateReel = useCallback((id: string, updater: ReelUpdater) => {
    setState((current) => ({
      ...current,
      items: current.items.map((reel) => (reel.id === id ? updater(reel) : reel)),
    }));
  }, []);

  const setAccess = useCallback((access: AccessInfo) => {
    setState((current) => ({ ...current, access }));
  }, []);

  /** Re-fetch one reel (fresh signed playback URLs after expiry). */
  const refreshReel = useCallback(
    async (id: string) => {
      try {
        const { reel } = await fetchReel(id);
        updateReel(id, () => reel);
      } catch (error) {
        console.warn('Could not refresh reel', describeError(error));
      }
    },
    [updateReel],
  );

  return { ...state, refresh, loadMore, retry, updateReel, setAccess, refreshReel };
}
