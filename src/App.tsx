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
  Files,
  FolderGit2,
  GitBranch,
  History as HistoryIcon,
  Settings as SettingsIcon,
} from 'lucide-react';

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
} from './domain/repositoryLocation';
import { ChangesView } from './features/changes/ChangesView';
import type { ConflictLeaveHandle } from './features/conflict/ConflictSurface';
import { mergeActivityEntries } from './features/activity/activityPersistence';
import { HistoryView } from './features/history/HistoryView';
import { SettingsView } from './features/settings/SettingsView';
import { listenForOpenSettings } from './features/settings/settingsMenu';
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
import { Dialog } from './ui/Dialog';
import { BranchSwitcherDialog } from './ui/BranchSwitcherDialog';
import { RepositorySwitcherDialog } from './ui/RepositorySwitcherDialog';
import {
  markWorkspaceErrorHandled,
  WorkspaceErrorDialog,
  type ShowWorkspaceError,
} from './ui/WorkspaceErrorDialog';
import { describeWorkspaceError, type WorkspaceErrorContent } from './ui/WorkspaceErrorDetails';
import {
  CHANGES_PANE_MIN_WIDTH,
  readPreferences,
  rememberRepositoryPath,
  updatePreferences,
  type PaneWidthPreferences,
} from './persistence/preferences';
import {
  AppearanceProvider,
  applyAppearance,
  applyNativeAppearance,
  type Appearance,
} from './theme/appearance';

const EMPTY_WORKSPACE: WorkspaceSnapshot = { repos: [], activities: [] };
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

type AppPage = 'workspace' | 'activity' | 'settings';

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
  path: string;
  name: string;
  error?: string;
}

interface BranchDialogState {
  requestId: number;
  repoId: string;
  branches: BranchSummary[];
  loading: boolean;
  error?: string;
}

type WorkspaceViewTransitionStyle = CSSProperties & { '--left-pane': string };

function actionNeedsPreview(action: WorkspaceAction): boolean {
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
    'createTag',
    'abortOperation',
    'materializeConflict',
  ].includes(action.kind);
}

function confirmationActionLabel(action: WorkspaceAction, t: I18nValue['t']): string {
  if (action.kind === 'fileAction' && action.operation === 'moveToTrash') return t('deleteFiles');
  if (action.kind === 'discardFiles') return t('discardFiles');
  return t('run');
}

