/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogのfocus stackを保ったまま非破壊操作をdialogとして公開する。 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import {
  Columns2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  Ellipsis,
  RotateCcw,
  Rows3,
  Search,
  Tag,
  Undo2,
} from 'lucide-react';

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
import { Dialog } from '../../ui/Dialog';
import { PaneResizer } from '../../ui/PaneResizer';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';

export interface HistoryViewProps {
  repo: RepoSnapshot;
  adapter: WorkspaceAdapter;
  busy?: boolean;
  onError?: ShowWorkspaceError | undefined;
  onAction: (action: WorkspaceAction) => Promise<void>;
  paneWidths: { left: number; right?: number };
  onPaneWidthsChange: (widths: { left: number; right?: number }) => void;
}

const GRAPH_HEIGHT = 48;
const GRAPH_MIDDLE = GRAPH_HEIGHT / 2;
const GRAPH_EDGE_TOP = 0;
const GRAPH_EDGE_BOTTOM = GRAPH_HEIGHT;
const GRAPH_LANE_GAP = 12;
const GRAPH_HORIZONTAL_PADDING = 6;
const HISTORY_LANE_COLOR_COUNT = 6;

type HistoryLaneStyle = CSSProperties & { '--history-lane-color': string };

function historyLaneStyle(lane: number): HistoryLaneStyle {
  return { '--history-lane-color': `var(--history-lane-${lane % HISTORY_LANE_COLOR_COUNT})` };
}

function graphWidth(laneCount: number): number {
  return Math.max(20, GRAPH_HORIZONTAL_PADDING * 2 + (laneCount - 1) * GRAPH_LANE_GAP);
}

function laneX(lane: number): number {
  return GRAPH_HORIZONTAL_PADDING + lane * GRAPH_LANE_GAP;
}

