import {
  preparePresortedFileTreeInput,
  type FileTreePreparedInput,
  type FileTreeRowDecoration,
  type GitStatusEntry,
} from '@pierre/trees';

import type { GitHubPullRequestFile } from '@/lib/github/api';
import type { FileViewedState } from '@/lib/github/graphql';

import { formatReviewCommentDecorationTitle } from './comment-badge';
import {
  countViewedFiles,
  getDirectoryViewedMark,
  getFileViewedMark,
  TREE_VIEWED_MARK_COLOR,
  TREE_VIEWED_MARK_TITLE,
  type TreeViewedMark,
} from './viewed-mark';

export type PreparedFileTreeInput = {
  /** File rows only — keys are file paths. */
  annotationsByPath: Map<string, FileTreeRowDecoration>;
  /** Directory rows — keys are canonical tree directory paths (trailing slash). */
  directoryAnnotationsByPath: Map<string, FileTreeRowDecoration>;
  /** Every changed file under each directory (recursive), keyed like `directoryAnnotationsByPath`. */
  filePathsByDirectory: Map<string, string[]>;
  gitStatus: GitStatusEntry[];
  paths: string[];
  pathsSignature: string;
  preparedInput: FileTreePreparedInput;
};

const preparedInputCache = new Map<string, FileTreePreparedInput>();

function getPathsSignature(paths: readonly string[]): string {
  return paths.join('\0');
}

function getOrCreatePreparedInput(paths: string[]): FileTreePreparedInput {
  const signature = getPathsSignature(paths);
  const cached = preparedInputCache.get(signature);
  if (cached) {
    return cached;
  }

  const preparedInput = preparePresortedFileTreeInput(paths);
  preparedInputCache.set(signature, preparedInput);
  return preparedInput;
}

/** Pierre canonicalizes directory ids with a trailing slash (`src/lib/`). */
export function normalizeTreeDirectoryPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

export function groupFilePathsByDirectory(paths: readonly string[]): Map<string, string[]> {
  const filePathsByDirectory = new Map<string, string[]>();

  for (const path of paths) {
    let separatorIndex = path.indexOf('/');
    while (separatorIndex !== -1) {
      const directoryPath = path.slice(0, separatorIndex + 1);
      const bucket = filePathsByDirectory.get(directoryPath);
      if (bucket) {
        bucket.push(path);
      } else {
        filePathsByDirectory.set(directoryPath, [path]);
      }
      separatorIndex = path.indexOf('/', separatorIndex + 1);
    }
  }

  return filePathsByDirectory;
}

export function createFileTreeInput(
  files: GitHubPullRequestFile[],
  reviewCommentCountByPath: ReadonlyMap<string, number> = new Map(),
  viewedByPath: ReadonlyMap<string, FileViewedState> | null = null,
): PreparedFileTreeInput {
  const paths = files.map((file) => file.filename);
  const pathsSignature = getPathsSignature(paths);
  const annotationsByPath = new Map<string, FileTreeRowDecoration>();
  const directoryAnnotationsByPath = new Map<string, FileTreeRowDecoration>();
  const gitStatus: GitStatusEntry[] = [];

  for (const file of files) {
    const reviewCommentCount = reviewCommentCountByPath.get(file.filename) ?? 0;
    const viewedMark = viewedByPath ? getFileViewedMark(viewedByPath.get(file.filename)) : null;
    annotationsByPath.set(
      file.filename,
      formatFileTreeRowDecoration(file, reviewCommentCount, viewedMark),
    );
    gitStatus.push({ path: file.filename, status: toTreeGitStatus(file.status) });
  }

  const filePathsByDirectory = groupFilePathsByDirectory(paths);
  if (viewedByPath) {
    for (const [directoryPath, directoryFiles] of filePathsByDirectory) {
      const viewedCount = countViewedFiles(directoryFiles, viewedByPath);
      directoryAnnotationsByPath.set(
        directoryPath,
        formatDirectoryViewedDecoration(viewedCount, directoryFiles.length),
      );
    }
  }

  return {
    annotationsByPath,
    directoryAnnotationsByPath,
    filePathsByDirectory,
    gitStatus,
    paths,
    pathsSignature,
    preparedInput: getOrCreatePreparedInput(paths),
  };
}

type FileTreeRowDecorationTextPart = { text: string; color?: string };

function viewedMarkPart(mark: TreeViewedMark): FileTreeRowDecorationTextPart {
  return { text: '', color: TREE_VIEWED_MARK_COLOR[mark] };
}

function formatDirectoryViewedDecoration(
  viewedCount: number,
  total: number,
): FileTreeRowDecoration {
  const mark = getDirectoryViewedMark(viewedCount, total);
  const filesLabel = total === 1 ? 'file' : 'files';
  return {
    text: '',
    title: `${viewedCount.toLocaleString()} of ${total.toLocaleString()} ${filesLabel} viewed · ${TREE_VIEWED_MARK_TITLE[mark]}`,
    parts: [viewedMarkPart(mark)],
  };
}

function formatFileTreeRowDecoration(
  file: GitHubPullRequestFile,
  reviewCommentCount: number,
  viewedMark: TreeViewedMark | null,
): FileTreeRowDecoration {
  const changeSummary = formatFileChangeAnnotation(file);
  const changeTitle = `${file.changes.toLocaleString()} total changes: +${file.additions.toLocaleString()} / -${file.deletions.toLocaleString()}`;

  const text = reviewCommentCount === 0 ? changeSummary : `${changeSummary} · `;
  let title =
    reviewCommentCount === 0
      ? changeTitle
      : formatReviewCommentDecorationTitle(changeTitle, reviewCommentCount);

  if (viewedMark == null) {
    return { text, title };
  }

  title = `${title} · ${TREE_VIEWED_MARK_TITLE[viewedMark]}`;
  return {
    text,
    title,
    parts: [{ text }, viewedMarkPart(viewedMark)],
  };
}

function formatFileChangeAnnotation(file: GitHubPullRequestFile): string {
  if (file.additions === 0 && file.deletions === 0) {
    return file.changes > 0 ? file.changes.toLocaleString() : '0';
  }

  if (file.additions === 0) {
    return `-${file.deletions.toLocaleString()}`;
  }

  if (file.deletions === 0) {
    return `+${file.additions.toLocaleString()}`;
  }

  return `+${file.additions.toLocaleString()} / -${file.deletions.toLocaleString()}`;
}

function toTreeGitStatus(
  status: GitHubPullRequestFile['status'],
): 'added' | 'deleted' | 'modified' | 'renamed' {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}
