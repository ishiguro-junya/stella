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
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Rows3,
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
import type { PaneWidths } from '../../persistence/preferences';
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
  paneWidths: PaneWidths;
  onPaneWidthsChange: (widths: PaneWidths) => void;
}

const GRAPH_HEIGHT = 48;
const GRAPH_MIDDLE = GRAPH_HEIGHT / 2;
const GRAPH_EDGE_TOP = -GRAPH_HEIGHT;
const GRAPH_EDGE_BOTTOM = GRAPH_HEIGHT * 2;
const GRAPH_LANE_GAP = 12;
const GRAPH_HORIZONTAL_PADDING = 6;

function graphWidth(laneCount: number): number {
  return Math.max(20, GRAPH_HORIZONTAL_PADDING * 2 + (laneCount - 1) * GRAPH_LANE_GAP);
}

function laneX(lane: number): number {
  return GRAPH_HORIZONTAL_PADDING + lane * GRAPH_LANE_GAP;
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

  return (
    <svg
      className="history-graph"
      data-testid={`history-graph-${commit.oid}`}
      width={width}
      viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`}
      preserveAspectRatio="xMinYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {throughLanes.map((lane) => (
        <path
          key={`active:${lane}`}
          className="history-graph-edge active"
          data-edge-kind="active"
          data-from-lane={lane}
          data-to-lane={lane}
          d={`M ${laneX(lane)} ${GRAPH_EDGE_TOP} L ${laneX(lane)} ${GRAPH_EDGE_BOTTOM}`}
        />
      ))}
      {commit.incomingEdges.map((edge) => (
        <path
          key={`incoming:${edge.fromLane}:${edge.toLane}`}
          className="history-graph-edge incoming"
          data-edge-kind="incoming"
          data-from-lane={edge.fromLane}
          data-to-lane={edge.toLane}
          d={`M ${laneX(edge.fromLane)} ${GRAPH_EDGE_TOP} L ${laneX(edge.toLane)} ${GRAPH_MIDDLE}`}
        />
      ))}
      {commit.parentEdges.map((edge) => (
        <path
          key={`parent:${edge.parentOid}:${edge.toLane}`}
          className="history-graph-edge parent"
          data-edge-kind="parent"
          data-from-lane={edge.fromLane}
          data-to-lane={edge.toLane}
          d={`M ${laneX(edge.fromLane)} ${GRAPH_MIDDLE} L ${laneX(edge.toLane)} ${GRAPH_EDGE_BOTTOM}`}
        />
      ))}
      <circle
        className="history-graph-node"
        data-node-lane={commit.lane}
        cx={laneX(commit.lane)}
        cy={GRAPH_MIDDLE}
        r="4"
      />
    </svg>
  );
}

function reachableCommitOids(history: RepoSnapshot['history'], headOid: string | undefined) {
  const reachable = new Set<string>();
  if (!headOid) return reachable;
  const byOid = new Map(history.map((commit) => [commit.oid, commit]));
  const pending = [headOid];
  while (pending.length) {
    const oid = pending.pop();
    if (!oid || reachable.has(oid)) continue;
    reachable.add(oid);
    const commit = byOid.get(oid);
    if (commit) pending.push(...commit.parents);
  }
  return reachable;
}

function settleAction(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

interface HistoryPageState {
  commits: RepoSnapshot['history'];
  nextSkip: number;
  complete: boolean;
}

const AUTO_HISTORY_PAGE_LIMIT = 5;

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
  const [allRefs, setAllRefs] = useState(false);
  const [sourceRef, setSourceRef] = useState('');
  const [branchName, setBranchName] = useState('');
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const [mainlineParent, setMainlineParent] = useState(1);
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState<HistoryPageState>(() =>
    initialHistoryPage(repo.history),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [automaticPagesLoaded, setAutomaticPagesLoaded] = useState(0);
  const historyRequestIdRef = useRef(0);
  const visibleHistory = useMemo(() => {
    const reachable = reachableCommitOids(historyPage.commits, repo.branch.oid);
    const visibleCommits = allRefs
      ? historyPage.commits
      : historyPage.commits.filter((commit) => reachable.has(commit.oid));
    return assignHistoryLanes(visibleCommits);
  }, [allRefs, historyPage.commits, repo.branch.oid]);
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
    historyRequestIdRef.current += 1;
    setHistoryPage(initialHistoryPage(repo.history));
    setLoadingMore(false);
    setAutomaticPagesLoaded(0);
  }, [repo.branch.oid, repo.history, repo.repoId]);

  useEffect(() => {
    setSelectedOid((current) =>
      current && visibleHistory.some((commit) => commit.oid === current)
        ? current
        : (repo.selectedCommitOid ?? visibleHistory[0]?.oid),
    );
  }, [repo.selectedCommitOid, visibleHistory]);

  useEffect(() => {
    setMainlineParent(1);
  }, [selectedOid]);

  const loadMoreHistory = useCallback(
    async (automatic = false): Promise<void> => {
      if (loadingMore || historyPage.complete) return;
      const requestId = ++historyRequestIdRef.current;
      const skip = historyPage.nextSkip;
      setLoadingMore(true);
      setError(undefined);
      try {
        const result = await adapter.query({
          kind: 'history',
          repoId: repo.repoId,
          limit: HISTORY_PAGE_SIZE,
          skip,
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
          if (automatic) setAutomaticPagesLoaded(AUTO_HISTORY_PAGE_LIMIT);
        }
      } finally {
        if (requestId === historyRequestIdRef.current) setLoadingMore(false);
      }
    },
    [
      adapter,
      historyPage.complete,
      historyPage.nextSkip,
      loadingMore,
      repo.repoId,
      reportRuntimeError,
      t,
    ],
  );

  const currentHeadNeedsMore = Boolean(
    repo.branch.oid && !allRefs && visibleHistory.length === 0 && !historyPage.complete,
  );
  const graphLaneCount = Math.max(1, ...visibleHistory.map((commit) => commit.laneCount));
  const historyListStyle: CSSProperties & { '--history-graph-width': string } = {
    '--history-graph-width': `${graphWidth(graphLaneCount)}px`,
  };

  useEffect(() => {
    if (!currentHeadNeedsMore || loadingMore || automaticPagesLoaded >= AUTO_HISTORY_PAGE_LIMIT)
      return;
    setAutomaticPagesLoaded((current) => current + 1);
    void loadMoreHistory(true);
  }, [automaticPagesLoaded, currentHeadNeedsMore, loadMoreHistory, loadingMore]);

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

  const paneStyle: CSSProperties & { '--left-pane': string; '--right-pane': string } = {
    '--left-pane': `${paneWidths.left}px`,
    '--right-pane': `${paneWidths.right}px`,
  };

  const updateResetMode = (value: string): void => {
    if (value === 'soft' || value === 'mixed' || value === 'hard') setResetMode(value);
  };

  const actionsToggle = (
    <button
      type="button"
      className="history-actions-toggle"
      aria-expanded={inspectorOpen}
      aria-controls="history-actions-inspector"
      onClick={() => setInspectorOpen((current) => !current)}
    >
      {inspectorOpen ? (
        <PanelRightClose aria-hidden="true" size={14} />
      ) : (
        <PanelRightOpen aria-hidden="true" size={14} />
      )}{' '}
      {t('actions')}
    </button>
  );

  return (
    <div
      className={`three-pane history-view ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`}
      style={paneStyle}
    >
      <aside className="pane commit-list-pane" aria-label={t('commitHistory')}>
        <div className="pane-toolbar history-list-toolbar">
          <div className="history-branch-context" title={repo.branch.name ?? t('detachedHead')}>
            <GitBranch aria-hidden="true" focusable="false" />
            <span>{repo.branch.name ?? t('detachedHead')}</span>
          </div>
          <label className="compact-toggle">
            <input
              type="checkbox"
              checked={allRefs}
              onChange={(event) => setAllRefs(event.target.checked)}
            />
            <span>{t('allRefs')}</span>
          </label>
        </div>
        <ol className="commit-list" style={historyListStyle}>
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
                  {commit.refs.length ? (
                    <span className="ref-list">{commit.refs.join(' · ')}</span>
                  ) : null}
                </span>
                <time dateTime={commit.authoredAt}>
                  {formatDate(commit.authoredAt, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              </button>
            </li>
          ))}
        </ol>
        {!historyPage.complete ? (
          <div className="history-load-more">
            {currentHeadNeedsMore && automaticPagesLoaded >= AUTO_HISTORY_PAGE_LIMIT ? (
              <p id="history-head-not-loaded">{t('headNotLoaded')}</p>
            ) : null}
            <button
              type="button"
              disabled={loadingMore}
              aria-describedby={
                currentHeadNeedsMore && automaticPagesLoaded >= AUTO_HISTORY_PAGE_LIMIT
                  ? 'history-head-not-loaded'
                  : undefined
              }
              onClick={() => settleAction(loadMoreHistory())}
            >
              {loadingMore ? t('loading') : t('loadMore')}
            </button>
          </div>
        ) : null}
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
                </div>
                {actionsToggle}
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
                {actionsToggle}
              </div>
            </header>
            <p className="empty-state-small">
              {t(selectedOid ? 'loadingCommitDetails' : 'selectCommit')}
            </p>
          </>
        )}
      </main>
      {inspectorOpen ? (
        <>
          <PaneResizer
            label={t('historyActionsWidth')}
            value={paneWidths.right}
            direction="growLeft"
            onChange={(right) => onPaneWidthsChange({ ...paneWidths, right })}
          />

          <aside
            id="history-actions-inspector"
            className="pane history-actions"
            aria-labelledby="history-actions-title"
          >
            <div className="pane-toolbar">
              <h2 id="history-actions-title">{t('actions')}</h2>
            </div>
            {operationActionDisabledReason ? (
              <p id="history-operation-action-reason" className="remote-action-hint">
                {operationActionDisabledReason}
              </p>
            ) : null}
            <form onSubmit={(event) => settleAction(submitBranch(event))}>
              <label>
                <span>{t('createBranchFromSelected')}</span>
                <input
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
          </aside>
        </>
      ) : null}
    </div>
  );
}
