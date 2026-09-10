import { useEffect, useRef } from 'react';

import {
  fetchPullRequestHeadMeta,
  isRateLimitLow,
  type GitHubPullRequestRef,
  type PullRequestHeadMeta,
  type RateLimitState,
} from '@/lib/github/api';
import { withRevalidateHttpCache } from '@/lib/github/github-fetch';

/** Poll cadence while the overlay is visible. Probes revalidate via ETag, so an unchanged PR answers 304 and costs no rate limit. */
const POLL_INTERVAL_MS = 120_000;
/** Focus/visibility events can fire in bursts; never probe more often than this. */
const MIN_PROBE_GAP_MS = 15_000;

type UseAutoRefreshPullRequestParams = {
  ref: GitHubPullRequestRef;
  enabled: boolean;
  /** Head SHA and `updated_at` of the data currently on screen. */
  headSha: string;
  updatedAt: string;
  isRefreshing: boolean;
  rateLimit: RateLimitState | null;
  /** Return false to defer a detected change (e.g. the user is mid-comment). It is retried on the next probe. */
  canRefresh: () => boolean;
  /** New commits: reload the whole PR. */
  onRefresh: () => void;
  /** Activity without new commits (comments, edits): sync just the review comments. */
  onActivity: (head: PullRequestHeadMeta) => void;
};

type PendingChange = { kind: 'commits' } | { kind: 'activity'; head: PullRequestHeadMeta };

/**
 * Event-driven refresh: probes the PR head (one cheap, conditional `pulls.get`)
 * when the tab regains focus/visibility and on a slow interval, then reloads
 * only what changed. Hidden tabs never probe; a low rate-limit budget pauses it.
 */
export function useAutoRefreshPullRequest({
  ref,
  enabled,
  headSha,
  updatedAt,
  isRefreshing,
  rateLimit,
  canRefresh,
  onRefresh,
  onActivity,
}: UseAutoRefreshPullRequestParams): void {
  const latest = useRef({
    headSha,
    updatedAt,
    isRefreshing,
    rateLimit,
    canRefresh,
    onRefresh,
    onActivity,
  });
  useEffect(() => {
    latest.current = {
      headSha,
      updatedAt,
      isRefreshing,
      rateLimit,
      canRefresh,
      onRefresh,
      onActivity,
    };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isCancelled = false;
    let isProbing = false;
    let lastProbeAt = 0;
    let pendingChange: PendingChange | null = null;

    const applyChange = (change: PendingChange): void => {
      const {
        canRefresh: canRefreshNow,
        onRefresh: refresh,
        onActivity: activity,
      } = latest.current;
      if (!canRefreshNow()) {
        pendingChange = change;
        return;
      }

      pendingChange = null;
      if (change.kind === 'commits') {
        refresh();
      } else {
        activity(change.head);
      }
    };

    const probe = async () => {
      if (isCancelled || isProbing || document.hidden || latest.current.isRefreshing) {
        return;
      }

      if (pendingChange) {
        // Already detected but deferred; don't spend a request re-detecting it.
        applyChange(pendingChange);
        return;
      }

      const now = Date.now();
      if (now - lastProbeAt < MIN_PROBE_GAP_MS) {
        return;
      }

      if (isRateLimitLow(latest.current.rateLimit)) {
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
        if (head.sha !== currentSha) {
          applyChange({ kind: 'commits' });
        } else if (head.updatedAt !== currentUpdatedAt) {
          applyChange({ kind: 'activity', head });
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
  }, [enabled, ref]);
}
