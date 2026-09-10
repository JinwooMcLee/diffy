import { IconSearch, IconX } from '@pierre/icons';
import type { FileTreeRowDecorationRenderer } from '@pierre/trees';
import { FileTree, useFileTree, useFileTreeSearch } from '@pierre/trees/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTreeThemeStyles } from '@/hooks/useTreeThemeStyles';
import {
  buildCommentBadgeCountCss,
  FILE_TREE_REVIEW_COMMENT_TITLE_MARKER,
} from '@/lib/file-tree/comment-badge';
import {
  FILE_TREE_COMMENT_ICON_MASK_URL,
  FILE_TREE_COMMENT_ICON_SIZE,
} from '@/lib/file-tree/comment-icon';
import { createFileTreeInput, normalizeTreeDirectoryPath } from '@/lib/file-tree/input';
import { FILE_TREE_VIEWED_MARK_CSS, isTreeViewedMarkElement } from '@/lib/file-tree/viewed-mark';
import type { GitHubPullRequest, GitHubPullRequestFile } from '@/lib/github/api';
import type { FileViewedState } from '@/lib/github/graphql';
import { isViewedComplete, type ViewedProgress } from '@/lib/review/viewed-files';

import { ReviewProgress } from '../review/ReviewProgress';
import { SidebarPrInfo } from './SidebarPrInfo';
import { SidebarPrStats } from './SidebarPrStats';

const treePanelClassName = 'flex h-full min-h-0 flex-col border-sidebar-border';
const treePanelTopClassName =
  'flex shrink-0 flex-col gap-2 border-b border-sidebar-border bg-sidebar pb-2';
const treeSearchWrapClassName =
  'box-border flex w-full shrink-0 flex-col gap-1.5 border-b border-sidebar-border bg-sidebar px-3 py-2.5';

const TREE_INITIAL_VISIBLE_ROW_COUNT = 80;
const TREE_OVERSCAN = 12;

type FileTreePanelProps = {
  files: GitHubPullRequestFile[];
  selectedPath: string | null;
  reviewCommentCountByPath?: ReadonlyMap<string, number>;
  onSelectPath: (path: string) => void;
  pullRequest: GitHubPullRequest;
  reviewCommentCount: number;
  reviewProgress?: ViewedProgress | null;
  onJumpToNextUnviewed?: () => void;
  /** `null` hides the viewed checkboxes (no token). */
  viewedByPath?: ReadonlyMap<string, FileViewedState> | null;
  isViewedReady?: boolean;
  onToggleViewed?: (path: string, next: boolean) => void;
  onToggleViewedMany?: (paths: readonly string[], next: boolean) => void;
};

const FILE_TREE_COMMENT_BADGE_CSS = `
  [data-item-section="decoration"] {
    align-items: center;
  }

  [data-item-section="decoration"] > span[title*="${FILE_TREE_REVIEW_COMMENT_TITLE_MARKER}"] {
    align-items: center;
    display: inline-flex;
    gap: 3px;
    line-height: 1;
    white-space: nowrap;
  }

  [data-item-section="decoration"] > span[title*="${FILE_TREE_REVIEW_COMMENT_TITLE_MARKER}"]::before {
    background-color: var(--trees-fg-muted, #8b949e);
    content: '';
    display: block;
    flex-shrink: 0;
    height: ${FILE_TREE_COMMENT_ICON_SIZE};
    -webkit-mask-image: ${FILE_TREE_COMMENT_ICON_MASK_URL};
    mask-image: ${FILE_TREE_COMMENT_ICON_MASK_URL};
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: contain;
    order: 2;
    width: ${FILE_TREE_COMMENT_ICON_SIZE};
  }

  [data-item-section="decoration"] > span[title*="${FILE_TREE_REVIEW_COMMENT_TITLE_MARKER}"]::after {
    font-variant-numeric: tabular-nums;
    line-height: 1;
    order: 3;
  }
`;

