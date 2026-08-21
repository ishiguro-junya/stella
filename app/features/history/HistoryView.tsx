import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  Search,
  Tag,
} from 'lucide-react';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import {
  diffFileSections,
  imagePreviewToggleAvailable,
  profileDiffPatch,
} from '../../domain/diffProfile';
import { Button } from '../../ui/Button';
import { FileStatusIcon } from '../../ui/FileStatusIcon';
import { Input } from '../../ui/Input';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import {
  assignHistoryLanes,
  HISTORY_PAGE_SIZE,
  type HistoryGraphNode,
} from '../../domain/historyLanes';
import type {
  CommitDetails,
  CommitDiffFile,
  DiffDocument,
  CommitSummary,
  DiffStyle,
  ImageDiffCandidate,
  RepoSnapshot,
  WorkspaceAction,
} from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { DiffFileHeader, DiffSurface } from '../diff/DiffSurface';
import { ImageDiffPreview, ImagePreviewToggle } from '../diff/ImageDiffPreview';
import {
  DEFAULT_EDITOR_WRAP_COLUMN,
  LEFT_PANE_MAX_WIDTH,
  LEFT_PANE_MIN_WIDTH,
} from '../../persistence/preferences';
import { PaneResizer } from '../../ui/PaneResizer';
import { Tooltip } from '../../ui/Tooltip';
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
import {
  RowActionMenu,
  type RowActionMenuItem,
  type RowActionMenuPoint,
} from '../../ui/RowActionMenu';
import type { LocalizedMessage } from '../../i18n/i18n';

export interface HistoryViewProps {
  repo: RepoSnapshot;
  adapter: WorkspaceAdapter;
  busy?: boolean;
  onError?: ShowWorkspaceError | undefined;
  onShowDiff: () => void;
  onAction: (action: WorkspaceAction) => Promise<void>;
  diffStyle?: DiffStyle | undefined;
  imagePreviewLayout?: DiffStyle | undefined;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  stickyFileHeaders?: boolean | undefined;
  paneWidths: { left: number; right?: number };
  onPaneWidthsChange: (widths: { left: number; right?: number }) => void;
}

const GRAPH_CORNER_HEIGHT = 8;
const GRAPH_LANE_GAP = 12;
const GRAPH_HORIZONTAL_PADDING = 6;
const GRAPH_NODE_CENTER_Y = 17;
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

