import { invalidateCodeViewItemsCache } from '@/lib/code-view/build-items';
import {
  fetchPullRequestReviewComments,
  type GitHubPullRequestRef,
  type GitHubPullRequestReviewComment,
  type PullRequestDiffData,
  type PullRequestHeadMeta,
} from '@/lib/github/api';
import { withRevalidateHttpCache } from '@/lib/github/github-fetch';

import { queryClient } from './client';
import { prDiffQueryOptions } from './pr-diff';
import { viewedFilesQueryOptions } from './viewed-files';

/**
 * Force-refetch PR diff + viewed files. Requests revalidate against the browser
 * HTTP cache (`cache: 'no-cache'`), so anything GitHub answers with 304 is free
 * with respect to the API rate limit; only changed resources cost a request.
 */
export async function refreshPullRequestData(ref: GitHubPullRequestRef): Promise<void> {
  invalidateCodeViewItemsCache(ref);

  await withRevalidateHttpCache(async () => {
    await Promise.all([
      queryClient.fetchQuery({
        ...prDiffQueryOptions(ref),
        staleTime: 0,
      }),
      queryClient.fetchQuery({
        ...viewedFilesQueryOptions(ref),
        staleTime: 0,
      }),
    ]);
  });
}

/** Activity-only refresh (new/edited comments, no new commits): just the review comments. */
export function fetchPullRequestActivityComments(
  ref: GitHubPullRequestRef,
): Promise<GitHubPullRequestReviewComment[]> {
  return withRevalidateHttpCache(() => fetchPullRequestReviewComments(ref));
}

/** Record the probed head metadata so the next probe compares against what is on screen. */
export function applyPullRequestHeadMeta(
  ref: GitHubPullRequestRef,
  head: PullRequestHeadMeta,
): void {
  queryClient.setQueryData<PullRequestDiffData>(prDiffQueryOptions(ref).queryKey, (current) => {
    if (current == null) {
      return current;
    }

    return {
      ...current,
      pullRequest: { ...current.pullRequest, title: head.title, updated_at: head.updatedAt },
    };
  });
}