// Pierre renders its own search input in shadow DOM; we use a custom header instead.
const FILE_TREE_PANEL_BASE_CSS = `
  [data-file-tree-search-container] {
    display: none !important;
  }

  :host {
    --trees-padding-inline-override: 12px;
  }

  ${FILE_TREE_COMMENT_BADGE_CSS}

  ${FILE_TREE_VIEWED_MARK_CSS}
`;

type FileTreeSearchHeaderProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  matchingPaths: readonly string[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
};

function FileTreeSearchHeader({
  inputRef,
  matchingPaths,
  searchQuery,
  onSearchQueryChange,
}: FileTreeSearchHeaderProps) {
  const hasQuery = searchQuery.trim().length > 0;
  const matchCount = matchingPaths.length;

  const stopGitHubKeybindings = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    stopGitHubKeybindings(event);

    if (event.key === 'Escape') {
      event.preventDefault();
      onSearchQueryChange('');
    }
  };

  return (
    <div
      className={treeSearchWrapClassName}
      onKeyDownCapture={stopGitHubKeybindings}
      onKeyUpCapture={stopGitHubKeybindings}
    >
      <div className='relative'>
        <IconSearch
          size={14}
          className='pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground'
        />
        <Input
          ref={inputRef}
          className='h-8 bg-secondary pr-8 pl-8 text-xs'
          type='text'
          inputMode='search'
          autoComplete='off'
          spellCheck={false}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onKeyUp={stopGitHubKeybindings}
          placeholder='Filter files'
          aria-label='Filter changed files'
        />
        {hasQuery ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-xs'
            className='absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground'
            aria-label='Clear filter'
            onClick={() => onSearchQueryChange('')}
          >
            <IconX />
          </Button>
        ) : null}
      </div>
      {hasQuery ? (
        <p
          className='m-0 text-[11px] text-muted-foreground'
          aria-live='polite'
        >
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
        </p>
      ) : null}
    </div>
  );
}

/** Walk the (shadow-piercing) event path up to the tree row button. */
function findTreeRowFromEvent(event: Event): { path: string; isFile: boolean } | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const path = node.dataset.itemPath;
    if (path != null) {
      return { path, isFile: node.dataset.itemType === 'file' };
    }
  }

  return null;
}

function isViewedMarkTarget(event: Event): boolean {
  return event.composedPath().some((node) => isTreeViewedMarkElement(node));
}

