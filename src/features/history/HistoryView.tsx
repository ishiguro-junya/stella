import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { GitBranch, GitCommitHorizontal, LoaderCircle, Search, Tag } from 'lucide-react';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { patchContainsMultipleFiles } from '../../domain/diffProfile';
import {
  assignHistoryLanes,
  HISTORY_PAGE_SIZE,
  type HistoryGraphNode,
} from '../../domain/historyLanes';
import type {
  CommitDetails,
  CommitSummary,
  DiffStyle,
  RepoSnapshot,
  WorkspaceAction,
} from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { DiffSurface } from '../diff/DiffSurface';
import {
  DEFAULT_EDITOR_WRAP_COLUMN,
  LEFT_PANE_MAX_WIDTH,
  LEFT_PANE_MIN_WIDTH,
} from '../../persistence/preferences';
import { PaneResizer } from '../../ui/PaneResizer';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import { HistoryActionDialog, type HistoryActionDialogRequest } from './HistoryActionDialog';
import {
  HistoryActionMenu,
  type HistoryActionKind,
  type HistoryActionTarget,
} from './HistoryActionMenu';
import type { RowActionMenuPoint } from '../../ui/RowActionMenu';

export interface HistoryViewProps {
  repo: RepoSnapshot;
  adapter: WorkspaceAdapter;
  busy?: boolean;
  onError?: ShowWorkspaceError | undefined;
  onShowChanges: () => void;
  onAction: (action: WorkspaceAction) => Promise<void>;
  diffStyle?: DiffStyle | undefined;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  stickyFileHeaders?: boolean | undefined;
  paneWidths: { left: number; right?: number };
  onPaneWidthsChange: (widths: { left: number; right?: number }) => void;
}

const GRAPH_CORNER_HEIGHT = 8;
const GRAPH_EDGE_LENGTH = 10_000;
const GRAPH_LANE_GAP = 12;
const GRAPH_HORIZONTAL_PADDING = 6;
const HISTORY_LANE_COLOR_COUNT = 6;

type HistoryLaneStyle = CSSProperties & { '--history-lane-color': string };
type HistoryMenuSource = 'list' | 'detail';

const WORKING_TREE_LANE_STYLE: HistoryLaneStyle = {
  '--history-lane-color': 'var(--history-working-tree)',
};

function historyLaneStyle(lane: number): HistoryLaneStyle {
  return { '--history-lane-color': `var(--history-lane-${lane % HISTORY_LANE_COLOR_COUNT})` };
}

function graphWidth(laneCount: number): number {
  return Math.max(20, GRAPH_HORIZONTAL_PADDING * 2 + (laneCount - 1) * GRAPH_LANE_GAP);
}

function laneX(lane: number): number {
  return GRAPH_HORIZONTAL_PADDING + lane * GRAPH_LANE_GAP;
}

function graphVerticalPath(lane: number): string {
  const x = laneX(lane);
  return `M ${x} 0 L ${x} ${GRAPH_EDGE_LENGTH}`;
}

function graphCornerPath(fromLane: number, toLane: number): string {
  return `M ${laneX(fromLane)} 0 L ${laneX(toLane)} ${GRAPH_CORNER_HEIGHT}`;
}

type HistoryRefKind = 'tag' | 'branch' | 'remote' | 'head' | 'other';

interface HistoryRefLabel {
  raw: string;
  kind: HistoryRefKind;
  label: string;
}

function historyRefLabel(raw: string): HistoryRefLabel {
  const tagPrefix = 'tag: refs/tags/';
  if (raw.startsWith(tagPrefix)) {
    return { raw, kind: 'tag', label: raw.slice(tagPrefix.length) };
  }
  if (raw.startsWith('refs/tags/')) {
    return { raw, kind: 'tag', label: raw.slice('refs/tags/'.length) };
  }

  const headTarget = raw.startsWith('HEAD -> ') ? raw.slice('HEAD -> '.length) : raw;
  if (headTarget.startsWith('refs/heads/')) {
    return { raw, kind: 'branch', label: headTarget.slice('refs/heads/'.length) };
  }
  if (headTarget.startsWith('refs/remotes/')) {
    return { raw, kind: 'remote', label: headTarget.slice('refs/remotes/'.length) };
  }
  if (raw === 'HEAD') return { raw, kind: 'head', label: raw };
  return { raw, kind: 'other', label: raw };
}

