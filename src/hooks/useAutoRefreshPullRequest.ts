import { useEffect, useRef } from 'react';

import {
  fetchPullRequestHeadMeta,
  type GitHubPullRequestRef,
  type RateLimitState,
} from '@/lib/github/api';
import { withRevalidateHttpCache } from '@/lib/github/github-fetch';

/** Poll cadence while the overlay is visible. Probes revalidate via ETag, so unchanged PRs cost no rate limit. */
const POLL_INTERVAL_MS = 60_000;
/** Focus/visibility events can fire in bursts; never probe more often than this. */
const MIN_PROBE_GAP_MS = 15_000;
/** Leave headroom for the actual refresh (and the user's other tabs) when the REST budget is nearly gone. */
const MIN_RATE_LIMIT_REMAINING = 25;

type UseAutoRefreshPullRequestParams = {
  ref: GitHubPullRequestRef;
  /** Head SHA and `updated_at` of the data currently on screen. */
  headSha: string;
  updatedAt: string;
  isRefreshing: boolean;
  rateLimit: RateLimitState | null;
  /** Return false to defer a detected change (e.g. the user is mid-comment). It is retried on the next probe. */
  canRefresh: () => boolean;
  onRefresh: () => void;
};

/**
 * Event-driven refresh: probes the PR head (one cheap `pulls.get`) when the tab
 * regains focus/visibility and on a slow interval, and refreshes the overlay
 * when GitHub reports new commits or activity.
 */
export function useAutoRefreshPullRequest({
  ref,
  headSha,
  updatedAt,
  isRefreshing,
  rateLimit,
  canRefresh,
  onRefresh,
}: UseAutoRefreshPullRequestParams): void {
  const latest = useRef({ headSha, updatedAt, isRefreshing, rateLimit, canRefresh, onRefresh });
  useEffect(() => {
    latest.current = { headSha, updatedAt, isRefreshing, rateLimit, canRefresh, onRefresh };
  });

  useEffect(() => {
    let isCancelled = false;
    let isProbing = false;
    let lastProbeAt = 0;
    let hasPendingChange = false;

    const tryRefresh = (): boolean => {
      const { canRefresh: canRefreshNow, onRefresh: refresh } = latest.current;
      if (!canRefreshNow()) {
        hasPendingChange = true;
        return false;
      }

      hasPendingChange = false;
      refresh();
      return true;
    };

    const probe = async () => {
      if (isCancelled || isProbing || document.hidden || latest.current.isRefreshing) {
        return;
      }

      if (hasPendingChange) {
        // A change was already detected but deferred; don't spend a request re-detecting it.
        tryRefresh();
        return;
      }

      const now = Date.now();
      if (now - lastProbeAt < MIN_PROBE_GAP_MS) {
        return;
      }

      const { rateLimit: currentRateLimit } = latest.current;
      if (currentRateLimit != null && currentRateLimit.remaining < MIN_RATE_LIMIT_REMAINING) {
        return;
      }

      isProbing = true;
      lastProbeAt = now;
      try {
        const head = await withRevalidateHttpCache(() => fetchPullRequestHeadMeta(ref));
        if (isCancelled) {
          return;
        }

        const { headSha: currentSha, updatedAt: currentUpdatedAt } = latest.current;
        if (head.sha !== currentSha || head.updatedAt !== currentUpdatedAt) {
          tryRefresh();
        }
      } catch {
        // Probes are best-effort; the manual refresh path surfaces real errors.
      } finally {
        isProbing = false;
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void probe();
      }
    };
    const handleFocus = () => {
      void probe();
    };

    const intervalId = window.setInterval(() => {
      void probe();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [ref]);
}