export function FileTreePanel({
  files,
  selectedPath,
  reviewCommentCountByPath,
  onSelectPath,
  pullRequest,
  reviewCommentCount,
  reviewProgress,
  onJumpToNextUnviewed,
  viewedByPath = null,
  isViewedReady = false,
  onToggleViewed,
  onToggleViewedMany,
}: FileTreePanelProps) {
  const treeThemeStyles = useTreeThemeStyles();
  const treeInput = useMemo(
    () => createFileTreeInput(files, reviewCommentCountByPath, viewedByPath),
    [files, reviewCommentCountByPath, viewedByPath],
  );
  const fileTreePanelCss = useMemo(
    () => `${FILE_TREE_PANEL_BASE_CSS}\n${buildCommentBadgeCountCss(reviewCommentCountByPath)}`,
    [reviewCommentCountByPath],
  );
  const pathsSignatureRef = useRef(treeInput.pathsSignature);
  const selectedPathRef = useRef(selectedPath);
  const treeInputRef = useRef(treeInput);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const treeHostRef = useRef<HTMLDivElement>(null);
  const isProgrammaticSelectionRef = useRef(false);
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (isProgrammaticSelectionRef.current) {
        return;
      }

      const nextPath = selectedPaths[0];
      if (nextPath) {
        onSelectPath(nextPath);
      }
    },
    [onSelectPath],
  );

  const handleSearchQueryChange = useCallback((query: string) => {
    const shouldKeepFocus = document.activeElement === searchInputRef.current;
    setSearchQuery(query);
    if (shouldKeepFocus) {
      queueMicrotask(() => {
        searchInputRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  // Pierre captures `renderRowDecoration` when the model is created, so it must
  // read the latest input through a ref rather than closing over props.
  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(({ item }) => {
    const input = treeInputRef.current;
    if (item.kind === 'directory') {
      return input.directoryAnnotationsByPath.get(normalizeTreeDirectoryPath(item.path)) ?? null;
    }

    return input.annotationsByPath.get(item.path) ?? null;
  }, []);

  const { model } = useFileTree({
    preparedInput: treeInput.preparedInput,
    initialExpansion: 'open',
    icons: 'complete',
    gitStatus: treeInput.gitStatus,
    renderRowDecoration,
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
    searchBlurBehavior: 'retain',
    unsafeCSS: fileTreePanelCss,
    initialVisibleRowCount: TREE_INITIAL_VISIBLE_ROW_COUNT,
    overscan: TREE_OVERSCAN,
    onSelectionChange: handleSelectionChange,
  });

  const modelRef = useRef(model);

  const search = useFileTreeSearch(model);

  const syncExternalSelection = useCallback(() => {
    const currentModel = modelRef.current;
    const path = selectedPathRef.current;
    const annotationsByPath = treeInputRef.current.annotationsByPath;

    isProgrammaticSelectionRef.current = true;
    try {
      if (!path) {
        for (const selected of currentModel.getSelectedPaths()) {
          currentModel.getItem(selected)?.deselect();
        }
        return;
      }

      if (!annotationsByPath.has(path)) {
        return;
      }

      const selectedPaths = currentModel.getSelectedPaths();
      if (selectedPaths.length === 1 && selectedPaths[0] === path) {
        return;
      }

      for (const selected of selectedPaths) {
        if (selected !== path) {
          currentModel.getItem(selected)?.deselect();
        }
      }

      if (!selectedPaths.includes(path)) {
        currentModel.getItem(path)?.select();
      }
    } finally {
      isProgrammaticSelectionRef.current = false;
    }
  }, []);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
    syncExternalSelection();
  }, [selectedPath, syncExternalSelection]);

  useEffect(() => {
    if (searchQuery) {
      model.setSearch(searchQuery);
    } else {
      model.closeSearch();
    }
  }, [model, searchQuery]);

  useEffect(() => {
    return model.subscribe(() => {
      if (searchQuery && model.getSearchValue() !== searchQuery) {
        model.setSearch(searchQuery);
      }
    });
  }, [model, searchQuery]);

  // Auto-collapse directories once every file inside is viewed; applied only on
  // transitions so manual expand/collapse is respected.
  const appliedFullyViewedDirectoriesRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const isSameInput = treeInputRef.current === treeInput;
    treeInputRef.current = treeInput;

    if (pathsSignatureRef.current === treeInput.pathsSignature) {
      model.setGitStatus(treeInput.gitStatus);
      if (!isSameInput) {
        // Decorations (comment badges, viewed marks) changed: force a row re-render.
        model.setComposition(model.getComposition());
      }
      return;
    }

    pathsSignatureRef.current = treeInput.pathsSignature;
    appliedFullyViewedDirectoriesRef.current = null;
    model.resetPaths(treeInput.paths, { preparedInput: treeInput.preparedInput });
    model.setGitStatus(treeInput.gitStatus);
    setSearchQuery('');
    syncExternalSelection();
  }, [model, treeInput, syncExternalSelection]);

  useEffect(() => {
    if (!viewedByPath || !isViewedReady || searchQuery) {
      return;
    }

    const fullyViewed = new Set<string>();
    for (const [directoryPath, directoryFiles] of treeInput.filePathsByDirectory) {
      if (
        directoryFiles.length > 0 &&
        directoryFiles.every((path) => isViewedComplete(viewedByPath.get(path)))
      ) {
        fullyViewed.add(directoryPath);
      }
    }

    const previous = appliedFullyViewedDirectoriesRef.current;
    for (const directoryPath of fullyViewed) {
      if (previous?.has(directoryPath)) {
        continue;
      }

      const item = model.getItem(directoryPath);
      if (item && 'collapse' in item) {
        item.collapse();
      }
    }

    if (previous) {
      for (const directoryPath of previous) {
        if (fullyViewed.has(directoryPath)) {
          continue;
        }

        const item = model.getItem(directoryPath);
        if (item && 'expand' in item) {
          item.expand();
        }
      }
    }

    appliedFullyViewedDirectoriesRef.current = fullyViewed;
  }, [model, treeInput.filePathsByDirectory, viewedByPath, isViewedReady, searchQuery]);

  useEffect(() => {
    modelRef.current = model;
    syncExternalSelection();
    return model.subscribe(syncExternalSelection);
  }, [model, syncExternalSelection]);

  // Row clicks are handled by Pierre inside the shadow root. We listen in the
  // capture phase on the host so we can (a) intercept viewed-checkbox clicks
  // before they select the row and (b) re-scroll to a file that is already
  // selected, since Pierre only reports selection *changes*.
  const latestHandlersRef = useRef({
    onSelectPath,
    onToggleViewed,
    onToggleViewedMany,
    viewedByPath,
    isViewedReady,
  });
  useEffect(() => {
    latestHandlersRef.current = {
      onSelectPath,
      onToggleViewed,
      onToggleViewedMany,
      viewedByPath,
      isViewedReady,
    };
  });

  useEffect(() => {
    const host = treeHostRef.current;
    if (!host) {
      return;
    }

    const toggleViewedForRow = (row: { path: string; isFile: boolean }) => {
      const {
        onToggleViewed: toggleViewed,
        onToggleViewedMany: toggleViewedMany,
        viewedByPath: currentViewedByPath,
        isViewedReady: ready,
      } = latestHandlersRef.current;
      if (!currentViewedByPath || !ready) {
        return;
      }

      if (row.isFile) {
        toggleViewed?.(row.path, !isViewedComplete(currentViewedByPath.get(row.path)));
        return;
      }

      const directoryFiles =
        treeInputRef.current.filePathsByDirectory.get(normalizeTreeDirectoryPath(row.path)) ?? [];
      if (directoryFiles.length === 0) {
        return;
      }

      const allViewed = directoryFiles.every((path) =>
        isViewedComplete(currentViewedByPath.get(path)),
      );
      toggleViewedMany?.(directoryFiles, !allViewed);
    };

    const handleClick = (event: MouseEvent) => {
      const row = findTreeRowFromEvent(event);
      if (!row) {
        return;
      }

      if (isViewedMarkTarget(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 0) {
          toggleViewedForRow(row);
        }
        return;
      }

      if (
        !row.isFile ||
        event.button !== 0 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      if (row.path === selectedPathRef.current) {
        latestHandlersRef.current.onSelectPath(row.path);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      const row = findTreeRowFromEvent(event);
      if (row?.isFile && row.path === selectedPathRef.current) {
        latestHandlersRef.current.onSelectPath(row.path);
      }
    };

    host.addEventListener('click', handleClick, { capture: true });
    host.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      host.removeEventListener('click', handleClick, { capture: true });
      host.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);

  return (
    <div
      className={treePanelClassName}
      style={treeThemeStyles}
    >
      <div className={treePanelTopClassName}>
        <SidebarPrStats
          pullRequest={pullRequest}
          reviewCommentCount={reviewCommentCount}
        />
        {reviewProgress && onJumpToNextUnviewed ? (
          <div className='px-3 pb-0.5'>
            <ReviewProgress
              viewed={reviewProgress.viewed}
              total={reviewProgress.total}
              onJumpToNextUnviewed={onJumpToNextUnviewed}
            />
          </div>
        ) : null}
      </div>
      <FileTreeSearchHeader
        inputRef={searchInputRef}
        matchingPaths={search.matchingPaths}
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchQueryChange}
      />
      <div
        ref={treeHostRef}
        className='flex min-h-0 flex-1 flex-col'
      >
        <FileTree
          className='min-h-0 flex-1'
          model={model}
          style={{ height: '100%', colorScheme: treeThemeStyles.colorScheme }}
        />
      </div>
      <SidebarPrInfo pullRequest={pullRequest} />
    </div>
  );
}