const HistoryRefs = memo(function HistoryRefs({ refs }: { refs: readonly string[] }) {
  const { t } = useI18n();
  const labels = refs
    .map(historyRefLabel)
    .toSorted((left, right) => HISTORY_REF_ORDER[left.kind] - HISTORY_REF_ORDER[right.kind]);
  if (!labels.length) return null;

  return (
    <span className="ref-list">
      {labels.map((ref) => {
        const hasTooltip = ref.kind === 'head' || ref.kind === 'other';
        const chip = (
          <span
            key={ref.raw}
            className={`ref-chip ${ref.kind}`}
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
        );
        return hasTooltip ? (
          <Tooltip key={ref.raw} content={ref.raw}>
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
    </span>
  );
});

const HistoryGraph = memo(function HistoryGraph({
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
      <svg className="history-graph-canvas" width={width} height="100%" focusable="false">
        <g className="history-graph-through">
          {throughLanes.map((lane) => (
            <line
              key={`active:${lane}`}
              className="history-graph-edge active"
              data-edge-kind="active"
              data-from-lane={lane}
              data-to-lane={lane}
              style={historyLaneStyle(lane)}
              x1={laneX(lane)}
              x2={laneX(lane)}
              y1="0"
              y2="100%"
            />
          ))}
        </g>
        <g className="history-graph-incoming-vertical">
          {connectsFromWorkingTree ? (
            <line
              className="history-graph-edge working-tree"
              data-edge-kind="working-tree-incoming-vertical"
              data-from-lane={commit.lane}
              data-to-lane={commit.lane}
              style={WORKING_TREE_LANE_STYLE}
              x1={laneX(commit.lane)}
              x2={laneX(commit.lane)}
              y1="0"
              y2={GRAPH_NODE_CENTER_Y - GRAPH_CORNER_HEIGHT}
            />
          ) : null}
          {commit.incomingEdges.map((edge) => (
            <line
              key={`incoming-vertical:${edge.fromLane}:${edge.toLane}`}
              className="history-graph-edge incoming-vertical"
              data-edge-kind="incoming-vertical"
              data-from-lane={edge.fromLane}
              data-to-lane={edge.toLane}
              style={historyLaneStyle(edge.fromLane)}
              x1={laneX(edge.fromLane)}
              x2={laneX(edge.fromLane)}
              y1="0"
              y2={GRAPH_NODE_CENTER_Y - GRAPH_CORNER_HEIGHT}
            />
          ))}
        </g>
        <g
          className="history-graph-incoming-corner"
          transform={`translate(0 ${GRAPH_NODE_CENTER_Y - GRAPH_CORNER_HEIGHT})`}
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
        </g>
        <g
          className="history-graph-outgoing-corner"
          transform={`translate(0 ${GRAPH_NODE_CENTER_Y})`}
        >
          {commit.parentEdges.map((edge) => (
            <path
              key={`parent:${edge.parentOid}:${edge.toLane}`}
              className="history-graph-edge parent"
              data-edge-kind="parent"
              data-from-lane={edge.fromLane}
              data-to-lane={edge.toLane}
              style={historyLaneStyle(edge.toLane)}
              d={graphCornerPath(edge.fromLane, edge.toLane)}
            />
          ))}
        </g>
        <g
          className="history-graph-outgoing-vertical"
          transform={`translate(0 ${GRAPH_NODE_CENTER_Y + GRAPH_CORNER_HEIGHT})`}
        >
          {commit.parentEdges.map((edge) => (
            <line
              key={`parent-vertical:${edge.parentOid}:${edge.toLane}`}
              className="history-graph-edge parent-vertical"
              data-edge-kind="parent-vertical"
              data-from-lane={edge.fromLane}
              data-to-lane={edge.toLane}
              style={historyLaneStyle(edge.toLane)}
              x1={laneX(edge.toLane)}
              x2={laneX(edge.toLane)}
              y1="0"
              y2="100%"
            />
          ))}
        </g>
      </svg>
      <span className="history-graph-node" data-node-lane={commit.lane} />
    </span>
  );
});

const WorkingTreeGraph = memo(function WorkingTreeGraph({
  laneCount,
  connected,
}: {
  laneCount: number;
  connected: boolean;
}) {
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
      <svg className="history-graph-canvas" width={width} height="100%" focusable="false">
        <g
          className="history-graph-outgoing-corner"
          transform={`translate(0 ${GRAPH_NODE_CENTER_Y})`}
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
        </g>
        <g
          className="history-graph-outgoing-vertical"
          transform={`translate(0 ${GRAPH_NODE_CENTER_Y + GRAPH_CORNER_HEIGHT})`}
        >
          {connected ? (
            <line
              className="history-graph-edge working-tree parent-vertical"
              data-edge-kind="working-tree-vertical"
              data-from-lane="0"
              data-to-lane="0"
              x1={laneX(0)}
              x2={laneX(0)}
              y1="0"
              y2="100%"
            />
          ) : null}
        </g>
      </svg>
      <span className="history-graph-node" data-node-lane="0" />
    </span>
  );
});

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

function imageCandidateKey(candidate: ImageDiffCandidate): string {
  return `${candidate.previousPath ?? ''}\0${candidate.path}`;
}

function DeferredHistoryFileHeader({
  path,
  status,
  collapsed,
  controlsId,
  onToggle,
  disabled = false,
}: {
  path: string;
  status: ImageDiffCandidate['changeKind'];
  collapsed: boolean;
  controlsId: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="diff-file-custom-header">
      <div className="diff-file-custom-header-title">
        <Button
          type="button"
          className="diff-file-collapse-toggle"
          aria-controls={controlsId}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', { path })}
          tooltip={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', { path })}
          onClick={onToggle}
          disabled={disabled}
        >
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
        <FileStatusIcon status={status} />
        <span>{path}</span>
      </div>
    </div>
  );
}

interface HistoryCommitDiffProps {
  adapter: WorkspaceAdapter;
  repoId: string;
  details: CommitDetails;
  files: ReturnType<typeof diffFileSections>;
  initiallyCollapsed: boolean;
  diffStyle: DiffStyle;
  imagePreviewLayout: DiffStyle;
  lineWrapping: boolean;
  wrapColumn: number;
  stickyFileHeaders: boolean;
  imagePreviewEnabled: ReadonlyMap<string, boolean>;
  imageProbeResults: ReadonlyMap<string, boolean>;
  onImagePreviewChange: (key: string, enabled: boolean) => void;
  onImageProbeResult: (key: string, previewable: boolean) => void;
  onCopySelectedLines: (text: string) => Promise<void>;
  commitImagePatchScope?: 'file';
}

const HistoryCommitDiff = memo(function HistoryCommitDiff({
  adapter,
  repoId,
  details,
  files,
  initiallyCollapsed,
  diffStyle,
  imagePreviewLayout,
  lineWrapping,
  wrapColumn,
  stickyFileHeaders,
  imagePreviewEnabled,
  imageProbeResults,
  onImagePreviewChange,
  onImageProbeResult,
  onCopySelectedLines,
  commitImagePatchScope,
}: HistoryCommitDiffProps) {
  const { t } = useI18n();
  const [expandedFileKeys, setExpandedFileKeys] = useState<{
    commitOid: string;
    keys: Set<string>;
  }>({ commitOid: '', keys: new Set() });
  const [selectionMenuContext, setSelectionMenuContext] = useState<{
    point: RowActionMenuPoint;
    text: string;
  }>();
  const diff = details.diff;
  const copySelectionMenuItem: RowActionMenuItem<'copySelection'> = {
    action: 'copySelection',
    label: t('actionCopySelectedLines'),
    icon: <Copy aria-hidden="true" focusable="false" size={15} />,
  };
  const selectionMenu = selectionMenuContext ? (
    <RowActionMenu
      triggerLabel={t('selectedLines')}
      triggerTitle={t('selectedLines')}
      menuLabel={t('selectedLines')}
      items={[copySelectionMenuItem]}
      open
      disabled={false}
      contextPoint={selectionMenuContext.point}
      contextOnly
      onOpenChange={(open) => {
        if (!open) setSelectionMenuContext(undefined);
      }}
      onTriggerOpen={() => undefined}
      onAction={async () => {
        await onCopySelectedLines(selectionMenuContext.text);
        setSelectionMenuContext(undefined);
      }}
    />
  ) : null;
  const selectionProps = {
    selectable: true,
    onSelectionContextMenu: (_selection: unknown, point: RowActionMenuPoint, text: string) =>
      setSelectionMenuContext({ point, text }),
    onSelectionCopy: (text: string) => void onCopySelectedLines(text),
  };
  if (details.files && !diff) {
    return (
      <HistoryCommitFileFallback
        adapter={adapter}
        repoId={repoId}
        details={details}
        files={details.files}
        diffStyle={diffStyle}
        imagePreviewLayout={imagePreviewLayout}
        lineWrapping={lineWrapping}
        wrapColumn={wrapColumn}
        stickyFileHeaders={stickyFileHeaders}
        imagePreviewEnabled={imagePreviewEnabled}
        imageProbeResults={imageProbeResults}
        onImagePreviewChange={onImagePreviewChange}
        onImageProbeResult={onImageProbeResult}
        onCopySelectedLines={onCopySelectedLines}
      />
    );
  }
  if (!diff) return null;
  if (diff.truncated) return null;

  if (!files.length) {
    if (diff.binary) return <p className="empty-state-small">{t('binaryDiffUnavailable')}</p>;
    return (
      <>
        <DiffSurface
          source={{
            kind: 'patch',
            patch: diff.patch,
            path: diff.path,
            cacheKey: diff.diffId,
          }}
          diffStyle={diffStyle}
          lineWrapping={lineWrapping}
          wrapColumn={wrapColumn}
          performanceMode={Boolean(diff.tooLarge)}
          showFileHeaders
          stickyFileHeaders={stickyFileHeaders}
          hunkSeparators="simple"
          ariaLabel={t('commitDiffAria', { oid: details.shortOid })}
          {...selectionProps}
        />
        {selectionMenu}
      </>
    );
  }

  return (
    <div className="history-diff-files">
      {files.map((file, index) => {
        const fileKey = `${index}:${file.path}`;
        const collapsed =
          initiallyCollapsed &&
          !(expandedFileKeys.commitOid === details.oid && expandedFileKeys.keys.has(fileKey));
        const candidate = file.imageCandidate;
        const contentId = `history-diff-content-${details.oid}-${diff.diffId}-${index}`;
        const toggleCollapsed = () =>
          setExpandedFileKeys((current) => {
            const keys = new Set(current.commitOid === details.oid ? current.keys : []);
            if (keys.has(fileKey)) keys.delete(fileKey);
            else keys.add(fileKey);
            return { commitOid: details.oid, keys };
          });
        const deferredSection = (body: ReactNode) => (
          <section key={fileKey} className="history-image-preview-item">
            <header
              className={`diff-file-standalone-header history-image-file-header${
                stickyFileHeaders ? ' is-sticky' : ''
              }`}
            >
              <DeferredHistoryFileHeader
                path={file.path}
                status={candidate?.changeKind ?? 'modified'}
                collapsed={collapsed}
                controlsId={contentId}
                onToggle={toggleCollapsed}
              />
            </header>
            <div id={contentId} hidden={collapsed}>
              {body}
            </div>
          </section>
        );
        if (collapsed) return deferredSection(null);
        const surface = (showFileHeaders: boolean) => (
          <DiffSurface
            source={{
              kind: 'patch',
              patch: file.patch,
              path: file.path,
              cacheKey: `${diff.diffId}:file:${index}`,
            }}
            diffStyle={diffStyle}
            lineWrapping={lineWrapping}
            wrapColumn={wrapColumn}
            performanceMode={Boolean(diff.tooLarge) || profileDiffPatch(file.patch).performanceMode}
            showFileHeaders={showFileHeaders}
            stickyFileHeaders={stickyFileHeaders}
            hunkSeparators="simple"
            ariaLabel={t('fileDiffAria', { path: file.path })}
            {...selectionProps}
          />
        );
        if (!candidate)
          return initiallyCollapsed ? (
            deferredSection(surface(true))
          ) : (
            <Fragment key={file.path}>{surface(true)}</Fragment>
          );

        const candidateKey = imageCandidateKey(candidate);
        const probeResult = imageProbeResults.get(candidateKey);
        const probePending = candidate.format === 'probe' && probeResult === undefined;
        const probeFailed = probeResult === false;
        const previewToggleAvailable = imagePreviewToggleAvailable(candidate.path);
        const previewEnabled = !probeFailed && (imagePreviewEnabled.get(candidateKey) ?? true);
        const showBinaryFallback = candidate.format === 'binary' && probeFailed;
        const expanded = previewEnabled || showBinaryFallback;
        const preview = (
          <ImageDiffPreview
            adapter={adapter}
            repoId={repoId}
            target={{
              kind: 'commit',
              oid: details.oid,
              path: candidate.path,
              ...(candidate.previousPath ? { previousPath: candidate.previousPath } : {}),
              diffId: diff.diffId,
              ...(commitImagePatchScope ? { patchScope: commitImagePatchScope } : {}),
            }}
            candidate={candidate}
            binaryFallback={t('binaryDiffUnavailable')}
            layout={imagePreviewLayout}
            hidden={!expanded}
            onProbeResult={(canPreview) => onImageProbeResult(candidateKey, canPreview)}
          />
        );

        if (probePending || (candidate.format === 'probe' && probeFailed)) {
          if (initiallyCollapsed)
            return deferredSection(
              <>
                {preview}
                {probeFailed ? surface(true) : null}
              </>,
            );
          return (
            <Fragment key={candidateKey}>
              {preview}
              {probeFailed ? surface(true) : null}
            </Fragment>
          );
        }

        if (initiallyCollapsed)
          return deferredSection(
            <>
              {preview}
              {candidate.format === 'svg' && !previewEnabled ? surface(false) : null}
            </>,
          );

        return (
          <section key={candidateKey} className="history-image-preview-item">
            <header
              className={`diff-file-standalone-header history-image-file-header${stickyFileHeaders ? ' is-sticky' : ''}`}
            >
              <DiffFileHeader
                path={candidate.path}
                status={candidate.changeKind}
                collapsed={!expanded}
                toggleDisabled={probeFailed}
                onToggle={() => onImagePreviewChange(candidateKey, !previewEnabled)}
                trailing={
                  previewToggleAvailable ? (
                    <ImagePreviewToggle
                      pressed={previewEnabled}
                      disabled={probeFailed}
                      onPressedChange={(pressed) => onImagePreviewChange(candidateKey, pressed)}
                    />
                  ) : undefined
                }
              />
            </header>
            {preview}
            {candidate.format === 'svg' && !previewEnabled ? surface(false) : null}
          </section>
        );
      })}
      {selectionMenu}
    </div>
  );
});

interface HistoryCommitFileFallbackProps extends Omit<
  HistoryCommitDiffProps,
  'files' | 'initiallyCollapsed'
> {
  files: CommitDiffFile[];
}

function HistoryCommitFileFallback({
  adapter,
  repoId,
  details,
  files,
  ...props
}: HistoryCommitFileFallbackProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, DiffDocument>>(new Map());
  const [errors, setErrors] = useState<Map<string, Error>>(new Map());
  const toggle = (file: CommitDiffFile) => {
    const key = `${file.previousPath ?? ''}\u0000${file.path}`;
    if (loading.has(key)) return;
    if (expanded.has(key)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return;
    }
    if (results.has(key)) {
      setExpanded((current) => new Set(current).add(key));
      return;
    }
    setLoading((current) => new Set(current).add(key));
    setExpanded((current) => new Set(current).add(key));
    setErrors((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    void adapter
      .query({
        kind: 'commitFileDiff',
        repoId,
        oid: details.oid,
        path: file.path,
        ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      })
      .then((result) => {
        if (result.kind !== 'commitFileDiff') throw new Error('Invalid commit file diff response.');
        setResults((current) => new Map(current).set(key, result.diff));
      })
      .catch((error: unknown) => {
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        setErrors((current) =>
          new Map(current).set(key, error instanceof Error ? error : new Error(String(error))),
        );
      })
      .finally(() => {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  };

  return (
    <div className="history-diff-files">
      {files.map((file, index) => {
        const key = `${file.previousPath ?? ''}\u0000${file.path}`;
        const isLoading = loading.has(key);
        const isExpanded = expanded.has(key);
        const diff = results.get(key);
        const error = errors.get(key);
        const contentId = `history-diff-content-${details.oid}-${index}`;
        return (
          <section key={key} className="history-image-preview-item">
            <header
              className={`diff-file-standalone-header history-image-file-header${
                props.stickyFileHeaders ? ' is-sticky' : ''
              }`}
            >
              <DeferredHistoryFileHeader
                path={file.path}
                status={file.status}
                collapsed={!isExpanded}
                controlsId={contentId}
                onToggle={() => toggle(file)}
                disabled={isLoading}
              />
            </header>
            <div id={contentId} hidden={!isExpanded} aria-busy={isLoading}>
              {isLoading ? <LoadingIndicator /> : null}
              {diff?.truncated ? (
                <output className="inline-alert warning">{t('diffTruncatedUnavailable')}</output>
              ) : null}
              {diff && !diff.truncated ? (
                <HistoryCommitDiff
                  adapter={adapter}
                  repoId={repoId}
                  details={{ ...details, diff }}
                  files={diffFileSections(diff.patch, diff.diffId)}
                  initiallyCollapsed={false}
                  {...props}
                  commitImagePatchScope="file"
                />
              ) : null}
            </div>
            {error ? (
              <div className="inline-alert error" role="alert">
                <WorkspaceErrorDetails
                  error={describeWorkspaceError(error, t('loadCommitFileDiffFailed'))}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
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

function focusHistoryRow(
  target: HTMLButtonElement | undefined,
  scrollFrameRef: RefObject<number | undefined>,
): void {
  if (!target) return;
  target.focus({ preventScroll: true });
  if (scrollFrameRef.current !== undefined) window.cancelAnimationFrame(scrollFrameRef.current);
  scrollFrameRef.current = window.requestAnimationFrame(() => {
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    scrollFrameRef.current = undefined;
  });
}

interface HistoryCommitItemProps {
  commit: HistoryGraphNode<CommitSummary>;
  index: number;
  selected: boolean;
  laneCount: number;
  connectsFromWorkingTree: boolean;
  menuOpen: boolean;
  actionsDisabled: boolean;
  contextPoint?: RowActionMenuPoint | undefined;
  rowRefs: RefObject<Map<string, HTMLButtonElement>>;
  onSelect: (oid: string) => void;
  onMove: (index: number, offset: -1 | 1) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLButtonElement>, commit: CommitSummary) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, commit: CommitSummary) => void;
  onMenuOpenChange: (commit: CommitSummary, open: boolean) => void;
  onMenuTrigger: (commit: CommitSummary) => void;
  onMenuAction: (kind: HistoryActionKind, target: HistoryActionTarget) => void;
}

const HistoryCommitItem = memo(function HistoryCommitItem({
  commit,
  index,
  selected,
  laneCount,
  connectsFromWorkingTree,
  menuOpen,
  actionsDisabled,
  contextPoint,
  rowRefs,
  onSelect,
  onMove,
  onDoubleClick,
  onContextMenu,
  onMenuOpenChange,
  onMenuTrigger,
  onMenuAction,
}: HistoryCommitItemProps) {
  const { t, formatDate } = useI18n();
  const target = actionTargetFor(commit);
  return (
    <li className={`history-commit-item${selected ? ' is-current' : ''}`}>
      <Button
        ref={(node) => {
          if (node) rowRefs.current.set(commit.oid, node);
          else rowRefs.current.delete(commit.oid);
        }}
        type="button"
        className="commit-row"
        data-history-commit-oid={commit.oid}
        aria-current={selected ? 'true' : undefined}
        onClick={(event) => {
          event.currentTarget.focus();
          onSelect(commit.oid);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            onMove(index, event.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        onDoubleClick={(event) => onDoubleClick(event, commit)}
        onContextMenu={(event) => onContextMenu(event, commit)}
      >
        <HistoryGraph
          commit={commit}
          laneCount={laneCount}
          connectsFromWorkingTree={connectsFromWorkingTree}
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
      </Button>
      <HistoryActionMenu
        target={target}
        open={menuOpen}
        disabled={actionsDisabled}
        contextPoint={contextPoint}
        onOpenChange={(open) => onMenuOpenChange(commit, open)}
        onTriggerOpen={() => onMenuTrigger(commit)}
        onAction={(kind) => onMenuAction(kind, target)}
      />
    </li>
  );
});

export function HistoryView({
  repo,
  adapter,
  busy = false,
  onError,
  onShowDiff,
  onAction,
  diffStyle = 'unified',
  imagePreviewLayout = 'split',
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
  const [imagePreviewEnabled, setImagePreviewEnabled] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [imageProbeResults, setImageProbeResults] = useState<Map<string, boolean>>(() => new Map());
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [copyNotice, setCopyNotice] = useState<LocalizedMessage>();
  const [openMenu, setOpenMenu] = useState<{ oid: string; source: HistoryMenuSource }>();
  const [contextMenu, setContextMenu] = useState<
    { oid: string; point: RowActionMenuPoint } | undefined
  >();
  const [actionDialog, setActionDialog] = useState<HistoryActionDialogRequest>();
  const [historyPage, setHistoryPage] = useState<HistoryPageState>(() =>
    initialHistoryPage(repo.history),
  );
  const [paintedGraphRevision, setPaintedGraphRevision] = useState<string>();
  const [historySearch, setHistorySearch] = useState('');
  const [activeHistorySearch, setActiveHistorySearch] = useState('');
  const [searchingHistory, setSearchingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const historyListRef = useRef<HTMLOListElement>(null);
  const historyEndRef = useRef<HTMLLIElement>(null);
  const historyRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const historyScrollFrameRef = useRef<number | undefined>(undefined);
  const selectedOidRef = useRef(selectedOid);
  const actionFocusOidRef = useRef<string | undefined>(undefined);
  const focusedRepoRef = useRef<string | undefined>(undefined);
  const loadingMoreRef = useRef(false);
  const historyRequestIdRef = useRef(0);
  const visibleHistory = useMemo(
    () => assignHistoryLanes(historyPage.commits),
    [historyPage.commits],
  );
  const graphRevision = useMemo(
    () =>
      historyPage.commits
        .map((commit) => `${commit.oid}:${commit.parents.join(',')}:${commit.refs.join(',')}`)
        .join('\n'),
    [historyPage.commits],
  );
  const diffFiles = useMemo(
    () =>
      details?.diff && !details.diff.truncated
        ? diffFileSections(details.diff.patch, details.diff.diffId)
        : [],
    [details],
  );
  const diffSoftLimitExceeded = useMemo(
    () =>
      Boolean(
        details?.diff &&
        !details.diff.truncated &&
        profileDiffPatch(details.diff.patch).softLimitExceeded,
      ),
    [details],
  );
  const moveCommitSelection = useCallback(
    (index: number, offset: -1 | 1): void => {
      historyListRef.current?.classList.add('is-keyboard-navigating');
      const nextIndex = Math.min(Math.max(index + offset, 0), visibleHistory.length - 1);
      const next = visibleHistory[nextIndex];
      if (!next || nextIndex === index) return;
      selectedOidRef.current = next.oid;
      setSelectedOid(next.oid);
      setOpenMenu(undefined);
      setContextMenu(undefined);
      focusHistoryRow(historyRowRefs.current.get(next.oid), historyScrollFrameRef);
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
    if (!copyNotice) return undefined;
    const timeout = window.setTimeout(() => setCopyNotice(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [copyNotice]);

  const copySelectedLines = useCallback(
    async (text: string): Promise<void> => {
      setCopyNotice(undefined);
      try {
        await navigator.clipboard.writeText(text);
        setCopyNotice({ id: 'copiedSelectedLines' });
      } catch (cause) {
        reportRuntimeError(t('copySelectedLinesFailedTitle'), cause, t('copySelectedLinesFailed'));
      }
    },
    [reportRuntimeError, t],
  );

  useEffect(
    () => () => {
      if (historyScrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(historyScrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPaintedGraphRevision(graphRevision));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [graphRevision]);

  const setImageProbeResult = useCallback((key: string, previewable: boolean): void => {
    setImageProbeResults((current) => {
      if (current.get(key) === previewable) return current;
      const next = new Map(current);
      next.set(key, previewable);
      return next;
    });
  }, []);

  const setImagePreview = useCallback((key: string, enabled: boolean): void => {
    setImagePreviewEnabled((current) => {
      if ((current.get(key) ?? true) === enabled) return current;
      const next = new Map(current);
      next.set(key, enabled);
      return next;
    });
  }, []);

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
          setImagePreviewEnabled(new Map());
          setImageProbeResults(new Map());
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
      if (current && visibleHistory.some((commit) => commit.oid === current)) {
        selectedOidRef.current = current;
        return current;
      }
      if (
        repo.selectedCommitOid &&
        visibleHistory.some((commit) => commit.oid === repo.selectedCommitOid)
      ) {
        selectedOidRef.current = repo.selectedCommitOid;
        return repo.selectedCommitOid;
      }
      const next = visibleHistory[0]?.oid;
      selectedOidRef.current = next;
      return next;
    });
  }, [repo.selectedCommitOid, visibleHistory]);

  useEffect(() => {
    if (focusedRepoRef.current === repo.repoId || !selectedOid) return;
    const target = historyRowRefs.current.get(selectedOid);
    if (!target) return;
    focusHistoryRow(target, historyScrollFrameRef);
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
      const index = visibleHistory.findIndex((commit) => commit.oid === selectedOidRef.current);
      if (index < 0) return;
      event.preventDefault();
      moveCommitSelection(index, event.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', handleHistoryArrow);
    return () => window.removeEventListener('keydown', handleHistoryArrow);
  }, [moveCommitSelection, visibleHistory]);

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
    const target = historyRowRefs.current.get(oid);
    const fallback = selectedOidRef.current
      ? historyRowRefs.current.get(selectedOidRef.current)
      : historyRowRefs.current.values().next().value;
    focusHistoryRow(target ?? fallback, historyScrollFrameRef);
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
      { root, rootMargin: '0px 0px 2400px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [historyPage.complete, loadMoreHistory]);

  const graphLaneCount = useMemo(
    () => Math.max(1, ...visibleHistory.map((commit) => commit.laneCount)),
    [visibleHistory],
  );
  const workingTreeConnectsToHistory =
    changedFileCount > 0 && !activeHistorySearch && visibleHistory.length > 0;
  const historyListStyle = useMemo<CSSProperties & { '--history-graph-width': string }>(
    () => ({ '--history-graph-width': `${graphWidth(graphLaneCount)}px` }),
    [graphLaneCount],
  );
  const graphPending = paintedGraphRevision !== graphRevision;
  const historyEmpty = repo.history.length === 0;

  const paneStyle: CSSProperties & { '--left-pane': string } = {
    '--left-pane': `${paneWidths.left}px`,
  };
  const commitBody = details?.body?.trim();

  const selectCommit = useCallback((oid: string): void => {
    selectedOidRef.current = oid;
    setSelectedOid(oid);
  }, []);

  const selectCommitForActions = useCallback((commit: CommitSummary): void => {
    selectedOidRef.current = commit.oid;
    setSelectedOid(commit.oid);
    setContextMenu(undefined);
  }, []);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, commit: CommitSummary): void => {
      event.preventDefault();
      if (repositoryActionsDisabled) return;
      event.currentTarget.focus();
      selectedOidRef.current = commit.oid;
      setSelectedOid(commit.oid);
      setContextMenu({ oid: commit.oid, point: { x: event.clientX, y: event.clientY } });
      setOpenMenu({ oid: commit.oid, source: 'list' });
    },
    [repositoryActionsDisabled],
  );

  const openActionDialog = useCallback(
    (kind: HistoryActionKind, target: HistoryActionTarget): void => {
      setOpenMenu(undefined);
      setContextMenu(undefined);
      actionFocusOidRef.current = target.oid;
      setActionDialog({ kind, target });
    },
    [],
  );

  const setListMenuOpen = useCallback((commit: CommitSummary, open: boolean): void => {
    setOpenMenu(open ? { oid: commit.oid, source: 'list' } : undefined);
    if (!open) setContextMenu(undefined);
  }, []);

  const checkoutCommitBranch = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, commit: CommitSummary): void => {
      if (repositoryActionsDisabled) return;
      const branch = doubleClickBranch(event.target, commit.refs, repo.branch.name);
      if (branch) settleAction(onAction({ kind: 'checkoutBranch', name: branch }));
    },
    [onAction, repo.branch.name, repositoryActionsDisabled],
  );

  const historySearchControl = (
    <label className="history-search">
      <Search className="history-search-icon" aria-hidden="true" focusable="false" />
      <Input
        ref={historySearchRef}
        type="search"
        value={historySearch}
        aria-label={t('searchHistory')}
        aria-keyshortcuts="Meta+F"
        placeholder={t('searchHistory')}
        onChange={(event) => setHistorySearch(event.currentTarget.value)}
      />
      {searchingHistory ? <LoadingIndicator className="history-search-loading" /> : null}
    </label>
  );

  return (
    <div className="three-pane history-view" style={paneStyle}>
      <aside className="pane commit-list-pane" aria-label={t('commitHistory')}>
        <ol
          ref={historyListRef}
          className="commit-list"
          style={historyListStyle}
          aria-busy={loadingMore || graphPending}
          onPointerMove={(event) => event.currentTarget.classList.remove('is-keyboard-navigating')}
        >
          {changedFileCount > 0 ? (
            <li className="history-working-tree-item">
              <Button
                type="button"
                className="commit-row history-working-tree-entry"
                aria-label={`${t('uncommittedChanges')}, ${t('uncommittedFileCount', {
                  count: changedFileCount,
                })}`}
                onClick={onShowDiff}
              >
                <WorkingTreeGraph
                  laneCount={graphLaneCount}
                  connected={workingTreeConnectsToHistory}
                />
                <span className="commit-copy">
                  <strong>{t('uncommittedChanges')}</strong>
                  <small>{t('uncommittedFileCount', { count: changedFileCount })}</small>
                </span>
              </Button>
            </li>
          ) : null}
          {visibleHistory.map((commit, index) => (
            <HistoryCommitItem
              key={commit.oid}
              commit={commit}
              index={index}
              selected={selectedOid === commit.oid}
              laneCount={graphLaneCount}
              connectsFromWorkingTree={workingTreeConnectsToHistory && index === 0}
              menuOpen={openMenu?.source === 'list' && openMenu.oid === commit.oid}
              actionsDisabled={repositoryActionsDisabled}
              contextPoint={contextMenu?.oid === commit.oid ? contextMenu.point : undefined}
              rowRefs={historyRowRefs}
              onSelect={selectCommit}
              onMove={moveCommitSelection}
              onDoubleClick={checkoutCommitBranch}
              onContextMenu={openContextMenu}
              onMenuOpenChange={setListMenuOpen}
              onMenuTrigger={selectCommitForActions}
              onMenuAction={openActionDialog}
            />
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
              {loadingMore ? <LoadingIndicator /> : null}
            </li>
          ) : null}
        </ol>
        <footer className="history-list-footer">{historySearchControl}</footer>
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
        {historyEmpty ? (
          <p id="commit-detail-title" className="diff-empty-state">
            {t('noHistory')}
          </p>
        ) : details ? (
          <>
            <header className="commit-detail-header">
              <div className="commit-detail-heading">
                <div>
                  <h2 id="commit-detail-title">{details.subject}</h2>
                  <HistoryRefs refs={details.refs} />
                </div>
                <div className="commit-detail-actions">
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
              </div>
              {commitBody && commitBody !== details.subject.trim() ? (
                <p className="commit-detail-body">{commitBody}</p>
              ) : null}
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
            {copyNotice ? (
              <output className="file-action-notice info" aria-live="polite">
                {message(copyNotice)}
              </output>
            ) : null}
            {details.diff?.truncated ? (
              <output className="inline-alert warning">{t('diffTruncatedUnavailable')}</output>
            ) : details.files && !details.diff ? (
              <output className="inline-alert warning">{t('commitDiffFilesFallback')}</output>
            ) : diffSoftLimitExceeded ? (
              <output className="inline-alert warning">{t('diffDisplayLimit')}</output>
            ) : null}
            <HistoryCommitDiff
              key={details.oid}
              adapter={adapter}
              repoId={repo.repoId}
              details={details}
              files={diffFiles}
              initiallyCollapsed={diffSoftLimitExceeded}
              diffStyle={diffStyle}
              imagePreviewLayout={imagePreviewLayout}
              lineWrapping={lineWrapping}
              wrapColumn={wrapColumn}
              stickyFileHeaders={stickyFileHeaders}
              imagePreviewEnabled={imagePreviewEnabled}
              imageProbeResults={imageProbeResults}
              onImagePreviewChange={setImagePreview}
              onImageProbeResult={setImageProbeResult}
              onCopySelectedLines={copySelectedLines}
            />
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