function localBranchNames(refs: readonly string[]): string[] {
  return [
    ...new Set(
      refs
        .map(historyRefLabel)
        .filter((ref) => ref.kind === 'branch')
        .map((ref) => ref.label),
    ),
  ];
}

function doubleClickBranch(
  target: EventTarget,
  refs: readonly string[],
  currentBranch: string | null,
): string | undefined {
  const clickedBranch =
    target instanceof Element
      ? target.closest<HTMLElement>('[data-local-branch]')?.dataset.localBranch
      : undefined;
  if (clickedBranch) return clickedBranch === currentBranch ? undefined : clickedBranch;

  const candidates = localBranchNames(refs).filter((branch) => branch !== currentBranch);
  return candidates.length === 1 ? candidates[0] : undefined;
}

const HISTORY_REF_ORDER: Record<HistoryRefKind, number> = {
  tag: 0,
  branch: 1,
  remote: 2,
  head: 3,
  other: 4,
};

function HistoryRefs({ refs }: { refs: readonly string[] }) {
  const { t } = useI18n();
  const labels = refs
    .map(historyRefLabel)
    .toSorted((left, right) => HISTORY_REF_ORDER[left.kind] - HISTORY_REF_ORDER[right.kind]);
  if (!labels.length) return null;

  return (
    <span className="ref-list">
      {labels.map((ref) => (
        <span
          key={ref.raw}
          className={`ref-chip ${ref.kind}`}
          title={ref.raw}
          data-local-branch={ref.kind === 'branch' ? ref.label : undefined}
          aria-label={ref.kind === 'tag' ? t('tagRefLabel', { name: ref.label }) : undefined}
        >
          {ref.kind === 'tag' ? (
            <Tag aria-hidden="true" focusable="false" />
          ) : ref.kind === 'head' ? (
            <GitCommitHorizontal aria-hidden="true" focusable="false" />
          ) : (
            <GitBranch aria-hidden="true" focusable="false" />
          )}
          <span>{ref.label}</span>
        </span>
      ))}
    </span>
  );
}

