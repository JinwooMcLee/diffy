import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { GitHubPullRequestRef } from '@/lib/github/api';
import { markFileAsViewed, unmarkFileAsViewed, type FileViewedState } from '@/lib/github/graphql';
import { viewedFilesQueryOptions, type ViewedFilesQueryData } from '@/lib/query/viewed-files';
import { computeViewedProgress, findNextUnviewedPath } from '@/lib/review/viewed-files';

export type UseViewedFilesResult = {
  viewedByPath: ReadonlyMap<string, FileViewedState>;
  isReady: boolean;
  hasToken: boolean;
  error: string | null;
  progress: { viewed: number; total: number };
  isViewed: (path: string) => boolean;
  toggleViewed: (path: string, next?: boolean) => void;
  /** Mark several files at once (folder checkbox). One optimistic update, sequential mutations. */
  setViewedMany: (paths: readonly string[], shouldView: boolean) => void;
  nextUnviewedPath: (fromPath: string | null) => string | null;
};

type ToggleViewedVariables = {
  path: string;
  shouldView: boolean;
  pullRequestId: string;
};

type SetViewedManyVariables = {
  paths: readonly string[];
  shouldView: boolean;
  pullRequestId: string;
};

function toViewedMap(data: ViewedFilesQueryData | undefined): ReadonlyMap<string, FileViewedState> {
  if (data == null || !data.hasToken) {
    return new Map();
  }

  return new Map(Object.entries(data.viewedByPath));
}

/**
 * Loads + syncs per-file viewed state via GraphQL. Mutations are optimistic and
 * revert on failure. Loading is async and never blocks the diff render.
 */
export function useViewedFiles(
  ref: GitHubPullRequestRef,
  orderedPaths: readonly string[],
): UseViewedFilesResult {
  const queryClient = useQueryClient();
  const queryKey = viewedFilesQueryOptions(ref).queryKey;

  const { data, isPending, error } = useQuery(viewedFilesQueryOptions(ref));

  const toggleMutation = useMutation({
    mutationFn: async ({ path, shouldView, pullRequestId }: ToggleViewedVariables) => {
      if (shouldView) {
        await markFileAsViewed(pullRequestId, path);
      } else {
        await unmarkFileAsViewed(pullRequestId, path);
      }
    },
    onMutate: async ({ path, shouldView }) => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<ViewedFilesQueryData>(queryKey);
      if (previous == null || !previous.hasToken) {
        return { previous };
      }

      const nextState: FileViewedState = shouldView ? 'VIEWED' : 'UNVIEWED';
      const optimistic: Extract<ViewedFilesQueryData, { hasToken: true }> = {
        hasToken: true,
        pullRequestId: previous.pullRequestId,
        viewedByPath: { ...previous.viewedByPath, [path]: nextState },
      };
      queryClient.setQueryData<ViewedFilesQueryData>(queryKey, optimistic);

      return { previous };
    },
    onError: (_mutationError, _variables, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
  });

  const setManyMutation = useMutation({
    mutationFn: async ({ paths, shouldView, pullRequestId }: SetViewedManyVariables) => {
      // GitHub asks clients not to fire mutations concurrently; walk the folder serially.
      let firstError: unknown = null;
      for (const path of paths) {
        try {
          if (shouldView) {
            await markFileAsViewed(pullRequestId, path);
          } else {
            await unmarkFileAsViewed(pullRequestId, path);
          }
        } catch (failure: unknown) {
          firstError ??= failure;
        }
      }

      if (firstError != null) {
        throw firstError;
      }
    },
    onMutate: async ({ paths, shouldView }) => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<ViewedFilesQueryData>(queryKey);
      if (previous == null || !previous.hasToken) {
        return { previous };
      }

      const nextState: FileViewedState = shouldView ? 'VIEWED' : 'UNVIEWED';
      const nextViewedByPath = { ...previous.viewedByPath };
      for (const path of paths) {
        nextViewedByPath[path] = nextState;
      }

      const optimistic: Extract<ViewedFilesQueryData, { hasToken: true }> = {
        hasToken: true,
        pullRequestId: previous.pullRequestId,
        viewedByPath: nextViewedByPath,
      };
      queryClient.setQueryData<ViewedFilesQueryData>(queryKey, optimistic);

      return { previous };
    },
    onError: () => {
      // Some files may have succeeded before the failure; resync from GitHub instead of blindly reverting.
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const viewedByPath = useMemo(() => toViewedMap(data), [data]);
  const hasToken = data?.hasToken === true;
  const isReady = !isPending;

  const isViewed = useCallback(
    (path: string) => viewedByPath.get(path) === 'VIEWED',
    [viewedByPath],
  );

  const toggleViewed = useCallback(
    (path: string, next?: boolean) => {
      if (data == null || !data.hasToken) {
        return;
      }

      const shouldView = next ?? viewedByPath.get(path) !== 'VIEWED';
      toggleMutation.mutate({
        path,
        shouldView,
        pullRequestId: data.pullRequestId,
      });
    },
    [data, toggleMutation, viewedByPath],
  );

  const setViewedMany = useCallback(
    (paths: readonly string[], shouldView: boolean) => {
      if (data == null || !data.hasToken) {
        return;
      }

      const targetState: FileViewedState = shouldView ? 'VIEWED' : 'UNVIEWED';
      const pending = paths.filter((path) => viewedByPath.get(path) !== targetState);
      if (pending.length === 0) {
        return;
      }

      setManyMutation.mutate({
        paths: pending,
        shouldView,
        pullRequestId: data.pullRequestId,
      });
    },
    [data, setManyMutation, viewedByPath],
  );

  const progress = useMemo(
    () => computeViewedProgress(orderedPaths, viewedByPath),
    [orderedPaths, viewedByPath],
  );

  const nextUnviewedPath = useCallback(
    (fromPath: string | null) => findNextUnviewedPath(orderedPaths, viewedByPath, fromPath),
    [orderedPaths, viewedByPath],
  );

  const mutationError = toggleMutation.error ?? setManyMutation.error;

  return {
    viewedByPath,
    isReady,
    hasToken,
    error:
      error != null
        ? error instanceof Error
          ? error.message
          : String(error)
        : mutationError != null
          ? mutationError instanceof Error
            ? mutationError.message
            : String(mutationError)
          : null,
    progress,
    isViewed,
    toggleViewed,
    setViewedMany,
    nextUnviewedPath,
  };
}