function repositoryState(
  repo: RepoSnapshot,
  t: I18nValue['t'],
  message: I18nValue['message'],
): { label: string; tone: 'danger' | 'warning' } | undefined {
  if (repo.operation.kind !== 'none')
    return { label: message(repo.operation.label), tone: 'danger' };
  if (repo.changes.length) return { label: t('hasChanges'), tone: 'warning' };
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
  const next: WorkspaceSnapshot = { repos: workspace.repos, activities: workspace.activities };
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
  const [view, setView] = useState<WorkspaceView>(initialPreferences.view);
  const [appearance, setAppearance] = useState<Appearance>(initialPreferences.appearance);
  const [language, setLanguage] = useState<Language>(initialPreferences.language);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(initialPreferences.diffStyle);
  const [splitStageView, setSplitStageView] = useState(initialPreferences.splitStageView);
  const [toolchainStatus, setToolchainStatus] = useState<ToolchainStatus>();
  const [toolchainBusy, setToolchainBusy] = useState(false);
  const t = useCallback<I18nValue['t']>((id, args) => translate(language, id, args), [language]);
  const message = useCallback<I18nValue['message']>(
    (value) => translate(language, value.id, value.args),
    [language],
  );
  const [page, setPage] = useState<AppPage>('workspace');
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0);
  const [activityFocusRequest, setActivityFocusRequest] = useState(0);
  const [activityReady, setActivityReady] = useState(false);
  const [cloneToStart, setCloneToStart] = useState<PendingClone>();
  const [paneWidths, setPaneWidths] = useState<PaneWidthPreferences>(initialPreferences.paneWidths);
  const [registeredPaths, setRegisteredPaths] = useState(initialPreferences.registeredRepoPaths);
  const [repositoryNames, setRepositoryNames] = useState(initialPreferences.repositoryNames);
  const [repositoryLogoUrls, setRepositoryLogoUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AppNotice>();
  const [errors, setErrors] = useState<AppError[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [latestConflict, setLatestConflict] = useState<ConflictDocument>();
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>();
  const [pendingOperationAction, setPendingOperationAction] = useState<GuardedOperationAction>();
  const [workspaceViewRevision, setWorkspaceViewRevision] = useState(0);
  const [workspaceViewTransition, setWorkspaceViewTransition] = useState<WorkspaceView>();
  const [addRepositoryDialog, setAddRepositoryDialog] = useState<AddRepositoryState>();
  const [repositorySwitcherOpen, setRepositorySwitcherOpen] = useState(false);
  const [branchDialog, setBranchDialog] = useState<BranchDialogState>();
  const [branchControlFocused, setBranchControlFocused] = useState(false);
  const [restoringWorkspace, setRestoringWorkspace] = useState(
    initialPreferences.openRepoPaths.length > 0,
  );
  const leaveHandleRef = useRef<ConflictLeaveHandle | null>(null);
  const conflictDirtyRef = useRef(false);
  const workspaceRef = useRef(workspace);
  const pageRef = useRef(page);
  const restorePromiseRef = useRef<Promise<RepoSnapshot[]> | undefined>(undefined);
  const pollingRef = useRef(false);
  const pendingPollingRef = useRef(false);
  const requestNavigationRef = useRef<(navigation: PendingNavigation) => void>(() => undefined);
  const activityButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusRepositoriesOnWorkspaceRef = useRef(false);
  const errorIdRef = useRef(0);
  const logoRequestsRef = useRef(new Set<string>());
  const branchRequestIdRef = useRef(0);
  const workspaceViewTransitionTimerRef = useRef<number | undefined>(undefined);
  const repo = selectedRepo(workspace);
  const effectiveRepositoryLogoLoader =
    repositoryLogoLoader ?? (providedAdapter ? undefined : loadRepositoryLogo);
  const registeredRepositories = useMemo<RepositoryListItem[]>(
    () =>
      registeredPaths.map((path) => ({
        path,
        name: repositoryNames[path] ?? repositoryNameFromPath(path) ?? path,
        ...(repositoryLogoUrls[path] ? { logoUrl: repositoryLogoUrls[path] } : {}),
      })),
    [registeredPaths, repositoryLogoUrls, repositoryNames],
  );
  const repoDisplayName = repo
    ? (registeredRepositories.find((candidate) => candidate.path === repo.path)?.name ?? repo.name)
    : undefined;
  pageRef.current = page;
  const handleConflictDirtyChange = useCallback((dirty: boolean): void => {
    conflictDirtyRef.current = dirty;
  }, []);
  const showError = useCallback<ShowWorkspaceError>((title, cause, fallback): void => {
    const content = describeWorkspaceError(cause, fallback);
    errorIdRef.current += 1;
    setErrors((current) => [...current, { id: errorIdRef.current, title, ...content }]);
  }, []);
  const dismissError = useCallback((): void => {
    setErrors((current) => current.slice(1));
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

  useEffect(() => {
    applyAppearance(appearance);
    void applyNativeAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    applyDocumentLanguage(language);
    void applyNativeLanguage(language).catch(() => undefined);
  }, [language]);

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
    if (page === 'settings') settingsButtonRef.current?.focus();
    if (page === 'activity') activityButtonRef.current?.focus();
  }, [activityFocusRequest, page, settingsFocusRequest]);

  useEffect(() => {
    if (page !== 'workspace' || repo || !focusRepositoriesOnWorkspaceRef.current) return;
    focusRepositoriesOnWorkspaceRef.current = false;
    document.getElementById('repositories-title')?.focus();
  }, [page, repo]);

  useEffect(() => {
    workspaceRef.current = workspace;
    if (restoringWorkspace) return;
    updatePreferences((current) => ({
      ...current,
      appearance,
      language,
      diffStyle,
      splitStageView,
      openRepoPaths: workspace.repos.map((candidate) => candidate.path),
      ...(repo ? { selectedRepoPath: repo.path } : {}),
      view,
      paneWidths,
    }));
  }, [
    appearance,
    diffStyle,
    language,
    paneWidths,
    repo,
    restoringWorkspace,
    splitStageView,
    view,
    workspace,
  ]);

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
    const preferences = initialPreferences;
    if (!preferences.openRepoPaths.length) return () => undefined;
    let active = true;
    const restorePromise =
      restorePromiseRef.current ??
      Promise.allSettled(
        preferences.openRepoPaths.map((path) => adapter.attach({ kind: 'openExisting', path })),
      ).then((results) =>
        results.flatMap((result) => (result.status === 'fulfilled' ? result.value.repos : [])),
      );
    restorePromiseRef.current = restorePromise;
    void restorePromise.then((restored) => {
      if (!active) return;
      const selected =
        restored.find((candidate) => candidate.path === preferences.selectedRepoPath) ??
        restored[0];
      if (selected)
        setWorkspace((current) =>
          selectWorkspaceRepo(restored.reduce(replaceRepo, current), selected.repoId),
        );
      setRestoringWorkspace(false);
    });
    return () => {
      active = false;
    };
  }, [adapter, initialPreferences]);

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
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void poll(true);
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
  }, [adapter]);

  const attach = useCallback(
    async (request: AttachRequest, repositoryName?: string): Promise<void> => {
      setBusy(true);
      setNotice(undefined);
      try {
        const attached = await adapter.attach(request);
        setWorkspace((current) => {
          const withRepos = attached.repos.reduce(replaceRepo, current);
          return {
            ...withRepos,
            activities: mergeActivityEntries(attached.activities, current.activities),
          };
        });
        const attachedRepoId = attached.selectedRepoId ?? attached.repos[0]?.repoId;
        const attachedPath = attached.repos[0]?.path;
        if (attachedPath) {
          const preferences = rememberRepositoryPath(attachedPath, repositoryName);
          setRegisteredPaths(preferences.registeredRepoPaths);
          setRepositoryNames(preferences.repositoryNames);
        }
        setAddRepositoryDialog(undefined);
        if (attachedRepoId) {
          requestNavigationRef.current({
            repoId: attachedRepoId,
            ...(request.kind === 'clone' ? {} : { page: 'workspace', view: 'changes' }),
          });
        }
      } catch (cause) {
        if (cause instanceof WorkspaceAdapterError && cause.code === 'cancelled') {
          setNotice({ level: 'info', message: { id: 'errorCancelled' } });
        } else {
          showError(t('openRepositoryFailedTitle'), cause, t('openRepositoryFailed'));
        }
      } finally {
        setBusy(false);
      }
    },
    [adapter, showError, t],
  );

  useEffect(() => {
    if (page !== 'activity' || !activityReady || !cloneToStart) return;
    const { request, repositoryName } = cloneToStart;
    setCloneToStart(undefined);
    settleUiAction(repositoryName ? attach(request, repositoryName) : attach(request));
  }, [activityReady, attach, cloneToStart, page]);

  const openAddRepositoryDialog = (): void => {
    setRepositorySwitcherOpen(false);
    setBranchDialog(undefined);
    setAddRepositoryDialog({ source: 'url', url: '', path: '', name: '' });
  };

  const chooseDirectory = async (title: string): Promise<string | null> => {
    try {
      return await directoryPicker(title);
    } catch (cause) {
      showError(t('openRepositoryFailedTitle'), cause, t('chooseDirectoryFailed'));
      return null;
    }
  };

  const chooseLocalRepository = async (): Promise<void> => {
    const path = await chooseDirectory(t('chooseRepositoryDirectory'));
    if (path) {
      setAddRepositoryDialog((current) =>
        current ? { source: 'path', url: current.url, path, name: current.name } : current,
      );
    }
  };

  const submitAddRepository = async (): Promise<void> => {
    if (!addRepositoryDialog) return;
    const repositoryName = addRepositoryDialog.name.trim() || undefined;
    if (addRepositoryDialog.source === 'path') {
      const path = addRepositoryDialog.path.trim();
      if (!isAbsoluteLocalPath(path)) {
        setAddRepositoryDialog((current) =>
          current ? { ...current, error: t('invalidRepositoryPath') } : current,
        );
        return;
      }
      await (repositoryName
        ? attach({ kind: 'open', path }, repositoryName)
        : attach({ kind: 'open', path }));
      return;
    }

    const remoteUrl = addRepositoryDialog.url.trim();
    const inferredName = repositoryNameFromRemoteUrl(remoteUrl);
    if (!inferredName) {
      setAddRepositoryDialog((current) =>
        current ? { ...current, error: t('invalidRepositoryUrl') } : current,
      );
      return;
    }

    const parent = await chooseDirectory(t('chooseCloneParentDirectory'));
    if (!parent) return;
    requestNavigationRef.current({
      page: 'activity',
      cloneRequest: {
        kind: 'clone',
        remoteUrl,
        destination: joinRepositoryPath(parent, inferredName),
      },
      ...(repositoryName ? { repositoryName } : {}),
    });
  };

  const openRepositorySwitcher = useCallback((): void => {
    if (!workspaceRef.current.repos.length) return;
    setBranchDialog(undefined);
    setRepositorySwitcherOpen(true);
  }, []);

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
    setBusy(true);
    setNotice(undefined);
    try {
      const outcome = await adapter.execute(request);
      applyOutcome(outcome.snapshot);
      if (outcome.conflictDocument) setLatestConflict(outcome.conflictDocument);
    } catch (cause) {
      if (request.action.kind === 'pullFastForward' && isPullDivergenceError(cause)) throw cause;
      showError(t('operationFailedTitle'), cause, t('operationFailed'));
      throw markWorkspaceErrorHandled(cause, t('operationFailed'));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: WorkspaceAction): Promise<void> => {
    if (!repo) return;
    const request: ActionRequest = {
      repoId: repo.repoId,
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

  const requestOperationAction = (action: GuardedOperationAction): void => {
    if (conflictDirtyRef.current) {
      setPendingOperationAction(action);
      return;
    }
    settleUiAction(runAction(action));
  };

  const runPendingOperationAction = async (discardConflict: boolean): Promise<void> => {
    if (!pendingOperationAction) return;
    const action = pendingOperationAction;
    setPendingOperationAction(undefined);
    if (discardConflict) setWorkspaceViewRevision((current) => current + 1);
    conflictDirtyRef.current = false;
    await runAction(action);
  };

  const confirmAction = async (): Promise<void> => {
    if (!pendingAction) return;
    const request: ActionRequest = {
      ...pendingAction.request,
      preview: pendingAction.preview,
    };
    setPendingAction(undefined);
    await execute(request);
  };

  const performNavigation = useCallback(
    (
      { repoId, view: nextView, page: nextPage, cloneRequest, repositoryName }: PendingNavigation,
      discardConflict = false,
    ): void => {
      if (discardConflict) setWorkspaceViewRevision((current) => current + 1);
      if (repoId) setWorkspace((current) => ({ ...current, selectedRepoId: repoId }));
      if (nextView) setView(nextView);
      if (nextPage) setPage(nextPage);
      if (nextPage === 'settings' || nextPage === 'activity') {
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
      conflictDirtyRef.current = false;
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
      if (conflictDirtyRef.current) {
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
        // 非前面のWKWebViewでも遷移を完了できるtaskへ分け、旧画面の内容を先に破棄します。
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

  const cancelActivity = async (entry: ActivityEntry): Promise<void> => {
    try {
      await adapter.cancel({ repoId: entry.repoId, activityId: entry.id });
    } catch (cause) {
      showError(t('cancelOperationFailedTitle'), cause, t('cancelOperationFailed'));
    }
  };

  const operationActions = repo && repo.operation.kind !== 'none' ? repo.operation : undefined;
  const currentActivities = workspace.activities;
  const hasRunningActivity = currentActivities.some((entry) => entry.status === 'running');
  const activeError = errors[0];
  const currentRepositoryState = repo ? repositoryState(repo, t, message) : undefined;
  const showActivityMenu = Boolean(repo) || hasRunningActivity || page === 'activity';
  const showRepositoryMenu = !repo && page !== 'workspace';
  const activeWorkspaceView = workspaceViewTransition ?? view;
  const workspaceViewTransitionStyle: WorkspaceViewTransitionStyle | undefined =
    workspaceViewTransition
      ? {
          '--left-pane': `${
            workspaceViewTransition === 'changes'
              ? Math.max(CHANGES_PANE_MIN_WIDTH, paneWidths.changes.left)
              : paneWidths.history.left
          }px`,
        }
      : undefined;
  const branchDialogRepo = branchDialog
    ? workspace.repos.find((candidate) => candidate.repoId === branchDialog.repoId)
    : undefined;

  if (restoringWorkspace) {
    return (
      <I18nProvider language={language}>
        <AppearanceProvider appearance={appearance}>
          <div className="app-shell" data-testid="app-shell" aria-busy="true">
            <header className="titlebar" data-tauri-drag-region />
          </div>
        </AppearanceProvider>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={language}>
      <AppearanceProvider appearance={appearance}>
        <div className="app-shell" data-testid="app-shell">
          <header className="titlebar" data-tauri-drag-region>
            <nav
              className="titlebar-context"
              aria-label={t('workspaceContext')}
              data-tauri-drag-region
            >
              {repo ? (
                <>
                  <button
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
                    title={repo.path}
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
                  </button>
                  <button
                    type="button"
                    className={`titlebar-context-toggle branch-toggle${branchControlFocused ? ' is-focused' : ''}`}
                    aria-label={t('switchBranchCurrent', {
                      branch: repo.branch.detached ? t('detachedHead') : (repo.branch.name ?? ''),
                    })}
                    aria-haspopup="dialog"
                    aria-expanded={Boolean(branchDialog)}
                    title={
                      repo.branch.detached ? t('detachedHead') : (repo.branch.name ?? undefined)
                    }
                    onFocus={() => setBranchControlFocused(true)}
                    onBlur={() => setBranchControlFocused(false)}
                    onClick={openBranchSwitcher}
                  >
                    <GitBranch aria-hidden="true" focusable="false" />
                    <span>{repo.branch.detached ? t('detachedHead') : repo.branch.name}</span>
                    <ChevronDown aria-hidden="true" focusable="false" />
                  </button>
                </>
              ) : null}
            </nav>
            <nav
              className="titlebar-actions"
              aria-label={t('appNavigation')}
              data-tauri-drag-region
            >
              {repo ? (
                <>
                  <button
                    type="button"
                    className="titlebar-menu-button"
                    aria-label={t('changes')}
                    aria-current={
                      page === 'workspace' && activeWorkspaceView === 'changes' ? 'page' : undefined
                    }
                    onClick={() => {
                      if (page !== 'workspace' || activeWorkspaceView !== 'changes')
                        requestNavigation({ page: 'workspace', view: 'changes' });
                    }}
                  >
                    <Files aria-hidden="true" focusable="false" />
                    <span>{t('changes')}</span>
                  </button>
                  <button
                    type="button"
                    className="titlebar-menu-button"
                    aria-label={t('history')}
                    aria-current={
                      page === 'workspace' && activeWorkspaceView === 'history' ? 'page' : undefined
                    }
                    onClick={() => {
                      if (page !== 'workspace' || activeWorkspaceView !== 'history')
                        requestNavigation({ page: 'workspace', view: 'history' });
                    }}
                  >
                    <HistoryIcon aria-hidden="true" focusable="false" />
                    <span>{t('history')}</span>
                  </button>
                </>
              ) : showRepositoryMenu ? (
                <button
                  type="button"
                  className="titlebar-menu-button"
                  aria-label={t('repositoriesTitle')}
                  onClick={() => {
                    focusRepositoriesOnWorkspaceRef.current = true;
                    requestNavigation({ page: 'workspace' });
                  }}
                >
                  <FolderGit2 aria-hidden="true" focusable="false" />
                  <span>{t('repositoriesTitle')}</span>
                </button>
              ) : null}
              {showActivityMenu ? (
                <button
                  ref={activityButtonRef}
                  type="button"
                  className="titlebar-menu-button activity-toggle"
                  aria-label={t('appActivity')}
                  aria-current={page === 'activity' ? 'page' : undefined}
                  aria-describedby={hasRunningActivity ? 'activity-running-status' : undefined}
                  onClick={() => {
                    if (page !== 'activity') requestNavigation({ page: 'activity' });
                  }}
                >
                  <ChartNoAxesCombined aria-hidden="true" focusable="false" />
                  <span>{t('appActivity')}</span>
                  {hasRunningActivity ? (
                    <>
                      <span className="activity-running-indicator" aria-hidden="true" />
                      <span id="activity-running-status" className="sr-only">
                        {t('activityOperationRunning')}
                      </span>
                    </>
                  ) : null}
                </button>
              ) : null}
              <button
                ref={settingsButtonRef}
                type="button"
                className="titlebar-menu-button"
                aria-label={t('appSettings')}
                aria-current={page === 'settings' ? 'page' : undefined}
                onClick={() => {
                  if (page !== 'settings') requestNavigation({ page: 'settings' });
                }}
              >
                <SettingsIcon aria-hidden="true" focusable="false" />
                <span>{t('appSettings')}</span>
              </button>
            </nav>
          </header>

          {notice ? (
            <output className={`global-notice ${notice.level}`}>
              <NoticeContent notice={notice} />
            </output>
          ) : null}

          {page === 'settings' ? (
            <SettingsView
              appearance={appearance}
              language={language}
              diffStyle={diffStyle}
              splitStageView={splitStageView}
              {...(toolchainStatus ? { toolchainStatus } : {})}
              toolchainBusy={toolchainBusy}
              onAppearanceChange={changeAppearance}
              onLanguageChange={changeLanguage}
              onDiffStyleChange={setDiffStyle}
              onSplitStageViewChange={setSplitStageView}
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
                  <output>{t('loadingActivity')}</output>
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
              />
            </Suspense>
          ) : null}

          <div className="app-content" hidden={page !== 'workspace'}>
            {repo ? (
              <>
                {operationActions ? (
                  <section className="operation-banner" aria-label={t('gitOperationInProgress')}>
                    <div>
                      <strong>{message(operationActions.label)}</strong>
                      <span>
                        {t('unresolvedCount', { count: operationActions.unresolvedCount })}
                      </span>
                    </div>
                    <div className="button-row compact">
                      <button
                        type="button"
                        disabled={!operationActions.canContinue || busy}
                        onClick={() => requestOperationAction({ kind: 'continueOperation' })}
                      >
                        {t('continueAction')}
                      </button>
                      {operationActions.canSkip ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => requestOperationAction({ kind: 'skipOperation' })}
                        >
                          {t('skipAction')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="danger-quiet"
                        disabled={!operationActions.canAbort || busy}
                        onClick={() => requestOperationAction({ kind: 'abortOperation' })}
                      >
                        {t('abortAction')}
                      </button>
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
                    </div>
                  ) : view === 'changes' ? (
                    <ChangesView
                      key={`changes:${repo.repoId}:${workspaceViewRevision}`}
                      repo={repo}
                      adapter={adapter}
                      externalConflict={latestConflict}
                      busy={busy}
                      onError={showError}
                      onAction={runAction}
                      onConflictDirtyChange={handleConflictDirtyChange}
                      onConflictLeaveHandleChange={(handle) => {
                        leaveHandleRef.current = handle;
                      }}
                      paneWidths={paneWidths.changes}
                      diffStyle={diffStyle}
                      splitStageView={splitStageView}
                      onPaneWidthsChange={(changes) =>
                        setPaneWidths((current) => ({ ...current, changes }))
                      }
                    />
                  ) : (
                    <HistoryView
                      key={`history:${repo.repoId}`}
                      repo={repo}
                      adapter={adapter}
                      busy={busy}
                      onError={showError}
                      onShowChanges={() =>
                        requestNavigation({ page: 'workspace', view: 'changes' })
                      }
                      onAction={runAction}
                      diffStyle={diffStyle}
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
                repositories={registeredRepositories}
                busy={busy}
                onAdd={openAddRepositoryDialog}
                onOpen={(path) => settleUiAction(attach({ kind: 'openExisting', path }))}
              />
            )}
          </div>

          {repositorySwitcherOpen && repo ? (
            <RepositorySwitcherDialog
              repos={workspace.repos}
              registeredRepositories={registeredRepositories}
              selectedRepoId={repo.repoId}
              busy={busy}
              onDismiss={() => setRepositorySwitcherOpen(false)}
              onSelectOpen={(repoId) => {
                setRepositorySwitcherOpen(false);
                if (repoId === repo.repoId) return;
                requestNavigation({ repoId });
              }}
              onSelectRegistered={(path) => {
                setRepositorySwitcherOpen(false);
                settleUiAction(attach({ kind: 'openExisting', path }));
              }}
              onAdd={openAddRepositoryDialog}
            />
          ) : null}

          {branchDialog && branchDialogRepo ? (
            <BranchSwitcherDialog
              repo={branchDialogRepo}
              branches={branchDialog.branches}
              loading={branchDialog.loading}
              busy={busy}
              {...(branchDialog.error ? { error: branchDialog.error } : {})}
              onDismiss={() => setBranchDialog(undefined)}
              onCheckout={(branchName) => {
                setBranchDialog(undefined);
                settleUiAction(runAction({ kind: 'checkoutBranch', name: branchName }));
              }}
              onCreate={(branchName, startOid) => {
                setBranchDialog(undefined);
                settleUiAction(
                  runAction({ kind: 'createBranch', name: branchName, startOid, checkout: true }),
                );
              }}
            />
          ) : null}

          {pendingAction ? (
            <Dialog labelledBy="action-preview-title" onDismiss={() => setPendingAction(undefined)}>
              <p className="eyebrow">{t('impactPreview')}</p>
              <h2 id="action-preview-title">{message(pendingAction.preview.title)}</h2>
              <p>{message(pendingAction.preview.summary)}</p>
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
                  <input
                    value={typedConfirmation}
                    onChange={(event) => setTypedConfirmation(event.target.value)}
                  />
                </label>
              ) : null}
              <div className="button-row end">
                <button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingAction(undefined)}
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className={pendingAction.preview.destructive ? 'danger' : 'primary'}
                  disabled={
                    Boolean(pendingAction.preview.typedConfirmation) &&
                    typedConfirmation !== pendingAction.preview.typedConfirmation
                  }
                  onClick={() => settleUiAction(confirmAction())}
                >
                  {confirmationActionLabel(pendingAction.request.action, t)}
                </button>
              </div>
            </Dialog>
          ) : null}

          {pendingNavigation ? (
            <Dialog
              labelledBy="leave-conflict-title"
              onDismiss={() => setPendingNavigation(undefined)}
            >
              <h2 id="leave-conflict-title">{t('unsavedResult')}</h2>
              <p>{t('saveOrDiscardBeforeLeaving')}</p>
              <div className="button-row end">
                <button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingNavigation(undefined)}
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className="danger-quiet"
                  onClick={() => performNavigation(pendingNavigation, true)}
                >
                  {t('leaveWithoutSaving')}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => settleUiAction(saveAndNavigate())}
                >
                  {t('saveAndLeave')}
                </button>
              </div>
            </Dialog>
          ) : null}

          {pendingOperationAction ? (
            <Dialog
              labelledBy="leave-operation-title"
              onDismiss={() => setPendingOperationAction(undefined)}
            >
              <h2 id="leave-operation-title">{t('unsavedResult')}</h2>
              <p>
                {t(
                  pendingOperationAction.kind === 'continueOperation'
                    ? 'discardBeforeContinue'
                    : pendingOperationAction.kind === 'skipOperation'
                      ? 'discardBeforeSkip'
                      : 'discardBeforeAbort',
                )}
              </p>
              <div className="button-row end">
                <button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setPendingOperationAction(undefined)}
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => settleUiAction(runPendingOperationAction(true))}
                >
                  {pendingOperationAction.kind === 'continueOperation'
                    ? t('discardAndContinue')
                    : pendingOperationAction.kind === 'skipOperation'
                      ? t('discardAndSkip')
                      : t('discardAndAbort')}
                </button>
              </div>
            </Dialog>
          ) : null}

          {addRepositoryDialog ? (
            <AddRepositoryDialog
              source={addRepositoryDialog.source}
              url={addRepositoryDialog.url}
              path={addRepositoryDialog.path}
              name={addRepositoryDialog.name}
              {...(addRepositoryDialog.error ? { error: addRepositoryDialog.error } : {})}
              busy={busy}
              onSourceChange={(source) =>
                setAddRepositoryDialog((current) =>
                  current
                    ? { source, url: current.url, path: current.path, name: current.name }
                    : current,
                )
              }
              onUrlChange={(url) =>
                setAddRepositoryDialog((current) =>
                  current
                    ? { source: current.source, url, path: current.path, name: current.name }
                    : current,
                )
              }
              onPathChange={(path) =>
                setAddRepositoryDialog((current) =>
                  current
                    ? { source: current.source, url: current.url, path, name: current.name }
                    : current,
                )
              }
              onNameChange={(name) =>
                setAddRepositoryDialog((current) => (current ? { ...current, name } : current))
              }
              onChooseLocal={() => settleUiAction(chooseLocalRepository())}
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