function HistoryGraph({
  commit,
  laneCount,
  connectsFromWorkingTree = false,
}: {
  commit: HistoryGraphNode<CommitSummary>;
  laneCount: number;
  connectsFromWorkingTree?: boolean;
}) {
  const width = graphWidth(laneCount);
  const incomingLanes = new Set(commit.incomingEdges.map((edge) => edge.fromLane));
  const throughLanes = commit.activeLanes.filter((lane) => !incomingLanes.has(lane));
  const graphStyle: CSSProperties & {
    '--history-lane-color': string;
    '--history-node-x': string;
  } = {
    ...historyLaneStyle(commit.lane),
    '--history-node-x': `${laneX(commit.lane)}px`,
  };

  return (
    <span
      className="history-graph"
      data-testid={`history-graph-${commit.oid}`}
      aria-hidden="true"
      style={graphStyle}
    >
      <svg className="history-graph-through" width={width} focusable="false">
        {throughLanes.map((lane) => (
          <path
            key={`active:${lane}`}
            className="history-graph-edge active"
            data-edge-kind="active"
            data-from-lane={lane}
            data-to-lane={lane}
            style={historyLaneStyle(lane)}
            d={graphVerticalPath(lane)}
          />
        ))}
      </svg>
      <svg className="history-graph-incoming-vertical" width={width} focusable="false">
        {connectsFromWorkingTree ? (
          <path
            className="history-graph-edge working-tree"
            data-edge-kind="working-tree-incoming-vertical"
            data-from-lane={commit.lane}
            data-to-lane={commit.lane}
            style={WORKING_TREE_LANE_STYLE}
            d={graphVerticalPath(commit.lane)}
          />
        ) : null}
        {commit.incomingEdges.map((edge) => (
          <path
            key={`incoming-vertical:${edge.fromLane}:${edge.toLane}`}
            className="history-graph-edge incoming-vertical"
            data-edge-kind="incoming-vertical"
            data-from-lane={edge.fromLane}
            data-to-lane={edge.toLane}
            style={historyLaneStyle(edge.fromLane)}
            d={graphVerticalPath(edge.fromLane)}
          />
        ))}
      </svg>
      <svg
        className="history-graph-incoming-corner"
        width={width}
        height={GRAPH_CORNER_HEIGHT}
        focusable="false"
      >
        {connectsFromWorkingTree ? (
          <path
            className="history-graph-edge working-tree"
            data-edge-kind="working-tree"
            data-from-lane={commit.lane}
            data-to-lane={commit.lane}
            style={WORKING_TREE_LANE_STYLE}
            d={graphCornerPath(commit.lane, commit.lane)}
          />
        ) : null}
        {commit.incomingEdges.map((edge) => (
          <path
            key={`incoming:${edge.fromLane}:${edge.toLane}`}
            className="history-graph-edge incoming"
            data-edge-kind="incoming"
            data-from-lane={edge.fromLane}
            data-to-lane={edge.toLane}
            style={historyLaneStyle(edge.fromLane)}
            d={graphCornerPath(edge.fromLane, edge.toLane)}
          />
        ))}
      </svg>
      <svg
        className="history-graph-outgoing-corner"
        width={width}
        height={GRAPH_CORNER_HEIGHT}
        focusable="false"
      >
        {commit.parentEdges.map((edge, index) => (
          <path
            key={`parent:${edge.parentOid}:${edge.toLane}`}
            className="history-graph-edge parent"
            data-edge-kind="parent"
            data-from-lane={edge.fromLane}
            data-to-lane={edge.toLane}
            style={historyLaneStyle(index === 0 ? edge.fromLane : edge.toLane)}
            d={graphCornerPath(edge.fromLane, edge.toLane)}
          />
        ))}
      </svg>
      <svg className="history-graph-outgoing-vertical" width={width} focusable="false">
        {commit.parentEdges.map((edge, index) => (
          <path
            key={`parent-vertical:${edge.parentOid}:${edge.toLane}`}
            className="history-graph-edge parent-vertical"
            data-edge-kind="parent-vertical"
            data-from-lane={edge.fromLane}
            data-to-lane={edge.toLane}
            style={historyLaneStyle(index === 0 ? edge.fromLane : edge.toLane)}
            d={graphVerticalPath(edge.toLane)}
          />
        ))}
      </svg>
      <span className="history-graph-node" data-node-lane={commit.lane} />
    </span>
  );
}

function WorkingTreeGraph({ laneCount, connected }: { laneCount: number; connected: boolean }) {
  const width = graphWidth(laneCount);
  const graphStyle: CSSProperties & {
    '--history-lane-color': string;
    '--history-node-x': string;
  } = {
    ...WORKING_TREE_LANE_STYLE,
    '--history-node-x': `${laneX(0)}px`,
  };

  return (
    <span
      className="history-graph history-working-tree-graph"
      data-testid="history-graph-working-tree"
      aria-hidden="true"
      style={graphStyle}
    >
      <svg
        className="history-graph-outgoing-corner"
        width={width}
        height={GRAPH_CORNER_HEIGHT}
        focusable="false"
      >
        {connected ? (
          <path
            className="history-graph-edge working-tree"
            data-edge-kind="working-tree"
            data-from-lane="0"
            data-to-lane="0"
            d={graphCornerPath(0, 0)}
          />
        ) : null}
      </svg>
      <svg className="history-graph-outgoing-vertical" width={width} focusable="false">
        {connected ? (
          <path
            className="history-graph-edge working-tree parent-vertical"
            data-edge-kind="working-tree-vertical"
            data-from-lane="0"
            data-to-lane="0"
            d={graphVerticalPath(0)}
          />
        ) : null}
      </svg>
      <span className="history-graph-node" data-node-lane="0" />
    </span>
  );
}

