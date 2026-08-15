/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通ダイアログのフォーカス履歴を保ったまま非破壊操作をダイアログとして公開する。 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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

import { Button } from '../../ui/Button';
import { isPullDivergenceError, type WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import {
  editorLineForDiffSelection,
  imageDiffCandidates,
  patchContainsMultipleFiles,
} from '../../domain/diffProfile';
import type { UnsavedChangesHandle } from '../../domain/unsavedChanges';
import type {
  ChangeEntry,
  ChangeArea,
  ConflictDocument,
  DiffDocument,
  DiffStyle,
  FileDocument,
  ImageBytesTarget,
  ImageDiffCandidate,
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
import { ImageDiffPreview, ImagePreviewToggle } from '../diff/ImageDiffPreview';
import {
  DEFAULT_EDITOR_WRAP_COLUMN,
  LEFT_PANE_MAX_WIDTH,
  LEFT_PANE_MIN_WIDTH,
  type ChangeListDisplay,
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
import { RemoteOperationDialog } from './RemoteOperationDialog';

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
  changeListDisplay?: ChangeListDisplay | undefined;
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
  splitStageView: boolean,
  t: I18nValue['t'],
  message: I18nValue['message'],
): string | undefined {
  if (repo.operation.kind === 'merge' && repo.changes.some((entry) => entry.area === 'conflicted'))
    return t('resolveConflictsBeforeCommit');
  if (
    !repo.changes.some((entry) =>
      splitStageView ? entry.area === 'staged' : entry.area !== 'conflicted',
    )
  )
    return t(splitStageView ? 'stageChangesToCommit' : 'noChangesToCommit');
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

function imageTarget(
  document: DiffDocument,
  candidate: ImageDiffCandidate,
): ImageBytesTarget | undefined {
  if (document.area === 'conflicted') return undefined;
  return {
    kind: 'changes',
    path: candidate.path,
    ...(candidate.previousPath ? { previousPath: candidate.previousPath } : {}),
    area: document.area,
    generation: document.generation,
    diffId: document.diffId,
  };
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
  changeListDisplay = 'fullPath',
  useConventionalCommits = false,
  stickyFileHeaders = false,
  editorLineWrapping = false,
  editorWrapColumn = DEFAULT_EDITOR_WRAP_COLUMN,
  onPaneWidthsChange,
}: ChangesViewProps) {
  const { t, message, formatNumber } = useI18n();
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
  const [disabledImagePreviewKeys, setDisabledImagePreviewKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [imageProbeResults, setImageProbeResults] = useState<Map<string, boolean>>(() => new Map());
  const [conflict, setConflict] = useState<ConflictDocument>();
  const [selection, setSelection] = useState<LineDiffSelection>();
  const [selectionItemId, setSelectionItemId] = useState<string>();
  const [selectionPatchActionable, setSelectionPatchActionable] = useState(true);
  const [restoredDiffSelection, setRestoredDiffSelection] = useState<SurfaceSelection>();
  const [selectionMenuContext, setSelectionMenuContext] = useState<{
    point: RowActionMenuPoint;
    text: string;
  }>();
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [divergedPull, setDivergedPull] = useState<{
    target: string;
    commitMergeImmediately: boolean;
  }>();
  const [conflictDirty, setConflictDirty] = useState(false);
  const [fileEditorDirty, setFileEditorDirty] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    path: string;
    originalEntry: ChangeEntry;
    initialScrollLine?: number;
    returnSelection?: SurfaceSelection;
  }>();
  const [fileDocument, setFileDocument] = useState<FileDocument>();
  const [fileEditorExternalStateChanged, setFileEditorExternalStateChanged] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [remoteDialog, setRemoteDialog] = useState<'pull' | 'push'>();
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
  const deferredSelectedKey = useDeferredValue(selectedKey);
  const deferredSelectedFromSnapshot = repo.changes.find(
    (entry) => `${entry.area}:${entry.path}` === deferredSelectedKey,
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
  const displayedSelected = pinnedConflictEntry ?? deferredSelectedFromSnapshot ?? repo.changes[0];
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
  const changedFileCount = new Set(repo.changes.map((entry) => entry.path)).size;
  const selectedFileCount = new Set(selectedFileEntries.map((entry) => entry.path)).size;
  const entryTotals = repo.changes.reduce(
    (totals, entry) => ({
      additions: totals.additions + (entry.additions ?? 0),
      deletions: totals.deletions + (entry.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
  const changeTotals = {
    additions: repo.additions ?? entryTotals.additions,
    deletions: repo.deletions ?? entryTotals.deletions,
  };
  const unsavedDirty = conflictDirty || fileEditorDirty;
  const selectedFileKeysSignature = selectedFileKeys.join('\0');
  const selectedArea = displayedSelected?.area;
  const selectedPath = displayedSelected?.path;
  const selectedPreviousPath = displayedSelected?.previousPath;
  const visibleDiff =
    diff && diff.path === selectedPath && diff.area === selectedArea ? diff : undefined;
  const visibleImageCandidate = useMemo(
    () =>
      visibleDiff
        ? imageDiffCandidates(visibleDiff.patch, visibleDiff.diffId).find(
            (candidate) => candidate.path === visibleDiff.path,
          )
        : undefined,
    [visibleDiff],
  );
  const selectedSurfaceSelection: SurfaceSelection | undefined = selection
    ? {
        ...(selectionItemId ? { itemId: selectionItemId } : {}),
        side: selection.side,
        startLine: selection.startLine,
        endLine: selection.endLine,
        patchActionable: selectionPatchActionable,
      }
    : undefined;
  const effectiveConflict =
    conflict && selectedArea === 'conflicted' && conflict.path === selectedPath
      ? conflict
      : undefined;
  const disabledCommitReason = commitDisabledReason(repo, splitStageView, t, message);
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
    visibleDiff && displayedSelected && supportsPartialDiffActions(visibleDiff, displayedSelected),
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
    setDisabledImagePreviewKeys(new Set());
    setImageProbeResults(new Map());
    setMultiDetailFileMenuKey(undefined);
    setMultiDetailFileMenuContext(undefined);
  }, [repo.repoId, selectedFileKeysSignature]);

  const setImagePreviewEnabled = (key: string, enabled: boolean): void => {
    setDisabledImagePreviewKeys((current) => {
      const next = new Set(current);
      if (enabled) next.delete(key);
      else next.add(key);
      return next;
    });
    if (enabled) {
      setSelection(undefined);
      setSelectionMenuContext(undefined);
    }
  };

  const setImageProbeResult = (key: string, previewable: boolean): void => {
    setImageProbeResults((current) => {
      if (current.get(key) === previewable) return current;
      const next = new Map(current);
      next.set(key, previewable);
      return next;
    });
  };

  const visibleImageKey = visibleDiff ? `${visibleDiff.area}:${visibleDiff.path}` : '';
  const visibleImageProbeKey = visibleDiff ? `${visibleImageKey}:${visibleDiff.diffId}` : '';
  const visibleImageTarget =
    visibleDiff && visibleImageCandidate
      ? imageTarget(visibleDiff, visibleImageCandidate)
      : undefined;
  const visibleImageProbeResult = imageProbeResults.get(visibleImageProbeKey);
  const visibleImageProbePending = Boolean(
    visibleImageTarget &&
    visibleImageCandidate?.format === 'probe' &&
    visibleImageProbeResult === undefined,
  );
  const visibleImageAvailable = Boolean(
    visibleImageTarget &&
    visibleImageCandidate &&
    (visibleImageCandidate.format !== 'probe' || visibleImageProbeResult === true),
  );
  const visibleImagePreviewEnabled =
    visibleImageAvailable && !disabledImagePreviewKeys.has(visibleImageKey);

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
            ...(selectedPreviousPath ? { previousPath: selectedPreviousPath } : {}),
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
    selectedPreviousPath,
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
          ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
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
        // 通常の問い合わせ処理でエラーを報告するため、バックグラウンド更新では通知しない。
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
    setDivergedPull(undefined);
  }, [repo.branch.name, repo.branch.upstream]);

  useEffect(() => {
    setFileActionNotice(undefined);
    setRestoredDiffSelection(undefined);
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
    setRestoredDiffSelection(undefined);
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
    setRestoredDiffSelection(undefined);
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
    setRestoredDiffSelection(undefined);
    setSelectedFileKeys(keys);
  };

  const saveAndSelectFile = async (): Promise<void> => {
    if (!pendingSelectedKey) return;
    const saved = await unsavedLeaveHandleRef.current?.save();
    if (saved) completeFileSelection(pendingSelectedKey);
  };

  const completeDisplayExit = (): void => {
    setFileEditorDirty(false);
    setRestoredDiffSelection(editingTarget?.returnSelection);
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
      setSelectionItemId(undefined);
      setSelectionPatchActionable(true);
      setRestoredDiffSelection(undefined);
      return;
    }
    setSelectionItemId(surfaceSelection.itemId);
    setSelectionPatchActionable(surfaceSelection.patchActionable);
    if (
      restoredDiffSelection &&
      (restoredDiffSelection.itemId !== surfaceSelection.itemId ||
        restoredDiffSelection.side !== surfaceSelection.side ||
        restoredDiffSelection.startLine !== surfaceSelection.startLine ||
        restoredDiffSelection.endLine !== surfaceSelection.endLine)
    ) {
      setRestoredDiffSelection(undefined);
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

  const copySelectedLines = async (text: string): Promise<void> => {
    setFileActionNotice(undefined);
    try {
      await navigator.clipboard.writeText(text);
      setFileActionNotice({ level: 'info', message: { id: 'copiedSelectedLines' } });
    } catch (cause) {
      if (onError) {
        reportRuntimeError(t('copySelectedLinesFailedTitle'), cause, t('copySelectedLinesFailed'));
      } else {
        setFileActionNotice({ level: 'error', message: { id: 'copySelectedLinesFailed' } });
      }
    }
  };

  const runSelectionAction = async (kind: SelectionActionKind): Promise<void> => {
    if (kind === 'editLines') {
      if (displayedSelected && selectedSurfaceSelection)
        startEditing(
          displayedSelected,
          selectedSurfaceSelection.startLine,
          selectedSurfaceSelection,
        );
      return;
    }
    if (kind === 'copySelection') {
      if (!selectionMenuContext) return;
      await copySelectedLines(selectionMenuContext.text);
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

  const hunkAction = createHunkAction(visibleDiff, displayedSelected, true);

  const copySelectionMenuItem: RowActionMenuItem<SelectionActionKind> = {
    action: 'copySelection',
    label: t('actionCopySelectedLines'),
    icon: <Copy aria-hidden="true" focusable="false" size={15} />,
  };
  const editLinesMenuItem: RowActionMenuItem<SelectionActionKind> = {
    action: 'editLines',
    label: t('actionEditLines'),
    icon: <Pencil aria-hidden="true" focusable="false" size={15} />,
    disabled: busy || unsavedDirty || displayedSelected?.status === 'deleted',
  };
  const discardSelectionMenuItem: RowActionMenuItem<SelectionActionKind> = {
    action: 'discardSelection',
    label: t('actionDiscardSelectedLines'),
    icon: <Trash2 aria-hidden="true" focusable="false" size={15} />,
    disabled: repositoryActionsDisabled || displayedSelected?.area === 'untracked',
    danger: true,
    separatorBefore: true,
  };
  const selectionMenuItems: RowActionMenuItem<SelectionActionKind>[] = !selectionPatchActionable
    ? [editLinesMenuItem, copySelectionMenuItem]
    : !splitStageView
      ? displayedSelected?.area === 'staged'
        ? [editLinesMenuItem, copySelectionMenuItem]
        : [editLinesMenuItem, copySelectionMenuItem, discardSelectionMenuItem]
      : displayedSelected?.area === 'staged'
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

  const startEditing = (
    entry: ChangeEntry,
    initialScrollLine?: number,
    returnSelection?: SurfaceSelection,
  ): void => {
    if (entry.area === 'conflicted' || entry.status === 'deleted' || entry.status === 'binary') {
      setFileActionNotice({ level: 'error', message: { id: 'fileEditUnsupported' } });
      return;
    }
    const editorLine =
      returnSelection && visibleDiff
        ? editorLineForDiffSelection(visibleDiff.patch, visibleDiff.diffId, returnSelection)
        : initialScrollLine;
    setEditingTarget({
      path: entry.path,
      originalEntry: entry,
      ...(editorLine ? { initialScrollLine: editorLine } : {}),
      ...(returnSelection ? { returnSelection } : {}),
    });
    setFileDocument(undefined);
    setFileEditorDirty(false);
    setFileEditorExternalStateChanged(false);
    setRestoredDiffSelection(undefined);
    setSelection(undefined);
    setSelectionItemId(undefined);
    setSelectionPatchActionable(true);
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

  const pull = async (
    remote: string,
    remoteBranch: string,
    commitMergeImmediately: boolean,
  ): Promise<void> => {
    setDivergedPull(undefined);
    try {
      await onAction({ kind: 'pull', remote, remoteBranch });
    } catch (cause) {
      if (isPullDivergenceError(cause)) {
        setDivergedPull({ target: `${remote}/${remoteBranch}`, commitMergeImmediately });
        return;
      }
      throw cause;
    }
  };

  const resolveDivergedPull = async (kind: 'merge' | 'rebase'): Promise<void> => {
    await onAction(
      kind === 'merge'
        ? {
            kind: 'merge',
            sourceRef: 'FETCH_HEAD',
            commitImmediately: divergedPull?.commitMergeImmediately ?? true,
          }
        : { kind: 'rebase', ontoRef: 'FETCH_HEAD' },
    );
    setDivergedPull(undefined);
  };

  const repositoryActions = (
    <fieldset className="changes-action-bar" aria-label={t('actions')}>
      <Button
        type="button"
        variant="quiet"
        className="changes-action-button"
        aria-label={t('commit')}
        aria-haspopup="dialog"
        aria-expanded={commitDialogOpen}
        tooltip={t('commit')}
        disabled={busy || unsavedDirty}
        onClick={() => setCommitDialogOpen(true)}
      >
        <GitCommitHorizontal aria-hidden="true" focusable="false" size={14} />
      </Button>
      <Button
        type="button"
        variant="quiet"
        className="changes-action-button"
        aria-label={t('pull')}
        aria-haspopup="dialog"
        aria-expanded={remoteDialog === 'pull'}
        tooltip={t('pull')}
        disabled={repositoryActionsDisabled || repo.branch.detached}
        aria-describedby={
          operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
        }
        onClick={() => setRemoteDialog('pull')}
      >
        <Download aria-hidden="true" focusable="false" size={14} />
      </Button>
      <Button
        type="button"
        variant="quiet"
        className="changes-action-button"
        aria-label={t('push')}
        aria-haspopup="dialog"
        aria-expanded={remoteDialog === 'push'}
        tooltip={t('push')}
        disabled={repositoryActionsDisabled || repo.branch.detached}
        aria-describedby={
          operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
        }
        onClick={() => setRemoteDialog('push')}
      >
        <Upload aria-hidden="true" focusable="false" size={14} />
      </Button>
      <Button
        type="button"
        variant="quiet"
        className="changes-action-button"
        aria-label={t('fetch')}
        tooltip={t('fetch')}
        disabled={repositoryActionsDisabled}
        aria-describedby={
          operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
        }
        onClick={() => settleAction(onAction({ kind: 'fetch' }))}
      >
        <RefreshCw aria-hidden="true" focusable="false" size={14} />
      </Button>
    </fieldset>
  );
  const pullResolution = divergedPull ? (
    <section
      className="inline-alert warning pull-resolution"
      aria-labelledby="pull-resolution-title"
    >
      <div>
        <strong id="pull-resolution-title">{t('fastForwardUnavailable')}</strong>
        <p>{t('fetchCompleteResolve', { target: divergedPull.target })}</p>
      </div>
      <div className="button-row">
        <Button
          type="button"
          disabled={repositoryActionsDisabled}
          aria-describedby={
            operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
          }
          onClick={() => settleAction(resolveDivergedPull('merge'))}
        >
          {t('merge')}
        </Button>
        <Button
          type="button"
          disabled={repositoryActionsDisabled}
          aria-describedby={
            operationActionDisabledReason ? 'changes-operation-action-reason' : undefined
          }
          onClick={() => settleAction(resolveDivergedPull('rebase'))}
        >
          {t('rebase')}
        </Button>
      </div>
    </section>
  ) : null;

  const renderDiffFileHeader = ({
    entry,
    collapsed,
    menuOpen,
    menuContextPoint,
    titleId,
    binary = false,
    imagePreview,
    onToggle,
    onMenuOpenChange,
    onMenuContextPointChange,
  }: {
    entry: ChangeEntry;
    collapsed?: boolean;
    menuOpen: boolean;
    menuContextPoint: FileActionMenuPoint | undefined;
    titleId?: string;
    binary?: boolean;
    imagePreview?: { pressed: boolean; onPressedChange: (pressed: boolean) => void } | undefined;
    onToggle?: () => void;
    onMenuOpenChange: (open: boolean) => void;
    onMenuContextPointChange: (point: FileActionMenuPoint | undefined) => void;
  }) => {
    const fileActionInvalid =
      binary ||
      entry.area === 'conflicted' ||
      entry.status === 'deleted' ||
      entry.status === 'binary';
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
            <Button
              type="button"
              className="selected-file-toggle"
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', {
                path: entry.path,
              })}
              tooltip={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', {
                path: entry.path,
              })}
              onClick={onToggle}
            >
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </Button>
          ) : null}
          <FileStatusIcon status={entry.status} />
          <h2 {...(titleId ? { id: titleId } : {})} aria-label={entry.path}>
            {entry.path}
          </h2>
        </div>
        <div className="diff-file-actions">
          {imagePreview ? (
            <ImagePreviewToggle
              pressed={imagePreview.pressed}
              onPressedChange={imagePreview.onPressedChange}
            />
          ) : null}
          <FileViewModeTabs
            mode="display"
            editDisabled={busy || unsavedDirty || fileActionInvalid}
            onDisplay={() => undefined}
            onEdit={() =>
              startEditing(entry, selectedSurfaceSelection?.startLine, selectedSurfaceSelection)
            }
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
            imagePreview={imagePreview}
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
    '--left-pane': `${Math.max(LEFT_PANE_MIN_WIDTH, paneWidths.left)}px`,
    '--right-pane': `${paneWidths.right}px`,
  };

  return (
    <>
      <div className="three-pane changes-view changes-two-pane" style={paneStyle}>
        <aside className="pane changes-list-pane changes-sidebar-pane" aria-label={t('changes')}>
          {pullResolution}
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
              display={changeListDisplay}
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
              imagePreview={
                !multipleFilesSelected && visibleImageAvailable
                  ? {
                      key: visibleImageKey,
                      pressed: visibleImagePreviewEnabled,
                      onPressedChange: (pressed) =>
                        setImagePreviewEnabled(visibleImageKey, pressed),
                    }
                  : undefined
              }
              onSelect={requestFileSelection}
              onSelectedKeysChange={requestSelectedFiles}
              onStageTransition={runStageTransition}
              onFileAction={runFileAction}
            />
          </section>
          <footer className="changes-list-footer">
            <div className="changes-list-summary" aria-live="polite">
              {multipleFilesSelected ? (
                t('selectedFilesSummary', { count: selectedFileCount })
              ) : (
                <>
                  <span>{t('uncommittedFileCount', { count: changedFileCount })}</span>
                  <span className="additions">+{formatNumber(changeTotals.additions)}</span>
                  <span className="deletions">−{formatNumber(changeTotals.deletions)}</span>
                </>
              )}
            </div>
            {repositoryActions}
          </footer>
        </aside>
        <PaneResizer
          label={t('changesListWidth')}
          value={Math.max(LEFT_PANE_MIN_WIDTH, paneWidths.left)}
          direction="growRight"
          min={LEFT_PANE_MIN_WIDTH}
          max={LEFT_PANE_MAX_WIDTH}
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
            aria-label={multipleFilesSelected || !displayedSelected ? t('diff') : undefined}
            aria-labelledby={
              !multipleFilesSelected && displayedSelected ? 'selected-file-title' : undefined
            }
          >
            {displayedSelected && !multipleFilesSelected
              ? renderDiffFileHeader({
                  entry: displayedSelected,
                  binary: Boolean(visibleDiff?.binary),
                  ...(visibleImageAvailable
                    ? {
                        imagePreview: {
                          pressed: visibleImagePreviewEnabled,
                          onPressedChange: (pressed: boolean) =>
                            setImagePreviewEnabled(visibleImageKey, pressed),
                        },
                      }
                    : {}),
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
                  const imageKey = itemKey;
                  const imageProbeKey = `${itemKey}:${document.diffId}`;
                  const imageCandidate = imageDiffCandidates(document.patch, document.diffId).find(
                    (candidate) => candidate.path === document.path,
                  );
                  const target = imageCandidate ? imageTarget(document, imageCandidate) : undefined;
                  const imageProbeResult = imageProbeResults.get(imageProbeKey);
                  const imageProbePending = Boolean(
                    target && imageCandidate?.format === 'probe' && imageProbeResult === undefined,
                  );
                  const imageAvailable = Boolean(
                    target &&
                    imageCandidate &&
                    (imageCandidate.format !== 'probe' || imageProbeResult === true),
                  );
                  const imagePreviewEnabled =
                    imageAvailable && !disabledImagePreviewKeys.has(imageKey);
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
                    binary: Boolean(document.binary),
                    ...(imageAvailable
                      ? {
                          imagePreview: {
                            pressed: imagePreviewEnabled,
                            onPressedChange: (pressed: boolean) =>
                              setImagePreviewEnabled(imageKey, pressed),
                          },
                        }
                      : {}),
                    collapsed,
                    menuOpen: multiDetailFileMenuKey === itemKey,
                    menuContextPoint:
                      multiDetailFileMenuContext?.key === itemKey
                        ? multiDetailFileMenuContext.point
                        : undefined,
                    onToggle: toggle,
                    onMenuOpenChange: (open) =>
                      setMultiDetailFileMenuKey(open ? itemKey : undefined),
                    onMenuContextPointChange: (point) =>
                      setMultiDetailFileMenuContext(point ? { key: itemKey, point } : undefined),
                  });
                  const multiHunkAction = createHunkAction(document, entry, false);
                  return (
                    <section
                      key={`${document.area}:${document.path}:${document.diffId}`}
                      className={document.binary ? 'multi-diff-binary' : 'multi-diff-item'}
                    >
                      {header}
                      {document.truncated && !collapsed ? (
                        <output className="inline-alert warning">{t('diffDisplayLimit')}</output>
                      ) : null}
                      {!collapsed &&
                      target &&
                      imageCandidate &&
                      (imagePreviewEnabled || imageProbePending) ? (
                        <ImageDiffPreview
                          adapter={adapter}
                          repoId={repo.repoId}
                          target={target}
                          candidate={imageCandidate}
                          hidden={imageProbePending}
                          {...(imageCandidate.format === 'probe'
                            ? {
                                onProbeResult: (previewable: boolean) =>
                                  setImageProbeResult(imageProbeKey, previewable),
                              }
                            : {})}
                        />
                      ) : null}
                      {document.binary ? (
                        !imagePreviewEnabled && !collapsed ? (
                          <p className="empty-state-small">{t('binaryWholeFileOnly')}</p>
                        ) : null
                      ) : !imagePreviewEnabled ? (
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
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : null}
            {!multipleFilesSelected &&
            visibleImageTarget &&
            visibleImageCandidate &&
            (visibleImagePreviewEnabled || visibleImageProbePending) ? (
              <ImageDiffPreview
                adapter={adapter}
                repoId={repo.repoId}
                target={visibleImageTarget}
                candidate={visibleImageCandidate}
                hidden={visibleImageProbePending}
                {...(visibleImageCandidate.format === 'probe'
                  ? {
                      onProbeResult: (previewable: boolean) =>
                        setImageProbeResult(visibleImageProbeKey, previewable),
                    }
                  : {})}
              />
            ) : null}
            {!multipleFilesSelected && visibleDiff?.binary && !visibleImagePreviewEnabled ? (
              <p className="empty-state-small">{t('binaryWholeFileOnly')}</p>
            ) : null}
            {!multipleFilesSelected && visibleDiff?.truncated ? (
              <output className="inline-alert warning">{t('diffDisplayLimit')}</output>
            ) : null}
            {!multipleFilesSelected &&
            visibleDiff &&
            !visibleDiff.binary &&
            !visibleImagePreviewEnabled ? (
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
                initialSelection={restoredDiffSelection}
                onSelectionChange={handleSurfaceSelection}
                onSelectionContextMenu={(_surfaceSelection, point, text) =>
                  setSelectionMenuContext({ point, text })
                }
                onSelectionCopy={(text) => void copySelectedLines(text)}
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
              onCommit={(input) =>
                onAction({ kind: 'commit', input, includeAllChanges: !splitStageView })
              }
            />
          </Dialog>
        ) : null}
        {remoteDialog ? (
          <RemoteOperationDialog
            key={`${repo.repoId}:${remoteDialog}`}
            kind={remoteDialog}
            repo={repo}
            adapter={adapter}
            busy={busy}
            onDismiss={() => setRemoteDialog(undefined)}
            onRefreshBranches={(remote) => onAction({ kind: 'fetch', remote })}
            onPull={pull}
            onPush={onAction}
          />
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
              <Button
                type="button"
                data-dialog-initial-focus
                onClick={() => setPendingSelectedKey(undefined)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="dangerQuiet"
                onClick={() => completeFileSelection(pendingSelectedKey)}
              >
                {t('leaveWithoutSaving')}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => settleAction(saveAndSelectFile())}
              >
                {t('saveAndLeave')}
              </Button>
            </DialogFooter>
          </Dialog>
        ) : null}
      </div>
    </>
  );
}
