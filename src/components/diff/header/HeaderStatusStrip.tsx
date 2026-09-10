import { IconCiWarning } from '@pierre/icons';
import { memo, useMemo } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { isRateLimitLow, type RateLimitState } from '@/lib/github/api';
import { cn } from '@/lib/utils';

type HeaderStatusStripProps = {
  reviewCommentsLoadError?: string | null;
  rateLimit?: RateLimitState | null;
  viewedFilesError?: string | null;
};

type StatusItem = {
  id: string;
  label: string;
  title: string;
  tone: 'warning' | 'danger';
};

export const HeaderStatusStrip = memo(function HeaderStatusStrip({
  reviewCommentsLoadError,
  rateLimit,
  viewedFilesError,
}: HeaderStatusStripProps) {
  const items = useMemo(() => {
    const next: StatusItem[] = [];

    if (reviewCommentsLoadError) {
      next.push({
        id: 'review-comments',
        label: 'Review comments unavailable',
        title: reviewCommentsLoadError,
        tone: 'warning',
      });
    }

    if (rateLimit != null && rateLimit.remaining >= 0 && isRateLimitLow(rateLimit)) {
      const exhausted = rateLimit.remaining <= 0;
      const resetsAt = new Date(rateLimit.reset * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const isAuthenticated = rateLimit.limit > 60;
      next.push({
        id: 'rate-limit',
        label: exhausted
          ? `API limit exhausted · resets ${resetsAt}`
          : `${rateLimit.remaining} API requests left · resets ${resetsAt}`,
        title: exhausted
          ? `GitHub API rate limit (${rateLimit.limit}/h) exhausted for this account across all apps. Resets at ${resetsAt}.`
          : `${rateLimit.remaining} of ${rateLimit.limit} hourly requests left. Auto-refresh and image prefetch are paused until ${resetsAt}.${isAuthenticated ? '' : ' Add a token in the diffy popup for 5000/h.'}`,
        tone: exhausted ? 'danger' : 'warning',
      });
    }

    if (viewedFilesError) {
      next.push({
        id: 'viewed-files',
        label: 'Viewed sync failed',
        title: viewedFilesError,
        tone: 'warning',
      });
    }

    return next;
  }, [rateLimit, reviewCommentsLoadError, viewedFilesError]);

  if (items.length === 0) {
    return null;
  }

  const hasDanger = items.some((item) => item.tone === 'danger');

  return (
    <Alert
      variant={hasDanger ? 'destructive' : 'default'}
      className={cn(
        'rounded-none border-0 border-b px-3 py-1.5',
        !hasDanger &&
          'bg-amber-500/10 text-amber-100 **:data-[slot=alert-description]:text-amber-100/90',
      )}
      role='status'
      aria-live='polite'
    >
      <IconCiWarning aria-hidden='true' />
      <AlertDescription className='truncate text-xs'>
        {items.map((item, index) => (
          <span key={item.id}>
            {index > 0 ? <span className='text-muted-foreground'> · </span> : null}
            <span title={item.title}>{item.label}</span>
          </span>
        ))}
      </AlertDescription>
    </Alert>
  );
});