function settleAction(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

interface HistoryPageState {
  commits: RepoSnapshot['history'];
  nextSkip: number;
  complete: boolean;
}

function initialHistoryPage(commits: RepoSnapshot['history']): HistoryPageState {
  return {
    commits,
    nextSkip: commits.length,
    complete: commits.length < HISTORY_PAGE_SIZE,
  };
}

function appendUniqueCommits(
  current: RepoSnapshot['history'],
  incoming: RepoSnapshot['history'],
): RepoSnapshot['history'] {
  const seen = new Set(current.map((commit) => commit.oid));
  return [
    ...current,
    ...incoming.filter((commit) => {
      if (seen.has(commit.oid)) return false;
      seen.add(commit.oid);
      return true;
    }),
  ];
}

function actionTargetFor(commit: CommitSummary): HistoryActionTarget {
  return {
    oid: commit.oid,
    shortOid: commit.shortOid,
    subject: commit.subject,
    parents: commit.parents,
  };
}

export function HistoryView({
  repo,
  adapter,
  busy = false,
  onError,
  onShowChanges,
  onAction,
  diffStyle = 'unified',
  lineWrapping = false,
  wrapColumn = DEFAULT_EDITOR_WRAP_COLUMN,
  stickyFileHeaders = false,
  paneWidths,
  onPaneWidthsChange,
}: HistoryViewProps) {
  const { t, message, formatDate } = useI18n();
  const [selectedOid, setSelectedOid] = useState(repo.selectedCommitOid ?? repo.history[0]?.oid);
  const deferredSelectedOid = useDeferredValue(selectedOid);
  const [details, setDetails] = useState<CommitDetails>();
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [openMenu, setOpenMenu] = useState<{ oid: string; source: HistoryMenuSource }>();
  const [contextMenu, setContextMenu] = useState<
    { oid: string; point: RowActionMenuPoint } | undefined
  >();
  const [actionDialog, setActionDialog] = useState<HistoryActionDialogRequest>();
  const [historyPage, setHistoryPage] = useState<HistoryPageState>(() =>
    initialHistoryPage(repo.history),
  );
  const [historySearch, setHistorySearch] = useState('');
  const [activeHistorySearch, setActiveHistorySearch] = useState('');
  const [searchingHistory, setSearchingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const historyListRef = useRef<HTMLOListElement>(null);
  const historyEndRef = useRef<HTMLLIElement>(null);
  const actionFocusOidRef = useRef<string | undefined>(undefined);
  const focusedRepoRef = useRef<string | undefined>(undefined);
  const loadingMoreRef = useRef(false);
  const historyRequestIdRef = useRef(0);
  const visibleHistory = useMemo(
    () => assignHistoryLanes(historyPage.commits),
    [historyPage.commits],
  );
  const moveCommitSelection = useCallback(
    (index: number, offset: -1 | 1): void => {
      historyListRef.current?.classList.add('is-keyboard-navigating');
      const nextIndex = Math.min(Math.max(index + offset, 0), visibleHistory.length - 1);
      const next = visibleHistory[nextIndex];
      if (!next || nextIndex === index) return;
      setSelectedOid(next.oid);
      setOpenMenu(undefined);
      setContextMenu(undefined);
      const rows = historyListRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-history-commit-oid]',
      );
      rows?.[nextIndex]?.focus();
    },
    [visibleHistory],
  );
  const changedFileCount = new Set(repo.changes.map((change) => change.path)).size;
  const operationActionDisabledReason =
    repo.operation.kind === 'none'
      ? undefined
      : t('historyActionsUnavailable', { operation: message(repo.operation.label) });
  const repositoryActionsDisabled = busy || Boolean(operationActionDisabledReason);
  const reportRuntimeError = useCallback(
    (title: string, cause: unknown, fallback: string): void => {
      if (isWorkspaceErrorHandled(cause)) return;
      if (onError) {
        setError(undefined);
        onError(title, cause, fallback);
        return;
      }
      setError(describeWorkspaceError(cause, fallback));
    },
    [onError],
  );

  useEffect(() => {
    if (!deferredSelectedOid) {
      setDetails(undefined);
      return undefined;
    }
    let cancelled = false;
    setError(undefined);
    void adapter
      .query({ kind: 'commitDetails', repoId: repo.repoId, oid: deferredSelectedOid })
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'commitDetails' && result.commit.oid === deferredSelectedOid) {
          setDetails(result.commit);
          return;
        }
        setDetails(undefined);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDetails(undefined);
        reportRuntimeError(t('loadCommitDetailsFailedTitle'), cause, t('loadCommitDetailsFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, deferredSelectedOid, repo.repoId, reportRuntimeError, t]);

  useEffect(() => {
    const normalizedSearch = historySearch.trim();
    if (!normalizedSearch) {
      setActiveHistorySearch('');
      return undefined;
    }
    const timeout = window.setTimeout(() => setActiveHistorySearch(normalizedSearch), 180);
    return () => window.clearTimeout(timeout);
  }, [historySearch]);

  useEffect(() => {
    const focusHistorySearch = (event: KeyboardEvent): void => {
      if (
        event.key.toLowerCase() !== 'f' ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }
      event.preventDefault();
      historySearchRef.current?.focus();
      historySearchRef.current?.select();
    };
    window.addEventListener('keydown', focusHistorySearch);
    return () => window.removeEventListener('keydown', focusHistorySearch);
  }, []);

  useEffect(() => {
    historyRequestIdRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!activeHistorySearch) {
      setSearchingHistory(false);
      setHistoryPage(initialHistoryPage(repo.history));
      return undefined;
    }

    let cancelled = false;
    const requestId = historyRequestIdRef.current;
    setError(undefined);
    setSearchingHistory(true);
    setHistoryPage({ commits: [], nextSkip: 0, complete: true });
    void adapter
      .query({
        kind: 'history',
        repoId: repo.repoId,
        limit: HISTORY_PAGE_SIZE,
        skip: 0,
        search: activeHistorySearch,
      })
      .then((result) => {
        if (cancelled || requestId !== historyRequestIdRef.current || result.kind !== 'history')
          return;
        setHistoryPage({
          commits: result.commits,
          nextSkip: result.commits.length,
          complete: result.commits.length < HISTORY_PAGE_SIZE,
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled && requestId === historyRequestIdRef.current) {
          reportRuntimeError(t('searchHistoryFailedTitle'), cause, t('searchHistoryFailed'));
        }
      })
      .finally(() => {
        if (!cancelled && requestId === historyRequestIdRef.current) setSearchingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeHistorySearch,
    adapter,
    repo.branch.oid,
    repo.history,
    repo.repoId,
    reportRuntimeError,
    t,
  ]);

  useEffect(() => {
    setSelectedOid((current) => {
      if (current && visibleHistory.some((commit) => commit.oid === current)) return current;
      if (
        repo.selectedCommitOid &&
        visibleHistory.some((commit) => commit.oid === repo.selectedCommitOid)
      ) {
        return repo.selectedCommitOid;
      }
      return visibleHistory[0]?.oid;
    });
  }, [repo.selectedCommitOid, visibleHistory]);

  useEffect(() => {
    if (focusedRepoRef.current === repo.repoId || !selectedOid) return;
    const target = [
      ...(historyListRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-history-commit-oid]',
      ) ?? []),
    ].find((row) => row.dataset.historyCommitOid === selectedOid);
    if (!target) return;
    target.focus();
    focusedRepoRef.current = repo.repoId;
  }, [repo.repoId, selectedOid, visibleHistory]);

  useEffect(() => {
    const handleHistoryArrow = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        return;
      }
      const active = document.activeElement;
      if (
        active !== document.body &&
        !(active instanceof Element && active.closest('.history-view')) &&
        !(active instanceof Element && active.matches('.titlebar-menu-button[aria-current="page"]'))
      ) {
        return;
      }
      const index = visibleHistory.findIndex((commit) => commit.oid === selectedOid);
      if (index < 0) return;
      event.preventDefault();
      moveCommitSelection(index, event.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', handleHistoryArrow);
    return () => window.removeEventListener('keydown', handleHistoryArrow);
  }, [moveCommitSelection, selectedOid, visibleHistory]);

  useEffect(() => {
    setOpenMenu(undefined);
    setContextMenu(undefined);
    setActionDialog(undefined);
    actionFocusOidRef.current = undefined;
  }, [repo.repoId]);

  useEffect(() => {
    if (!busy) return;
    setOpenMenu(undefined);
    setContextMenu(undefined);
  }, [busy]);

  useEffect(() => {
    if (repo.operation.kind === 'none') return;
    setOpenMenu(undefined);
    setContextMenu(undefined);
    setActionDialog(undefined);
  }, [repo.operation.kind]);

  useEffect(() => {
    const oid = actionFocusOidRef.current;
    if (!oid || busy || actionDialog) return;
    const active = document.activeElement;
    if (active !== document.body) {
      if (active instanceof HTMLElement && active.closest('.history-commit-item')) {
        actionFocusOidRef.current = undefined;
      }
      return;
    }
    const rows = historyListRef.current?.querySelectorAll<HTMLButtonElement>(
      '.history-commit-item > .commit-row',
    );
    const target = [...(rows ?? [])].find((row) => row.dataset.historyCommitOid === oid);
    const fallback = historyListRef.current?.querySelector<HTMLButtonElement>(
      '.history-commit-item.is-current > .commit-row, .history-commit-item > .commit-row',
    );
    (target ?? fallback)?.focus();
    actionFocusOidRef.current = undefined;
  });

  const loadMoreHistory = useCallback(async (): Promise<void> => {
    if (loadingMoreRef.current || historyPage.complete) return;
    const requestId = ++historyRequestIdRef.current;
    const skip = historyPage.nextSkip;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(undefined);
    try {
      const result = await adapter.query({
        kind: 'history',
        repoId: repo.repoId,
        limit: HISTORY_PAGE_SIZE,
        skip,
        ...(activeHistorySearch ? { search: activeHistorySearch } : {}),
      });
      if (requestId !== historyRequestIdRef.current || result.kind !== 'history') return;
      setHistoryPage((current) => ({
        commits: appendUniqueCommits(current.commits, result.commits),
        nextSkip: skip + result.commits.length,
        complete: result.commits.length < HISTORY_PAGE_SIZE,
      }));
    } catch (cause) {
      if (requestId === historyRequestIdRef.current) {
        reportRuntimeError(t('loadMoreHistoryFailedTitle'), cause, t('loadMoreHistoryFailed'));
      }
    } finally {
      if (requestId === historyRequestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [
    activeHistorySearch,
    adapter,
    historyPage.complete,
    historyPage.nextSkip,
    repo.repoId,
    reportRuntimeError,
    t,
  ]);

  useEffect(() => {
    const root = historyListRef.current;
    const target = historyEndRef.current;
    if (!root || !target || historyPage.complete) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) settleAction(loadMoreHistory());
      },
      { root, rootMargin: '0px 0px 160px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [historyPage.complete, loadMoreHistory]);

  const graphLaneCount = Math.max(1, ...visibleHistory.map((commit) => commit.laneCount));
  const workingTreeConnectsToHistory =
    changedFileCount > 0 && !activeHistorySearch && visibleHistory.length > 0;
  const historyListStyle: CSSProperties & { '--history-graph-width': string } = {
    '--history-graph-width': `${graphWidth(graphLaneCount)}px`,
  };

  const paneStyle: CSSProperties & { '--left-pane': string } = {
    '--left-pane': `${paneWidths.left}px`,
  };
  const commitBody = details?.body?.trim();

  const selectCommitForActions = (commit: CommitSummary): void => {
    setSelectedOid(commit.oid);
    setContextMenu(undefined);
  };

  const openContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    commit: CommitSummary,
  ): void => {
    event.preventDefault();
    if (repositoryActionsDisabled) return;
    event.currentTarget.focus();
    setSelectedOid(commit.oid);
    setContextMenu({ oid: commit.oid, point: { x: event.clientX, y: event.clientY } });
    setOpenMenu({ oid: commit.oid, source: 'list' });
  };

  const openActionDialog = (kind: HistoryActionKind, target: HistoryActionTarget): void => {
    setOpenMenu(undefined);
    setContextMenu(undefined);
    actionFocusOidRef.current = target.oid;
    setActionDialog({ kind, target });
  };

  const checkoutCommitBranch = (
    event: ReactMouseEvent<HTMLButtonElement>,
    commit: CommitSummary,
  ): void => {
    if (repositoryActionsDisabled) return;
    const branch = doubleClickBranch(event.target, commit.refs, repo.branch.name);
    if (branch) settleAction(onAction({ kind: 'checkoutBranch', name: branch }));
  };

  const historySearchControl = (
    <label className="history-search">
      <Search className="history-search-icon" aria-hidden="true" focusable="false" />
      <input
        ref={historySearchRef}
        type="search"
        value={historySearch}
        aria-label={t('searchHistory')}
        aria-keyshortcuts="Meta+F"
        placeholder={t('searchHistory')}
        onChange={(event) => setHistorySearch(event.currentTarget.value)}
      />
      {searchingHistory ? (
        <>
          <LoaderCircle className="history-search-loading" aria-hidden="true" focusable="false" />
          <output className="sr-only">{t('loading')}</output>
        </>
      ) : null}
    </label>
  );

  return (
    <div className="three-pane history-view" style={paneStyle}>
      <aside className="pane commit-list-pane" aria-label={t('commitHistory')}>
        <div className="left-pane-toolbar history-pane-toolbar">{historySearchControl}</div>
        <ol
          ref={historyListRef}
          className="commit-list"
          style={historyListStyle}
          onPointerMove={(event) => event.currentTarget.classList.remove('is-keyboard-navigating')}
        >
          {changedFileCount > 0 ? (
            <li className="history-working-tree-item">
              <button
                type="button"
                className="commit-row history-working-tree-entry"
                aria-label={`${t('uncommittedChanges')}, ${t('uncommittedFileCount', {
                  count: changedFileCount,
                })}`}
                onClick={onShowChanges}
              >
                <WorkingTreeGraph
                  laneCount={graphLaneCount}
                  connected={workingTreeConnectsToHistory}
                />
                <span className="commit-copy">
                  <strong>{t('uncommittedChanges')}</strong>
                  <small>{t('uncommittedFileCount', { count: changedFileCount })}</small>
                </span>
              </button>
            </li>
          ) : null}
          {visibleHistory.map((commit, index) => {
            const target = actionTargetFor(commit);
            const selected = selectedOid === commit.oid;
            return (
              <li
                key={commit.oid}
                className={`history-commit-item${selected ? ' is-current' : ''}`}
              >
                <button
                  type="button"
                  className="commit-row"
                  data-history-commit-oid={commit.oid}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => setSelectedOid(commit.oid)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveCommitSelection(index, event.key === 'ArrowUp' ? -1 : 1);
                    }
                  }}
                  onDoubleClick={(event) => checkoutCommitBranch(event, commit)}
                  onContextMenu={(event) => openContextMenu(event, commit)}
                >
                  <HistoryGraph
                    commit={commit}
                    laneCount={graphLaneCount}
                    connectsFromWorkingTree={workingTreeConnectsToHistory && index === 0}
                  />
                  <span className="commit-copy">
                    <strong>{commit.subject}</strong>
                    <small className="commit-metadata">
                      <code className="commit-oid">{commit.shortOid}</code>
                      <span className="commit-author">{commit.authorName}</span>
                      <time dateTime={commit.authoredAt}>
                        {formatDate(commit.authoredAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </small>
                    <span className="sr-only">
                      {commit.parents.length
                        ? t('commitParents', { parents: commit.parents.join(', ') })
                        : t('rootCommit')}
                    </span>
                    <HistoryRefs refs={commit.refs} />
                  </span>
                </button>
                <HistoryActionMenu
                  target={target}
                  open={openMenu?.source === 'list' && openMenu.oid === commit.oid}
                  disabled={repositoryActionsDisabled}
                  contextPoint={contextMenu?.oid === commit.oid ? contextMenu.point : undefined}
                  onOpenChange={(open) => {
                    setOpenMenu(open ? { oid: commit.oid, source: 'list' } : undefined);
                    if (!open) setContextMenu(undefined);
                  }}
                  onTriggerOpen={() => selectCommitForActions(commit)}
                  onAction={(kind) => openActionDialog(kind, target)}
                />
              </li>
            );
          })}
          {activeHistorySearch && !searchingHistory && visibleHistory.length === 0 ? (
            <li className="history-search-empty">{t('noHistorySearchResults')}</li>
          ) : null}
          {!historyPage.complete ? (
            <li
              ref={historyEndRef}
              className={`history-load-sentinel ${loadingMore ? 'loading' : ''}`}
              data-testid="history-load-sentinel"
            >
              {loadingMore ? (
                <>
                  <LoaderCircle aria-hidden="true" focusable="false" />
                  <output className="sr-only">{t('loading')}</output>
                </>
              ) : null}
            </li>
          ) : null}
        </ol>
      </aside>
      <PaneResizer
        label={t('historyListWidth')}
        value={paneWidths.left}
        direction="growRight"
        min={LEFT_PANE_MIN_WIDTH}
        max={LEFT_PANE_MAX_WIDTH}
        onChange={(left) => onPaneWidthsChange({ ...paneWidths, left })}
      />

      <main className="pane commit-detail-pane" aria-labelledby="commit-detail-title">
        {error ? (
          <div className="inline-alert error" role="alert">
            <WorkspaceErrorDetails error={error} />
          </div>
        ) : null}
        {details ? (
          <>
            <header className="commit-detail-header">
              <div className="commit-detail-heading">
                <div>
                  <h2 id="commit-detail-title">{details.subject}</h2>
                  <HistoryRefs refs={details.refs} />
                </div>
                <HistoryActionMenu
                  target={actionTargetFor(details)}
                  open={openMenu?.source === 'detail' && openMenu.oid === details.oid}
                  disabled={repositoryActionsDisabled || details.oid !== selectedOid}
                  persistentTrigger
                  onOpenChange={(open) => {
                    setOpenMenu(open ? { oid: details.oid, source: 'detail' } : undefined);
                    if (!open) setContextMenu(undefined);
                  }}
                  onTriggerOpen={() => {
                    setContextMenu(undefined);
                    setOpenMenu({ oid: details.oid, source: 'detail' });
                  }}
                  onAction={(kind) => openActionDialog(kind, actionTargetFor(details))}
                />
              </div>
              {commitBody && commitBody !== details.subject.trim() ? <p>{commitBody}</p> : null}
              <dl className="metadata-list inline">
                <div>
                  <dt>{t('commitId')}</dt>
                  <dd>
                    <code>{details.shortOid}</code>
                  </dd>
                </div>
                <div>
                  <dt>{t('author')}</dt>
                  <dd>{details.authorName}</dd>
                </div>
                <div>
                  <dt>{t('date')}</dt>
                  <dd>
                    {formatDate(details.authoredAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </dd>
                </div>
              </dl>
            </header>
            {details.diff?.binary ? (
              <p className="empty-state-small">{t('binaryDiffUnavailable')}</p>
            ) : details.diff ? (
              <>
                {details.diff.truncated ? (
                  <output className="inline-alert warning">{t('diffBeginningOnly')}</output>
                ) : null}
                <DiffSurface
                  source={
                    details.diff.tooLarge || patchContainsMultipleFiles(details.diff.patch)
                      ? {
                          kind: 'codeView',
                          patch: details.diff.patch,
                          cacheKey: details.diff.diffId,
                        }
                      : {
                          kind: 'patch',
                          patch: details.diff.patch,
                          path: details.diff.path,
                          cacheKey: details.diff.diffId,
                        }
                  }
                  diffStyle={diffStyle}
                  lineWrapping={lineWrapping}
                  wrapColumn={wrapColumn}
                  performanceMode={Boolean(details.diff.tooLarge)}
                  showFileHeaders
                  stickyFileHeaders={stickyFileHeaders}
                  hunkSeparators="simple"
                  ariaLabel={t('commitDiffAria', { oid: details.shortOid })}
                />
              </>
            ) : (
              <p className="empty-state-small">{t('noCommitChanges')}</p>
            )}
          </>
        ) : (
          <>
            <header className="commit-detail-header">
              <div className="commit-detail-heading">
                <h2 id="commit-detail-title">{t('commitDetails')}</h2>
              </div>
            </header>
            {!selectedOid ? <p className="empty-state-small">{t('selectCommit')}</p> : null}
          </>
        )}
      </main>
      {actionDialog ? (
        <HistoryActionDialog
          key={`${actionDialog.kind}:${actionDialog.target.oid}`}
          request={actionDialog}
          disabled={repositoryActionsDisabled}
          disabledReason={operationActionDisabledReason}
          onDismiss={() => setActionDialog(undefined)}
          onAction={onAction}
        />
      ) : null}
    </div>
  );
}
