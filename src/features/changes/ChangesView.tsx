import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronRight,
  Columns2,
  Download,
  GitCommitHorizontal,
  RefreshCw,
  Rows3,
  Trash2,
  Upload,
} from 'lucide-react';

import { isPullDivergenceError, type WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { patchContainsMultipleFiles } from '../../domain/diffProfile';
import type {
  ChangeEntry,
  ConflictDocument,
  DiffDocument,
  DiffSelection,
  DiffStyle,
  RepoSnapshot,
  WorkspaceAction,
} from '../../domain/workspace';
import { useI18n, type I18nValue, type LocalizedMessage } from '../../i18n/i18n';
import { CommitForm } from '../commit/CommitForm';
import {
  ConflictSurface,
  type ConflictLeaveHandle,
  type ConflictSurfaceActions,
} from '../conflict/ConflictSurface';
import { DiffSurface, type SurfaceSelection } from '../diff/DiffSurface';
import type { PaneWidths } from '../../persistence/preferences';
import { PaneResizer } from '../../ui/PaneResizer';
import { Dialog } from '../../ui/Dialog';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { ChangeList, type StageTransitionRequest } from './ChangeList';
import type { FileActionKind } from './FileActionMenu';

export interface ChangesViewProps {
  repo: RepoSnapshot;
  adapter: WorkspaceAdapter;
  externalConflict?: ConflictDocument | undefined;
  busy?: boolean | undefined;
  onError?: ShowWorkspaceError | undefined;
  onAction: (action: WorkspaceAction) => Promise<void>;
  onConflictDirtyChange?: ((dirty: boolean) => void) | undefined;
  onConflictLeaveHandleChange?: ((handle: ConflictLeaveHandle | null) => void) | undefined;
  commitOpen?: boolean | undefined;
  onCommitOpenChange?: ((open: boolean) => void) | undefined;
  paneWidths: PaneWidths;
  onPaneWidthsChange: (widths: PaneWidths) => void;
}

function settleAction(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function commitDisabledReason(
  repo: RepoSnapshot,
  t: I18nValue['t'],
  message: I18nValue['message'],
): string | undefined {
  if (repo.operation.kind === 'merge' && repo.changes.some((entry) => entry.area === 'conflicted'))
    return t('resolveConflictsBeforeCommit');
  if (!repo.changes.some((entry) => entry.area === 'staged')) return t('stageChangesToCommit');
  switch (repo.operation.kind) {
    case 'none':
    case 'merge':
    case 'pendingStructuredCommit':
      return undefined;
    case 'rebase':
    case 'cherryPick':
    case 'revert':
    case 'unknown':
      return t('regularCommitUnavailable', { operation: message(repo.operation.label) });
    case 'structuredAbortRecovery':
      return t('regularCommitAbortOnly', { operation: message(repo.operation.label) });
  }
  throw new Error('Unknown operation state');
}

export function ChangesView({
  repo,
  adapter,
  externalConflict,
  busy = false,
  onError,
  onAction,
  onConflictDirtyChange,
  onConflictLeaveHandleChange,
  commitOpen: controlledCommitOpen,
  onCommitOpenChange,
  paneWidths,
  onPaneWidthsChange,
}: ChangesViewProps) {
  const { t, message } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    const initial =
      repo.changes.find((entry) => entry.path === repo.selectedPath) ?? repo.changes[0];
    return initial ? `${initial.area}:${initial.path}` : '';
  });
  const [diff, setDiff] = useState<DiffDocument>();
  const [conflict, setConflict] = useState<ConflictDocument>();
  const [selection, setSelection] = useState<DiffSelection>();
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [pullDiverged, setPullDiverged] = useState(false);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [conflictDirty, setConflictDirty] = useState(false);
  const [localCommitOpen, setLocalCommitOpen] = useState(false);
  const [pendingSelectedKey, setPendingSelectedKey] = useState<string>();
  const [fileActionNotice, setFileActionNotice] = useState<
    { level: 'info' | 'error'; message: LocalizedMessage } | undefined
  >();
  const conflictQueryIdRef = useRef(0);
  const conflictLeaveHandleRef = useRef<ConflictLeaveHandle | null>(null);
  const syncedExternalConflictRef = useRef<ConflictDocument | undefined>(undefined);
  const pendingStageSelectionRef = useRef<
    | {
        path: string;
        target: 'staged' | 'worktree';
        fromGeneration: number;
      }
    | undefined
  >(undefined);

  const selectedFromSnapshot = repo.changes.find(
    (entry) => `${entry.area}:${entry.path}` === selectedKey,
  );
  const conflictMissingFromSnapshot = Boolean(
    conflictDirty &&
    conflict &&
    !repo.changes.some((entry) => entry.area === 'conflicted' && entry.path === conflict.path),
  );
  const pinnedConflictEntry: ChangeEntry | undefined =
    conflictMissingFromSnapshot && conflict
      ? { path: conflict.path, area: 'conflicted', status: 'conflicted' }
      : undefined;
  const selected = pinnedConflictEntry ?? selectedFromSnapshot ?? repo.changes[0];
  const selectedArea = selected?.area;
  const selectedPath = selected?.path;
  const visibleDiff =
    diff && diff.path === selectedPath && diff.area === selectedArea ? diff : undefined;
  const effectiveConflict =
    conflict && selectedArea === 'conflicted' && conflict.path === selectedPath
      ? conflict
      : undefined;
  const pullTarget = repo.branch.upstream;
  const disabledCommitReason = commitDisabledReason(repo, t, message);
  const operationActionDisabledReason =
    repo.operation.kind === 'none'
      ? undefined
      : t('operationActionsUnavailable', { operation: message(repo.operation.label) });
  const repositoryActionsDisabled = busy || Boolean(operationActionDisabledReason);
  const stageActionDisabledReason =
    operationActionDisabledReason ??
    (conflictDirty ? t('stageUnavailableUnsavedConflict') : undefined);
  const stageActionsDisabled = busy || Boolean(stageActionDisabledReason);
  const stageActionDisabledReasonId = operationActionDisabledReason
    ? 'changes-operation-action-reason'
    : conflictDirty
      ? 'changes-conflict-stage-action-reason'
      : undefined;
  const diffContainsMultipleFiles = visibleDiff
    ? patchContainsMultipleFiles(visibleDiff.patch)
    : false;
  const lineSelectionEnabled = Boolean(
    visibleDiff &&
    !visibleDiff.binary &&
    !visibleDiff.truncated &&
    !diffContainsMultipleFiles &&
    !repositoryActionsDisabled,
  );
  const commitOpen = controlledCommitOpen ?? localCommitOpen;

  const setCommitOpen = (open: boolean): void => {
    if (controlledCommitOpen === undefined) setLocalCommitOpen(open);
    onCommitOpenChange?.(open);
  };

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
    if (fileActionNotice?.level !== 'info') return undefined;
    const timeout = window.setTimeout(() => {
      setFileActionNotice((current) => (current === fileActionNotice ? undefined : current));
    }, 4_000);
    return () => window.clearTimeout(timeout);
  }, [fileActionNotice]);

  useEffect(() => {
    if (
      !externalConflict ||
      externalConflict === syncedExternalConflictRef.current ||
      externalConflict.repoId !== repo.repoId ||
      selectedArea !== 'conflicted' ||
      externalConflict.path !== selectedPath
    )
      return;
    syncedExternalConflictRef.current = externalConflict;
    setConflict(externalConflict);
  }, [externalConflict, repo.repoId, selectedArea, selectedPath]);

  useEffect(() => {
    const conflictQueryId = ++conflictQueryIdRef.current;
    if (!selectedArea || !selectedPath) {
      setDiff(undefined);
      setConflict(undefined);
      return undefined;
    }
    let cancelled = false;
    setError(undefined);
    setSelection(undefined);

    const query =
      selectedArea === 'conflicted'
        ? adapter.query({ kind: 'conflict', repoId: repo.repoId, path: selectedPath })
        : adapter.query({
            kind: 'diff',
            repoId: repo.repoId,
            path: selectedPath,
            area: selectedArea,
          });

    void query
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'conflict') {
          if (conflictQueryId !== conflictQueryIdRef.current) return;
          setConflict(result.document);
          setDiff(undefined);
        } else if (result.kind === 'diff') {
          setDiff(result.diff);
          setConflict(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          reportRuntimeError(t('loadChangesFailedTitle'), cause, t('loadChangesFailed'));
      });

    return () => {
      cancelled = true;
    };
  }, [adapter, repo.generation, repo.repoId, reportRuntimeError, selectedArea, selectedPath, t]);

  useEffect(() => {
    if (selectedArea !== 'conflicted' || !selectedPath) return undefined;
    let cancelled = false;
    const refreshConflict = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return;
      const conflictQueryId = ++conflictQueryIdRef.current;
      try {
        const result = await adapter.query({
          kind: 'conflict',
          repoId: repo.repoId,
          path: selectedPath,
        });
        if (
          !cancelled &&
          conflictQueryId === conflictQueryIdRef.current &&
          result.kind === 'conflict'
        )
          setConflict(result.document);
      } catch {
        // 通常のquery処理でerrorを報告するため、background refreshでは通知しない。
      }
    };
    const interval = window.setInterval(() => {
      void refreshConflict();
    }, 2_000);
    const focus = () => {
      void refreshConflict();
    };
    window.addEventListener('focus', focus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
    };
  }, [adapter, repo.repoId, selectedArea, selectedPath]);

  useEffect(() => {
    setPullDiverged(false);
  }, [repo.branch.name, repo.branch.upstream]);

  useEffect(() => {
    setFileActionNotice(undefined);
  }, [repo.repoId]);

  useEffect(() => {
    const pending = pendingStageSelectionRef.current;
    if (!pending) return;
    const next = repo.changes.find(
      (entry) =>
        entry.path === pending.path &&
        (pending.target === 'staged'
          ? entry.area === 'staged'
          : entry.area === 'unstaged' || entry.area === 'untracked'),
    );
    if (next) {
      setSelectedKey(`${next.area}:${next.path}`);
      pendingStageSelectionRef.current = undefined;
    } else if (repo.generation !== pending.fromGeneration) {
      pendingStageSelectionRef.current = undefined;
    }
  }, [repo.changes, repo.generation]);

  const handleConflictDirtyChange = useCallback(
    (dirty: boolean): void => {
      setConflictDirty(dirty);
      onConflictDirtyChange?.(dirty);
    },
    [onConflictDirtyChange],
  );

  const handleConflictLeaveHandleChange = useCallback(
    (handle: ConflictLeaveHandle | null): void => {
      conflictLeaveHandleRef.current = handle;
      onConflictLeaveHandleChange?.(handle);
    },
    [onConflictLeaveHandleChange],
  );

  const completeFileSelection = (nextSelectedKey: string): void => {
    setPendingSelectedKey(undefined);
    setConflictDirty(false);
    onConflictDirtyChange?.(false);
    setSelectedKey(nextSelectedKey);
  };

  const requestFileSelection = (nextSelectedKey: string): void => {
    if (nextSelectedKey === selectedKey) return;
    if (conflictDirty && effectiveConflict) {
      setPendingSelectedKey(nextSelectedKey);
      return;
    }
    setSelectedKey(nextSelectedKey);
  };

  const saveAndSelectFile = async (): Promise<void> => {
    if (!pendingSelectedKey) return;
    const saved = await conflictLeaveHandleRef.current?.save();
    if (saved) completeFileSelection(pendingSelectedKey);
  };

  const conflictActions: ConflictSurfaceActions = useMemo(
    () => ({
      async choose(input) {
        const outcome = await adapter.execute({
          repoId: repo.repoId,
          action: {
            kind: 'conflictChoice',
            sessionId: input.conflict.sessionId,
            path: input.conflict.path,
            blockId: input.blockId,
            choice: input.choice,
            draftText: input.draftText,
            contentHash: input.conflict.contentHash,
            documentRevision: input.documentRevision,
            baseDocumentRevision: input.baseDocumentRevision,
          },
        });
        if (!outcome.conflictDocument)
          throw new Error('The choice response did not include a conflict document.');
        return outcome.conflictDocument;
      },
      async save(input) {
        const outcome = await adapter.execute({
          repoId: repo.repoId,
          action: {
            kind: 'saveConflict',
            sessionId: input.conflict.sessionId,
            path: input.conflict.path,
            draftText: input.draftText,
            contentHash: input.conflict.contentHash,
            documentRevision: input.documentRevision,
          },
        });
        if (outcome.conflictDocument) return outcome.conflictDocument;
        const refreshed = await adapter.query({
          kind: 'conflict',
          repoId: input.conflict.repoId,
          path: input.conflict.path,
        });
        if (refreshed.kind !== 'conflict')
          throw new Error('Could not load the conflict document after saving.');
        return refreshed.document;
      },
      async markResolved(current) {
        await adapter.execute({
          repoId: repo.repoId,
          action: {
            kind: 'markConflictResolved',
            sessionId: current.sessionId,
            path: current.path,
            contentHash: current.contentHash,
          },
        });
      },
      async reload(current) {
        const result = await adapter.query({
          kind: 'conflict',
          repoId: current.repoId,
          path: current.path,
        });
        if (result.kind !== 'conflict') throw new Error('Could not refresh the conflict state.');
        return result.document;
      },
      async materialize(current, choice) {
        await onAction({ kind: 'materializeConflict', sessionId: current.sessionId, choice });
      },
      async openExternal(current) {
        await adapter.execute({
          repoId: repo.repoId,
          action: { kind: 'openExternal', path: current.path },
        });
      },
    }),
    [adapter, onAction, repo.repoId],
  );

  const handleSurfaceSelection = (surfaceSelection: SurfaceSelection | null): void => {
    if (!surfaceSelection || !diff) {
      setSelection(undefined);
      return;
    }
    setSelection({
      diffId: diff.diffId,
      path: diff.path,
      generation: diff.generation,
      side: surfaceSelection.side,
      startLine: surfaceSelection.startLine,
      endLine: surfaceSelection.endLine,
    });
  };

  const runSelectionAction = async (
    kind: 'stageSelection' | 'unstageSelection' | 'discardSelection',
  ): Promise<void> => {
    if (!selection) return;
    await onAction({ kind, selection });
    setSelection(undefined);
  };

  const runStageTransition = async (request: StageTransitionRequest): Promise<void> => {
    const transitioningSelectedPath = request.paths.find(
      (path) => selectedKey === `${request.sourceArea}:${path}`,
    );
    if (transitioningSelectedPath) {
      pendingStageSelectionRef.current = {
        path: transitioningSelectedPath,
        target: request.kind === 'stage' ? 'staged' : 'worktree',
        fromGeneration: repo.generation,
      };
    }
    try {
      await onAction(
        request.kind === 'stage'
          ? { kind: 'stageFiles', paths: request.paths }
          : { kind: 'unstageFiles', paths: request.paths },
      );
    } catch (cause) {
      pendingStageSelectionRef.current = undefined;
      throw cause;
    }
  };

  const runFileAction = async (entry: ChangeEntry, action: FileActionKind): Promise<void> => {
    setFileActionNotice(undefined);
    if (action === 'copyPath') {
      const absolutePath = repo.path.endsWith('/')
        ? `${repo.path}${entry.path}`
        : `${repo.path}/${entry.path}`;
      try {
        await navigator.clipboard.writeText(absolutePath);
        setFileActionNotice({
          level: 'info',
          message: { id: 'copiedPath', args: { path: absolutePath } },
        });
      } catch (cause) {
        if (onError) {
          reportRuntimeError(t('copyPathFailedTitle'), cause, t('copyPathFailed'));
        } else {
          setFileActionNotice({ level: 'error', message: { id: 'copyPathFailed' } });
        }
      }
      return;
    }

    await onAction({ kind: 'fileAction', path: entry.path, operation: action });
  };

  const pull = async (): Promise<void> => {
    setPullDiverged(false);
    try {
      await onAction({ kind: 'pullFastForward' });
    } catch (cause) {
      if (isPullDivergenceError(cause)) {
        setPullDiverged(true);
        setCommitOpen(true);
      }
    }
  };

  const resolveDivergedPull = async (kind: 'merge' | 'rebase'): Promise<void> => {
    await onAction(
      kind === 'merge'
        ? { kind: 'merge', sourceRef: 'FETCH_HEAD' }
        : { kind: 'rebase', ontoRef: 'FETCH_HEAD' },
    );
    setPullDiverged(false);
  };

  const commitContentId = 'changes-commit-content';
  const commitHeadingId = 'changes-commit-heading';
  const remoteActions = (
    <fieldset className="remote-action-bar" aria-label={t('remoteActions')}>
      <button
        type="button"
        className="remote-action-button quiet"
        aria-label={t('pull')}
        title={t('pull')}
        disabled={repositoryActionsDisabled || repo.branch.detached || !repo.branch.upstream}
        aria-describedby={
          operationActionDisabledReason
            ? 'changes-operation-action-reason'
            : !repo.branch.detached && !repo.branch.upstream
              ? 'pull-disabled-reason'
              : undefined
        }
        onClick={() => void pull()}
      >
        <Download aria-hidden="true" focusable="false" size={14} />
        <span>{t('pull')}</span>
      </button>
      <button
        type="button"
        className="remote-action-button quiet"
        aria-label={t('push')}
        title={t('push')}
        disabled={repositoryActionsDisabled || repo.branch.detached}
        aria-describedby={
          operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
        }
        onClick={() => settleAction(onAction({ kind: 'push' }))}
      >
        <Upload aria-hidden="true" focusable="false" size={14} />
        <span>{t('push')}</span>
      </button>
      <button
        type="button"
        className="remote-action-button quiet"
        aria-label={t('fetch')}
        title={t('fetch')}
        disabled={repositoryActionsDisabled}
        aria-describedby={
          operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
        }
        onClick={() => settleAction(onAction({ kind: 'fetch' }))}
      >
        <RefreshCw aria-hidden="true" focusable="false" size={14} />
        <span>{t('fetch')}</span>
      </button>
    </fieldset>
  );
  const commitSection = effectiveConflict ? null : (
    <section className="changes-commit-section" aria-labelledby={commitHeadingId}>
      {!repo.branch.detached && !repo.branch.upstream ? (
        <p id="pull-disabled-reason" className="sr-only">
          {t('setUpstreamBeforePull')}
        </p>
      ) : null}
      {remoteActions}
      <div className="commit-disclosure-header">
        <h2 id={commitHeadingId} className="commit-disclosure-heading" aria-label={t('commit')}>
          <button
            type="button"
            className="commit-disclosure-toggle"
            aria-label={t(commitOpen ? 'hideCommit' : 'showCommit')}
            aria-expanded={commitOpen}
            aria-controls={commitContentId}
            onClick={() => setCommitOpen(!commitOpen)}
          >
            <GitCommitHorizontal aria-hidden="true" focusable="false" />
            <span>{t('commit')}</span>
            <ChevronRight
              className="commit-disclosure-chevron"
              aria-hidden="true"
              focusable="false"
            />
          </button>
        </h2>
      </div>
      <div id={commitContentId} className="commit-disclosure-content" hidden={!commitOpen}>
        {pullDiverged && pullTarget ? (
          <section
            className="inline-alert warning pull-resolution"
            aria-labelledby="pull-resolution-title"
          >
            <div>
              <strong id="pull-resolution-title">{t('fastForwardUnavailable')}</strong>
              <p>{t('fetchCompleteResolve', { target: pullTarget })}</p>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={repositoryActionsDisabled}
                aria-describedby={
                  operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
                }
                onClick={() => settleAction(resolveDivergedPull('merge'))}
              >
                {t('merge')}
              </button>
              <button
                type="button"
                disabled={repositoryActionsDisabled}
                aria-describedby={
                  operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
                }
                onClick={() => settleAction(resolveDivergedPull('rebase'))}
              >
                {t('rebase')}
              </button>
            </div>
          </section>
        ) : null}
        <CommitForm
          key={repo.path}
          draftKey={repo.path}
          disabled={Boolean(disabledCommitReason)}
          disabledReason={disabledCommitReason}
          busy={busy}
          showHeading={false}
          labelledBy={commitHeadingId}
          onAttentionRequired={() => setCommitOpen(true)}
          onError={reportRuntimeError}
          onCommit={(input) => onAction({ kind: 'commit', input })}
        />
      </div>
    </section>
  );

  const paneStyle: CSSProperties & { '--left-pane': string; '--right-pane': string } = {
    '--left-pane': `${Math.max(240, paneWidths.left)}px`,
    '--right-pane': `${paneWidths.right}px`,
  };

  return (
    <div className="three-pane changes-view changes-two-pane" style={paneStyle}>
      <aside className="pane changes-list-pane changes-sidebar-pane" aria-label={t('changes')}>
        {commitSection}
        <section className="changes-files-scroll-region" aria-label={t('changedFiles')}>
          {fileActionNotice ? (
            <p
              className={`file-action-notice ${fileActionNotice.level}`}
              role={fileActionNotice.level === 'error' ? 'alert' : 'status'}
              aria-live={fileActionNotice.level === 'error' ? 'assertive' : 'polite'}
            >
              {message(fileActionNotice.message)}
            </p>
          ) : null}
          {conflictDirty && !operationActionDisabledReason ? (
            <p id="changes-conflict-stage-action-reason" className="sr-only">
              {stageActionDisabledReason}
            </p>
          ) : null}
          <ChangeList
            repoId={repo.repoId}
            generation={repo.generation}
            entries={repo.changes}
            selectedKey={selected ? `${selected.area}:${selected.path}` : ''}
            disabled={stageActionsDisabled}
            disabledReasonId={stageActionDisabledReasonId}
            fileActionsDisabled={busy}
            fileOpenDisabled={Boolean(operationActionDisabledReason) || conflictDirty}
            fileTrashDisabled={Boolean(operationActionDisabledReason) || conflictDirty}
            onSelect={requestFileSelection}
            onStageTransition={runStageTransition}
            onFileAction={runFileAction}
          />
        </section>
      </aside>
      <PaneResizer
        label={t('changesListWidth')}
        value={Math.max(240, paneWidths.left)}
        direction="growRight"
        min={240}
        onChange={(left) => onPaneWidthsChange({ ...paneWidths, left })}
      />

      {effectiveConflict ? (
        <main className="pane conflict-pane-span changes-content-pane">
          <ConflictSurface
            key={`${effectiveConflict.repoId}:${effectiveConflict.path}`}
            document={effectiveConflict}
            actions={conflictActions}
            externalStateChanged={conflictMissingFromSnapshot}
            onError={reportRuntimeError}
            onDirtyChange={handleConflictDirtyChange}
            onLeaveHandleChange={handleConflictLeaveHandleChange}
            onResolved={() => {
              setConflict(undefined);
              handleConflictDirtyChange(false);
            }}
          />
        </main>
      ) : (
        <main
          className="pane diff-pane changes-content-pane"
          aria-label={selected ? undefined : t('diff')}
          aria-labelledby={selected ? 'selected-file-title' : undefined}
        >
          {selected ? (
            <div className="pane-toolbar">
              <div>
                <h2 id="selected-file-title">{selected.path}</h2>
              </div>
              <div className="pane-toolbar-actions">
                {visibleDiff && !visibleDiff.binary && !visibleDiff.tooLarge ? (
                  <fieldset className="segmented" aria-label={t('diffLayout')}>
                    {(['unified', 'split'] as const).map((style) => (
                      <button
                        key={style}
                        type="button"
                        aria-pressed={diffStyle === style}
                        onClick={() => {
                          setDiffStyle(style);
                          setSelection(undefined);
                        }}
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
                ) : null}
                <FileActions
                  entry={selected}
                  disabled={repositoryActionsDisabled}
                  disabledReasonId={
                    operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
                  }
                  onAction={onAction}
                />
              </div>
            </div>
          ) : null}
          {operationActionDisabledReason ? (
            <p id="changes-operation-action-reason" className="sr-only">
              {operationActionDisabledReason}
            </p>
          ) : null}
          {error ? (
            <div className="inline-alert error" role="alert">
              <WorkspaceErrorDetails error={error} />
            </div>
          ) : null}
          {visibleDiff?.binary ? (
            <p className="empty-state-small">{t('binaryWholeFileOnly')}</p>
          ) : null}
          {visibleDiff?.truncated ? (
            <output className="inline-alert warning">{t('diffDisplayLimit')}</output>
          ) : null}
          {visibleDiff && !visibleDiff.binary ? (
            <DiffSurface
              source={
                visibleDiff.tooLarge || diffContainsMultipleFiles
                  ? {
                      kind: 'codeView',
                      patch: visibleDiff.patch,
                      cacheKey: visibleDiff.diffId,
                    }
                  : {
                      kind: 'patch',
                      patch: visibleDiff.patch,
                      path: visibleDiff.path,
                      cacheKey: visibleDiff.diffId,
                    }
              }
              selectable={lineSelectionEnabled}
              diffStyle={diffStyle}
              performanceMode={Boolean(visibleDiff.tooLarge)}
              onSelectionChange={handleSurfaceSelection}
              ariaLabel={t('fileDiffAria', { path: visibleDiff.path })}
            />
          ) : null}
          {selection ? (
            <div className="selection-action-bar" role="toolbar" aria-label={t('selectedLines')}>
              <span>{t('lineRange', { start: selection.startLine, end: selection.endLine })}</span>
              {selected?.area === 'staged' ? (
                <button
                  type="button"
                  disabled={repositoryActionsDisabled}
                  aria-describedby={
                    operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
                  }
                  onClick={() => settleAction(runSelectionAction('unstageSelection'))}
                >
                  {t('unstage')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={repositoryActionsDisabled}
                  aria-describedby={
                    operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
                  }
                  onClick={() => settleAction(runSelectionAction('stageSelection'))}
                >
                  {t('stage')}
                </button>
              )}
              {selected?.area !== 'staged' ? (
                <button
                  type="button"
                  className="danger-quiet"
                  disabled={repositoryActionsDisabled}
                  aria-describedby={
                    operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
                  }
                  onClick={() => settleAction(runSelectionAction('discardSelection'))}
                >
                  <Trash2 aria-hidden="true" size={14} /> {t('discard')}
                </button>
              ) : null}
            </div>
          ) : null}
        </main>
      )}
      {pendingSelectedKey ? (
        <Dialog
          labelledBy="leave-conflict-file-title"
          onDismiss={() => setPendingSelectedKey(undefined)}
        >
          <h2 id="leave-conflict-file-title">{t('unsavedResult')}</h2>
          <p>{t('saveOrDiscardBeforeChangingFile')}</p>
          <div className="button-row end">
            <button
              type="button"
              data-dialog-initial-focus
              onClick={() => setPendingSelectedKey(undefined)}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="danger-quiet"
              onClick={() => completeFileSelection(pendingSelectedKey)}
            >
              {t('leaveWithoutSaving')}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => settleAction(saveAndSelectFile())}
            >
              {t('saveAndLeave')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function FileActions({
  entry,
  disabled,
  disabledReasonId,
  onAction,
}: {
  entry: ChangeEntry;
  disabled: boolean;
  disabledReasonId: string | undefined;
  onAction: (action: WorkspaceAction) => Promise<void>;
}) {
  const { t } = useI18n();
  if (entry.area === 'conflicted' || entry.area === 'staged') return null;
  return (
    <fieldset className="button-row compact" aria-label={t('fileActionsFor', { path: entry.path })}>
      <button
        type="button"
        className="danger-quiet"
        disabled={disabled}
        aria-describedby={disabledReasonId}
        onClick={() =>
          settleAction(onAction({ kind: 'discardFile', path: entry.path, area: entry.area }))
        }
      >
        <Trash2 aria-hidden="true" size={14} /> {t('discard')}
      </button>
    </fieldset>
  );
}
