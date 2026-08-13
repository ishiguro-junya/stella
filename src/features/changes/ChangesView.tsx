/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogのfocus stackを保ったまま非破壊操作をdialogとして公開する。 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  GitCommitHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';

import { isPullDivergenceError, type WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { patchContainsMultipleFiles } from '../../domain/diffProfile';
import type { UnsavedChangesHandle } from '../../domain/unsavedChanges';
import type {
  ChangeEntry,
  ChangeArea,
  ConflictDocument,
  DiffDocument,
  DiffStyle,
  FileDocument,
  LineDiffSelection,
  RepoSnapshot,
  WorkspaceAction,
} from '../../domain/workspace';
import { useI18n, type I18nValue, type LocalizedMessage } from '../../i18n/i18n';
import { CommitForm } from '../commit/CommitForm';
import { ConflictSurface, type ConflictSurfaceActions } from '../conflict/ConflictSurface';
import {
  DiffSurface,
  type HunkActionConfig,
  type SurfaceHunkEditSelection,
  type SurfaceHunkSelection,
  type SurfaceSelection,
} from '../diff/DiffSurface';
import {
  CHANGES_PANE_MIN_WIDTH,
  DEFAULT_EDITOR_WRAP_COLUMN,
  type PaneWidths,
} from '../../persistence/preferences';
import { PaneResizer } from '../../ui/PaneResizer';
import { Dialog, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { FileStatusIcon } from '../../ui/FileStatusIcon';
import {
  RowActionMenu,
  type RowActionMenuItem,
  type RowActionMenuPoint,
} from '../../ui/RowActionMenu';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { ChangeList, type StageTransitionRequest } from './ChangeList';
import { FileActionMenu, type FileActionKind, type FileActionMenuPoint } from './FileActionMenu';
import { FileEditorSurface, type FileEditorSaveInput } from './FileEditorSurface';
import { FileViewModeTabs } from './FileViewModeTabs';

export interface ChangesViewProps {
  repo: RepoSnapshot;
  adapter: WorkspaceAdapter;
  externalConflict?: ConflictDocument | undefined;
  busy?: boolean | undefined;
  onError?: ShowWorkspaceError | undefined;
  onAction: (action: WorkspaceAction) => Promise<void>;
  onUnsavedDirtyChange?: ((dirty: boolean) => void) | undefined;
  onUnsavedLeaveHandleChange?: ((handle: UnsavedChangesHandle | null) => void) | undefined;
  paneWidths: PaneWidths;
  diffStyle?: DiffStyle | undefined;
  splitStageView?: boolean | undefined;
  useConventionalCommits?: boolean | undefined;
  stickyFileHeaders?: boolean | undefined;
  editorLineWrapping?: boolean | undefined;
  editorWrapColumn?: number | undefined;
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

function supportsPartialDiffActions(document: DiffDocument, entry: ChangeEntry): boolean {
  return (
    !document.binary &&
    !document.truncated &&
    !patchContainsMultipleFiles(document.patch) &&
    entry.area !== 'conflicted' &&
    (entry.status === 'added' || entry.status === 'modified' || entry.status === 'deleted')
  );
}

export function ChangesView({
  repo,
  adapter,
  externalConflict,
  busy = false,
  onError,
  onAction,
  onUnsavedDirtyChange,
  onUnsavedLeaveHandleChange,
  paneWidths,
  diffStyle = 'unified',
  splitStageView = true,
  useConventionalCommits = false,
  stickyFileHeaders = false,
  editorLineWrapping = false,
  editorWrapColumn = DEFAULT_EDITOR_WRAP_COLUMN,
  onPaneWidthsChange,
}: ChangesViewProps) {
  const { t, message } = useI18n();
  const initialSelectedEntry =
    repo.changes.find((entry) => entry.path === repo.selectedPath) ?? repo.changes[0];
  const initialSelectedKey = initialSelectedEntry
    ? `${initialSelectedEntry.area}:${initialSelectedEntry.path}`
    : '';
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>(() =>
    initialSelectedKey ? [initialSelectedKey] : [],
  );
  const [diff, setDiff] = useState<DiffDocument>();
  const [multiDiffs, setMultiDiffs] = useState<DiffDocument[]>([]);
  const [collapsedMultiDiffKeys, setCollapsedMultiDiffKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [conflict, setConflict] = useState<ConflictDocument>();
  const [selection, setSelection] = useState<LineDiffSelection>();
  const [selectionMenuContext, setSelectionMenuContext] = useState<{
    point: RowActionMenuPoint;
    text: string;
  }>();
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [pullDiverged, setPullDiverged] = useState(false);
  const [conflictDirty, setConflictDirty] = useState(false);
  const [fileEditorDirty, setFileEditorDirty] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    path: string;
    originalEntry: ChangeEntry;
    initialScrollLine?: number;
  }>();
  const [fileDocument, setFileDocument] = useState<FileDocument>();
  const [fileEditorExternalStateChanged, setFileEditorExternalStateChanged] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [detailFileMenuOpen, setDetailFileMenuOpen] = useState(false);
  const [detailFileMenuContextPoint, setDetailFileMenuContextPoint] =
    useState<FileActionMenuPoint>();
  const [multiDetailFileMenuKey, setMultiDetailFileMenuKey] = useState<string>();
  const [multiDetailFileMenuContext, setMultiDetailFileMenuContext] = useState<{
    key: string;
    point: FileActionMenuPoint;
  }>();
  const [pendingSelectedKey, setPendingSelectedKey] = useState<string>();
  const [fileActionNotice, setFileActionNotice] = useState<
    { level: 'info' | 'error'; message: LocalizedMessage } | undefined
  >();
  const conflictQueryIdRef = useRef(0);
  const unsavedLeaveHandleRef = useRef<UnsavedChangesHandle | null>(null);
  const fileQueryIdRef = useRef(0);
  const syncedExternalConflictRef = useRef<ConflictDocument | undefined>(undefined);
  const pendingStageSelectionRef = useRef<
    | {
        path: string;
        target: 'staged' | 'worktree';
        sourceArea: Extract<ChangeArea, 'staged' | 'unstaged' | 'untracked'>;
        fromGeneration: number;
      }
    | undefined
  >(undefined);
  const pendingEditSelectionRef = useRef<{ path: string; fromGeneration: number } | undefined>(
    undefined,
  );

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
  const editingEntry = editingTarget
    ? (repo.changes.find(
        (entry) =>
          entry.path === editingTarget.path &&
          (entry.area === 'unstaged' || entry.area === 'untracked'),
      ) ??
      repo.changes.find((entry) => entry.path === editingTarget.path) ??
      editingTarget.originalEntry)
    : undefined;
  const selectedFileEntries = useMemo(() => {
    const keys = new Set(selectedFileKeys);
    const entries = repo.changes.filter((entry) => keys.has(`${entry.area}:${entry.path}`));
    return entries.length ? entries : selected ? [selected] : [];
  }, [repo.changes, selected, selectedFileKeys]);
  const multipleFilesSelected = selectedFileEntries.length > 1;
  const unsavedDirty = conflictDirty || fileEditorDirty;
  const selectedFileKeysSignature = selectedFileKeys.join('\0');
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
  const repositoryActionsDisabled = busy || Boolean(operationActionDisabledReason) || unsavedDirty;
  const stageActionDisabledReason =
    operationActionDisabledReason ??
    (unsavedDirty ? t('stageUnavailableUnsavedChanges') : undefined);
  const stageActionsDisabled = busy || Boolean(stageActionDisabledReason);
  const stageActionDisabledReasonId = operationActionDisabledReason
    ? 'changes-operation-action-reason'
    : unsavedDirty
      ? 'changes-unsaved-stage-action-reason'
      : undefined;
  const diffContainsMultipleFiles = visibleDiff
    ? patchContainsMultipleFiles(visibleDiff.patch)
    : false;
  const partialSelectionEligible = Boolean(
    visibleDiff && selected && supportsPartialDiffActions(visibleDiff, selected),
  );
  const lineSelectionEnabled = partialSelectionEligible && !repositoryActionsDisabled;
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
    setDetailFileMenuOpen(false);
    setDetailFileMenuContextPoint(undefined);
  }, [selectedKey]);

  useEffect(() => {
    setCollapsedMultiDiffKeys(new Set());
    setMultiDetailFileMenuKey(undefined);
    setMultiDetailFileMenuContext(undefined);
  }, [repo.repoId, selectedFileKeysSignature]);

  useEffect(() => {
    if (busy) {
      setDetailFileMenuOpen(false);
      setDetailFileMenuContextPoint(undefined);
      setMultiDetailFileMenuKey(undefined);
      setMultiDetailFileMenuContext(undefined);
    }
  }, [busy]);

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
    if (editingTarget) return undefined;
    if (multipleFilesSelected) {
      setDiff(undefined);
      setConflict(undefined);
      setSelection(undefined);
      setSelectionMenuContext(undefined);
      return undefined;
    }
    if (!selectedArea || !selectedPath) {
      setDiff(undefined);
      setConflict(undefined);
      return undefined;
    }
    let cancelled = false;
    setError(undefined);
    setSelection(undefined);
    setSelectionMenuContext(undefined);

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
  }, [
    adapter,
    editingTarget,
    multipleFilesSelected,
    repo.generation,
    repo.repoId,
    reportRuntimeError,
    selectedArea,
    selectedPath,
    t,
  ]);

  useEffect(() => {
    if (editingTarget) return undefined;
    if (!multipleFilesSelected) {
      setMultiDiffs((current) => (current.length ? [] : current));
      return undefined;
    }
    let cancelled = false;
    setError(undefined);
    setMultiDiffs([]);
    void Promise.all(
      selectedFileEntries.map(async (entry) => {
        const result = await adapter.query({
          kind: 'diff',
          repoId: repo.repoId,
          path: entry.path,
          area: entry.area,
        });
        if (result.kind !== 'diff') throw new Error('Could not load the selected file diff.');
        return result.diff;
      }),
    )
      .then((documents) => {
        if (!cancelled) setMultiDiffs(documents);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          reportRuntimeError(t('loadChangesFailedTitle'), cause, t('loadChangesFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    editingTarget,
    multipleFilesSelected,
    repo.generation,
    repo.repoId,
    reportRuntimeError,
    selectedFileEntries,
    t,
  ]);

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
    setEditingTarget(undefined);
    setFileDocument(undefined);
    setFileEditorDirty(false);
    setFileEditorExternalStateChanged(false);
  }, [repo.repoId]);

  useEffect(() => {
    if (!editingTarget) return undefined;
    const currentEntry = repo.changes.find((entry) => entry.path === editingTarget.path);
    if (!currentEntry) {
      if (fileEditorDirty) setFileEditorExternalStateChanged(true);
      else {
        setEditingTarget(undefined);
        setFileDocument(undefined);
      }
      return undefined;
    }
    const queryId = ++fileQueryIdRef.current;
    let cancelled = false;
    void adapter
      .query({ kind: 'fileContents', repoId: repo.repoId, path: editingTarget.path })
      .then((result) => {
        if (cancelled || queryId !== fileQueryIdRef.current || result.kind !== 'fileContents')
          return;
        setFileDocument(result.document);
        const key = `${editingTarget.originalEntry.area}:${editingTarget.path}`;
        setSelectedKey(key);
        setSelectedFileKeys([key]);
        setFileEditorExternalStateChanged(false);
      })
      .catch((cause: unknown) => {
        if (cancelled || queryId !== fileQueryIdRef.current) return;
        if (fileEditorDirty) {
          setFileEditorExternalStateChanged(true);
          return;
        }
        setEditingTarget(undefined);
        setFileDocument(undefined);
        reportRuntimeError(t('fileEditLoadFailedTitle'), cause, t('fileEditLoadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    editingTarget,
    fileEditorDirty,
    repo.changes,
    repo.generation,
    repo.repoId,
    reportRuntimeError,
    t,
  ]);

  useEffect(() => {
    const available = new Set(repo.changes.map((entry) => `${entry.area}:${entry.path}`));
    setSelectedFileKeys((current) => {
      const next = current.filter((key) => available.has(key));
      if (next.length || !selectedKey || !available.has(selectedKey)) return next;
      return [selectedKey];
    });
  }, [repo.changes, repo.repoId, selectedKey]);

  useEffect(() => {
    const pending = pendingStageSelectionRef.current;
    if (!pending) return;
    if (repo.generation === pending.fromGeneration) return;
    const sourceRemains = repo.changes.some(
      (entry) => entry.path === pending.path && entry.area === pending.sourceArea,
    );
    if (sourceRemains) {
      pendingStageSelectionRef.current = undefined;
      return;
    }
    const next = repo.changes.find(
      (entry) =>
        entry.path === pending.path &&
        (pending.target === 'staged'
          ? entry.area === 'staged'
          : entry.area === 'unstaged' || entry.area === 'untracked'),
    );
    if (next) {
      const nextKey = `${next.area}:${next.path}`;
      setSelectedKey(nextKey);
      setSelectedFileKeys([nextKey]);
      pendingStageSelectionRef.current = undefined;
    } else if (repo.generation !== pending.fromGeneration) {
      pendingStageSelectionRef.current = undefined;
    }
  }, [repo.changes, repo.generation]);

  useEffect(() => {
    const pending = pendingEditSelectionRef.current;
    if (!pending || repo.generation === pending.fromGeneration) return;
    const next = repo.changes.find(
      (entry) =>
        entry.path === pending.path && (entry.area === 'unstaged' || entry.area === 'untracked'),
    );
    if (next) {
      const nextKey = `${next.area}:${next.path}`;
      setSelectedKey(nextKey);
      setSelectedFileKeys([nextKey]);
    }
    pendingEditSelectionRef.current = undefined;
  }, [repo.changes, repo.generation]);

  const handleConflictDirtyChange = useCallback((dirty: boolean): void => {
    setConflictDirty(dirty);
  }, []);

  useEffect(() => {
    onUnsavedDirtyChange?.(unsavedDirty);
  }, [onUnsavedDirtyChange, unsavedDirty]);

  const handleUnsavedLeaveHandleChange = useCallback(
    (handle: UnsavedChangesHandle | null): void => {
      unsavedLeaveHandleRef.current = handle;
      onUnsavedLeaveHandleChange?.(handle);
    },
    [onUnsavedLeaveHandleChange],
  );

  const completeFileSelection = (nextSelectedKey: string): void => {
    setPendingSelectedKey(undefined);
    setConflictDirty(false);
    setFileEditorDirty(false);
    setEditingTarget(undefined);
    setFileDocument(undefined);
    setFileEditorExternalStateChanged(false);
    setSelectedKey(nextSelectedKey);
    setSelectedFileKeys([nextSelectedKey]);
  };

  const requestFileSelection = (nextSelectedKey: string): void => {
    if (nextSelectedKey === selectedKey) return;
    if (unsavedDirty) {
      setPendingSelectedKey(nextSelectedKey);
      return;
    }
    if (editingTarget) {
      setEditingTarget(undefined);
      setFileDocument(undefined);
    }
    setSelectedKey(nextSelectedKey);
  };

  const requestSelectedFiles = (keys: string[]): void => {
    if (unsavedDirty) return;
    if (
      editingTarget &&
      (keys.length !== 1 || !keys.some((key) => key.endsWith(`:${editingTarget.path}`)))
    ) {
      setEditingTarget(undefined);
      setFileDocument(undefined);
    }
    setSelectedFileKeys(keys);
  };

  const saveAndSelectFile = async (): Promise<void> => {
    if (!pendingSelectedKey) return;
    const saved = await unsavedLeaveHandleRef.current?.save();
    if (saved) completeFileSelection(pendingSelectedKey);
  };

  const completeDisplayExit = (): void => {
    setFileEditorDirty(false);
    setEditingTarget(undefined);
    setFileDocument(undefined);
    setFileEditorExternalStateChanged(false);
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
    setSelectionMenuContext(undefined);
    if (!surfaceSelection || !diff) {
      setSelection(undefined);
      return;
    }
    setSelection({
      kind: 'lines',
      diffId: diff.diffId,
      path: diff.path,
      generation: diff.generation,
      side: surfaceSelection.side,
      startLine: surfaceSelection.startLine,
      endLine: surfaceSelection.endLine,
    });
  };

  type SelectionActionKind =
    | 'editLines'
    | 'copySelection'
    | 'stageSelection'
    | 'unstageSelection'
    | 'discardSelection';

  const runSelectionAction = async (kind: SelectionActionKind): Promise<void> => {
    if (kind === 'editLines') {
      if (selected && selection) startEditing(selected, selection.startLine);
      return;
    }
    if (kind === 'copySelection') {
      if (!selectionMenuContext) return;
      setFileActionNotice(undefined);
      try {
        await navigator.clipboard.writeText(selectionMenuContext.text);
        setFileActionNotice({ level: 'info', message: { id: 'copiedSelectedLines' } });
      } catch (cause) {
        if (onError) {
          reportRuntimeError(
            t('copySelectedLinesFailedTitle'),
            cause,
            t('copySelectedLinesFailed'),
          );
        } else {
          setFileActionNotice({ level: 'error', message: { id: 'copySelectedLinesFailed' } });
        }
      }
      setSelectionMenuContext(undefined);
      return;
    }
    if (!selection) return;
    await onAction({ kind, selection });
    setSelection(undefined);
    setSelectionMenuContext(undefined);
  };

  const runHunkAction = async (
    actionKind: 'stageSelection' | 'unstageSelection' | 'discardSelection',
    { hunkIndex }: SurfaceHunkSelection,
    document: DiffDocument,
    entry: ChangeEntry,
    trackSelectionTransition: boolean,
  ): Promise<void> => {
    if (entry.area === 'conflicted') return;
    if (trackSelectionTransition && actionKind !== 'discardSelection') {
      pendingStageSelectionRef.current = {
        path: entry.path,
        target: entry.area === 'staged' ? 'worktree' : 'staged',
        sourceArea: entry.area,
        fromGeneration: repo.generation,
      };
    }
    try {
      await onAction({
        kind: actionKind,
        selection: {
          kind: 'hunk',
          diffId: document.diffId,
          path: document.path,
          generation: document.generation,
          hunkIndex,
        },
      });
      setSelection(undefined);
    } catch (cause) {
      if (trackSelectionTransition) pendingStageSelectionRef.current = undefined;
      throw cause;
    }
  };

  const createHunkAction = (
    document: DiffDocument | undefined,
    entry: ChangeEntry | undefined,
    trackSelectionTransition: boolean,
  ): HunkActionConfig | undefined =>
    document && entry && supportsPartialDiffActions(document, entry)
      ? {
          kind: entry.area === 'staged' ? 'unstage' : 'stage',
          editDisabled: busy || unsavedDirty || entry.status === 'deleted',
          ...(entry.status === 'deleted'
            ? {}
            : {
                onEdit: (hunkSelection: SurfaceHunkEditSelection) =>
                  startEditing(entry, hunkSelection.startLine),
              }),
          disabled: repositoryActionsDisabled,
          ...(stageActionDisabledReasonId ? { describedBy: stageActionDisabledReasonId } : {}),
          ...(splitStageView
            ? {
                onAction: (hunkSelection: SurfaceHunkSelection) =>
                  settleAction(
                    runHunkAction(
                      entry.area === 'staged' ? 'unstageSelection' : 'stageSelection',
                      hunkSelection,
                      document,
                      entry,
                      trackSelectionTransition,
                    ),
                  ),
              }
            : {}),
          ...(entry.area === 'unstaged'
            ? {
                discardDisabled: repositoryActionsDisabled,
                onDiscard: (hunkSelection: SurfaceHunkSelection) =>
                  settleAction(
                    runHunkAction(
                      'discardSelection',
                      hunkSelection,
                      document,
                      entry,
                      trackSelectionTransition,
                    ),
                  ),
              }
            : {}),
        }
      : undefined;

  const hunkAction = createHunkAction(visibleDiff, selected, true);

  const copySelectionMenuItem: RowActionMenuItem<SelectionActionKind> = {
    action: 'copySelection',
    label: t('actionCopySelectedLines'),
    icon: <Copy aria-hidden="true" focusable="false" size={15} />,
  };
  const editLinesMenuItem: RowActionMenuItem<SelectionActionKind> = {
    action: 'editLines',
    label: t('actionEditLines'),
    icon: <Pencil aria-hidden="true" focusable="false" size={15} />,
    disabled: busy || unsavedDirty || selected?.status === 'deleted',
  };
  const discardSelectionMenuItem: RowActionMenuItem<SelectionActionKind> = {
    action: 'discardSelection',
    label: t('actionDiscardSelectedLines'),
    icon: <Trash2 aria-hidden="true" focusable="false" size={15} />,
    disabled: repositoryActionsDisabled || selected?.area === 'untracked',
    danger: true,
    separatorBefore: true,
  };
  const selectionMenuItems: RowActionMenuItem<SelectionActionKind>[] = !splitStageView
    ? selected?.area === 'staged'
      ? [editLinesMenuItem, copySelectionMenuItem]
      : [editLinesMenuItem, copySelectionMenuItem, discardSelectionMenuItem]
    : selected?.area === 'staged'
      ? [
          editLinesMenuItem,
          copySelectionMenuItem,
          {
            action: 'unstageSelection',
            label: t('actionUnstageSelectedLines'),
            icon: <Upload aria-hidden="true" focusable="false" size={15} />,
            disabled: repositoryActionsDisabled,
            separatorBefore: true,
          },
        ]
      : [
          editLinesMenuItem,
          copySelectionMenuItem,
          {
            action: 'stageSelection',
            label: t('actionStageSelectedLines'),
            icon: <Download aria-hidden="true" focusable="false" size={15} />,
            disabled: repositoryActionsDisabled,
            separatorBefore: true,
          },
          discardSelectionMenuItem,
        ];

  const runStageTransition = async (request: StageTransitionRequest): Promise<void> => {
    const transitioningSelectedPath = request.paths.find(
      (path) => selectedKey === `${request.sourceArea}:${path}`,
    );
    if (transitioningSelectedPath) {
      pendingStageSelectionRef.current = {
        path: transitioningSelectedPath,
        target: request.kind === 'stage' ? 'staged' : 'worktree',
        sourceArea: request.sourceArea,
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

  const startEditing = (entry: ChangeEntry, initialScrollLine?: number): void => {
    if (entry.area === 'conflicted' || entry.status === 'deleted' || entry.status === 'binary') {
      setFileActionNotice({ level: 'error', message: { id: 'fileEditUnsupported' } });
      return;
    }
    setEditingTarget({
      path: entry.path,
      originalEntry: entry,
      ...(initialScrollLine ? { initialScrollLine } : {}),
    });
    setFileDocument(undefined);
    setFileEditorDirty(false);
    setFileEditorExternalStateChanged(false);
    setSelection(undefined);
    setSelectionMenuContext(undefined);
    setError(undefined);
  };

  const runFileAction = async (entries: ChangeEntry[], action: FileActionKind): Promise<void> => {
    setFileActionNotice(undefined);
    const paths = [...new Set(entries.map((entry) => entry.path))];
    const entry = entries[0];
    if (!entry || !paths.length) return;
    if (action === 'editFile') {
      startEditing(entry);
      return;
    }
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

    if (action === 'discardChanges') {
      await onAction({ kind: 'discardFiles', paths });
      return;
    }
    await onAction({ kind: 'fileAction', paths, operation: action });
  };

  const saveFile = async (input: FileEditorSaveInput): Promise<FileDocument | undefined> => {
    if (editingTarget?.originalEntry.area === 'staged') {
      pendingEditSelectionRef.current = {
        path: input.path,
        fromGeneration: repo.generation,
      };
    }
    try {
      await onAction({
        kind: 'saveFile',
        path: input.path,
        text: input.text,
        expectedContentHash: input.expectedContentHash,
      });
    } catch (cause) {
      pendingEditSelectionRef.current = undefined;
      throw cause;
    }
    try {
      const result = await adapter.query({
        kind: 'fileContents',
        repoId: repo.repoId,
        path: input.path,
      });
      if (result.kind !== 'fileContents') throw new Error('Could not reload the saved file.');
      return result.document;
    } catch (cause) {
      const snapshotResult = await adapter.query({ kind: 'snapshot', repoId: repo.repoId });
      if (
        snapshotResult.kind === 'snapshot' &&
        !snapshotResult.snapshot.changes.some((entry) => entry.path === input.path)
      ) {
        return undefined;
      }
      throw cause;
    }
  };

  const reloadEditedFile = async (): Promise<FileDocument> => {
    if (!editingTarget) throw new Error('No file is being edited.');
    const result = await adapter.query({
      kind: 'fileContents',
      repoId: repo.repoId,
      path: editingTarget.path,
    });
    if (result.kind !== 'fileContents') throw new Error('Could not reload the edited file.');
    return result.document;
  };

  const handleFileSaved = (document: FileDocument | undefined): void => {
    setFileEditorDirty(false);
    if (!document) {
      setEditingTarget(undefined);
      setFileDocument(undefined);
      setFileEditorExternalStateChanged(false);
      return;
    }
    setFileDocument(document);
  };

  const pull = async (): Promise<void> => {
    setPullDiverged(false);
    try {
      await onAction({ kind: 'pullFastForward' });
    } catch (cause) {
      if (isPullDivergenceError(cause)) {
        setPullDiverged(true);
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

  const repositoryActions = (
    <section className="changes-action-section">
      {!repo.branch.detached && !repo.branch.upstream ? (
        <p id="pull-disabled-reason" className="sr-only">
          {t('setUpstreamBeforePull')}
        </p>
      ) : null}
      <fieldset className="changes-action-bar" aria-label={t('actions')}>
        <button
          type="button"
          className="changes-action-button quiet"
          aria-label={t('commit')}
          aria-haspopup="dialog"
          aria-expanded={commitDialogOpen}
          title={t('commit')}
          disabled={busy || unsavedDirty}
          onClick={() => setCommitDialogOpen(true)}
        >
          <GitCommitHorizontal aria-hidden="true" focusable="false" size={14} />
          <span>{t('commit')}</span>
        </button>
        <button
          type="button"
          className="changes-action-button quiet"
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
          className="changes-action-button quiet"
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
          className="changes-action-button quiet"
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
    </section>
  );

  const renderDiffFileHeader = ({
    entry,
    collapsed,
    menuOpen,
    menuContextPoint,
    titleId,
    onToggle,
    onMenuOpenChange,
    onMenuContextPointChange,
  }: {
    entry: ChangeEntry;
    collapsed?: boolean;
    menuOpen: boolean;
    menuContextPoint: FileActionMenuPoint | undefined;
    titleId?: string;
    onToggle?: () => void;
    onMenuOpenChange: (open: boolean) => void;
    onMenuContextPointChange: (point: FileActionMenuPoint | undefined) => void;
  }) => {
    const fileActionInvalid =
      entry.area === 'conflicted' || entry.status === 'deleted' || entry.status === 'binary';
    const openDisabled =
      Boolean(operationActionDisabledReason) || unsavedDirty || fileActionInvalid;
    const discardDisabled =
      Boolean(operationActionDisabledReason) ||
      unsavedDirty ||
      entry.area !== 'unstaged' ||
      entry.status === 'deleted';
    return (
      <div
        className={`pane-toolbar diff-file-toolbar${stickyFileHeaders ? ' is-sticky' : ''}`}
        onContextMenu={(event) => {
          event.preventDefault();
          if (busy) return;
          onMenuContextPointChange({ x: event.clientX, y: event.clientY });
          onMenuOpenChange(true);
        }}
      >
        <div className="selected-file-heading">
          {onToggle ? (
            <button
              type="button"
              className="selected-file-toggle"
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', {
                path: entry.path,
              })}
              onClick={onToggle}
            >
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </button>
          ) : null}
          <FileStatusIcon status={entry.status} />
          <h2 {...(titleId ? { id: titleId } : {})} aria-label={entry.path}>
            {entry.path}
          </h2>
        </div>
        <div className="diff-file-actions">
          <FileViewModeTabs
            mode="display"
            editDisabled={busy || unsavedDirty || fileActionInvalid}
            onDisplay={() => undefined}
            onEdit={() => startEditing(entry)}
          />
          <FileActionMenu
            path={entry.path}
            selectedPaths={[entry.path]}
            open={menuOpen}
            disabled={busy}
            editDisabled={unsavedDirty || fileActionInvalid}
            openDisabled={openDisabled}
            discardDisabled={discardDisabled}
            deleteDisabled={openDisabled}
            persistentTrigger
            contextPoint={menuContextPoint}
            onOpenChange={(open) => {
              onMenuOpenChange(open);
              if (!open) onMenuContextPointChange(undefined);
            }}
            onTriggerOpen={() => onMenuContextPointChange(undefined)}
            onAction={(fileAction) => runFileAction([entry], fileAction)}
          />
        </div>
      </div>
    );
  };

  const paneStyle: CSSProperties & { '--left-pane': string; '--right-pane': string } = {
    '--left-pane': `${Math.max(CHANGES_PANE_MIN_WIDTH, paneWidths.left)}px`,
    '--right-pane': `${paneWidths.right}px`,
  };

  return (
    <div className="three-pane changes-view changes-two-pane" style={paneStyle}>
      <aside className="pane changes-list-pane changes-sidebar-pane" aria-label={t('changes')}>
        {repositoryActions}
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
          {unsavedDirty && !operationActionDisabledReason ? (
            <p id="changes-unsaved-stage-action-reason" className="sr-only">
              {stageActionDisabledReason}
            </p>
          ) : null}
          <ChangeList
            repoId={repo.repoId}
            generation={repo.generation}
            entries={repo.changes}
            splitStageView={splitStageView}
            selectedKey={selected ? `${selected.area}:${selected.path}` : ''}
            selectionKeys={selectedFileKeys}
            unsavedFileKey={
              fileEditorDirty && editingTarget
                ? `${editingTarget.originalEntry.area}:${editingTarget.path}`
                : undefined
            }
            disabled={stageActionsDisabled}
            disabledReasonId={stageActionDisabledReasonId}
            fileActionsDisabled={busy}
            fileEditDisabled={unsavedDirty}
            fileOpenDisabled={Boolean(operationActionDisabledReason) || unsavedDirty}
            fileTrashDisabled={Boolean(operationActionDisabledReason) || unsavedDirty}
            onSelect={requestFileSelection}
            onSelectedKeysChange={requestSelectedFiles}
            onStageTransition={runStageTransition}
            onFileAction={runFileAction}
          />
        </section>
      </aside>
      <PaneResizer
        label={t('changesListWidth')}
        value={Math.max(CHANGES_PANE_MIN_WIDTH, paneWidths.left)}
        direction="growRight"
        min={CHANGES_PANE_MIN_WIDTH}
        onChange={(left) => onPaneWidthsChange({ ...paneWidths, left })}
      />

      {editingTarget && editingEntry && fileDocument ? (
        <FileEditorSurface
          key={`${repo.repoId}:${editingTarget.path}`}
          document={fileDocument}
          entry={editingEntry}
          busy={busy}
          externalStateChanged={fileEditorExternalStateChanged}
          lineWrapping={editorLineWrapping}
          wrapColumn={editorWrapColumn}
          initialScrollLine={editingTarget.initialScrollLine}
          headerActions={
            <FileActionMenu
              path={editingEntry.path}
              selectedPaths={[editingEntry.path]}
              open={detailFileMenuOpen}
              disabled={busy}
              editDisabled
              openDisabled={Boolean(operationActionDisabledReason) || unsavedDirty}
              discardDisabled={
                Boolean(operationActionDisabledReason) ||
                unsavedDirty ||
                editingEntry.area !== 'unstaged' ||
                editingEntry.status === 'deleted'
              }
              deleteDisabled={Boolean(operationActionDisabledReason) || unsavedDirty}
              persistentTrigger
              onOpenChange={(open) => {
                setDetailFileMenuOpen(open);
                if (!open) setDetailFileMenuContextPoint(undefined);
              }}
              onTriggerOpen={() => setDetailFileMenuContextPoint(undefined)}
              onAction={(fileAction) => runFileAction([editingEntry], fileAction)}
            />
          }
          onDisplay={completeDisplayExit}
          onSave={saveFile}
          onReload={reloadEditedFile}
          onSaved={handleFileSaved}
          onDirtyChange={setFileEditorDirty}
          onLeaveHandleChange={handleUnsavedLeaveHandleChange}
        />
      ) : effectiveConflict && !multipleFilesSelected ? (
        <main className="pane conflict-pane-span changes-content-pane">
          <ConflictSurface
            key={`${effectiveConflict.repoId}:${effectiveConflict.path}`}
            document={effectiveConflict}
            actions={conflictActions}
            externalStateChanged={conflictMissingFromSnapshot}
            lineWrapping={editorLineWrapping}
            wrapColumn={editorWrapColumn}
            onError={reportRuntimeError}
            onDirtyChange={handleConflictDirtyChange}
            onLeaveHandleChange={handleUnsavedLeaveHandleChange}
            diffStyle={diffStyle}
            onResolved={() => {
              setConflict(undefined);
              handleConflictDirtyChange(false);
            }}
          />
        </main>
      ) : (
        <main
          className={`pane diff-pane changes-content-pane${stickyFileHeaders ? '' : ' has-static-file-headers'}`}
          aria-label={multipleFilesSelected || !selected ? t('diff') : undefined}
          aria-labelledby={!multipleFilesSelected && selected ? 'selected-file-title' : undefined}
        >
          {selected && !multipleFilesSelected
            ? renderDiffFileHeader({
                entry: selected,
                menuOpen: detailFileMenuOpen,
                menuContextPoint: detailFileMenuContextPoint,
                titleId: 'selected-file-title',
                onMenuOpenChange: setDetailFileMenuOpen,
                onMenuContextPointChange: setDetailFileMenuContextPoint,
              })
            : null}
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
          {multipleFilesSelected ? (
            <div className="multi-diff-list">
              {multiDiffs.map((document) => {
                const entry = selectedFileEntries.find(
                  (candidate) =>
                    candidate.path === document.path && candidate.area === document.area,
                ) ?? {
                  path: document.path,
                  area: document.area,
                  status: document.binary ? ('binary' as const) : ('modified' as const),
                };
                const itemKey = `${document.area}:${document.path}`;
                const collapsed = collapsedMultiDiffKeys.has(itemKey);
                const toggle = () => {
                  setCollapsedMultiDiffKeys((current) => {
                    const next = new Set(current);
                    if (next.has(itemKey)) next.delete(itemKey);
                    else next.add(itemKey);
                    return next;
                  });
                };
                const header = renderDiffFileHeader({
                  entry,
                  collapsed,
                  menuOpen: multiDetailFileMenuKey === itemKey,
                  menuContextPoint:
                    multiDetailFileMenuContext?.key === itemKey
                      ? multiDetailFileMenuContext.point
                      : undefined,
                  onToggle: toggle,
                  onMenuOpenChange: (open) => setMultiDetailFileMenuKey(open ? itemKey : undefined),
                  onMenuContextPointChange: (point) =>
                    setMultiDetailFileMenuContext(point ? { key: itemKey, point } : undefined),
                });
                const multiHunkAction = createHunkAction(document, entry, false);
                return document.binary ? (
                  <section
                    key={`${document.area}:${document.path}:${document.diffId}`}
                    className="multi-diff-binary"
                  >
                    {header}
                    {!collapsed ? (
                      <p className="empty-state-small">{t('binaryWholeFileOnly')}</p>
                    ) : null}
                  </section>
                ) : (
                  <section
                    key={`${document.area}:${document.path}:${document.diffId}`}
                    className="multi-diff-item"
                  >
                    {header}
                    {document.truncated && !collapsed ? (
                      <output className="inline-alert warning">{t('diffDisplayLimit')}</output>
                    ) : null}
                    <DiffSurface
                      source={
                        document.tooLarge || patchContainsMultipleFiles(document.patch)
                          ? {
                              kind: 'codeView',
                              patch: document.patch,
                              cacheKey: document.diffId,
                            }
                          : {
                              kind: 'patch',
                              patch: document.patch,
                              path: document.path,
                              cacheKey: document.diffId,
                            }
                      }
                      diffStyle={diffStyle}
                      lineWrapping={editorLineWrapping}
                      wrapColumn={editorWrapColumn}
                      performanceMode={Boolean(document.tooLarge)}
                      collapsed={collapsed}
                      {...(multiHunkAction ? { hunkAction: multiHunkAction } : {})}
                      ariaLabel={t('fileDiffAria', { path: document.path })}
                    />
                  </section>
                );
              })}
            </div>
          ) : null}
          {!multipleFilesSelected && visibleDiff?.binary ? (
            <p className="empty-state-small">{t('binaryWholeFileOnly')}</p>
          ) : null}
          {!multipleFilesSelected && visibleDiff?.truncated ? (
            <output className="inline-alert warning">{t('diffDisplayLimit')}</output>
          ) : null}
          {!multipleFilesSelected && visibleDiff && !visibleDiff.binary ? (
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
              {...(hunkAction ? { hunkAction } : {})}
              diffStyle={diffStyle}
              lineWrapping={editorLineWrapping}
              wrapColumn={editorWrapColumn}
              performanceMode={Boolean(visibleDiff.tooLarge)}
              onSelectionChange={handleSurfaceSelection}
              onSelectionContextMenu={(_surfaceSelection, point, text) =>
                setSelectionMenuContext({ point, text })
              }
              ariaLabel={t('fileDiffAria', { path: visibleDiff.path })}
            />
          ) : null}
          {!multipleFilesSelected && selection ? (
            <RowActionMenu
              triggerLabel={t('selectedLines')}
              triggerTitle={t('selectedLines')}
              menuLabel={t('selectedLines')}
              items={selectionMenuItems}
              open={selectionMenuContext !== undefined}
              disabled={repositoryActionsDisabled}
              contextPoint={selectionMenuContext?.point}
              contextOnly
              onOpenChange={(open) => {
                if (!open) setSelectionMenuContext(undefined);
              }}
              onTriggerOpen={() => undefined}
              onAction={runSelectionAction}
            />
          ) : null}
        </main>
      )}
      {commitDialogOpen ? (
        <Dialog
          labelledBy="commit-dialog-title"
          dismissible={!busy}
          onDismiss={() => {
            if (!busy) setCommitDialogOpen(false);
          }}
          role="dialog"
        >
          <DialogHeader titleId="commit-dialog-title" title={t('commit')} />
          <CommitForm
            key={repo.path}
            draftKey={repo.path}
            disabled={Boolean(disabledCommitReason)}
            disabledReason={disabledCommitReason}
            hideDisabledReason={disabledCommitReason === t('stageChangesToCommit')}
            busy={busy}
            showHeading={false}
            labelledBy="commit-dialog-title"
            useConventionalCommits={useConventionalCommits}
            onCancel={() => setCommitDialogOpen(false)}
            onCommitted={() => setCommitDialogOpen(false)}
            onError={reportRuntimeError}
            onCommit={(input) => onAction({ kind: 'commit', input })}
          />
        </Dialog>
      ) : null}
      {pendingSelectedKey ? (
        <Dialog
          labelledBy="leave-edited-file-title"
          role="alertdialog"
          onDismiss={() => setPendingSelectedKey(undefined)}
        >
          <DialogHeader
            titleId="leave-edited-file-title"
            title={t(fileEditorDirty ? 'unsavedChanges' : 'unsavedResult')}
            description={t('saveOrDiscardBeforeChangingFile')}
          />
          <DialogFooter>
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
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
