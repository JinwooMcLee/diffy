import type { FileViewedState } from '@/lib/github/graphql';
import { isViewedComplete } from '@/lib/review/viewed-files';

/**
 * Viewed checkbox rendered inside file tree rows.
 *
 * Pierre's tree only lets a row decoration carry text parts with a `color`, so
 * the checkbox is an empty part whose color is a sentinel custom property. The
 * CSS below targets that sentinel to draw a checkbox, and FileTreePanel
 * intercepts clicks on it (via `composedPath`) before the row handles them.
 */
export type TreeViewedMark = 'viewed' | 'unviewed' | 'dismissed' | 'partial';

const VIEWED_MARK_VAR_PREFIX = '--gprv-tree-viewed-';

export const TREE_VIEWED_MARK_COLOR: Record<TreeViewedMark, string> = {
  viewed: `var(${VIEWED_MARK_VAR_PREFIX}viewed)`,
  unviewed: `var(${VIEWED_MARK_VAR_PREFIX}unviewed)`,
  dismissed: `var(${VIEWED_MARK_VAR_PREFIX}dismissed)`,
  partial: `var(${VIEWED_MARK_VAR_PREFIX}partial)`,
};

export const TREE_VIEWED_MARK_TITLE: Record<TreeViewedMark, string> = {
  viewed: 'Viewed · click to mark as not viewed',
  unviewed: 'Not viewed · click to mark as viewed',
  dismissed: 'Changed since viewed · click to mark as viewed',
  partial: 'Partially viewed · click to mark all as viewed',
};

export function getFileViewedMark(state: FileViewedState | undefined): TreeViewedMark {
  if (state === 'VIEWED') {
    return 'viewed';
  }

  if (state === 'DISMISSED') {
    return 'dismissed';
  }

  return 'unviewed';
}

export function getDirectoryViewedMark(viewedCount: number, total: number): TreeViewedMark {
  if (total > 0 && viewedCount === total) {
    return 'viewed';
  }

  return viewedCount > 0 ? 'partial' : 'unviewed';
}

export function countViewedFiles(
  paths: readonly string[],
  viewedByPath: ReadonlyMap<string, FileViewedState>,
): number {
  let viewed = 0;
  for (const path of paths) {
    if (isViewedComplete(viewedByPath.get(path))) {
      viewed += 1;
    }
  }

  return viewed;
}

export function isTreeViewedMarkElement(node: EventTarget | null): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    (node.getAttribute('style') ?? '').includes(VIEWED_MARK_VAR_PREFIX)
  );
}

const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="black"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`;

const CHECK_ICON_MASK_URL = `url("data:image/svg+xml,${encodeURIComponent(CHECK_ICON_SVG)}")`;

const MARK_SELECTOR = `[data-item-section="decoration"] > span > span[style*="${VIEWED_MARK_VAR_PREFIX}"]`;

function markSelector(mark: TreeViewedMark): string {
  return `[data-item-section="decoration"] > span > span[style*="${VIEWED_MARK_VAR_PREFIX}${mark}"]`;
}

export const FILE_TREE_VIEWED_MARK_CSS = `
  ${MARK_SELECTOR} {
    align-items: center;
    border: 1.5px solid var(--trees-fg-muted, #8b949e);
    border-radius: 3px;
    box-sizing: border-box;
    cursor: pointer;
    display: inline-flex;
    flex-shrink: 0;
    height: 14px;
    justify-content: center;
    margin-left: 8px;
    opacity: 0.75;
    order: 4;
    overflow: visible;
    width: 14px;
  }

  ${MARK_SELECTOR}:hover {
    border-color: var(--trees-fg, #e6edf3);
    opacity: 1;
  }

  ${MARK_SELECTOR}::after {
    content: '';
    display: block;
    height: 10px;
    opacity: 0;
    width: 10px;
  }

  ${markSelector('viewed')} {
    background-color: var(--trees-selected-bg, #1f6feb);
    border-color: var(--trees-selected-bg, #1f6feb);
    opacity: 1;
  }

  ${markSelector('viewed')}::after {
    background-color: var(--trees-selected-fg, #ffffff);
    -webkit-mask-image: ${CHECK_ICON_MASK_URL};
    mask-image: ${CHECK_ICON_MASK_URL};
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: contain;
    opacity: 1;
  }

  ${markSelector('partial')}::after {
    background-color: var(--trees-fg-muted, #8b949e);
    border-radius: 1px;
    height: 2px;
    opacity: 1;
    width: 8px;
  }

  ${markSelector('dismissed')} {
    border-color: var(--trees-status-modified, #d29922);
    border-style: dashed;
    opacity: 1;
  }
`;
