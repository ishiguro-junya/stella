import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ChartNoAxesCombined,
  ChevronDown,
  FileDiff,
  FolderGit2,
  GitBranch,
  History as HistoryIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from 'lucide-react';
import { documentDir } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { LoadingIndicator } from './ui/LoadingIndicator';
import { pickDirectory, type DirectoryPicker } from './ui/directoryPicker';
import {
  isPullDivergenceError,
  WorkspaceAdapterError,
  type WorkspaceAdapter,
} from './adapters/workspaceAdapter';
import { createTauriWorkspaceAdapter } from './adapters/tauriWorkspaceAdapter';
import {
  createTauriToolchainAdapter,
  type ToolchainAdapter,
  type ToolchainMode,
  type ToolchainStatus,
} from './adapters/toolchainAdapter';
import type {
  ActionPreview,
  ActionRequest,
  ActivityEntry,
  AttachRequest,
  BranchSummary,
  ConflictDocument,
  DiffStyle,
  RemoteDefinition,
  RepositoryAvailability,
  RepoSnapshot,
  WorkspaceAction,
  WorkspaceEvent,
  WorkspaceSnapshot,
  WorkspaceView,
} from './domain/workspace';
import { selectedRepo } from './domain/workspace';
import {
  isAbsoluteLocalPath,
  joinRepositoryPath,
  repositoryNameFromPath,
  repositoryNameFromRemoteUrl,
  isRepositoryDirectoryName,
} from './domain/repositoryLocation';
import { DiffView } from './features/diff/DiffView';
import type { UnsavedChangesHandle, UnsavedRelocationDraft } from './domain/unsavedChanges';
import { mergeActivityEntries } from './features/activity/activityPersistence';
import { HistoryView } from './features/history/HistoryView';
import { SettingsView } from './features/settings/SettingsView';
import { listenForOpenSettings } from './features/settings/settingsMenu';
import { openFilesAndFoldersSystemSettings } from './features/settings/systemSettings';
import {
  checkForAppUpdate,
  installAppUpdate,
  listenForCheckAppUpdates,
  type AppUpdateInfo,
} from './features/update/appUpdate';
import { AddRepositoryDialog } from './features/repositories/AddRepositoryDialog';
import type { RepositoryListItem } from './features/repositories/RepositoryLogo';
import { RepositoryLanding } from './features/repositories/RepositoryLanding';
import {
  loadRepositoryLogo,
  type RepositoryLogoLoader,
} from './features/repositories/repositoryLogoLoader';
import {
  applyDocumentLanguage,
  I18nProvider,
  translate,
  useI18n,
  type I18nValue,
  type Language,
  type LocalizedMessage,
} from './i18n/i18n';
import { applyNativeLanguage } from './i18n/nativeLanguage';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/Dialog';
import { BranchSwitcherDialog } from './ui/BranchSwitcherDialog';
import { RepositorySwitcherDialog } from './ui/RepositorySwitcherDialog';
import {
  RemoteManagerDialog,
  type RemoteAddition,
  type RemoteUrlChange,
  type RepositoryInformationChange,
} from './ui/RemoteManagerDialog';
import {
  markWorkspaceErrorHandled,
  WorkspaceErrorDialog,
  type ShowWorkspaceError,
} from './ui/WorkspaceErrorDialog';
import { describeWorkspaceError, type WorkspaceErrorContent } from './ui/WorkspaceErrorDetails';
import {
  DEFAULT_PREFERENCES,
  clearRemoteHealthIssue,
  forgetRepositoryPath,
  readPreferences,
  recordRemoteHealthIssue,
  rememberRepositoryPath,
  replaceRepositoryPath,
  updatePreferences,
  type DiffFileListDisplay,
  type PaneWidthPreferences,
} from './persistence/preferences';
import {
  AppearanceProvider,
  applyAppearance,
  applyNativeAppearance,
  type Appearance,
} from './theme/appearance';
import { applyTypography, type CodeFont, type FontSize, type UiFont } from './theme/typography';

const EMPTY_WORKSPACE: WorkspaceSnapshot = { repos: [], activities: [] };
const APP_UPDATE_INTERVAL_MS = 60 * 60 * 1_000;
const STARTUP_RESTORE_TIMEOUT_MS = 10_000;
const ActivityView = lazy(async () => {
  const module = await import('./features/activity/ActivityView');
  return { default: module.ActivityView };
});

export interface AppProps {
  adapter?: WorkspaceAdapter;
  directoryPicker?: DirectoryPicker;
  repositoryLogoLoader?: RepositoryLogoLoader;
  toolchainAdapter?: ToolchainAdapter;
}

interface PendingAction {
  request: ActionRequest;
  preview: ActionPreview;
}

interface PendingNavigation {
  repoId?: string;
  view?: WorkspaceView;
  page?: AppPage;
  cloneRequest?: Extract<AttachRequest, { kind: 'clone' }>;
  repositoryName?: string;
}

interface PendingClone {
  request: Extract<AttachRequest, { kind: 'clone' }>;
  repositoryName?: string;
}

type AppPage = 'workspace' | 'repositories' | 'activity' | 'settings';

type GuardedOperationAction = Extract<
  WorkspaceAction,
  { kind: 'continueOperation' | 'skipOperation' | 'abortOperation' }
>;

interface AppNotice {
  level: 'info' | 'warning';
  message: LocalizedMessage;
}

interface AppError extends WorkspaceErrorContent {
  id: number;
  title: string;
}

interface AddRepositoryState {
  source: 'url' | 'path';
  url: string;
  cloneParentPath: string;
  localPath: string;
  remoteName: string;
  localName: string;
  error?: string;
  errorField?: 'url' | 'path' | 'name';
}

interface BranchDialogState {
  requestId: number;
  repoId: string;
  branches: BranchSummary[];
  loading: boolean;
  error?: string;
}

interface RemoteManagerState {
  path: string;
  repoId: string;
  remotes: RemoteDefinition[];
  loading: boolean;
  error?: string;
}

interface RelocationState {
  oldPath: string;
  newPath: string;
  duplicate: boolean;
  repositoryName?: string;
  remoteUrlChanges?: readonly RemoteUrlChange[];
  remoteAddition?: RemoteAddition;
}

type WorkspaceViewTransitionStyle = CSSProperties & { '--left-pane': string };
type AppShellStyle = CSSProperties & { '--shell-left-pane': string };

function actionNeedsPreview(action: WorkspaceAction): boolean {
  if (action.kind === 'setRemoteUrl' || action.kind === 'addRemote') return true;
  if (action.kind === 'fileAction') return action.operation === 'moveToTrash';
  if (action.kind === 'gitFlow') {
    return [
      'delete',
      'finish',
      'integrate',
      'configRenameBase',
      'configRenameTopic',
      'configDeleteBase',
      'configDeleteTopic',
      'abort',
    ].includes(action.request.command);
  }
  return [
    'discardFiles',
    'discardSelection',
    'reset',
    'merge',
    'rebase',
    'cherryPick',
    'revert',
    'createBranch',
    'deleteBranch',
    'createTag',
    'abortOperation',
    'materializeConflict',
  ].includes(action.kind);
}

function confirmationActionLabel(action: WorkspaceAction, t: I18nValue['t']): string {
  if (action.kind === 'setRemoteUrl') return t('changeRemoteUrlAction');
  if (action.kind === 'addRemote') return t('add');
  if (action.kind === 'fileAction' && action.operation === 'moveToTrash') return t('delete');
  if (action.kind === 'discardFiles') return t('discard');
  if (action.kind === 'createBranch' || action.kind === 'createTag') return t('create');
  if (action.kind === 'deleteBranch') return t('delete');
  return t('run');
}

function actionRemote(action: WorkspaceAction, repo: RepoSnapshot): string | undefined {
  if (action.kind === 'fetch')
    return action.remote ?? repo.branch.upstream?.split('/')[0] ?? 'origin';
  if (action.kind === 'pull' || action.kind === 'push') return action.remote;
  return undefined;
}

function remoteHealthReason(
  cause: unknown,
): 'unavailable' | 'authentication' | 'network' | undefined {
  if (!(cause instanceof WorkspaceAdapterError)) return undefined;
  if (cause.code === 'remoteUnavailable') return 'unavailable';
  if (cause.code === 'authenticationFailed') return 'authentication';
  if (cause.code === 'networkFailed') return 'network';
  return undefined;
}

function repositoryState(
  repo: RepoSnapshot,
  message: I18nValue['message'],
): { label: string; tone: 'danger' } | undefined {
  if (repo.operation.kind !== 'none')
    return { label: message(repo.operation.label), tone: 'danger' };
  return undefined;
}

function replaceRepo(workspace: WorkspaceSnapshot, repo: RepoSnapshot): WorkspaceSnapshot {
  const current = workspace.repos.find((candidate) => candidate.repoId === repo.repoId);
  const stale =
    current &&
    (repo.generation < current.generation ||
      (repo.generation === current.generation && repo.eventSeq < current.eventSeq));
  if (stale) return workspace;
  return {
    ...workspace,
    repos: current
      ? workspace.repos.map((candidate) => (candidate.repoId === repo.repoId ? repo : candidate))
      : [...workspace.repos, repo],
    selectedRepoId: workspace.selectedRepoId ?? repo.repoId,
  };
}

function selectWorkspaceRepo(
  workspace: WorkspaceSnapshot,
  repoId: string | undefined,
): WorkspaceSnapshot {
  const selected = repoId
    ? workspace.repos.find((candidate) => candidate.repoId === repoId)
    : undefined;
  const next: WorkspaceSnapshot = {
    repos: selected
      ? [selected, ...workspace.repos.filter((candidate) => candidate.repoId !== repoId)]
      : workspace.repos,
    activities: workspace.activities,
  };
  if (repoId) next.selectedRepoId = repoId;
  return next;
}

function reduceEvent(workspace: WorkspaceSnapshot, event: WorkspaceEvent): WorkspaceSnapshot {
  switch (event.kind) {
    case 'snapshotChanged':
      return replaceRepo(workspace, event.snapshot);
    case 'activityChanged': {
      const current = workspace.activities.find((activity) => activity.id === event.activity.id);
      if (
        current?.eventSeq !== undefined &&
        event.activity.eventSeq !== undefined &&
        event.activity.eventSeq < current.eventSeq
      )
        return workspace;
      return {
        ...workspace,
        activities: current
          ? workspace.activities.map((activity) =>
              activity.id === event.activity.id ? event.activity : activity,
            )
          : [event.activity, ...workspace.activities],
      };
    }
    case 'repositoryRemoved': {
      const repos = workspace.repos.filter((repo) => repo.repoId !== event.repoId);
      return selectWorkspaceRepo(
        {
          ...workspace,
          repos,
        },
        workspace.selectedRepoId === event.repoId ? repos[0]?.repoId : workspace.selectedRepoId,
      );
    }
    case 'conflictChanged':
    case 'notice':
      return workspace;
  }
  throw new Error('Unknown workspace event');
}