function graphEdgePath(fromLane: number, fromY: number, toLane: number, toY: number): string {
  const fromX = laneX(fromLane);
  const toX = laneX(toLane);
  if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const controlY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${toY}`;
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
}: {
  commit: HistoryGraphNode<CommitSummary>;
  laneCount: number;
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
      <svg
        width={width}
        viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        {throughLanes.map((lane) => (
          <path
            key={`active:${lane}`}
            className="history-graph-edge active"
            data-edge-kind="active"
            data-from-lane={lane}
            data-to-lane={lane}
            style={historyLaneStyle(lane)}
            d={graphEdgePath(lane, GRAPH_EDGE_TOP, lane, GRAPH_EDGE_BOTTOM)}
          />
        ))}
        {commit.incomingEdges.map((edge) => (
          <path
            key={`incoming:${edge.fromLane}:${edge.toLane}`}
            className="history-graph-edge incoming"
            data-edge-kind="incoming"
            data-from-lane={edge.fromLane}
            data-to-lane={edge.toLane}
            style={historyLaneStyle(edge.fromLane)}
            d={graphEdgePath(edge.fromLane, GRAPH_EDGE_TOP, edge.toLane, GRAPH_MIDDLE)}
          />
        ))}
        {commit.parentEdges.map((edge) => (
          <path
            key={`parent:${edge.parentOid}:${edge.toLane}`}
            className="history-graph-edge parent"
            data-edge-kind="parent"
            data-from-lane={edge.fromLane}
            data-to-lane={edge.toLane}
            style={historyLaneStyle(edge.toLane)}
            d={graphEdgePath(edge.fromLane, GRAPH_MIDDLE, edge.toLane, GRAPH_EDGE_BOTTOM)}
          />
        ))}
      </svg>
      <span className="history-graph-node" data-node-lane={commit.lane} />
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

export function HistoryView({
  repo,
  adapter,
  busy = false,
  onError,
  onAction,
  paneWidths,
  onPaneWidthsChange,
}: HistoryViewProps) {
  const { t, message, formatDate } = useI18n();
  const [selectedOid, setSelectedOid] = useState(repo.selectedCommitOid ?? repo.history[0]?.oid);
  const [details, setDetails] = useState<CommitDetails>();
  const [sourceRef, setSourceRef] = useState('');
  const [branchName, setBranchName] = useState('');
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const [mainlineParent, setMainlineParent] = useState(1);
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [actionsOpen, setActionsOpen] = useState(false);
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
  const loadingMoreRef = useRef(false);
  const historyRequestIdRef = useRef(0);
  const visibleHistory = useMemo(
    () => assignHistoryLanes(historyPage.commits),
    [historyPage.commits],
  );
  const selectedCommit = visibleHistory.find((commit) => commit.oid === selectedOid);
  const selectedActionOid = details?.oid === selectedOid ? selectedOid : undefined;
  const selectedCommitNeedsMainline = Boolean(selectedCommit && selectedCommit.parents.length > 1);
  const selectedMainlineParent = Math.min(
    Math.max(1, mainlineParent),
    selectedCommit?.parents.length ?? 1,
  );
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
    if (!selectedOid) {
      setDetails(undefined);
      return undefined;
    }
    let cancelled = false;
    setError(undefined);
    setDetails(undefined);
    void adapter
      .query({ kind: 'commitDetails', repoId: repo.repoId, oid: selectedOid })
      .then((result) => {
        if (!cancelled && result.kind === 'commitDetails' && result.commit.oid === selectedOid)
          setDetails(result.commit);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          reportRuntimeError(
            t('loadCommitDetailsFailedTitle'),
            cause,
            t('loadCommitDetailsFailed'),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, repo.repoId, reportRuntimeError, selectedOid, t]);

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
    setMainlineParent(1);
  }, [selectedOid]);

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
  const historyListStyle: CSSProperties & { '--history-graph-width': string } = {
    '--history-graph-width': `${graphWidth(graphLaneCount)}px`,
  };

  const submitBranch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedOid || !branchName.trim()) return;
    await onAction({ kind: 'createBranch', name: branchName.trim(), startOid: selectedOid });
    setBranchName('');
  };

  const runIntegration = async (kind: 'merge' | 'rebase'): Promise<void> => {
    if (!sourceRef.trim()) return;
    await onAction(
      kind === 'merge'
        ? { kind: 'merge', sourceRef: sourceRef.trim() }
        : { kind: 'rebase', ontoRef: sourceRef.trim() },
    );
    setSourceRef('');
  };

  const paneStyle: CSSProperties & { '--left-pane': string } = {
    '--left-pane': `${paneWidths.left}px`,
  };

  const updateResetMode = (value: string): void => {
    if (value === 'soft' || value === 'mixed' || value === 'hard') setResetMode(value);
  };

  const actionsToggle = (
    <button
      type="button"
      className="history-actions-toggle"
      aria-expanded={actionsOpen}
      aria-haspopup="dialog"
      aria-controls="history-actions-dialog"
      onClick={() => setActionsOpen(true)}
    >
      <Ellipsis aria-hidden="true" size={14} /> {t('actions')}
    </button>
  );

  return (
    <div className="three-pane history-view" style={paneStyle}>
      <aside className="pane commit-list-pane" aria-label={t('commitHistory')}>
        <div className="pane-toolbar history-list-toolbar">
          <div className="history-branch-context" title={repo.branch.name ?? t('detachedHead')}>
            <GitBranch aria-hidden="true" focusable="false" />
            <span>{repo.branch.name ?? t('detachedHead')}</span>
          </div>
          {actionsToggle}
        </div>
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
              <LoaderCircle
                className="history-search-loading"
                aria-hidden="true"
                focusable="false"
              />
              <output className="sr-only">{t('loading')}</output>
            </>
          ) : null}
        </label>
        <ol ref={historyListRef} className="commit-list" style={historyListStyle}>
          {visibleHistory.map((commit) => (
            <li key={commit.oid}>
              <button
                type="button"
                className="commit-row"
                aria-current={selectedOid === commit.oid ? 'true' : undefined}
                onClick={() => setSelectedOid(commit.oid)}
              >
                <HistoryGraph commit={commit} laneCount={graphLaneCount} />
                <span className="commit-copy">
                  <strong>{commit.subject}</strong>
                  <small>
                    {commit.authorName} · {commit.shortOid}
                  </small>
                  <span className="sr-only">
                    {commit.parents.length
                      ? t('commitParents', { parents: commit.parents.join(', ') })
                      : t('rootCommit')}
                  </span>
                  <HistoryRefs refs={commit.refs} />
                </span>
                <time dateTime={commit.authoredAt}>
                  {formatDate(commit.authoredAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </button>
            </li>
          ))}
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
                  <p className="eyebrow">{details.shortOid}</p>
                  <h2 id="commit-detail-title">{details.subject}</h2>
                  <HistoryRefs refs={details.refs} />
                </div>
              </div>
              <p>{details.body}</p>
              <dl className="metadata-list inline">
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
            {details.diff && !details.diff.tooLarge ? (
              <div className="diff-display-controls">
                <fieldset className="segmented" aria-label={t('diffLayout')}>
                  {(['unified', 'split'] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      aria-pressed={diffStyle === style}
                      onClick={() => setDiffStyle(style)}
                    >
                      {style === 'unified' ? (
                        <Rows3 aria-hidden="true" size={14} />
                      ) : (
                        <Columns2 aria-hidden="true" size={14} />
                      )}{' '}
                      {t(style === 'unified' ? 'unified' : 'split')}
                    </button>
                  ))}
                </fieldset>
              </div>
            ) : null}
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
                  performanceMode={Boolean(details.diff.tooLarge)}
                  showFileHeaders
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
            <p className="empty-state-small">
              {t(selectedOid ? 'loadingCommitDetails' : 'selectCommit')}
            </p>
          </>
        )}
      </main>
      {actionsOpen ? (
        <Dialog
          labelledBy="history-actions-title"
          onDismiss={() => setActionsOpen(false)}
          role="dialog"
        >
          <h2 id="history-actions-title">{t('actions')}</h2>
          <div id="history-actions-dialog" className="history-actions-dialog">
            {operationActionDisabledReason ? (
              <p id="history-operation-action-reason" className="remote-action-hint">
                {operationActionDisabledReason}
              </p>
            ) : null}
            <form onSubmit={(event) => settleAction(submitBranch(event))}>
              <label>
                <span>{t('createBranchFromSelected')}</span>
                <input
                  data-dialog-initial-focus
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder={t('branchNamePlaceholder')}
                />
              </label>
              <button
                type="submit"
                disabled={!selectedOid || !branchName.trim() || repositoryActionsDisabled}
                aria-describedby={
                  operationActionDisabledReason ? 'history-operation-action-reason' : undefined
                }
              >
                <GitBranch aria-hidden="true" size={14} /> {t('createBranch')}
              </button>
            </form>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                settleAction(runIntegration('merge'));
              }}
            >
              <label>
                <span>{t('sourceRef')}</span>
                <input
                  value={sourceRef}
                  onChange={(event) => setSourceRef(event.target.value)}
                  placeholder={t('branchNamePlaceholder')}
                />
              </label>
              <div className="button-row">
                <button
                  type="submit"
                  disabled={!sourceRef.trim() || repositoryActionsDisabled}
                  aria-describedby={
                    operationActionDisabledReason ? 'history-operation-action-reason' : undefined
                  }
                >
                  <GitMerge aria-hidden="true" size={14} /> {t('merge')}
                </button>
                <button
                  type="button"
                  disabled={!sourceRef.trim() || repositoryActionsDisabled}
                  aria-describedby={
                    operationActionDisabledReason ? 'history-operation-action-reason' : undefined
                  }
                  onClick={() => settleAction(runIntegration('rebase'))}
                >
                  <GitPullRequest aria-hidden="true" size={14} /> {t('rebase')}
                </button>
              </div>
            </form>

            <div className="action-section">
              <span>{t('selectedCommit')}</span>
              {selectedCommitNeedsMainline ? (
                <label>
                  <span>{t('mainlineParent')}</span>
                  <select
                    aria-label={t('mainlineParent')}
                    value={selectedMainlineParent}
                    onChange={(event) => setMainlineParent(Number(event.target.value))}
                  >
                    {selectedCommit?.parents.map((parent, index) => (
                      <option key={parent} value={index + 1}>
                        {t('parentNumber', { number: index + 1 })} · {parent.slice(0, 7)}
                      </option>
                    ))}
                  </select>
                  <small id="merge-mainline-help">{t('mainlineHelp')}</small>
                </label>
              ) : null}
              <button
                type="button"
                disabled={!selectedActionOid || repositoryActionsDisabled}
                aria-describedby={
                  operationActionDisabledReason
                    ? 'history-operation-action-reason'
                    : selectedCommitNeedsMainline
                      ? 'merge-mainline-help'
                      : undefined
                }
                onClick={() =>
                  selectedActionOid &&
                  settleAction(
                    onAction({
                      kind: 'cherryPick',
                      oid: selectedActionOid,
                      ...(selectedCommitNeedsMainline ? { mainline: selectedMainlineParent } : {}),
                    }),
                  )
                }
              >
                <GitCommitHorizontal aria-hidden="true" size={14} /> {t('cherryPick')}
              </button>
              <button
                type="button"
                disabled={!selectedActionOid || repositoryActionsDisabled}
                aria-describedby={
                  operationActionDisabledReason
                    ? 'history-operation-action-reason'
                    : selectedCommitNeedsMainline
                      ? 'merge-mainline-help'
                      : undefined
                }
                onClick={() =>
                  selectedActionOid &&
                  settleAction(
                    onAction({
                      kind: 'revert',
                      oid: selectedActionOid,
                      ...(selectedCommitNeedsMainline ? { mainline: selectedMainlineParent } : {}),
                    }),
                  )
                }
              >
                <Undo2 aria-hidden="true" size={14} /> {t('revert')}
              </button>
            </div>

            <div className="action-section danger-zone">
              <label>
                <span>{t('reset')}</span>
                <select value={resetMode} onChange={(event) => updateResetMode(event.target.value)}>
                  <option value="soft">{t('soft')}</option>
                  <option value="mixed">{t('mixed')}</option>
                  <option value="hard">{t('hard')}</option>
                </select>
              </label>
              <button
                type="button"
                className={resetMode === 'hard' ? 'danger' : undefined}
                disabled={!selectedActionOid || repositoryActionsDisabled}
                aria-describedby={
                  operationActionDisabledReason ? 'history-operation-action-reason' : undefined
                }
                onClick={() =>
                  selectedActionOid &&
                  settleAction(onAction({ kind: 'reset', oid: selectedActionOid, mode: resetMode }))
                }
              >
                <RotateCcw aria-hidden="true" size={14} />{' '}
                {t('resetToTarget', {
                  target: selectedActionOid ? selectedActionOid.slice(0, 7) : t('commitLowercase'),
                })}
              </button>
            </div>
          </div>
          <div className="button-row end">
            <button type="button" onClick={() => setActionsOpen(false)}>
              {t('close')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