function settleUiAction(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function focusRepositoryList(): void {
  (
    document.querySelector<HTMLElement>(
      '.registered-repositories .switcher-option[aria-selected="true"]',
    ) ??
    document.querySelector<HTMLElement>('.registered-repositories .switcher-option') ??
    document.getElementById('repositories-title')
  )?.focus();
}

function focusSettingsCategory(): void {
  document.querySelector<HTMLElement>('.settings-category-button[aria-current="page"]')?.focus();
}

export function App({
  adapter: providedAdapter,
  directoryPicker = pickDirectory,
  repositoryLogoLoader,
  toolchainAdapter: providedToolchainAdapter,
}: AppProps) {
  const defaultAdapterRef = useRef<WorkspaceAdapter | undefined>(undefined);
  const defaultToolchainAdapterRef = useRef<ToolchainAdapter | undefined>(undefined);
  if (!providedAdapter && !defaultAdapterRef.current) {
    defaultAdapterRef.current = createTauriWorkspaceAdapter();
  }
  if (!providedToolchainAdapter && !providedAdapter && !defaultToolchainAdapterRef.current) {
    defaultToolchainAdapterRef.current = createTauriToolchainAdapter();
  }
  const adapter = providedAdapter ?? defaultAdapterRef.current;
  if (!adapter) throw new Error('Could not initialize the workspace adapter.');
  const toolchainAdapter = providedToolchainAdapter ?? defaultToolchainAdapterRef.current;
  const initialPreferences = useMemo(readPreferences, []);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [view, setView] = useState<WorkspaceView>('diff');
  const [appearance, setAppearance] = useState<Appearance>(initialPreferences.appearance);
  const [language, setLanguage] = useState<Language>(initialPreferences.language);
  const [fontSize, setFontSize] = useState<FontSize>(initialPreferences.fontSize);
  const [uiFont, setUiFont] = useState<UiFont>(initialPreferences.uiFont);
  const [codeFont, setCodeFont] = useState<CodeFont>(initialPreferences.codeFont);
  const [automaticUpdateChecks, setAutomaticUpdateChecks] = useState(
    initialPreferences.automaticUpdateChecks,
  );
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(initialPreferences.diffStyle);
  const [imagePreviewLayout, setImagePreviewLayout] = useState<DiffStyle>(
    initialPreferences.imagePreviewLayout,
  );
  const [splitStageView, setSplitStageView] = useState(initialPreferences.splitStageView);
  const [diffFileListDisplay, setDiffFileListDisplay] = useState<DiffFileListDisplay>(
    initialPreferences.diffFileListDisplay,
  );
  const [useConventionalCommits, setUseConventionalCommits] = useState(
    initialPreferences.useConventionalCommits,
  );
  const [stickyFileHeaders, setStickyFileHeaders] = useState(initialPreferences.stickyFileHeaders);
  const [editorLineWrapping, setEditorLineWrapping] = useState(
    initialPreferences.editorLineWrapping,
  );
  const [editorWrapColumn, setEditorWrapColumn] = useState(initialPreferences.editorWrapColumn);
  const [repositoryBasePath, setRepositoryBasePath] = useState(
    initialPreferences.repositoryBasePath ?? '',
  );
  const [toolchainStatus, setToolchainStatus] = useState<ToolchainStatus>();
  const [toolchainBusy, setToolchainBusy] = useState(false);
  const t = useCallback<I18nValue['t']>((id, args) => translate(language, id, args), [language]);
  const message = useCallback<I18nValue['message']>(
    (value) => translate(language, value.id, value.args),
    [language],
  );
  const [page, setPage] = useState<AppPage>('workspace');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0);
  const [activityFocusRequest, setActivityFocusRequest] = useState(0);
  const [activityReady, setActivityReady] = useState(false);
  const [cloneToStart, setCloneToStart] = useState<PendingClone>();
  const [paneWidths, setPaneWidths] = useState<PaneWidthPreferences>(initialPreferences.paneWidths);
  const [registeredPaths, setRegisteredPaths] = useState(initialPreferences.registeredRepoPaths);
  const [repositoryNames, setRepositoryNames] = useState(initialPreferences.repositoryNames);
  const [repositoryHealthIssues, setRepositoryHealthIssues] = useState(
    initialPreferences.repositoryHealthIssues,
  );
  const [repositoryAvailability, setRepositoryAvailability] = useState<
    Record<string, RepositoryAvailability>
  >({});
  const [repositoryLogoUrls, setRepositoryLogoUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AppNotice>();
  const [errors, setErrors] = useState<AppError[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [latestConflict, setLatestConflict] = useState<ConflictDocument>();
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>();
  const [pendingOperationAction, setPendingOperationAction] = useState<GuardedOperationAction>();
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<WorkspaceAction>();
  const [pendingWindowClose, setPendingWindowClose] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo>();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [pendingUpdateInstall, setPendingUpdateInstall] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [workspaceViewRevision, setWorkspaceViewRevision] = useState(0);
  const [workspaceViewTransition, setWorkspaceViewTransition] = useState<WorkspaceView | undefined>(
    () =>
      initialPreferences.lastSelectedRepoPath &&
      initialPreferences.registeredRepoPaths.includes(initialPreferences.lastSelectedRepoPath)
        ? 'history'
        : undefined,
  );
  const [addRepositoryDialog, setAddRepositoryDialog] = useState<AddRepositoryState>();
  const [repositorySwitcherOpen, setRepositorySwitcherOpen] = useState(false);
  const [branchDialog, setBranchDialog] = useState<BranchDialogState>();
  const [remoteManager, setRemoteManager] = useState<RemoteManagerState>();
  const [relocation, setRelocation] = useState<RelocationState>();
  const [unavailableRepoPath, setUnavailableRepoPath] = useState<string>();
  const [pendingForgetPath, setPendingForgetPath] = useState<string>();
  const leaveHandleRef = useRef<UnsavedChangesHandle | null>(null);
  const unsavedDirtyRef = useRef(false);
  const workspaceRef = useRef(workspace);
  const pageRef = useRef(page);
  const pollingRef = useRef(false);
  const pendingPollingRef = useRef(false);
  const requestNavigationRef = useRef<(navigation: PendingNavigation) => void>(() => undefined);
  const focusRepositoriesOnWorkspaceRef = useRef(false);
  const errorIdRef = useRef(0);
  const logoRequestsRef = useRef(new Set<string>());
  const branchRequestIdRef = useRef(0);
  const workspaceViewTransitionTimerRef = useRef<number | undefined>(undefined);
  const updateCheckInFlightRef = useRef(false);
  const manualUpdateCheckRequestedRef = useRef(false);
  const lastAutomaticUpdateCheckRef = useRef(0);
  const promptedUpdateVersionRef = useRef<string | undefined>(undefined);
  const repositoryAvailabilityRequestsRef = useRef(
    new Map<string, Promise<RepositoryAvailability>>(),
  );
  const restoreStartedRef = useRef(false);
  const nativeWindowShownRef = useRef(false);
  const repo = selectedRepo(workspace);
  const selectedRepoPath = repo?.path;
  const startupRestorePending =
    page === 'workspace' && !repo && workspaceViewTransition !== undefined;
  const repositoryLandingVisible = page === 'repositories' || (page === 'workspace' && !repo);
  const effectiveRepositoryLogoLoader =
    repositoryLogoLoader ?? (providedAdapter ? undefined : loadRepositoryLogo);
  const registeredRepositories = useMemo<RepositoryListItem[]>(
    () =>
      registeredPaths.map((path) => ({
        path,
        name: repositoryNames[path] ?? repositoryNameFromPath(path) ?? path,
        ...(repositoryLogoUrls[path] ? { logoUrl: repositoryLogoUrls[path] } : {}),
        ...(repositoryAvailability[path] ? { availability: repositoryAvailability[path] } : {}),
        ...(repositoryHealthIssues[path]?.length
          ? { healthIssues: repositoryHealthIssues[path] }
          : {}),
      })),
    [
      registeredPaths,
      repositoryAvailability,
      repositoryHealthIssues,
      repositoryLogoUrls,
      repositoryNames,
    ],
  );
  const orderedRegisteredRepositories = useMemo(() => {
    const recentIndex = new Map(
      workspace.repos.map((candidate, index) => [candidate.path, index] as const),
    );
    return registeredRepositories.toSorted((left, right) => {
      if (left.path === repo?.path) return -1;
      if (right.path === repo?.path) return 1;
      const leftRecent = recentIndex.get(left.path);
      const rightRecent = recentIndex.get(right.path);
      if (leftRecent !== undefined || rightRecent !== undefined) {
        if (leftRecent === undefined) return 1;
        if (rightRecent === undefined) return -1;
        return leftRecent - rightRecent;
      }
      return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
    });
  }, [registeredRepositories, repo?.path, workspace.repos]);
  const repositoryAccessNeedsAttention = registeredRepositories.some(
    (candidate) => candidate.availability === 'inaccessible',
  );
  const repoDisplayName = repo
    ? (registeredRepositories.find((candidate) => candidate.path === repo.path)?.name ?? repo.name)
    : undefined;
  pageRef.current = page;
  const handleUnsavedDirtyChange = useCallback((dirty: boolean): void => {
    unsavedDirtyRef.current = dirty;
  }, []);
  const showError = useCallback<ShowWorkspaceError>((title, cause, fallback): void => {
    const content = describeWorkspaceError(cause, fallback);
    errorIdRef.current += 1;
    setErrors((current) => [...current, { id: errorIdRef.current, title, ...content }]);
  }, []);
  const dismissError = useCallback((): void => {
    setErrors((current) => current.slice(1));
  }, []);
  const openFilesAndFoldersSettings = useCallback((): void => {
    void openFilesAndFoldersSystemSettings().catch((cause: unknown) =>
      showError(t('openSystemSettingsFailedTitle'), cause, t('openSystemSettingsFailed')),
    );
  }, [showError, t]);

  const checkAppUpdate = useCallback(
    async (manual = false): Promise<void> => {
      if (manual) {
        manualUpdateCheckRequestedRef.current = true;
        setNotice(undefined);
      }
      if (updateCheckInFlightRef.current) return;
      updateCheckInFlightRef.current = true;
      try {
        const update = await checkForAppUpdate();
        if (!update) {
          if (manualUpdateCheckRequestedRef.current)
            setNotice({ level: 'info', message: { id: 'appIsUpToDate' } });
          return;
        }
        setAvailableUpdate(update);
        if (
          manualUpdateCheckRequestedRef.current ||
          promptedUpdateVersionRef.current !== update.version
        ) {
          promptedUpdateVersionRef.current = update.version;
          setNotice(undefined);
          setUpdateDialogOpen(true);
        }
      } catch (cause) {
        if (manualUpdateCheckRequestedRef.current) {
          setNotice(undefined);
          showError(t('updateCheckFailedTitle'), cause, t('updateCheckFailed'));
        }
      } finally {
        updateCheckInFlightRef.current = false;
        manualUpdateCheckRequestedRef.current = false;
      }
    },
    [showError, t],
  );

  const disconnectRepository = useCallback(
    async (candidate: RepoSnapshot): Promise<void> => {
      if (candidate.operation.kind !== 'none') {
        setUnavailableRepoPath(candidate.path);
        return;
      }
      await adapter.detach?.(candidate.repoId);
      setWorkspace((current) => {
        const repos = current.repos.filter((item) => item.repoId !== candidate.repoId);
        const selectedRepoId =
          current.selectedRepoId === candidate.repoId ? repos[0]?.repoId : current.selectedRepoId;
        return {
          ...current,
          repos,
          ...(selectedRepoId ? { selectedRepoId } : {}),
        };
      });
    },
    [adapter],
  );

  const inspectRepositoryPath = useCallback(
    async (
      path: string,
      shouldApply: () => boolean = () => true,
    ): Promise<RepositoryAvailability> => {
      const request = adapter.query({ kind: 'repositoryAvailability', path }).then((result) => {
        if (result.kind !== 'repositoryAvailability') throw new Error(t('repositoryCheckFailed'));
        return result.availability;
      });
      repositoryAvailabilityRequestsRef.current.set(path, request);
      let latest = request;
      for (;;) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 先行した確認は、その場所に対する最新の確認結果へ合流する。
        const availability = await latest;
        const current = repositoryAvailabilityRequestsRef.current.get(path);
        if (current && current !== latest) {
          latest = current;
          continue;
        }
        if (shouldApply()) {
          setRepositoryAvailability((values) => ({ ...values, [path]: availability }));
        }
        return availability;
      }
    },
    [adapter, t],
  );

  const checkRegisteredRepositories = useCallback(async (): Promise<void> => {
    if (startupRestorePending) return;
    await Promise.allSettled(
      registeredPaths.map(async (path) => {
        const availability = await inspectRepositoryPath(path);
        if (availability === 'available') return;
        const attached = workspaceRef.current.repos.find((candidate) => candidate.path === path);
        if (!attached) return;
        if (
          attached.operation.kind !== 'none' ||
          (workspaceRef.current.selectedRepoId === attached.repoId && unsavedDirtyRef.current)
        ) {
          setUnavailableRepoPath(path);
          return;
        }
        await disconnectRepository(attached);
      }),
    );
  }, [disconnectRepository, inspectRepositoryPath, registeredPaths, startupRestorePending]);

  useEffect(() => {
    void checkRegisteredRepositories();
  }, [checkRegisteredRepositories]);

  useEffect(() => {
    if (!unavailableRepoPath) return;
    setPendingAction(undefined);
    setPendingNavigation(undefined);
    setPendingOperationAction(undefined);
    setPendingUnsavedAction(undefined);
    setBranchDialog(undefined);
    setRemoteManager(undefined);
  }, [unavailableRepoPath]);

  useEffect(() => {
    if (!Reflect.has(globalThis, '__TAURI_INTERNALS__')) return () => undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (!unsavedDirtyRef.current) return;
        event.preventDefault();
        setPendingWindowClose(true);
      })
      .then((listener) => {
        if (disposed) listener();
        else unlisten = listener;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!toolchainAdapter) return () => undefined;
    let alive = true;
    void toolchainAdapter
      .status()
      .then((status) => {
        if (alive) setToolchainStatus(status);
      })
      .catch((cause: unknown) => {
        if (alive) showError(t('toolchainTitle'), cause, t('toolchainLoadFailed'));
      });
    return () => {
      alive = false;
    };
  }, [showError, t, toolchainAdapter]);

  const changeToolchainMode = useCallback(
    (mode: ToolchainMode): void => {
      if (!toolchainAdapter || toolchainBusy) return;
      setToolchainBusy(true);
      void toolchainAdapter
        .setMode(mode)
        .then(setToolchainStatus)
        .catch((cause: unknown) =>
          showError(t('toolchainTitle'), cause, t('toolchainChangeFailed')),
        )
        .finally(() => setToolchainBusy(false));
    },
    [showError, t, toolchainAdapter, toolchainBusy],
  );

  const changeIgnorePatterns = useCallback(
    (patterns: string): void => {
      if (!toolchainAdapter || toolchainBusy) return;
      setToolchainBusy(true);
      void toolchainAdapter
        .setIgnorePatterns(patterns)
        .then(setToolchainStatus)
        .catch((cause: unknown) =>
          showError(t('ignorePatternsTitle'), cause, t('ignorePatternsChangeFailed')),
        )
        .finally(() => setToolchainBusy(false));
    },
    [showError, t, toolchainAdapter, toolchainBusy],
  );

  useEffect(() => {
    applyAppearance(appearance);
    void applyNativeAppearance(appearance);
  }, [appearance]);

  useEffect(() => applyTypography(fontSize, uiFont, codeFont), [codeFont, fontSize, uiFont]);

  useEffect(() => {
    applyDocumentLanguage(language);
    void applyNativeLanguage(language).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    if (repositoryBasePath) return;
    void documentDir()
      .then((path) => {
        if (isAbsoluteLocalPath(path)) setRepositoryBasePath(path);
      })
      .catch(() => undefined);
  }, [repositoryBasePath]);

  useEffect(() => {
    if (!effectiveRepositoryLogoLoader) return;
    for (const path of registeredPaths) {
      if (logoRequestsRef.current.has(path)) continue;
      logoRequestsRef.current.add(path);
      void effectiveRepositoryLogoLoader(path)
        .then((logoUrl) => {
          if (logoUrl) setRepositoryLogoUrls((current) => ({ ...current, [path]: logoUrl }));
        })
        .catch(() => undefined);
    }
  }, [effectiveRepositoryLogoLoader, registeredPaths]);

  useEffect(() => {
    if (page === 'settings') focusSettingsCategory();
  }, [page, settingsFocusRequest]);

  useEffect(() => {
    if (!repositoryLandingVisible || !focusRepositoriesOnWorkspaceRef.current) return;
    focusRepositoriesOnWorkspaceRef.current = false;
    focusRepositoryList();
  }, [repositoryLandingVisible]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!selectedRepoPath || !registeredPaths.includes(selectedRepoPath)) return;
    updatePreferences((current) =>
      current.lastSelectedRepoPath === selectedRepoPath
        ? current
        : { ...current, lastSelectedRepoPath: selectedRepoPath },
    );
  }, [registeredPaths, selectedRepoPath]);

  useEffect(() => {
    updatePreferences((current) => ({
      ...current,
      appearance,
      language,
      fontSize,
      uiFont,
      codeFont,
      automaticUpdateChecks,
      diffStyle,
      imagePreviewLayout,
      splitStageView,
      diffFileListDisplay,
      useConventionalCommits,
      stickyFileHeaders,
      editorLineWrapping,
      editorWrapColumn,
      ...(repositoryBasePath ? { repositoryBasePath } : {}),
      paneWidths,
    }));
  }, [
    appearance,
    automaticUpdateChecks,
    diffFileListDisplay,
    codeFont,
    diffStyle,
    imagePreviewLayout,
    editorLineWrapping,
    editorWrapColumn,
    fontSize,
    language,
    paneWidths,
    repositoryBasePath,
    splitStageView,
    useConventionalCommits,
    stickyFileHeaders,
    uiFont,
  ]);

  useEffect(() => {
    if (!automaticUpdateChecks) return undefined;
    const checkIfDue = (): void => {
      const now = Date.now();
      if (now - lastAutomaticUpdateCheckRef.current < APP_UPDATE_INTERVAL_MS) return;
      lastAutomaticUpdateCheckRef.current = now;
      void checkAppUpdate();
    };
    checkIfDue();
    const interval = window.setInterval(checkIfDue, APP_UPDATE_INTERVAL_MS);
    window.addEventListener('focus', checkIfDue);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkIfDue);
    };
  }, [automaticUpdateChecks, checkAppUpdate]);

  useEffect(() => {
    setLatestConflict((current) => {
      if (!current) return undefined;
      const owner = workspace.repos.find((candidate) => candidate.repoId === current.repoId);
      if (
        !owner ||
        owner.operation.kind === 'none' ||
        !owner.changes.some((entry) => entry.area === 'conflicted' && entry.path === current.path)
      )
        return undefined;
      return current;
    });
  }, [workspace.repos]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void adapter
      .subscribe((event) => {
        if (!alive) return;
        setWorkspace((current) => reduceEvent(current, event));
        if (event.kind === 'conflictChanged') setLatestConflict(event.document);
        if (event.kind === 'notice') {
          if (event.level === 'error') {
            const translated = message(event.message);
            showError(t('workspaceError'), new Error(translated), translated);
          } else {
            setNotice({ level: event.level, message: event.message });
          }
        }
      })
      .then((dispose) => {
        if (alive) unlisten = dispose;
        else dispose();
      })
      .catch((cause: unknown) => {
        if (alive) {
          showError(t('workspaceUnavailable'), cause, t('subscribeWorkspaceFailed'));
        }
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [adapter, message, showError, t]);

  useEffect(() => {
    let active = true;
    void adapter
      .query({ kind: 'activity' })
      .then((result) => {
        if (!active || result.kind !== 'activity') return;
        setWorkspace((current) => ({
          ...current,
          activities: mergeActivityEntries(result.entries, current.activities),
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [adapter]);

  useEffect(() => {
    if (notice?.level !== 'info') return undefined;
    const timeout = window.setTimeout(() => {
      setNotice((current) => (current === notice ? undefined : current));
    }, 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    let active = true;
    const poll = async (force = false): Promise<void> => {
      if (!active) return;
      if (pollingRef.current) {
        if (force) pendingPollingRef.current = true;
        return;
      }
      if (!force && document.visibilityState === 'hidden') return;
      pollingRef.current = true;
      try {
        const current = workspaceRef.current;
        const results = await Promise.allSettled(
          current.repos.map((candidate) =>
            adapter.query({ kind: 'snapshot', repoId: candidate.repoId }),
          ),
        );
        setWorkspace((latest) =>
          results.reduce((next, result) => {
            if (result.status !== 'fulfilled' || result.value.kind !== 'snapshot') return next;
            const snapshot = result.value.snapshot;
            const previous = next.repos.find((candidate) => candidate.repoId === snapshot.repoId);
            if (
              previous &&
              (snapshot.generation < previous.generation ||
                (snapshot.generation === previous.generation &&
                  snapshot.eventSeq <= previous.eventSeq))
            )
              return next;
            return replaceRepo(next, snapshot);
          }, latest),
        );
        await Promise.allSettled(
          results.flatMap((result, index) => {
            if (result.status === 'fulfilled') return [];
            const candidate = current.repos[index];
            if (!candidate) return [];
            return [
              inspectRepositoryPath(candidate.path).then(async (availability) => {
                if (availability === 'available') return;
                if (
                  candidate.operation.kind !== 'none' ||
                  (current.selectedRepoId === candidate.repoId && unsavedDirtyRef.current)
                ) {
                  setUnavailableRepoPath(candidate.path);
                  return;
                }
                await disconnectRepository(candidate);
              }),
            ];
          }),
        );
      } finally {
        pollingRef.current = false;
        if (active && pendingPollingRef.current) {
          pendingPollingRef.current = false;
          void poll(true);
        }
      }
    };
    const interval = window.setInterval(() => {
      void poll();
    }, 2_000);
    const focus = () => {
      void poll(true);
      void checkRegisteredRepositories();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        void poll(true);
        void checkRegisteredRepositories();
      }
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      pendingPollingRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [adapter, checkRegisteredRepositories, disconnectRepository, inspectRepositoryPath]);

  const attach = useCallback(
    async (
      request: AttachRequest,
      repositoryName?: string,
      navigate = true,
      shouldApply: () => boolean = () => true,
    ): Promise<RepoSnapshot | undefined> => {
      if (!shouldApply()) return undefined;
      setBusy(true);
      setNotice(undefined);
      try {
        const attached = await adapter.attach(request);
        if (!shouldApply()) return undefined;
        setWorkspace((current) => {
          const withRepos = attached.repos.reduce(replaceRepo, current);
          const withActivities = {
            ...withRepos,
            activities: mergeActivityEntries(attached.activities, current.activities),
          };
          return navigate
            ? withActivities
            : selectWorkspaceRepo(withActivities, current.selectedRepoId);
        });
        const attachedRepoId = attached.selectedRepoId ?? attached.repos[0]?.repoId;
        const attachedPath = attached.repos[0]?.path;
        if (attachedPath) {
          const preferences = rememberRepositoryPath(attachedPath, repositoryName);
          setRegisteredPaths(preferences.registeredRepoPaths);
          setRepositoryNames(preferences.repositoryNames);
          setRepositoryHealthIssues(preferences.repositoryHealthIssues);
          setRepositoryAvailability((current) => ({ ...current, [attachedPath]: 'available' }));
        }
        setAddRepositoryDialog(undefined);
        if (attachedRepoId && navigate) {
          requestNavigationRef.current({
            repoId: attachedRepoId,
            ...(request.kind === 'clone' ? {} : { page: 'workspace', view: 'diff' }),
          });
        }
        return attached.repos.find((candidate) => candidate.repoId === attachedRepoId);
      } catch (cause) {
        if (!shouldApply()) return undefined;
        if (cause instanceof WorkspaceAdapterError && cause.code === 'cancelled') {
          setNotice({ level: 'info', message: { id: 'errorCancelled' } });
        } else {
          showError(t('openRepositoryFailedTitle'), cause, t('openRepositoryFailed'));
        }
        return undefined;
      } finally {
        if (shouldApply()) setBusy(false);
      }
    },
    [adapter, showError, t],
  );

  useEffect(() => {
    const path = initialPreferences.lastSelectedRepoPath;
    if (!path || !registeredPaths.includes(path)) {
      setWorkspaceViewTransition(undefined);
      return undefined;
    }
    if (restoreStartedRef.current) return undefined;
    let active = true;
    const finishRestore = (): void => {
      if (!active) return;
      active = false;
      window.clearTimeout(timeout);
      setWorkspaceViewTransition(undefined);
    };
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setBusy(false);
      setWorkspaceViewTransition(undefined);
    }, STARTUP_RESTORE_TIMEOUT_MS);
    void inspectRepositoryPath(path, () => active)
      .then(async (availability) => {
        if (!active) return;
        if (availability !== 'available') {
          finishRestore();
          return;
        }
        if (
          restoreStartedRef.current ||
          pageRef.current !== 'workspace' ||
          selectedRepo(workspaceRef.current)
        ) {
          finishRestore();
          return;
        }
        restoreStartedRef.current = true;
        const attached = await attach(
          { kind: 'openExisting', path },
          undefined,
          false,
          () => active,
        );
        if (!active) return;
        if (!attached || pageRef.current !== 'workspace' || selectedRepo(workspaceRef.current)) {
          finishRestore();
          return;
        }
        active = false;
        window.clearTimeout(timeout);
        requestNavigationRef.current({
          repoId: attached.repoId,
          page: 'workspace',
          view: 'history',
        });
      })
      .catch(() => {
        if (active) finishRestore();
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [attach, initialPreferences.lastSelectedRepoPath, inspectRepositoryPath, registeredPaths]);

  useEffect(() => {
    if (
      workspaceViewTransition ||
      nativeWindowShownRef.current ||
      import.meta.env.VITE_E2E === 'true' ||
      !Reflect.has(globalThis, '__TAURI_INTERNALS__')
    )
      return;
    nativeWindowShownRef.current = true;
    void getCurrentWindow()
      .show()
      .catch(() => undefined);
  }, [workspaceViewTransition]);

  const openRegisteredRepository = useCallback(
    async (path: string): Promise<void> => {
      const availability =
        repositoryAvailability[path] ??
        (await (repositoryAvailabilityRequestsRef.current.get(path) ??
          inspectRepositoryPath(path)));
      if (availability !== 'available') return;
      await attach({ kind: 'openExisting', path });
    },
    [attach, inspectRepositoryPath, repositoryAvailability],
  );

  const loadRemoteManager = useCallback(
    async (repoId: string, path: string): Promise<void> => {
      setRemoteManager((current) =>
        current?.repoId === repoId ? { ...current, loading: true } : undefined,
      );
      try {
        const result = await adapter.query({ kind: 'remotes', repoId });
        if (result.kind !== 'remotes') throw new Error(t('loadRemotesFailed'));
        setRemoteManager({ path, repoId, remotes: result.remotes, loading: false });
      } catch (cause) {
        const error = describeWorkspaceError(cause, t('loadRemotesFailed'));
        setRemoteManager({ path, repoId, remotes: [], loading: false, error: error.message });
      }
    },
    [adapter, t],
  );

  const openRemoteManager = useCallback(
    async (path: string): Promise<void> => {
      const availability =
        repositoryAvailability[path] ?? (await inspectRepositoryPath(path).catch(() => undefined));
      if (availability && availability !== 'available') {
        setUnavailableRepoPath(path);
        return;
      }
      const current = workspaceRef.current.repos.find((candidate) => candidate.path === path);
      if (!current && !selectedRepo(workspaceRef.current) && pageRef.current === 'workspace') {
        setPage('repositories');
      }
      const attached = current ?? (await attach({ kind: 'openExisting', path }, undefined, false));
      if (attached) await loadRemoteManager(attached.repoId, path);
    },
    [attach, inspectRepositoryPath, loadRemoteManager, repositoryAvailability],
  );

  useEffect(() => {
    if (page !== 'activity' || !activityReady || !cloneToStart) return;
    const { request, repositoryName } = cloneToStart;
    setCloneToStart(undefined);
    settleUiAction(repositoryName ? attach(request, repositoryName) : attach(request));
  }, [activityReady, attach, cloneToStart, page]);

  const openRepositoryDialog = (): void => {
    setBranchDialog(undefined);
    setAddRepositoryDialog({
      source: 'url',
      url: '',
      cloneParentPath: repositoryBasePath,
      localPath: '',
      remoteName: '',
      localName: '',
    });
  };

  const chooseDirectory = async (title: string): Promise<string | null> => {
    try {
      return await directoryPicker(title);
    } catch (cause) {
      showError(t('openRepositoryFailedTitle'), cause, t('chooseDirectoryFailed'));
      return null;
    }
  };

  const chooseRepositoryBasePath = async (): Promise<void> => {
    const path = await chooseDirectory(t('chooseRepositoryBasePath'));
    if (path) setRepositoryBasePath(path);
  };

  const prepareRepositoryRelocation = async (
    oldPath: string,
    newPath: string,
    information?: Pick<RepositoryInformationChange, 'name' | 'remoteUrlChanges' | 'remoteAddition'>,
  ): Promise<boolean> => {
    try {
      const availability = await inspectRepositoryPath(newPath);
      if (availability !== 'available') {
        const detail =
          availability === 'missing'
            ? t('repositoryMissing')
            : availability === 'notRepository'
              ? t('repositoryNotRepository')
              : t('repositoryInaccessible');
        showError(t('repositoryRelocationFailedTitle'), new Error(detail), detail);
        return false;
      }
      setRelocation({
        oldPath,
        newPath,
        duplicate: oldPath !== newPath && registeredPaths.includes(newPath),
        ...(information
          ? {
              repositoryName: information.name,
              remoteUrlChanges: information.remoteUrlChanges,
              ...(information.remoteAddition ? { remoteAddition: information.remoteAddition } : {}),
            }
          : {}),
      });
      return true;
    } catch (cause) {
      showError(t('repositoryRelocationFailedTitle'), cause, t('repositoryCheckFailed'));
      return false;
    }
  };

  const chooseRelocatedRepository = async (oldPath: string): Promise<void> => {
    const newPath = await chooseDirectory(t('chooseRelocatedRepository'));
    if (newPath) await prepareRepositoryRelocation(oldPath, newPath);
  };

  const transferRelocationDraft = async (
    newRepo: RepoSnapshot,
    draft: UnsavedRelocationDraft,
  ): Promise<RepoSnapshot> => {
    if (draft.kind === 'file') {
      const result = await adapter.query({
        kind: 'fileContents',
        repoId: newRepo.repoId,
        path: draft.path,
      });
      if (result.kind !== 'fileContents' || result.document.contentHash !== draft.baseHash) {
        throw new WorkspaceAdapterError('staleDiff', t('relocationDraftChanged'));
      }
      const outcome = await adapter.execute({
        repoId: newRepo.repoId,
        action: {
          kind: 'saveFile',
          path: draft.path,
          text: draft.text,
          expectedContentHash: result.document.contentHash,
        },
      });
      return outcome.snapshot ?? newRepo;
    }
    const result = await adapter.query({
      kind: 'conflict',
      repoId: newRepo.repoId,
      path: draft.path,
    });
    if (result.kind !== 'conflict' || result.document.contentHash !== draft.baseHash) {
      throw new WorkspaceAdapterError('staleDiff', t('relocationDraftChanged'));
    }
    const outcome = await adapter.execute({
      repoId: newRepo.repoId,
      action: {
        kind: 'saveConflict',
        sessionId: result.document.sessionId,
        path: draft.path,
        draftText: draft.text,
        contentHash: result.document.contentHash,
        documentRevision: result.document.documentRevision,
      },
    });
    return outcome.snapshot ?? newRepo;
  };

  const applyRemoteChanges = async (
    changes: readonly RemoteUrlChange[],
    addition: RemoteAddition | undefined,
    repoId: string,
  ): Promise<RepoSnapshot | undefined> => {
    let snapshot: RepoSnapshot | undefined;
    const actions: WorkspaceAction[] = [
      ...(addition ? [{ kind: 'addRemote' as const, ...addition }] : []),
      ...changes.map((change) => ({ kind: 'setRemoteUrl' as const, ...change })),
    ];
    for (const action of actions) {
      const request: ActionRequest = {
        repoId,
        action,
      };
      let preview: ActionPreview;
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 対象リモートを各変更の直前に検証する。
        preview = await adapter.preview(request);
      } catch (cause) {
        showError(t('previewFailedTitle'), cause, t('previewFailed'));
        throw markWorkspaceErrorHandled(cause, t('previewFailed'));
      }
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 変更を順番に適用し、最初の失敗で停止する。
        const outcome = await adapter.execute({ ...request, preview });
        snapshot = outcome.snapshot ?? snapshot;
      } catch (cause) {
        showError(t('operationFailedTitle'), cause, t('operationFailed'));
        throw markWorkspaceErrorHandled(cause, t('operationFailed'));
      }
    }
    return snapshot;
  };

  const fetchChangedRemotes = async (
    repoId: string,
    changes: readonly RemoteUrlChange[],
    addition?: RemoteAddition,
  ): Promise<void> => {
    const remotesToFetch = new Set(
      changes.filter((change) => change.urlKind === 'fetch').map((change) => change.remote),
    );
    if (addition) remotesToFetch.add(addition.remote);
    for (const remote of remotesToFetch) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 共有の処理中状態を競合させずリモートごとに実行する。
        await execute({ repoId, action: { kind: 'fetch', remote } });
      } catch {
        // リモート設定は完了済みのため、フェッチ失敗は通常のエラー表示に残す。
      }
    }
  };

  const confirmRepositoryRelocation = async (): Promise<void> => {
    if (!relocation || relocation.duplicate) return;
    const oldRepo = workspaceRef.current.repos.find(
      (candidate) => candidate.path === relocation.oldPath,
    );
    const draft =
      oldRepo && workspaceRef.current.selectedRepoId === oldRepo.repoId && unsavedDirtyRef.current
        ? leaveHandleRef.current?.relocationDraft?.()
        : undefined;
    let attachedRepo: RepoSnapshot | undefined;
    let relocatedRepoId: string | undefined;
    setBusy(true);
    try {
      const attached = await adapter.attach({ kind: 'openExisting', path: relocation.newPath });
      attachedRepo = attached.selectedRepoId
        ? attached.repos.find((candidate) => candidate.repoId === attached.selectedRepoId)
        : attached.repos[0];
      if (!attachedRepo) throw new Error(t('openRepositoryFailed'));
      const restoredRepo = draft
        ? await transferRelocationDraft(attachedRepo, draft)
        : attachedRepo;
      if (oldRepo) await adapter.detach?.(oldRepo.repoId);
      setWorkspace((current) => {
        const withoutOld = oldRepo
          ? {
              ...current,
              repos: current.repos.filter((candidate) => candidate.repoId !== oldRepo.repoId),
            }
          : current;
        const next = replaceRepo(withoutOld, restoredRepo);
        return { ...next, selectedRepoId: restoredRepo.repoId };
      });
      let preferences = replaceRepositoryPath(relocation.oldPath, relocation.newPath);
      if (relocation.repositoryName) {
        const repositoryName = relocation.repositoryName;
        preferences = updatePreferences((current) => ({
          ...current,
          repositoryNames: {
            ...current.repositoryNames,
            [relocation.newPath]: repositoryName,
          },
        }));
      }
      setRegisteredPaths(preferences.registeredRepoPaths);
      setRepositoryNames(preferences.repositoryNames);
      setRepositoryHealthIssues(preferences.repositoryHealthIssues);
      setRepositoryAvailability((current) => {
        const next = { ...current, [relocation.newPath]: 'available' as const };
        delete next[relocation.oldPath];
        return next;
      });
      setRelocation(undefined);
      setUnavailableRepoPath(undefined);
      unsavedDirtyRef.current = false;
      setWorkspaceViewRevision((current) => current + 1);
      setNotice({ level: 'info', message: { id: 'repositoryRelocated' } });
      relocatedRepoId = restoredRepo.repoId;
    } catch (cause) {
      if (attachedRepo && attachedRepo.repoId !== oldRepo?.repoId) {
        await adapter.detach?.(attachedRepo.repoId).catch(() => undefined);
      }
      showError(t('repositoryRelocationFailedTitle'), cause, t('repositoryRelocationFailed'));
    } finally {
      setBusy(false);
    }

    if (!relocatedRepoId || (!relocation.remoteUrlChanges?.length && !relocation.remoteAddition))
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      applyOutcome(
        await applyRemoteChanges(
          relocation.remoteUrlChanges ?? [],
          relocation.remoteAddition,
          relocatedRepoId,
        ),
      );
    } finally {
      setBusy(false);
    }
    await fetchChangedRemotes(
      relocatedRepoId,
      relocation.remoteUrlChanges ?? [],
      relocation.remoteAddition,
    );
  };

  const requestForgetRepository = (path: string): void => {
    const attached = workspaceRef.current.repos.find((candidate) => candidate.path === path);
    if (attached && attached.operation.kind !== 'none') {
      showError(
        t('forgetRepositoryFailedTitle'),
        new WorkspaceAdapterError('operationInProgress', t('forgetRepositoryOperationBlocked')),
        t('forgetRepositoryOperationBlocked'),
      );
      return;
    }
    setPendingForgetPath(path);
  };

  const confirmRepositoryRemoval = async (deleteFiles: boolean): Promise<void> => {
    if (!pendingForgetPath) return;
    const path = pendingForgetPath;
    const attached = workspaceRef.current.repos.find((candidate) => candidate.path === path);
    setBusy(true);
    try {
      if (deleteFiles) {
        if (!adapter.deleteRepository) throw new Error(t('deleteRepositoryFailed'));
        await adapter.deleteRepository(path);
      }
      if (attached) await disconnectRepository(attached);
      const preferences = forgetRepositoryPath(path);
      setRegisteredPaths(preferences.registeredRepoPaths);
      setRepositoryNames(preferences.repositoryNames);
      setRepositoryHealthIssues(preferences.repositoryHealthIssues);
      setRepositoryAvailability((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      if (attached && workspaceRef.current.selectedRepoId === attached.repoId) {
        unsavedDirtyRef.current = false;
        setWorkspaceViewRevision((current) => current + 1);
      }
      setPendingForgetPath(undefined);
      if (unavailableRepoPath === path) setUnavailableRepoPath(undefined);
    } catch (cause) {
      showError(
        t(deleteFiles ? 'deleteRepositoryFailedTitle' : 'forgetRepositoryFailedTitle'),
        cause,
        t(deleteFiles ? 'deleteRepositoryFailed' : 'forgetRepositoryFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const chooseRepositoryPath = async (): Promise<void> => {
    const path = await chooseDirectory(t('chooseRepositoryDirectory'));
    if (path) {
      setAddRepositoryDialog((current) => {
        if (!current) return current;
        const previousInferredName = repositoryNameFromPath(current.localPath);
        return {
          source: current.source,
          url: current.url,
          cloneParentPath: current.source === 'url' ? path : current.cloneParentPath,
          localPath: current.source === 'path' ? path : current.localPath,
          remoteName: current.remoteName,
          localName:
            current.source === 'path' &&
            (!current.localName || current.localName === previousInferredName)
              ? (repositoryNameFromPath(path) ?? '')
              : current.localName,
        };
      });
    }
  };

  const submitAddRepository = async (): Promise<void> => {
    if (!addRepositoryDialog) return;
    if (addRepositoryDialog.source === 'path') {
      const path = addRepositoryDialog.localPath.trim();
      const repositoryName = addRepositoryDialog.localName.trim() || undefined;
      if (!isAbsoluteLocalPath(path)) {
        setAddRepositoryDialog((current) =>
          current ? { ...current, error: t('invalidRepositoryPath'), errorField: 'path' } : current,
        );
        return;
      }
      await (repositoryName
        ? attach({ kind: 'open', path }, repositoryName)
        : attach({ kind: 'open', path }));
      return;
    }

    const remoteUrl = addRepositoryDialog.url.trim();
    const repositoryName = addRepositoryDialog.remoteName.trim() || undefined;
    const inferredName = repositoryNameFromRemoteUrl(remoteUrl);
    if (!inferredName) {
      setAddRepositoryDialog((current) =>
        current ? { ...current, error: t('invalidRepositoryUrl'), errorField: 'url' } : current,
      );
      return;
    }

    if (!repositoryName || !isRepositoryDirectoryName(repositoryName)) {
      setAddRepositoryDialog((current) =>
        current ? { ...current, error: t('invalidRepositoryName'), errorField: 'name' } : current,
      );
      return;
    }

    const parent = addRepositoryDialog.cloneParentPath.trim();
    if (!isAbsoluteLocalPath(parent)) {
      setAddRepositoryDialog((current) =>
        current ? { ...current, error: t('invalidRepositoryPath'), errorField: 'path' } : current,
      );
      return;
    }
    requestNavigationRef.current({
      page: 'activity',
      cloneRequest: {
        kind: 'clone',
        remoteUrl,
        destination: joinRepositoryPath(parent, repositoryName),
      },
      repositoryName,
    });
  };

  const openRepositorySwitcher = useCallback((): void => {
    if (!workspaceRef.current.repos.length) return;
    setBranchDialog(undefined);
    setRepositorySwitcherOpen(true);
    void checkRegisteredRepositories();
  }, [checkRegisteredRepositories]);

  const openBranchSwitcher = useCallback((): void => {
    const currentRepo = selectedRepo(workspaceRef.current);
    if (!currentRepo) return;
    branchRequestIdRef.current += 1;
    const requestId = branchRequestIdRef.current;
    setRepositorySwitcherOpen(false);
    setBranchDialog({
      requestId,
      repoId: currentRepo.repoId,
      branches: [],
      loading: true,
    });
    void adapter
      .query({ kind: 'branches', repoId: currentRepo.repoId })
      .then((result) => {
        if (result.kind !== 'branches') return;
        setBranchDialog((current) =>
          current?.requestId === requestId
            ? { ...current, branches: result.branches, loading: false }
            : current,
        );
      })
      .catch((cause: unknown) => {
        const error = describeWorkspaceError(cause, t('loadBranchesFailed'));
        setBranchDialog((current) =>
          current?.requestId === requestId
            ? { ...current, loading: false, error: error.message }
            : current,
        );
      });
  }, [adapter, t]);

  useEffect(() => {
    const handleRepositoryShortcut = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.key.toLocaleLowerCase() !== 'o' ||
        !event.metaKey ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        addRepositoryDialog ||
        pendingAction ||
        pendingNavigation ||
        pendingOperationAction ||
        errors.length > 0 ||
        branchDialog
      ) {
        return;
      }
      if (!workspaceRef.current.repos.length) return;
      event.preventDefault();
      openRepositorySwitcher();
    };
    window.addEventListener('keydown', handleRepositoryShortcut);
    return () => window.removeEventListener('keydown', handleRepositoryShortcut);
  }, [
    addRepositoryDialog,
    branchDialog,
    errors.length,
    openRepositorySwitcher,
    pendingAction,
    pendingNavigation,
    pendingOperationAction,
  ]);

  const applyOutcome = (snapshot?: RepoSnapshot): void => {
    if (snapshot) setWorkspace((current) => replaceRepo(current, snapshot));
  };

  const execute = async (request: ActionRequest): Promise<void> => {
    const requestedRepo = workspaceRef.current.repos.find(
      (candidate) => candidate.repoId === request.repoId,
    );
    const remote = requestedRepo ? actionRemote(request.action, requestedRepo) : undefined;
    setBusy(true);
    setNotice(undefined);
    try {
      const outcome = await adapter.execute(request);
      applyOutcome(outcome.snapshot);
      if (outcome.conflictDocument) setLatestConflict(outcome.conflictDocument);
      if (requestedRepo && remote) {
        const preferences = clearRemoteHealthIssue(requestedRepo.path, remote);
        setRepositoryHealthIssues(preferences.repositoryHealthIssues);
      }
    } catch (cause) {
      if (request.action.kind === 'pull' && isPullDivergenceError(cause)) throw cause;
      const reason = remoteHealthReason(cause);
      if (requestedRepo && remote && reason) {
        const preferences = recordRemoteHealthIssue(requestedRepo.path, remote, reason);
        setRepositoryHealthIssues(preferences.repositoryHealthIssues);
      }
      showError(t('operationFailedTitle'), cause, t('operationFailed'));
      throw markWorkspaceErrorHandled(cause, t('operationFailed'));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: WorkspaceAction, targetRepoId = repo?.repoId): Promise<void> => {
    const targetRepo = workspaceRef.current.repos.find(
      (candidate) => candidate.repoId === targetRepoId,
    );
    if (!targetRepo || unavailableRepoPath === targetRepo.path) return;
    const request: ActionRequest = {
      repoId: targetRepo.repoId,
      action,
    };
    if (!actionNeedsPreview(action)) {
      await execute(request);
      return;
    }
    setBusy(true);
    try {
      const preview = await adapter.preview(request);
      setPendingAction({ request, preview });
      setTypedConfirmation('');
    } catch (cause) {
      showError(t('previewFailedTitle'), cause, t('previewFailed'));
      throw markWorkspaceErrorHandled(cause, t('previewFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveRepositoryInformation = async (
    information: RepositoryInformationChange,
    manager: RemoteManagerState,
  ): Promise<void> => {
    if (information.path !== manager.path) {
      const prepared = await prepareRepositoryRelocation(manager.path, information.path, {
        name: information.name,
        remoteUrlChanges: information.remoteUrlChanges,
        ...(information.remoteAddition ? { remoteAddition: information.remoteAddition } : {}),
      });
      if (prepared) setRemoteManager(undefined);
      return;
    }

    setBusy(true);
    setNotice(undefined);
    try {
      applyOutcome(
        await applyRemoteChanges(
          information.remoteUrlChanges,
          information.remoteAddition,
          manager.repoId,
        ),
      );
      const preferences = updatePreferences((current) => ({
        ...current,
        repositoryNames: {
          ...current.repositoryNames,
          [manager.path]: information.name,
        },
      }));
      setRepositoryNames(preferences.repositoryNames);
    } catch (cause) {
      await loadRemoteManager(manager.repoId, manager.path);
      throw cause;
    } finally {
      setBusy(false);
    }

    setRemoteManager(undefined);
    await fetchChangedRemotes(
      manager.repoId,
      information.remoteUrlChanges,
      information.remoteAddition,
    );
  };

  const requestOperationAction = (action: GuardedOperationAction): void => {
    if (unsavedDirtyRef.current) {
      setPendingOperationAction(action);
      return;
    }
    settleUiAction(runAction(action));
  };

  const requestUnsavedGuardedAction = (action: WorkspaceAction): void => {
    if (unsavedDirtyRef.current) {
      setPendingUnsavedAction(action);
      return;
    }
    settleUiAction(runAction(action));
  };

  const runPendingUnsavedAction = async (save: boolean): Promise<void> => {
    if (!pendingUnsavedAction) return;
    const action = pendingUnsavedAction;
    if (save) {
      const saved = await leaveHandleRef.current?.save();
      if (!saved) return;
    } else {
      setWorkspaceViewRevision((current) => current + 1);
    }
    setPendingUnsavedAction(undefined);
    unsavedDirtyRef.current = false;
    await runAction(action);
  };

  const runPendingOperationAction = async (discardConflict: boolean): Promise<void> => {
    if (!pendingOperationAction) return;
    const action = pendingOperationAction;
    setPendingOperationAction(undefined);
    if (discardConflict) setWorkspaceViewRevision((current) => current + 1);
    unsavedDirtyRef.current = false;
    await runAction(action);
  };

  const confirmAction = async (): Promise<void> => {
    if (!pendingAction) return;
    const completedAction = pendingAction.request.action;
    const request: ActionRequest = {
      ...pendingAction.request,
      preview: pendingAction.preview,
    };
    setPendingAction(undefined);
    await execute(request);
    if (completedAction.kind === 'setRemoteUrl' || completedAction.kind === 'addRemote') {
      if (completedAction.kind === 'addRemote' || completedAction.urlKind === 'fetch') {
        try {
          await execute({
            repoId: request.repoId,
            action: { kind: 'fetch', remote: completedAction.remote },
          });
        } catch {
          // リモート設定は完了済みのため、フェッチ失敗は警告と通常の詳細画面に残す。
        }
      }
      if (remoteManager) await loadRemoteManager(remoteManager.repoId, remoteManager.path);
    }
  };

  const performNavigation = useCallback(
    (
      { repoId, view: nextView, page: nextPage, cloneRequest, repositoryName }: PendingNavigation,
      discardConflict = false,
    ): void => {
      if (discardConflict) setWorkspaceViewRevision((current) => current + 1);
      if (repoId) {
        setWorkspace((current) => selectWorkspaceRepo(current, repoId));
        setRepositorySwitcherOpen(false);
      }
      if (nextView) setView(nextView);
      if (nextPage) setPage(nextPage);
      if (nextPage === 'settings' || nextPage === 'activity' || nextPage === 'repositories') {
        setAddRepositoryDialog(undefined);
        setRepositorySwitcherOpen(false);
        setBranchDialog(undefined);
        setPendingAction(undefined);
        setTypedConfirmation('');
      }
      if (nextPage === 'settings') {
        setSettingsFocusRequest((current) => current + 1);
      }
      if (nextPage === 'activity') {
        if (pageRef.current !== 'activity') setActivityReady(false);
        setActivityFocusRequest((current) => current + 1);
      } else if (nextPage) {
        setCloneToStart(undefined);
      }
      if (cloneRequest) {
        setCloneToStart({
          request: cloneRequest,
          ...(repositoryName ? { repositoryName } : {}),
        });
      }
      setPendingNavigation(undefined);
      unsavedDirtyRef.current = false;
    },
    [],
  );

  const cancelWorkspaceViewTransition = useCallback((): void => {
    const timer = workspaceViewTransitionTimerRef.current;
    if (timer !== undefined) window.clearTimeout(timer);
    workspaceViewTransitionTimerRef.current = undefined;
  }, []);

  const requestNavigation = useCallback(
    (navigation: PendingNavigation): void => {
      if (unsavedDirtyRef.current) {
        setPendingNavigation(navigation);
        return;
      }
      if (
        pageRef.current === 'workspace' &&
        navigation.page === 'workspace' &&
        navigation.view &&
        navigation.view !== view
      ) {
        cancelWorkspaceViewTransition();
        setWorkspaceViewTransition(navigation.view);
        // 非前面のWKWebViewでも遷移を完了できるタスクへ分け、旧画面の内容を先に破棄する。
        workspaceViewTransitionTimerRef.current = window.setTimeout(() => {
          workspaceViewTransitionTimerRef.current = undefined;
          performNavigation(navigation);
          setWorkspaceViewTransition(undefined);
        });
        return;
      }
      cancelWorkspaceViewTransition();
      setWorkspaceViewTransition(undefined);
      performNavigation(navigation);
    },
    [cancelWorkspaceViewTransition, performNavigation, view],
  );

  requestNavigationRef.current = requestNavigation;

  useEffect(
    () => () => {
      cancelWorkspaceViewTransition();
    },
    [cancelWorkspaceViewTransition],
  );

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenForOpenSettings(() => requestNavigation({ page: 'settings' }))
      .then((dispose) => {
        if (alive) unlisten = dispose;
        else dispose();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [requestNavigation]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenForCheckAppUpdates(() => void checkAppUpdate(true))
      .then((dispose) => {
        if (alive) unlisten = dispose;
        else dispose();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [checkAppUpdate]);

  const markActivityReady = useCallback((): void => {
    setActivityReady(true);
  }, []);

  const changeAppearance = useCallback((nextAppearance: Appearance): void => {
    setAppearance(nextAppearance);
  }, []);

  const changeLanguage = useCallback((nextLanguage: Language): void => {
    setLanguage(nextLanguage);
  }, []);

  const saveAndNavigate = async (): Promise<void> => {
    if (!pendingNavigation) return;
    const saved = await leaveHandleRef.current?.save();
    if (saved) performNavigation(pendingNavigation);
  };

  const completeWindowClose = async (save: boolean): Promise<void> => {
    if (save) {
      const saved = await leaveHandleRef.current?.save();
      if (!saved) return;
    }
    setPendingWindowClose(false);
    try {
      await getCurrentWindow().destroy();
    } catch (cause) {
      showError(t('closeWindowFailedTitle'), cause, t('closeWindowFailed'));
    }
  };

  const cancelActivity = async (entry: ActivityEntry): Promise<void> => {
    try {
      await adapter.cancel({ repoId: entry.repoId, activityId: entry.id });
    } catch (cause) {
      showError(t('cancelOperationFailedTitle'), cause, t('cancelOperationFailed'));
    }
  };

  const operationActions = repo && repo.operation.kind !== 'none' ? repo.operation : undefined;
  const repositoryUnavailable = Boolean(repo && unavailableRepoPath === repo.path);
  const currentActivities = workspace.activities;
  const hasRunningActivity = currentActivities.some((entry) => entry.status === 'running');
  const updateBlocked =
    busy ||
    hasRunningActivity ||
    workspace.repos.some((candidate) => candidate.operation.kind !== 'none');

  const beginAppUpdate = async (save: boolean, discard = false): Promise<void> => {
    if (updateBlocked || updateInstalling) return;
    if (save && !(await leaveHandleRef.current?.save())) return;
    if (discard) {
      unsavedDirtyRef.current = false;
      setWorkspaceViewRevision((current) => current + 1);
    }
    setPendingUpdateInstall(false);
    setUpdateDialogOpen(true);
    setUpdateInstalling(true);
    try {
      await installAppUpdate(() => undefined);
    } catch (cause) {
      setUpdateInstalling(false);
      showError(t('updateInstallFailedTitle'), cause, t('updateInstallFailed'));
    }
  };

  const requestAppUpdate = (): void => {
    if (updateBlocked || updateInstalling) return;
    if (unsavedDirtyRef.current) {
      setUpdateDialogOpen(false);
      setPendingUpdateInstall(true);
      return;
    }
    settleUiAction(beginAppUpdate(false));
  };
  const activeError = errors[0];
  const currentRepositoryState = repo ? repositoryState(repo, message) : undefined;
  const activeWorkspaceView = workspaceViewTransition ?? view;
  const activeNavigationPage = repositoryLandingVisible
    ? 'repositories'
    : page === 'workspace'
      ? activeWorkspaceView
      : page;
  const sidebarAvailable = (page === 'workspace' && Boolean(repo)) || page === 'activity';
  const sidebarVisible = sidebarAvailable && sidebarOpen;
  const workspaceLeftPane =
    activeWorkspaceView === 'diff' ? paneWidths.diff.left : paneWidths.history.left;
  const shellLeftPane =
    page === 'settings' ? 200 : page === 'activity' ? paneWidths.activity.left : workspaceLeftPane;
  const appShellStyle: AppShellStyle = { '--shell-left-pane': `${shellLeftPane}px` };
  const workspaceViewTransitionStyle: WorkspaceViewTransitionStyle | undefined =
    workspaceViewTransition
      ? {
          '--left-pane': `${workspaceLeftPane}px`,
        }
      : undefined;
  const branchDialogRepo = branchDialog
    ? workspace.repos.find((candidate) => candidate.repoId === branchDialog.repoId)
    : undefined;
  const unavailableRepo = unavailableRepoPath
    ? workspace.repos.find((candidate) => candidate.path === unavailableRepoPath)
    : undefined;
  const pendingForgetRepository = pendingForgetPath
    ? registeredRepositories.find((candidate) => candidate.path === pendingForgetPath)
    : undefined;
  const sidebarControlLabel = t(sidebarOpen ? 'closeSidebar' : 'openSidebar');
  const sidebarControl = (
    <Button
      type="button"
      variant="quiet"
      className="diff-action-button sidebar-toggle-button"
      aria-label={sidebarControlLabel}
      aria-expanded={sidebarOpen}
      tooltip={sidebarControlLabel}
      onClick={() => setSidebarOpen((current) => !current)}
    >
      {sidebarOpen ? (
        <PanelLeftClose aria-hidden="true" focusable="false" />
      ) : (
        <PanelLeftOpen aria-hidden="true" focusable="false" />
      )}
    </Button>
  );
  if (page === 'workspace' && !repo && workspaceViewTransition) return null;
  return (
    <I18nProvider language={language}>
      <AppearanceProvider appearance={appearance}>
        <div
          className={`app-shell${sidebarAvailable && !sidebarOpen ? ' is-sidebar-closed' : ''}`}
          data-testid="app-shell"
          style={appShellStyle}
        >
          <header className="app-header" data-tauri-drag-region="deep">
            <div className="window-header-content">
              <div className="window-header-leading">
                {sidebarAvailable ? sidebarControl : null}
                <nav className="titlebar-context" aria-label={t('workspaceContext')}>
                  {repo && (page === 'workspace' || page === 'activity') ? (
                    <>
                      <Button
                        type="button"
                        className="titlebar-context-toggle repository-toggle"
                        aria-label={t('switchRepositoryCurrent', {
                          repository: repoDisplayName ?? repo.name,
                          state: currentRepositoryState
                            ? t('repositoryStateSuffix', { state: currentRepositoryState.label })
                            : '',
                        })}
                        aria-haspopup="dialog"
                        aria-expanded={repositorySwitcherOpen}
                        data-repository-path={repo.path}
                        onClick={openRepositorySwitcher}
                      >
                        <FolderGit2 aria-hidden="true" focusable="false" />
                        <span>{repoDisplayName ?? repo.name}</span>
                        {currentRepositoryState ? (
                          <i
                            className={`repository-status-dot ${currentRepositoryState.tone}`}
                            aria-hidden="true"
                          />
                        ) : null}
                        <ChevronDown aria-hidden="true" focusable="false" />
                      </Button>
                      <Button
                        type="button"
                        className="titlebar-context-toggle branch-toggle"
                        aria-label={t('switchBranchCurrent', {
                          branch: repo.branch.detached
                            ? t('detachedHead')
                            : (repo.branch.name ?? ''),
                        })}
                        aria-haspopup="dialog"
                        aria-expanded={Boolean(branchDialog)}
                        onClick={openBranchSwitcher}
                      >
                        <GitBranch aria-hidden="true" focusable="false" />
                        <span>{repo.branch.detached ? t('detachedHead') : repo.branch.name}</span>
                        <ChevronDown aria-hidden="true" focusable="false" />
                      </Button>
                    </>
                  ) : null}
                </nav>
              </div>
              <nav className="titlebar-actions" aria-label={t('appNavigation')}>
                <Button
                  type="button"
                  className="titlebar-menu-button"
                  aria-label={t('diff')}
                  aria-current={activeNavigationPage === 'diff' ? 'page' : undefined}
                  disabled={!repo}
                  onClick={() => {
                    if (page !== 'workspace' || activeWorkspaceView !== 'diff')
                      requestNavigation({ page: 'workspace', view: 'diff' });
                  }}
                >
                  <FileDiff aria-hidden="true" focusable="false" />
                  <span>{t('diff')}</span>
                </Button>
                <Button
                  type="button"
                  className="titlebar-menu-button"
                  aria-label={t('history')}
                  aria-current={activeNavigationPage === 'history' ? 'page' : undefined}
                  disabled={!repo}
                  onClick={() => {
                    if (page !== 'workspace' || activeWorkspaceView !== 'history')
                      requestNavigation({ page: 'workspace', view: 'history' });
                  }}
                >
                  <HistoryIcon aria-hidden="true" focusable="false" />
                  <span>{t('history')}</span>
                </Button>
                <Button
                  type="button"
                  className="titlebar-menu-button activity-toggle"
                  aria-label={t('appActivity')}
                  aria-current={activeNavigationPage === 'activity' ? 'page' : undefined}
                  disabled={!repo}
                  onClick={() => {
                    if (page !== 'activity') requestNavigation({ page: 'activity' });
                  }}
                >
                  <ChartNoAxesCombined aria-hidden="true" focusable="false" />
                  <span>{t('appActivity')}</span>
                </Button>
                <Button
                  type="button"
                  className="titlebar-menu-button"
                  aria-label={t('repositoryList')}
                  aria-current={activeNavigationPage === 'repositories' ? 'page' : undefined}
                  onClick={() => {
                    if (repositoryLandingVisible) {
                      focusRepositoryList();
                      return;
                    }
                    focusRepositoriesOnWorkspaceRef.current = true;
                    requestNavigation({ page: 'repositories' });
                  }}
                >
                  <FolderGit2 aria-hidden="true" focusable="false" />
                  <span>{t('repositoryList')}</span>
                </Button>
                <Button
                  type="button"
                  className="titlebar-menu-button"
                  aria-label={t('appSettings')}
                  aria-current={activeNavigationPage === 'settings' ? 'page' : undefined}
                  onClick={() => {
                    if (page === 'settings') {
                      focusSettingsCategory();
                      return;
                    }
                    requestNavigation({ page: 'settings' });
                  }}
                >
                  <SettingsIcon aria-hidden="true" focusable="false" />
                  <span>{t('appSettings')}</span>
                </Button>
              </nav>
            </div>
          </header>

          {notice ? (
            <output
              className={`global-notice ${notice.level}${sidebarVisible ? ' is-right-pane' : ''}`}
            >
              <NoticeContent notice={notice} />
            </output>
          ) : null}

          {page === 'settings' ? (
            <SettingsView
              appearance={appearance}
              language={language}
              fontSize={fontSize}
              uiFont={uiFont}
              codeFont={codeFont}
              automaticUpdateChecks={automaticUpdateChecks}
              diffStyle={diffStyle}
              imagePreviewLayout={imagePreviewLayout}
              splitStageView={splitStageView}
              diffFileListDisplay={diffFileListDisplay}
              repositoryBasePath={repositoryBasePath}
              repositoryAccessNeedsAttention={repositoryAccessNeedsAttention}
              useConventionalCommits={useConventionalCommits}
              stickyFileHeaders={stickyFileHeaders}
              editorLineWrapping={editorLineWrapping}
              editorWrapColumn={editorWrapColumn}
              {...(toolchainStatus ? { toolchainStatus } : {})}
              toolchainBusy={toolchainBusy}
              onAppearanceChange={changeAppearance}
              onLanguageChange={changeLanguage}
              onFontSizeChange={setFontSize}
              onUiFontChange={setUiFont}
              onCodeFontChange={setCodeFont}
              onAutomaticUpdateChecksChange={setAutomaticUpdateChecks}
              onDiffStyleChange={setDiffStyle}
              onImagePreviewLayoutChange={setImagePreviewLayout}
              onSplitStageViewChange={setSplitStageView}
              onDiffFileListDisplayChange={setDiffFileListDisplay}
              onRepositoryBasePathChange={setRepositoryBasePath}
              onChooseRepositoryBasePath={() => settleUiAction(chooseRepositoryBasePath())}
              onOpenFilesAndFoldersSettings={openFilesAndFoldersSettings}
              onUseConventionalCommitsChange={setUseConventionalCommits}
              onStickyFileHeadersChange={setStickyFileHeaders}
              onEditorLineWrappingChange={setEditorLineWrapping}
              onEditorWrapColumnChange={setEditorWrapColumn}
              onResetPaneWidths={() => {
                setPaneWidths(DEFAULT_PREFERENCES.paneWidths);
                setNotice({ level: 'info', message: { id: 'panePositionsResetCompleted' } });
              }}
              onIgnorePatternsChange={changeIgnorePatterns}
              onToolchainModeChange={changeToolchainMode}
            />
          ) : null}

          {page === 'activity' ? (
            <Suspense
              fallback={
                <main
                  className="activity-view activity-page-loading"
                  aria-labelledby="activity-title"
                  aria-busy="true"
                >
                  <h1 id="activity-title" className="sr-only">
                    {t('appActivity')}
                  </h1>
                  <LoadingIndicator />
                </main>
              }
            >
              <ActivityView
                adapter={adapter}
                repo={repo}
                entries={currentActivities}
                paneWidth={paneWidths.activity.left}
                onPaneWidthChange={(left) =>
                  setPaneWidths((current) => ({ ...current, activity: { left } }))
                }
                onCancel={cancelActivity}
                onError={showError}
                onReady={markActivityReady}
                focusRequest={activityFocusRequest}
              />
            </Suspense>
          ) : null}

          <div className="app-content" hidden={page !== 'workspace' && page !== 'repositories'}>
            {repo && page === 'workspace' ? (
              <>
                {operationActions ? (
                  <section
                    className={`operation-banner${sidebarVisible ? ' is-right-pane' : ''}`}
                    aria-label={t('gitOperationInProgress')}
                  >
                    <div>
                      <strong>{message(operationActions.label)}</strong>
                      <span>
                        {t('unresolvedCount', { count: operationActions.unresolvedCount })}
                      </span>
                    </div>
                    <div className="button-row compact">
                      <Button
                        type="button"
                        disabled={!operationActions.canContinue || busy || repositoryUnavailable}
                        onClick={() => requestOperationAction({ kind: 'continueOperation' })}
                      >
                        {t('continueAction')}
                      </Button>
                      {operationActions.canSkip ? (
                        <Button
                          type="button"
                          disabled={busy || repositoryUnavailable}
                          onClick={() => requestOperationAction({ kind: 'skipOperation' })}
                        >
                          {t('skipAction')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="dangerQuiet"
                        disabled={!operationActions.canAbort || busy || repositoryUnavailable}
                        onClick={() => requestOperationAction({ kind: 'abortOperation' })}
                      >
                        {t('abortAction')}
                      </Button>
                    </div>
                  </section>
                ) : null}

                <main className="workspace-main">
                  {workspaceViewTransition ? (
                    <div
                      className="workspace-view-transition"
                      data-testid="workspace-view-transition"
                      aria-busy="true"
                      style={workspaceViewTransitionStyle}
                    >
                      <div className="workspace-view-transition-pane" />
                      <div className="workspace-view-transition-divider" />
                      <div className="workspace-view-transition-pane" />
                      <LoadingIndicator />
                    </div>
                  ) : view === 'diff' ? (
                    <DiffView
                      key={`diff:${repo.repoId}:${workspaceViewRevision}`}
                      repo={repo}
                      adapter={adapter}
                      externalConflict={latestConflict}
                      busy={busy || repositoryUnavailable}
                      onError={showError}
                      onAction={runAction}
                      onUnsavedDirtyChange={handleUnsavedDirtyChange}
                      onUnsavedLeaveHandleChange={(handle) => {
                        leaveHandleRef.current = handle;
                      }}
                      paneWidths={paneWidths.diff}
                      diffStyle={diffStyle}
                      imagePreviewLayout={imagePreviewLayout}
                      splitStageView={splitStageView}
                      diffFileListDisplay={diffFileListDisplay}
                      useConventionalCommits={useConventionalCommits}
                      stickyFileHeaders={stickyFileHeaders}
                      editorLineWrapping={editorLineWrapping}
                      editorWrapColumn={editorWrapColumn}
                      onPaneWidthsChange={(diff) =>
                        setPaneWidths((current) => ({ ...current, diff }))
                      }
                    />
                  ) : (
                    <HistoryView
                      key={`history:${repo.repoId}`}
                      repo={repo}
                      adapter={adapter}
                      busy={busy || repositoryUnavailable}
                      onError={showError}
                      onShowDiff={() => requestNavigation({ page: 'workspace', view: 'diff' })}
                      onAction={runAction}
                      diffStyle={diffStyle}
                      imagePreviewLayout={imagePreviewLayout}
                      lineWrapping={editorLineWrapping}
                      wrapColumn={editorWrapColumn}
                      stickyFileHeaders={stickyFileHeaders}
                      paneWidths={paneWidths.history}
                      onPaneWidthsChange={({ left }) =>
                        setPaneWidths((current) => ({ ...current, history: { left } }))
                      }
                    />
                  )}
                </main>
              </>
            ) : (
              <RepositoryLanding
                repositories={orderedRegisteredRepositories}
                currentPath={repo?.path}
                focusFirst={repositoryLandingVisible}
                busy={busy}
                onAdd={openRepositoryDialog}
                onOpen={(path) => settleUiAction(openRegisteredRepository(path))}
                onRepair={(path) => settleUiAction(chooseRelocatedRepository(path))}
                onManageRemotes={(path) => settleUiAction(openRemoteManager(path))}
                onForget={requestForgetRepository}
              />
            )}
          </div>

          {availableUpdate && updateDialogOpen ? (
            <Dialog
              labelledBy="app-update-title"
              describedBy="app-update-description"
              role="alertdialog"
              dismissible={!updateInstalling}
              onDismiss={() => {
                if (!updateInstalling) setUpdateDialogOpen(false);
              }}
            >
              <DialogHeader
                titleId="app-update-title"
                title={t('updateAvailableTitle')}
                descriptionId="app-update-description"
                description={t('updateVersionDescription', {
                  current: availableUpdate.currentVersion,
                  version: availableUpdate.version,
                })}
              />
              <DialogBody>
                {availableUpdate.notes ? (
                  <p className="app-update-notes">{availableUpdate.notes}</p>
                ) : null}
                {updateInstalling ? <LoadingIndicator className="app-update-loading" /> : null}
                {updateBlocked ? (
                  <p className="field-error">{t('finishWorkBeforeUpdate')}</p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus={updateBlocked}
                  disabled={updateInstalling}
                  onClick={() => setUpdateDialogOpen(false)}
                >
                  {t('later')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  data-dialog-initial-focus={!updateBlocked}
                  disabled={updateBlocked || updateInstalling}
                  onClick={requestAppUpdate}
                >
                  {t('updateAndRestart')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {availableUpdate && pendingUpdateInstall ? (
            <Dialog
              labelledBy="unsaved-update-title"
              role="alertdialog"
              onDismiss={() => {
                setPendingUpdateInstall(false);
                setUpdateDialogOpen(true);
              }}
            >
              <DialogHeader
                titleId="unsaved-update-title"
                title={t('unsavedChanges')}
                description={t('saveOrDiscardBeforeUpdate')}
              />
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => {
                    setPendingUpdateInstall(false);
                    setUpdateDialogOpen(true);
                  }}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="dangerQuiet"
                  onClick={() => settleUiAction(beginAppUpdate(false, true))}
                >
                  {t('updateWithoutSaving')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => settleUiAction(beginAppUpdate(true))}
                >
                  {t('saveAndUpdate')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {repositorySwitcherOpen && repo ? (
            <RepositorySwitcherDialog
              repos={workspace.repos}
              registeredRepositories={orderedRegisteredRepositories}
              selectedRepoId={repo.repoId}
              busy={busy}
              onDismiss={() => setRepositorySwitcherOpen(false)}
              onSelectOpen={(repoId) => {
                if (repoId === repo.repoId) return;
                requestNavigation({ repoId });
              }}
              onSelectRegistered={(path) => {
                const registration = registeredRepositories.find(
                  (candidate) => candidate.path === path,
                );
                if (registration?.availability && registration.availability !== 'available') {
                  settleUiAction(chooseRelocatedRepository(path));
                } else {
                  settleUiAction(openRegisteredRepository(path));
                }
              }}
              onManageRemotes={(path) => settleUiAction(openRemoteManager(path))}
              onForget={(path) => {
                requestForgetRepository(path);
              }}
              onAdd={openRepositoryDialog}
            />
          ) : null}

          {remoteManager ? (
            <RemoteManagerDialog
              repositoryName={
                repositoryNames[remoteManager.path] ??
                repositoryNameFromPath(remoteManager.path) ??
                remoteManager.path
              }
              repositoryPath={remoteManager.path}
              remotes={remoteManager.remotes}
              loading={remoteManager.loading}
              busy={busy}
              {...(remoteManager.error ? { error: remoteManager.error } : {})}
              onDismiss={() => setRemoteManager(undefined)}
              onReload={() =>
                settleUiAction(loadRemoteManager(remoteManager.repoId, remoteManager.path))
              }
              onChoosePath={() => chooseDirectory(t('chooseRelocatedRepository'))}
              onSave={(information) =>
                settleUiAction(saveRepositoryInformation(information, remoteManager))
              }
            />
          ) : null}

          {unavailableRepoPath ? (
            <Dialog
              labelledBy="repository-unavailable-title"
              describedBy="repository-unavailable-description"
              role="alertdialog"
              dismissible={!unavailableRepo && !unsavedDirtyRef.current}
              onDismiss={() => {
                if (!unavailableRepo && !unsavedDirtyRef.current) setUnavailableRepoPath(undefined);
              }}
            >
              <DialogHeader
                titleId="repository-unavailable-title"
                title={t('repositoryLocationUnavailableTitle')}
                descriptionId="repository-unavailable-description"
                description={
                  unavailableRepo && unsavedDirtyRef.current
                    ? t('repositoryLocationUnavailableWithDraft')
                    : t('repositoryLocationUnavailableDescription')
                }
              />
              <DialogBody>
                <code className="repository-relocation-path">{unavailableRepoPath}</code>
                {unavailableRepo?.operation.kind !== 'none' ? (
                  <p className="field-error">{t('forgetRepositoryOperationBlocked')}</p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                {!unavailableRepo || !unsavedDirtyRef.current ? (
                  <Button
                    type="button"
                    data-dialog-initial-focus
                    onClick={() => setUnavailableRepoPath(undefined)}
                  >
                    {t('cancel')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  data-dialog-initial-focus={Boolean(unavailableRepo && unsavedDirtyRef.current)}
                  disabled={busy}
                  onClick={() => settleUiAction(chooseRelocatedRepository(unavailableRepoPath))}
                >
                  {t('repairRepositoryLocation')}
                </Button>
                {unavailableRepo ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={busy || unavailableRepo.operation.kind !== 'none'}
                    onClick={() =>
                      settleUiAction(
                        (async () => {
                          unsavedDirtyRef.current = false;
                          setWorkspaceViewRevision((current) => current + 1);
                          await disconnectRepository(unavailableRepo);
                          setUnavailableRepoPath(undefined);
                        })(),
                      )
                    }
                  >
                    {t('discardAndCloseRepository')}
                  </Button>
                ) : null}
              </DialogFooter>
            </Dialog>
          ) : null}

          {relocation ? (
            <Dialog
              labelledBy="repository-relocation-title"
              describedBy="repository-relocation-description"
              role="alertdialog"
              dismissible={!busy}
              onDismiss={() => setRelocation(undefined)}
            >
              <DialogHeader
                titleId="repository-relocation-title"
                title={
                  relocation.duplicate
                    ? t('repositoryAlreadyRegisteredTitle')
                    : t('confirmRepositoryRelocation')
                }
                descriptionId="repository-relocation-description"
                description={
                  relocation.duplicate
                    ? t('repositoryAlreadyRegisteredDescription')
                    : t('repositoryRelocationDescription')
                }
              />
              <DialogBody>
                <dl className="repository-relocation-paths">
                  <div>
                    <dt>{t('oldRepositoryLocation')}</dt>
                    <dd>
                      <code>{relocation.oldPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('newRepositoryLocation')}</dt>
                    <dd>
                      <code>{relocation.newPath}</code>
                    </dd>
                  </div>
                </dl>
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  disabled={busy}
                  onClick={() => setRelocation(undefined)}
                >
                  {t('cancel')}
                </Button>
                {relocation.duplicate ? (
                  <>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const path = relocation.newPath;
                        setRelocation(undefined);
                        settleUiAction(attach({ kind: 'openExisting', path }));
                      }}
                    >
                      {t('openRegisteredRepository')}
                    </Button>
                    <Button
                      type="button"
                      variant="dangerQuiet"
                      disabled={busy}
                      onClick={() => {
                        const path = relocation.oldPath;
                        setRelocation(undefined);
                        requestForgetRepository(path);
                      }}
                    >
                      {t('forgetOldRepository')}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    onClick={() => settleUiAction(confirmRepositoryRelocation())}
                  >
                    {t('replaceRepositoryLocation')}
                  </Button>
                )}
              </DialogFooter>
            </Dialog>
          ) : null}

          {pendingForgetPath ? (
            <Dialog
              labelledBy="forget-repository-title"
              describedBy="forget-repository-description"
              role="alertdialog"
              dismissible={!busy}
              onDismiss={() => setPendingForgetPath(undefined)}
            >
              <DialogHeader
                titleId="forget-repository-title"
                title={t('forgetRepositoryTitle')}
                descriptionId="forget-repository-description"
                description={t('forgetRepositoryDescription', {
                  repository: pendingForgetRepository?.name ?? pendingForgetPath,
                })}
              />
              <DialogBody>
                {workspace.repos.some(
                  (candidate) =>
                    candidate.path === pendingForgetPath &&
                    candidate.repoId === workspace.selectedRepoId &&
                    unsavedDirtyRef.current,
                ) ? (
                  <p className="field-error">{t('unsavedChangesWillBeDiscarded')}</p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  disabled={busy}
                  onClick={() => setPendingForgetPath(undefined)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="dangerQuiet"
                  disabled={busy}
                  onClick={() => settleUiAction(confirmRepositoryRemoval(false))}
                >
                  {t('forgetRepository')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={
                    busy ||
                    (pendingForgetRepository?.availability !== undefined &&
                      pendingForgetRepository.availability !== 'available')
                  }
                  onClick={() => settleUiAction(confirmRepositoryRemoval(true))}
                >
                  {t('moveRepositoryToTrash')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {branchDialog && !branchDialog.loading && branchDialogRepo ? (
            <BranchSwitcherDialog
              repo={branchDialogRepo}
              branches={branchDialog.branches}
              loading={branchDialog.loading}
              busy={busy}
              {...(branchDialog.error ? { error: branchDialog.error } : {})}
              onDismiss={() => setBranchDialog(undefined)}
              onCheckout={(branchName) => {
                setBranchDialog(undefined);
                requestUnsavedGuardedAction({ kind: 'checkoutBranch', name: branchName });
              }}
              onCreate={(branchName, startOid) => {
                setBranchDialog(undefined);
                requestUnsavedGuardedAction({
                  kind: 'createBranch',
                  name: branchName,
                  startOid,
                  checkout: true,
                });
              }}
              onDelete={(branchName) => {
                const repoId = branchDialog.repoId;
                setBranchDialog(undefined);
                settleUiAction(runAction({ kind: 'deleteBranch', name: branchName }, repoId));
              }}
            />
          ) : null}

          {pendingAction ? (
            <Dialog
              labelledBy="action-preview-title"
              role="alertdialog"
              onDismiss={() => setPendingAction(undefined)}
            >
              <DialogHeader
                titleId="action-preview-title"
                title={message(pendingAction.preview.title)}
                description={message(pendingAction.preview.summary)}
              />
              <DialogBody>
                {pendingAction.preview.resolvedTargets.length ? (
                  <dl className="preview-targets">
                    {pendingAction.preview.resolvedTargets.map((target) => (
                      <div key={`${target.input}:${target.oid}`}>
                        <dt>{target.input}</dt>
                        <dd>
                          <code>{target.oid.slice(0, 12)}</code>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {pendingAction.preview.affectedPaths.length ? (
                  <section aria-labelledby="affected-paths-title">
                    <h3 id="affected-paths-title">{t('affectedPaths')}</h3>
                    <ul className="affected-paths">
                      {pendingAction.preview.affectedPaths.map((path) => (
                        <li key={path}>
                          <code>{path}</code>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {pendingAction.preview.affectedCommits.length ? (
                  <section aria-labelledby="affected-commits-title">
                    <h3 id="affected-commits-title">{t('affectedCommits')}</h3>
                    <ul className="affected-commits">
                      {pendingAction.preview.affectedCommits.map((oid) => (
                        <li key={oid}>
                          <code>{oid.slice(0, 12)}</code>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {pendingAction.preview.lostCommitOids.length ? (
                  <section aria-labelledby="lost-commits-title">
                    <h3 id="lost-commits-title">{t('removedCommits')}</h3>
                    <ul className="affected-commits">
                      {pendingAction.preview.lostCommitOids.map((oid) => (
                        <li key={oid}>
                          <code>{oid.slice(0, 12)}</code>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {pendingAction.preview.remoteEffect ? (
                  <p>{message(pendingAction.preview.remoteEffect)}</p>
                ) : null}
                {pendingAction.preview.typedConfirmation ? (
                  <label>
                    <span>
                      {t('typeToConfirm', { value: pendingAction.preview.typedConfirmation })}
                    </span>
                    <Input
                      value={typedConfirmation}
                      onChange={(event) => setTypedConfirmation(event.target.value)}
                    />
                  </label>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingAction(undefined)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant={pendingAction.preview.destructive ? 'danger' : 'primary'}
                  disabled={
                    Boolean(pendingAction.preview.typedConfirmation) &&
                    typedConfirmation !== pendingAction.preview.typedConfirmation
                  }
                  onClick={() => settleUiAction(confirmAction())}
                >
                  {confirmationActionLabel(pendingAction.request.action, t)}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {pendingNavigation ? (
            <Dialog
              labelledBy="leave-conflict-title"
              role="alertdialog"
              onDismiss={() => setPendingNavigation(undefined)}
            >
              <DialogHeader
                titleId="leave-conflict-title"
                title={t('unsavedChanges')}
                description={t('saveOrDiscardBeforeLeaving')}
              />
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingNavigation(undefined)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="dangerQuiet"
                  onClick={() => performNavigation(pendingNavigation, true)}
                >
                  {t('leaveWithoutSaving')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => settleUiAction(saveAndNavigate())}
                >
                  {t('saveAndLeave')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {pendingOperationAction ? (
            <Dialog
              labelledBy="leave-operation-title"
              role="alertdialog"
              onDismiss={() => setPendingOperationAction(undefined)}
            >
              <DialogHeader
                titleId="leave-operation-title"
                title={t('unsavedResult')}
                description={t(
                  pendingOperationAction.kind === 'continueOperation'
                    ? 'discardBeforeContinue'
                    : pendingOperationAction.kind === 'skipOperation'
                      ? 'discardBeforeSkip'
                      : 'discardBeforeAbort',
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingOperationAction(undefined)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => settleUiAction(runPendingOperationAction(true))}
                >
                  {pendingOperationAction.kind === 'continueOperation'
                    ? t('discardAndContinue')
                    : pendingOperationAction.kind === 'skipOperation'
                      ? t('discardAndSkip')
                      : t('discardAndAbort')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {pendingUnsavedAction ? (
            <Dialog
              labelledBy="unsaved-action-title"
              role="alertdialog"
              onDismiss={() => setPendingUnsavedAction(undefined)}
            >
              <DialogHeader
                titleId="unsaved-action-title"
                title={t('unsavedChanges')}
                description={t('saveOrDiscardBeforeAction')}
              />
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingUnsavedAction(undefined)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="dangerQuiet"
                  onClick={() => settleUiAction(runPendingUnsavedAction(false))}
                >
                  {t('leaveWithoutSaving')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => settleUiAction(runPendingUnsavedAction(true))}
                >
                  {t('saveAndLeave')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {pendingWindowClose ? (
            <Dialog
              labelledBy="unsaved-close-title"
              role="alertdialog"
              onDismiss={() => setPendingWindowClose(false)}
            >
              <DialogHeader
                titleId="unsaved-close-title"
                title={t('unsavedChanges')}
                description={t('saveOrDiscardBeforeClosing')}
              />
              <DialogFooter>
                <Button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingWindowClose(false)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="dangerQuiet"
                  onClick={() => settleUiAction(completeWindowClose(false))}
                >
                  {t('closeWithoutSaving')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => settleUiAction(completeWindowClose(true))}
                >
                  {t('saveAndClose')}
                </Button>
              </DialogFooter>
            </Dialog>
          ) : null}

          {addRepositoryDialog ? (
            <AddRepositoryDialog
              source={addRepositoryDialog.source}
              url={addRepositoryDialog.url}
              cloneParentPath={addRepositoryDialog.cloneParentPath}
              localPath={addRepositoryDialog.localPath}
              remoteName={addRepositoryDialog.remoteName}
              localName={addRepositoryDialog.localName}
              {...(addRepositoryDialog.error ? { error: addRepositoryDialog.error } : {})}
              {...(addRepositoryDialog.errorField
                ? { errorField: addRepositoryDialog.errorField }
                : {})}
              busy={busy}
              onSourceChange={(source) =>
                setAddRepositoryDialog((current) => {
                  if (!current) return current;
                  const { error: _error, errorField: _errorField, ...values } = current;
                  return { ...values, source };
                })
              }
              onUrlChange={(url) =>
                setAddRepositoryDialog((current) => {
                  if (!current) return current;
                  const previousInferredName = repositoryNameFromRemoteUrl(current.url);
                  const nextInferredName = repositoryNameFromRemoteUrl(url);
                  return {
                    source: current.source,
                    url,
                    cloneParentPath: current.cloneParentPath,
                    localPath: current.localPath,
                    remoteName:
                      !current.remoteName || current.remoteName === previousInferredName
                        ? (nextInferredName ?? '')
                        : current.remoteName,
                    localName: current.localName,
                  };
                })
              }
              onCloneParentPathChange={(cloneParentPath) =>
                setAddRepositoryDialog((current) =>
                  current
                    ? {
                        source: current.source,
                        url: current.url,
                        cloneParentPath,
                        localPath: current.localPath,
                        remoteName: current.remoteName,
                        localName: current.localName,
                      }
                    : current,
                )
              }
              onLocalPathChange={(localPath) =>
                setAddRepositoryDialog((current) => {
                  if (!current) return current;
                  const previousInferredName = repositoryNameFromPath(current.localPath);
                  const nextInferredName = repositoryNameFromPath(localPath);
                  return {
                    source: current.source,
                    url: current.url,
                    cloneParentPath: current.cloneParentPath,
                    localPath,
                    remoteName: current.remoteName,
                    localName:
                      !current.localName || current.localName === previousInferredName
                        ? (nextInferredName ?? '')
                        : current.localName,
                  };
                })
              }
              onRemoteNameChange={(remoteName) =>
                setAddRepositoryDialog((current) =>
                  current ? { ...current, remoteName } : current,
                )
              }
              onLocalNameChange={(localName) =>
                setAddRepositoryDialog((current) => (current ? { ...current, localName } : current))
              }
              onChoosePath={() => settleUiAction(chooseRepositoryPath())}
              onDismiss={() => setAddRepositoryDialog(undefined)}
              onSubmit={() => settleUiAction(submitAddRepository())}
            />
          ) : null}

          {activeError ? (
            <WorkspaceErrorDialog
              key={activeError.id}
              title={activeError.title}
              error={activeError}
              onDismiss={dismissError}
            />
          ) : null}
        </div>
      </AppearanceProvider>
    </I18nProvider>
  );
}

function NoticeContent({ notice }: { notice: AppNotice }) {
  const { message } = useI18n();
  return <span>{message(notice.message)}</span>;
}
