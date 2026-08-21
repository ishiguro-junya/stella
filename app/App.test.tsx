import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceAdapterError, type WorkspaceAdapter } from './adapters/workspaceAdapter';
import { App, showsOperationProgress } from './App';
import type {
  ActionPreview,
  QueryResult,
  RepositoryAvailability,
  RepoSnapshot,
  WorkspaceAction,
  WorkspaceSnapshot,
} from './domain/workspace';
import type { AppUpdateInfo, AppUpdateInstallEvent } from './features/update/appUpdate';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from './persistence/preferences';
import { conflictDocument, repoSnapshot } from './test/unit/fixtures';

const tauriWindowMock = vi.hoisted(() => ({
  destroy: vi.fn<() => Promise<void>>(async () => undefined),
  show: vi.fn<() => Promise<void>>(async () => undefined),
  handler: undefined as ((event: { preventDefault: () => void }) => void) | undefined,
  onCloseRequested: vi.fn<
    (handler: (event: { preventDefault: () => void }) => void) => Promise<() => void>
  >(async (handler) => {
    tauriWindowMock.handler = handler;
    return () => undefined;
  }),
}));

const appUpdateMock = vi.hoisted(() => ({
  check: vi.fn<() => Promise<AppUpdateInfo | undefined>>(async () => undefined),
  install: vi.fn<(onEvent: (event: AppUpdateInstallEvent) => void) => Promise<void>>(
    async () => undefined,
  ),
  handler: undefined as (() => void) | undefined,
  listen: vi.fn<(handler: () => void) => Promise<() => void>>(async (handler) => {
    appUpdateMock.handler = handler;
    return () => undefined;
  }),
}));

const settingsMenuMock = vi.hoisted(() => ({
  handler: undefined as (() => void) | undefined,
  listen: vi.fn<(handler: () => void) => Promise<() => void>>(async (handler) => {
    settingsMenuMock.handler = handler;
    return () => undefined;
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: tauriWindowMock.destroy,
    show: tauriWindowMock.show,
    onCloseRequested: tauriWindowMock.onCloseRequested,
  }),
}));

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: async () => '/tmp',
}));

vi.mock('./features/update/appUpdate', () => ({
  checkForAppUpdate: appUpdateMock.check,
  installAppUpdate: appUpdateMock.install,
  listenForCheckAppUpdates: appUpdateMock.listen,
}));

vi.mock('./features/settings/settingsMenu', () => ({
  listenForOpenSettings: settingsMenuMock.listen,
}));

vi.mock('./features/diff/DiffSurface', () => ({ DiffSurface: () => <div>Diff</div> }));
vi.mock('./features/conflict/ConflictResultEditor', () => ({
  ConflictResultEditor: ({ onChange }: { onChange: (value: string) => void }) => (
    <div>
      <span>Editor</span>
      <button type="button" onClick={() => onChange('dirty result')}>
        Edit Result
      </button>
    </div>
  ),
}));
vi.mock('./ui/TextEditor', () => ({
  TextEditor: ({
    value,
    ariaLabel,
    readOnly,
    onChange,
  }: {
    value: string;
    ariaLabel: string;
    readOnly?: boolean;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function commitActivityResult(repo: RepoSnapshot, boundaries: number[], commits = 0): QueryResult {
  return {
    kind: 'commitActivity',
    series: {
      repoId: repo.repoId,
      repoGeneration: repo.generation,
      historyRevision: `history:${repo.repoId}`,
      timeBasis: 'committed',
      totals: {
        commits,
        activeDays: commits ? 1 : 0,
        contributors: commits ? 1 : 0,
        branches: commits ? 1 : 0,
      },
      buckets: boundaries.slice(0, -1).map((startUnixSeconds, index) => ({
        startUnixSeconds,
        endUnixSeconds: boundaries[index + 1] ?? startUnixSeconds,
        commitCount: index === boundaries.length - 2 ? commits : 0,
        contributorCount: index === boundaries.length - 2 && commits ? 1 : 0,
        branchCount: index === boundaries.length - 2 && commits ? 1 : 0,
      })),
      coverage: { kind: 'complete' },
    },
  };
}

function expectOnlyCurrentDestination(button: HTMLElement): void {
  const navigation = screen.getByRole('navigation', { name: 'App navigation' });
  expect(within(navigation).getAllByRole('button', { current: 'page' })).toEqual([button]);
}

async function selectRepository(
  user: ReturnType<typeof userEvent.setup>,
  repositoryName: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Switch repository/u }));
  const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
  await user.dblClick(
    within(dialog).getByRole('option', { name: new RegExp(repositoryName, 'u') }),
  );
}

async function openAddRepositoryDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Switch repository/u }));
  const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
  await user.click(within(dialog).getByRole('button', { name: 'Add Repository' }));
}

async function enterRepositoryPath(
  user: ReturnType<typeof userEvent.setup>,
  path: string,
): Promise<void> {
  const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
  const localTab = within(dialog).getByRole('tab', { name: 'Local' });
  if (localTab.getAttribute('aria-selected') !== 'true') await user.click(localTab);
  await user.type(within(dialog).getByRole('textbox', { name: 'Repository path' }), path);
}

function addRepositorySubmitButton(): HTMLElement {
  const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
  return within(dialog).getByRole('button', { name: 'Add Repository' });
}

describe('showsOperationProgress', () => {
  const selection = {
    kind: 'lines' as const,
    diffId: 'diff',
    path: 'README.md',
    generation: 1,
    side: 'additions' as const,
    startLine: 1,
    endLine: 1,
  };
  const progressActions = [
    { kind: 'commit', input: { format: 'plain', message: 'message' }, includeAllChanges: false },
    { kind: 'fetch', remote: 'origin' },
    { kind: 'pull', remote: 'origin', remoteBranch: 'main' },
    {
      kind: 'push',
      remote: 'origin',
      remoteBranch: 'main',
      forceWithLease: false,
      pushTags: false,
    },
    { kind: 'checkoutBranch', name: 'main' },
    { kind: 'createBranch', name: 'feature/progress', startOid: 'abc', checkout: true },
    { kind: 'gitFlow', request: { command: 'init' } },
    { kind: 'merge', sourceRef: 'origin/main', commitImmediately: true },
    { kind: 'rebase', ontoRef: 'origin/main' },
    { kind: 'cherryPick', oid: 'abc' },
    { kind: 'revert', oid: 'abc' },
    { kind: 'reset', oid: 'abc', mode: 'mixed' },
    { kind: 'continueOperation' },
    { kind: 'skipOperation' },
    { kind: 'abortOperation' },
  ] satisfies WorkspaceAction[];
  const immediateActions = [
    { kind: 'stageFiles', paths: ['README.md'] },
    { kind: 'unstageFiles', paths: ['README.md'] },
    { kind: 'discardFiles', paths: ['README.md'] },
    { kind: 'stageSelection', selection },
    { kind: 'unstageSelection', selection },
    { kind: 'discardSelection', selection },
    {
      kind: 'setRemoteUrl',
      remote: 'origin',
      urlKind: 'fetch',
      expectedUrl: 'https://example.test/old.git',
      newUrl: 'https://example.test/new.git',
    },
    { kind: 'addRemote', remote: 'origin', url: 'https://example.test/repo.git' },
    { kind: 'createBranch', name: 'feature/no-checkout', startOid: 'abc', checkout: false },
    { kind: 'createBranch', name: 'feature/default', startOid: 'abc' },
    { kind: 'deleteBranch', name: 'feature/old' },
    { kind: 'createTag', name: 'v1.0.0', targetOid: 'abc' },
    {
      kind: 'conflictChoice',
      sessionId: 'session',
      path: 'README.md',
      blockId: 'block',
      choice: 'current',
      draftText: 'text',
      contentHash: 'hash',
      documentRevision: 'revision',
      baseDocumentRevision: 'base',
    },
    {
      kind: 'saveConflict',
      sessionId: 'session',
      path: 'README.md',
      draftText: 'text',
      contentHash: 'hash',
      documentRevision: 'revision',
    },
    { kind: 'markConflictResolved', sessionId: 'session', path: 'README.md', contentHash: 'hash' },
    { kind: 'materializeConflict', sessionId: 'session', choice: 'current' },
    { kind: 'openExternal', path: 'README.md' },
    { kind: 'saveFile', path: 'README.md', text: 'text', expectedContentHash: 'hash' },
    { kind: 'renameFile', path: 'README.md', newPath: 'GUIDE.md' },
    { kind: 'fileAction', paths: ['README.md'], operation: 'moveToTrash' },
    { kind: 'fileAction', paths: ['README.md'], operation: 'revealInFinder' },
    { kind: 'fileAction', paths: ['README.md'], operation: 'openInDefaultApp' },
  ] satisfies WorkspaceAction[];

  it.each(progressActions)('tracks %s operations', (action) => {
    expect(showsOperationProgress(action)).toBe(true);
  });

  it.each(immediateActions)('does not track %s operations', (action) => {
    expect(showsOperationProgress(action)).toBe(false);
  });
});

describe('App repository attach', () => {
  it('shows an available update dialog without adding a titlebar action', async () => {
    appUpdateMock.check.mockResolvedValueOnce({
      currentVersion: '1.0.0-alpha.4',
      version: '1.0.0-beta.1',
      notes: 'Beta update',
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({ kind: 'activity', entries: [] })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };

    const { container } = render(<App adapter={adapter} />);

    expect(
      await screen.findByRole('alertdialog', { name: 'An update is available' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Update to version 1.0.0-beta.1' }),
    ).not.toBeInTheDocument();

    const actions = container.querySelector<HTMLElement>('.titlebar-actions');
    if (!actions) throw new Error('titlebar actions not found');
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Diff', 'History', 'Activity', 'Repository', 'Settings']);
  });

  it('keeps a manual update check out of the titlebar', async () => {
    let resolveCheck!: (update: AppUpdateInfo | undefined) => void;
    appUpdateMock.handler = undefined;
    appUpdateMock.check.mockReturnValueOnce(
      new Promise<AppUpdateInfo | undefined>((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({ kind: 'activity', entries: [] })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };

    const { container } = render(<App adapter={adapter} />);
    await waitFor(() => expect(appUpdateMock.check).toHaveBeenCalled());
    await waitFor(() => expect(appUpdateMock.handler).toBeDefined());

    act(() => appUpdateMock.handler?.());
    expect(container.querySelector('.titlebar-update-loading')).not.toBeInTheDocument();

    await act(async () => resolveCheck(undefined));
    expect(screen.getByText('The app is up to date.')).toBeVisible();
  });

  it('shows Repository and Settings on the repository landing and the full navigation in Settings', async () => {
    const user = userEvent.setup();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'repositoryAvailability'
          ? {
              kind: 'repositoryAvailability' as const,
              path: request.path,
              availability: 'available',
            }
          : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };

    const { container } = render(<App adapter={adapter} />);

    expect(screen.queryByRole('heading', { name: 'Repositories' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Add your first repository' })).toBeVisible();
    expect(container.querySelector('.titlebar-brand')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stella' })).not.toBeInTheDocument();
    expect(container.querySelector('.repository-landing-brand')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Repository' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Add Repository' })).toHaveLength(1);
    const diff = screen.getByRole('button', { name: 'Diff' });
    const history = screen.getByRole('button', { name: 'History' });
    const activity = screen.getByRole('button', { name: 'Activity' });
    expect(diff).toBeDisabled();
    expect(history).toBeDisabled();
    expect(activity).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings).toBeVisible();
    expect(container.querySelector('.app-header')).toHaveAttribute(
      'data-tauri-drag-region',
      'deep',
    );
    const titlebarActions = container.querySelector('.titlebar-actions');
    if (!(titlebarActions instanceof HTMLElement)) throw new Error('Titlebar actions are missing.');
    const titlebarContext = container.querySelector('.titlebar-context');
    if (!(titlebarContext instanceof HTMLElement)) throw new Error('Titlebar context is missing.');
    expect(titlebarContext).not.toHaveAttribute('data-tauri-drag-region');
    expect(titlebarActions).not.toHaveAttribute('data-tauri-drag-region');
    expect(settings).not.toHaveAttribute('data-tauri-drag-region');
    const repositoryList = within(titlebarActions).getByRole('button', { name: 'Repository' });
    await waitFor(() => expect(repositoryList).toHaveAttribute('aria-current', 'page'));
    expect(within(titlebarActions).getAllByRole('button', { current: 'page' })).toEqual([
      repositoryList,
    ]);
    expect(within(titlebarActions).getAllByRole('button')).toEqual([
      diff,
      history,
      activity,
      repositoryList,
      settings,
    ]);

    await user.click(settings);
    expect(diff).toBeDisabled();
    expect(history).toBeDisabled();
    expect(activity).toBeDisabled();
    expect(settings).toHaveAttribute('aria-current', 'page');
    const headerLeading = container.querySelector('.window-header-leading');
    if (!(headerLeading instanceof HTMLElement)) throw new Error('Header leading is missing.');
    expect(within(headerLeading).queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('.settings-sidebar-footer')).not.toBeInTheDocument();
    expect(within(titlebarContext).queryByRole('button')).not.toBeInTheDocument();
    expect(within(titlebarActions).getAllByRole('button')).toEqual([
      diff,
      history,
      activity,
      repositoryList,
      settings,
    ]);
    expect(container).not.toHaveTextContent('Workspace Log');

    await user.click(repositoryList);
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(within(titlebarContext).queryByRole('button')).not.toBeInTheDocument();
  });

  it('restores page keyboard navigation after clicking the active Repository or Settings button', async () => {
    const user = userEvent.setup();
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: ['/tmp/alpha', '/tmp/bravo'],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'repositoryAvailability'
          ? { kind: 'repositoryAvailability', path: request.path, availability: 'available' }
          : { kind: 'activity', entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    const repositoryButton = screen.getByRole('button', { name: 'Repository' });
    const repositoryRows = screen.getAllByRole('option');
    await user.click(repositoryButton);
    await user.keyboard('{ArrowDown}');
    expect(repositoryRows[1]).toHaveFocus();

    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    await user.click(settingsButton);
    const generalButton = screen.getByRole('button', { name: 'General' });
    const permissionsButton = screen.getByRole('button', { name: 'Permissions' });
    expect(generalButton).toHaveFocus();
    await user.click(settingsButton);
    await user.keyboard('{ArrowDown}');
    expect(permissionsButton).toHaveFocus();
  });

  it('keeps Diff, History, Activity, and Settings as peer right-pane destinations', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'snapshot'
          ? { kind: 'snapshot', snapshot: repo }
          : request.kind === 'commitActivity'
            ? commitActivityResult(repo, request.bucketBoundariesUnixSeconds)
            : { kind: 'activity', entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());

    let diff = await screen.findByRole('button', { name: 'Diff' });
    let history = screen.getByRole('button', { name: 'History' });
    let activity = screen.getByRole('button', { name: 'Activity' });
    let settings = screen.getByRole('button', { name: 'Settings' });
    expect(diff).toHaveAttribute('aria-current', 'page');
    expectOnlyCurrentDestination(diff);
    expect(diff.querySelector('.lucide-file-diff')).toBeInTheDocument();
    expect(document.querySelector('.titlebar-brand')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stella' })).not.toBeInTheDocument();
    const repositoryList = screen.getByRole('button', { name: 'Repository' });
    await user.click(repositoryList);
    expectOnlyCurrentDestination(repositoryList);
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(document.querySelector('.titlebar-brand')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Current repository/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Current branch/u })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diff' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'History' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Close Sidebar' })).not.toBeInTheDocument();
    diff = await screen.findByRole('button', { name: 'Diff' });
    history = screen.getByRole('button', { name: 'History' });
    activity = screen.getByRole('button', { name: 'Activity' });
    settings = screen.getByRole('button', { name: 'Settings' });
    await user.click(diff);
    expect(diff).toHaveAttribute('aria-current', 'page');
    expectOnlyCurrentDestination(diff);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    const closeSidebar = screen.getByRole('button', { name: 'Close Sidebar' });
    expect(closeSidebar.closest('.window-header-leading')).toBeInTheDocument();
    expect(document.querySelector('.diff-list-footer .sidebar-toggle-button')).toBeNull();
    await user.click(closeSidebar);
    expect(screen.getByTestId('app-shell')).toHaveClass('is-sidebar-closed');
    const openSidebar = screen.getByRole('button', { name: 'Open Sidebar' });
    expect(openSidebar.closest('.window-header-leading')).toBeInTheDocument();
    await user.click(openSidebar);
    expect(screen.getByTestId('app-shell')).not.toHaveClass('is-sidebar-closed');
    const diffResizer = screen.getByRole('separator', { name: 'Diff list width' });
    expect(diffResizer).toHaveAttribute('aria-valuenow', '360');
    diffResizer.focus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(diffResizer).toHaveAttribute('aria-valuenow', '384');

    await user.click(activity);
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expectOnlyCurrentDestination(activity);
    expect(screen.getByRole('button', { name: /Current repository/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current branch/u })).toBeVisible();
    const activityMetric = await screen.findByRole('combobox', { name: 'Activity metric' });
    expect(activityMetric).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Activity range' })).toBeVisible();
    expect(document.querySelector('.activity-analytics-footer select')).toBe(activityMetric);
    expect(activityMetric.closest('.activity-analytics-footer')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close Sidebar' }).closest('.window-header-leading'),
    ).toBeInTheDocument();
    const activityResizer = await screen.findByRole('separator', {
      name: 'Repository analytics width',
    });
    expect(activityResizer).toHaveAttribute('aria-valuenow', '590');
    activityResizer.focus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(activityResizer).toHaveAttribute('aria-valuenow', '600');

    await user.click(activity);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(activity).toHaveFocus();

    await user.click(diff);
    expect(diff).toHaveAttribute('aria-current', 'page');
    expect(diff).toHaveFocus();
    expect(activity).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('separator', { name: 'Diff list width' })).toHaveAttribute(
      'aria-valuenow',
      '384',
    );

    await user.click(history);
    expect(history).toHaveAttribute('aria-current', 'page');
    expectOnlyCurrentDestination(history);
    expect(history).toHaveFocus();
    const historyResizer = await screen.findByRole('separator', { name: 'History list width' });
    expect(historyResizer).toHaveAttribute('aria-valuenow', '472');
    historyResizer.focus();
    await user.keyboard('{ArrowRight}');
    expect(historyResizer).toHaveAttribute('aria-valuenow', '480');
    expect(
      screen.getByRole('button', { name: 'Close Sidebar' }).closest('.window-header-leading'),
    ).toBeInTheDocument();

    await user.click(settings);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'General' })).toHaveFocus();
    expect(settings).toHaveAttribute('aria-current', 'page');
    expectOnlyCurrentDestination(settings);
    expect(screen.queryByRole('button', { name: /Current repository/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Current branch/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Sidebar' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('separator', { name: 'Settings category width' }),
    ).not.toBeInTheDocument();
    await user.click(activity);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('separator', { name: 'Repository analytics width' })).toHaveAttribute(
      'aria-valuenow',
      '600',
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}')).toMatchObject({
        paneWidths: {
          diff: { left: 384, right: 336 },
          history: { left: 480 },
          activity: { left: 600 },
        },
      }),
    );

    await user.click(settings);
    await user.click(
      within(screen.getByRole('navigation', { name: 'Settings categories' })).getByRole('button', {
        name: 'Appearance',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('status')).toHaveTextContent('Reset completed.');
    await user.click(activity);
    expect(screen.getByRole('separator', { name: 'Repository analytics width' })).toHaveAttribute(
      'aria-valuenow',
      '590',
    );

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(activity).toHaveFocus();
  });

  it('clears the selected Diff detail before History rendering begins', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>((request) => {
        if (request.kind === 'snapshot')
          return Promise.resolve({ kind: 'snapshot', snapshot: repo });
        if (request.kind === 'diff') return new Promise<QueryResult>(() => undefined);
        return Promise.resolve({ kind: 'activity', entries: [] });
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    expect(await screen.findByRole('heading', { name: 'src/app.ts' })).toBeVisible();

    const history = screen.getByRole('button', { name: 'History' });
    history.focus();
    fireEvent.click(history);

    expect(screen.getByTestId('workspace-view-transition')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'src/app.ts' })).not.toBeInTheDocument();
    expect(history).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('separator', { name: 'History list width' })).toBeVisible();
  });

  it('hydrates persisted operation summaries before any repository is opened', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ path: '/tmp/activity-repo' });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity',
        entries: [
          {
            id: 'persisted-fetch',
            repoId: 'closed-repo',
            repositoryName: 'archived-repo',
            action: { id: 'actionFetch' },
            summary: { id: 'backendFetchCompleted' },
            status: 'succeeded',
            startedAt: '2026-08-08T12:00:00.000Z',
            finishedAt: '2026-08-08T12:00:02.000Z',
            detailAvailability: 'summaryOnly',
          },
        ],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);
    await waitFor(() => expect(adapter.query).toHaveBeenCalledWith({ kind: 'activity' }));

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect((await screen.findAllByText('Fetch completed')).length).toBeGreaterThan(0);
    expect(screen.getByText('archived-repo')).toBeVisible();
    expect(screen.getByText(/Command output is only available/u)).toBeVisible();
  });

  it('opens global Activity and allows an in-progress Clone to be cancelled', async () => {
    const user = userEvent.setup();
    let subscriber: Parameters<WorkspaceAdapter['subscribe']>[0] | undefined;
    let rejectClone: ((cause: unknown) => void) | undefined;
    const attach = vi.fn<WorkspaceAdapter['attach']>(async (request) => {
      if (request.kind !== 'clone') return { repos: [], activities: [] };
      expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
      return await new Promise((_, reject) => {
        rejectClone = reject;
        subscriber?.({
          kind: 'activityChanged',
          activity: {
            id: 'clone-operation',
            repoId: 'clone-temporary',
            repositoryName: 'custom-repository',
            action: { id: 'actionCloneRepository' },
            summary: { id: 'backendCloningRepository' },
            status: 'running',
            eventSeq: 1,
            startedAt: new Date().toISOString(),
            detailAvailability: 'currentSession',
            cancellable: true,
          },
        });
      });
    });
    const cancel = vi.fn<WorkspaceAdapter['cancel']>(async () => {
      rejectClone?.(new WorkspaceAdapterError('cancelled', 'Git operation cancelled.'));
    });
    const adapter: WorkspaceAdapter = {
      attach,
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel,
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async (onEvent) => {
        subscriber = onEvent;
        return () => undefined;
      }),
    };
    render(<App adapter={adapter} directoryPicker={async () => '/tmp'} />);
    await waitFor(() => expect(subscriber).toBeDefined());

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'custom-repository');
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'https://example.com/repository.git',
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    const progress = await screen.findByRole('dialog', { name: 'Clone Repository' });
    expect(
      within(progress).getByRole('progressbar', { name: 'Clone Repository' }),
    ).not.toHaveAttribute('value');
    expect(attach).toHaveBeenCalledWith({
      kind: 'clone',
      remoteUrl: 'https://example.com/repository.git',
      destination: '/tmp/custom-repository',
    });
    await user.click(within(progress).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        repoId: 'clone-temporary',
        activityId: 'clone-operation',
      }),
    );
    expect(await screen.findByText('The operation was cancelled.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Repository' }));
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Activity' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Repository' }));
    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'https://example.com/another.git',
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2));
  });

  it('keeps clone form values after a clone fails before an activity is bound', async () => {
    const user = userEvent.setup();
    let rejectClone: ((cause: unknown) => void) | undefined;
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async (request) => {
        if (request.kind !== 'clone') return { repos: [], activities: [] };
        return await new Promise((_, reject) => {
          rejectClone = reject;
        });
      }),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({ kind: 'activity', entries: [] })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} directoryPicker={async () => '/tmp'} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'custom-repository');
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'https://example.com/repository.git',
    );
    await user.click(addRepositorySubmitButton());
    expect(await screen.findByRole('dialog', { name: 'Clone Repository' })).toBeVisible();
    const addForm = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-labelledby="add-repository-title"]',
    );
    if (!addForm) throw new Error('Add Repository form not found');
    expect(addForm).toHaveAttribute('aria-hidden', 'true');
    for (const control of addForm.querySelectorAll('input, button')) {
      expect(control).not.toBeDisabled();
    }

    act(() =>
      rejectClone?.(
        new WorkspaceAdapterError('gitFailed', 'Git operation failed.', { stderr: 'clone denied' }),
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('clone denied');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    const form = screen.getByRole('dialog', { name: 'Add Repository' });
    expect(within(form).getByRole('textbox', { name: 'Repository URL' })).toHaveValue(
      'https://example.com/repository.git',
    );
    expect(within(form).getByRole('textbox', { name: 'Repository path' })).toHaveValue('/tmp');
    expect(within(form).getByRole('textbox', { name: 'Repository name' })).toHaveValue(
      'custom-repository',
    );
    expect(within(form).getByRole('button', { name: 'Add Repository' })).toBeEnabled();
  });

  it('tracks only the new matching activity and keeps a failed Fetch in the progress dialog', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    settingsMenuMock.handler = undefined;
    appUpdateMock.handler = undefined;
    let subscriber: Parameters<WorkspaceAdapter['subscribe']>[0] | undefined;
    let rejectFetch: ((cause: unknown) => void) | undefined;
    const cancel = vi.fn<WorkspaceAdapter['cancel']>(async () => undefined);
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({ kind: 'activity', entries: [] })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(
        async () =>
          await new Promise((_, reject) => {
            rejectFetch = reject;
          }),
      ),
      cancel,
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async (onEvent) => {
        subscriber = onEvent;
        return () => undefined;
      }),
    };
    render(<App adapter={adapter} />);
    await waitFor(() => expect(subscriber).toBeDefined());

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Fetch' }));

    const progress = await screen.findByRole('dialog', { name: 'Fetch' });
    act(() => {
      subscriber?.({
        kind: 'activityChanged',
        activity: {
          id: 'unrelated-fetch',
          repoId: 'other-repository',
          repositoryName: 'other',
          action: { id: 'actionFetch' },
          summary: { id: 'backendOperationInProgress' },
          status: 'running',
          startedAt: new Date().toISOString(),
          detailAvailability: 'currentSession',
        },
      });
    });
    expect(within(progress).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    act(() => {
      subscriber?.({
        kind: 'activityChanged',
        activity: {
          id: 'fetch-operation',
          repoId: repo.repoId,
          repositoryName: repo.name,
          action: { id: 'actionFetch' },
          summary: { id: 'backendOperationInProgress' },
          status: 'running',
          startedAt: new Date().toISOString(),
          detailAvailability: 'currentSession',
          cancellable: false,
        },
      });
    });
    expect(within(progress).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    act(() => {
      subscriber?.({
        kind: 'activityChanged',
        activity: {
          id: 'fetch-operation',
          repoId: repo.repoId,
          repositoryName: repo.name,
          action: { id: 'actionFetch' },
          summary: { id: 'backendOperationInProgress' },
          status: 'running',
          startedAt: new Date().toISOString(),
          detailAvailability: 'currentSession',
          cancellable: true,
        },
      });
    });
    await waitFor(() =>
      expect(within(progress).getByRole('button', { name: 'Cancel' })).toBeEnabled(),
    );
    await waitFor(() => expect(settingsMenuMock.handler).toBeDefined());
    await waitFor(() => expect(appUpdateMock.handler).toBeDefined());
    const diff = screen.getByRole('button', { name: 'Diff' });
    const repositorySwitcher = screen.getByRole('button', { name: /Switch repository/u });
    const repositoryName = repositorySwitcher.getAttribute('aria-label');
    expectOnlyCurrentDestination(diff);
    appUpdateMock.check.mockClear();
    act(() => {
      fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });
      settingsMenuMock.handler?.();
      appUpdateMock.handler?.();
    });
    expect(progress).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Switch Repository' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    expectOnlyCurrentDestination(diff);
    expect(repositorySwitcher).toHaveAttribute('aria-label', repositoryName);
    expect(appUpdateMock.check).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    fireEvent.click(progress.parentElement!);
    expect(progress).toBeVisible();

    await user.click(within(progress).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({ repoId: repo.repoId, activityId: 'fetch-operation' }),
    );
    act(() =>
      rejectFetch?.(
        new WorkspaceAdapterError('gitFailed', 'Permission denied.', {
          stderr: 'permission denied',
        }),
      ),
    );

    expect(await screen.findByText('permission denied')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('permission denied');
    expect(screen.getByRole('dialog', { name: 'Fetch' })).toBeVisible();
    expect(screen.queryByRole('alertdialog', { name: 'Operation failed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    const cancelledProgress = await screen.findByRole('dialog', { name: 'Fetch' });
    act(() => {
      subscriber?.({
        kind: 'activityChanged',
        activity: {
          id: 'cancelled-fetch-operation',
          repoId: repo.repoId,
          repositoryName: repo.name,
          action: { id: 'actionFetch' },
          summary: { id: 'backendOperationInProgress' },
          status: 'running',
          startedAt: new Date().toISOString(),
          detailAvailability: 'currentSession',
          cancellable: true,
        },
      });
    });
    await user.click(within(cancelledProgress).getByRole('button', { name: 'Cancel' }));
    act(() => rejectFetch?.(new WorkspaceAdapterError('cancelled', 'Git operation cancelled.')));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Fetch' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alertdialog', { name: 'Operation failed' })).not.toBeInTheDocument();
  });

  it('keeps progress open and announces a rejected cancellation until its activity finishes', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    let subscriber: Parameters<WorkspaceAdapter['subscribe']>[0] | undefined;
    const cancel = vi.fn<WorkspaceAdapter['cancel']>(async () => {
      throw new WorkspaceAdapterError('gitFailed', 'Git operation failed.', {
        stderr: 'cancel denied',
      });
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({ kind: 'activity', entries: [] })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => await new Promise(() => undefined)),
      cancel,
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async (onEvent) => {
        subscriber = onEvent;
        return () => undefined;
      }),
    };
    render(<App adapter={adapter} />);
    await waitFor(() => expect(subscriber).toBeDefined());

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Fetch' }));
    const progress = await screen.findByRole('dialog', { name: 'Fetch' });
    act(() => {
      subscriber?.({
        kind: 'activityChanged',
        activity: {
          id: 'fetch-operation',
          repoId: repo.repoId,
          repositoryName: repo.name,
          action: { id: 'actionFetch' },
          summary: { id: 'backendOperationInProgress' },
          status: 'running',
          startedAt: new Date().toISOString(),
          detailAvailability: 'currentSession',
          cancellable: true,
        },
      });
    });
    const cancelButton = within(progress).getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(screen.getByRole('alert')).toHaveTextContent('cancel denied');
    expect(cancelButton).toBeDisabled();
    await user.click(cancelButton);
    expect(cancel).toHaveBeenCalledOnce();

    act(() => {
      subscriber?.({
        kind: 'activityChanged',
        activity: {
          id: 'fetch-operation',
          repoId: repo.repoId,
          repositoryName: repo.name,
          action: { id: 'actionFetch' },
          summary: { id: 'backendFetchCompleted' },
          status: 'succeeded',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          detailAvailability: 'currentSession',
        },
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Fetch' })).not.toBeInTheDocument(),
    );
  });

  it('collects an Open path before invoking attach', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : request.kind === 'snapshot'
            ? { kind: 'snapshot' as const, snapshot: repo }
            : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, '/tmp/stella');
    await user.click(addRepositorySubmitButton());
    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({ kind: 'open', path: '/tmp/stella' }),
    );
    expect(screen.getByRole('button', { name: /Current repository stella/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current branch main/u })).toBeVisible();
    const diff = screen.getByRole('button', { name: 'Diff' });
    const history = screen.getByRole('button', { name: 'History' });
    expect(diff.closest('.window-header-content')).toBeInTheDocument();
    expect(history.closest('.window-header-content')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    await user.click(history);
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('History')).toBeVisible();

    await user.click(diff);
    expect(diff).toHaveFocus();
    expect(diff).toHaveAttribute('aria-current', 'page');
  });

  it('opens a registered repository with OpenExisting instead of initializing it', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ path: '/tmp/registered-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'repositoryAvailability'
          ? {
              kind: 'repositoryAvailability' as const,
              path: request.path,
              availability: 'available',
            }
          : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.dblClick(
      screen.getByRole('option', { name: 'registered-stella/tmp/registered-stella' }),
    );

    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({
        kind: 'openExisting',
        path: '/tmp/registered-stella',
      }),
    );
  });

  it('does not attach a registered repository while its availability check is pending', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ path: '/tmp/pending-registered-stella' });
    writePreferences({ ...DEFAULT_PREFERENCES, registeredRepoPaths: [repo.path] });
    const resolvers: Array<(availability: RepositoryAvailability) => void> = [];
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          const availability = await new Promise<RepositoryAvailability>((resolve) =>
            resolvers.push(resolve),
          );
          return { kind: 'repositoryAvailability' as const, path: request.path, availability };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await waitFor(() => expect(resolvers).toHaveLength(1));
    await user.dblClick(
      screen.getByRole('option', {
        name: 'pending-registered-stella/tmp/pending-registered-stella',
      }),
    );
    await act(async () => resolvers[0]?.('missing'));

    expect(await screen.findByText('Check location')).toBeInTheDocument();
    expect(adapter.attach).not.toHaveBeenCalled();
  });

  it('saves the repository after its selection changes', async () => {
    const user = userEvent.setup();
    const first = repoSnapshot({ repoId: 'first', path: '/tmp/first' });
    const second = repoSnapshot({ repoId: 'second', path: '/tmp/second' });
    writePreferences({ ...DEFAULT_PREFERENCES, registeredRepoPaths: [first.path, second.path] });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async (request) => {
        const repo = request.kind !== 'clone' && request.path === second.path ? second : first;
        return { repos: [repo], selectedRepoId: repo.repoId, activities: [] };
      }),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'repositoryAvailability'
          ? {
              kind: 'repositoryAvailability' as const,
              path: request.path,
              availability: 'available',
            }
          : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.dblClick(screen.getByRole('option', { name: 'first/tmp/first' }));
    await waitFor(() => expect(readPreferences().lastSelectedRepoPath).toBe(first.path));
    await user.click(screen.getByRole('button', { name: 'Repository' }));
    await user.dblClick(screen.getByRole('option', { name: 'second/tmp/second' }));
    await waitFor(() => expect(readPreferences().lastSelectedRepoPath).toBe(second.path));
  });

  it('restores the saved available repository with OpenExisting and shows History once', async () => {
    Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    tauriWindowMock.show.mockClear();
    const repo = repoSnapshot({ path: '/tmp/restored-stella' });
    let resolveAvailability!: (availability: RepositoryAvailability) => void;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
      lastSelectedRepoPath: repo.path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          const availability = await new Promise<RepositoryAvailability>((resolve) => {
            resolveAvailability = resolve;
          });
          return {
            kind: 'repositoryAvailability' as const,
            path: request.path,
            availability,
          };
        }
        if (request.kind === 'history') return { kind: 'history' as const, commits: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const { container } = render(
      <StrictMode>
        <App adapter={adapter} />
      </StrictMode>,
    );

    await waitFor(() => expect(resolveAvailability).toBeTypeOf('function'));
    expect(container.querySelector('[data-testid="app-shell"]')).not.toBeInTheDocument();
    expect(container.querySelector('.app-header')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Repositories' })).not.toBeInTheDocument();
    expect(container.querySelector('.diff-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-view-transition')).not.toBeInTheDocument();

    await act(async () => resolveAvailability('available'));
    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({ kind: 'openExisting', path: repo.path }),
    );
    expect(adapter.attach).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('separator', { name: 'History list width' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(tauriWindowMock.show).toHaveBeenCalledOnce());
    Reflect.deleteProperty(globalThis, '__TAURI_INTERNALS__');
  });

  it('shows the native window after rendering the repository landing', async () => {
    Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    tauriWindowMock.show.mockClear();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({ kind: 'activity', entries: [] })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const rendered = render(<App adapter={adapter} />);

    expect(await screen.findByRole('region', { name: 'Repositories' })).toBeVisible();
    await waitFor(() => expect(tauriWindowMock.show).toHaveBeenCalledOnce());
    rendered.unmount();
    Reflect.deleteProperty(globalThis, '__TAURI_INTERNALS__');
  });

  it('falls back to the repository landing and ignores an attachment that finishes after 10 seconds', async () => {
    vi.useFakeTimers();
    const repo = repoSnapshot({ path: '/tmp/late-attach-stella' });
    let resolveAttach!: (snapshot: WorkspaceSnapshot) => void;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
      lastSelectedRepoPath: repo.path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(
        () =>
          new Promise<WorkspaceSnapshot>((resolve) => {
            resolveAttach = resolve;
          }),
      ),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          return {
            kind: 'repositoryAvailability' as const,
            path: request.path,
            availability: 'available',
          };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const rendered = render(<App adapter={adapter} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(adapter.attach).toHaveBeenCalledWith({ kind: 'openExisting', path: repo.path });

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expectOnlyCurrentDestination(screen.getByRole('button', { name: 'Repository' }));

    await act(async () =>
      resolveAttach({ repos: [repo], selectedRepoId: repo.repoId, activities: [] }),
    );
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(screen.queryByRole('separator', { name: 'History list width' })).not.toBeInTheDocument();

    rendered.unmount();
    vi.useRealTimers();
  });

  it('falls back to the repository landing and ignores a late attachment failure', async () => {
    vi.useFakeTimers();
    const path = '/tmp/late-attach-failure-stella';
    let rejectAttach!: (reason?: unknown) => void;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
      lastSelectedRepoPath: path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(
        () =>
          new Promise<WorkspaceSnapshot>((_resolve, reject) => {
            rejectAttach = reject;
          }),
      ),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          return {
            kind: 'repositoryAvailability' as const,
            path: request.path,
            availability: 'available',
          };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const rendered = render(<App adapter={adapter} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();

    await act(async () => rejectAttach(new Error('attachment failed')));
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(
      screen.queryByRole('alertdialog', { name: 'Open repository failed' }),
    ).not.toBeInTheDocument();

    rendered.unmount();
    vi.useRealTimers();
  });

  it('does not apply a delayed startup availability result to the repository landing', async () => {
    vi.useFakeTimers();
    const path = '/tmp/late-availability-stella';
    const resolveAvailability: Array<(availability: RepositoryAvailability) => void> = [];
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
      lastSelectedRepoPath: path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          const availability = await new Promise<RepositoryAvailability>((resolve) => {
            resolveAvailability.push(resolve);
          });
          return { kind: 'repositoryAvailability' as const, path: request.path, availability };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const rendered = render(<App adapter={adapter} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolveAvailability).toHaveLength(1);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(resolveAvailability).toHaveLength(2);

    await act(async () => resolveAvailability[0]?.('inaccessible'));
    expect(adapter.attach).not.toHaveBeenCalled();
    expect(screen.queryByText('Check access')).not.toBeInTheDocument();

    rendered.unmount();
    vi.useRealTimers();
  });

  it('keeps the repository landing when there is no saved selection', async () => {
    const path = '/tmp/available-stella';
    writePreferences({ ...DEFAULT_PREFERENCES, registeredRepoPaths: [path] });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'repositoryAvailability'
          ? {
              kind: 'repositoryAvailability' as const,
              path: request.path,
              availability: 'available',
            }
          : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    expect(await screen.findByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(adapter.attach).not.toHaveBeenCalled();
  });

  it('keeps the repository landing when the saved selection is unavailable', async () => {
    const path = '/tmp/unavailable-stella';
    let resolveAvailability!: (availability: RepositoryAvailability) => void;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
      lastSelectedRepoPath: path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          const availability = await new Promise<RepositoryAvailability>((resolve) => {
            resolveAvailability = resolve;
          });
          return { kind: 'repositoryAvailability' as const, path: request.path, availability };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const { container } = render(<App adapter={adapter} />);

    await waitFor(() => expect(resolveAvailability).toBeTypeOf('function'));
    expect(container.querySelector('[data-testid="app-shell"]')).not.toBeInTheDocument();
    await act(async () => resolveAvailability('missing'));
    expect(await screen.findByRole('region', { name: 'Repositories' })).toBeVisible();
    expectOnlyCurrentDestination(screen.getByRole('button', { name: 'Repository' }));
    expect(adapter.attach).not.toHaveBeenCalled();
  });

  it('keeps the repository landing when checking the saved selection fails', async () => {
    const path = '/tmp/failed-availability-stella';
    let rejectAvailability!: (reason?: unknown) => void;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
      lastSelectedRepoPath: path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          await new Promise<RepositoryAvailability>((_resolve, reject) => {
            rejectAvailability = reject;
          });
          throw new Error('unreachable');
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const { container } = render(<App adapter={adapter} />);

    await waitFor(() => expect(rejectAvailability).toBeTypeOf('function'));
    expect(container.querySelector('[data-testid="app-shell"]')).not.toBeInTheDocument();
    await act(async () => rejectAvailability(new Error('availability failed')));
    expect(await screen.findByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(screen.queryByTestId('workspace-view-transition')).not.toBeInTheDocument();
    expectOnlyCurrentDestination(screen.getByRole('button', { name: 'Repository' }));
    expect(adapter.attach).not.toHaveBeenCalled();
  });

  it('keeps the repository landing when opening the saved selection fails', async () => {
    const path = '/tmp/failed-attach-stella';
    let resolveAvailability!: (availability: RepositoryAvailability) => void;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
      lastSelectedRepoPath: path,
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => {
        throw new Error('attach failed');
      }),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          const availability = await new Promise<RepositoryAvailability>((resolve) => {
            resolveAvailability = resolve;
          });
          return { kind: 'repositoryAvailability' as const, path: request.path, availability };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const { container } = render(<App adapter={adapter} />);

    await waitFor(() => expect(resolveAvailability).toBeTypeOf('function'));
    expect(container.querySelector('[data-testid="app-shell"]')).not.toBeInTheDocument();
    await act(async () => resolveAvailability('available'));
    expect(await screen.findByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(screen.queryByTestId('workspace-view-transition')).not.toBeInTheDocument();
    expectOnlyCurrentDestination(screen.getByRole('button', { name: 'Repository' }));
    expect(adapter.attach).toHaveBeenCalledTimes(1);
  });

  it('opens repository dialogs over the repository landing without navigating away', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ name: 'remote-stella', path: '/tmp/remote-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'remotes'
          ? { kind: 'remotes', generation: repo.generation, remotes: [] }
          : { kind: 'activity', entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'More actions for remote-stella' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));

    expect(
      await screen.findByRole('dialog', { name: 'Change Repository Information' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Repository' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('adds origin to a local repository and fetches it without pushing', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ name: 'local-stella', path: '/tmp/local-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
    });
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionAddRemote' },
      summary: { id: 'actionAddRemote' },
      affectedPaths: [],
      affectedCommits: [],
      lostCommitOids: [],
      resolvedTargets: [],
      destructive: false,
    }));
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
      repoId: request.repoId,
      generation: repo.generation,
      snapshot: repo,
      summary: {
        id:
          request.action.kind === 'fetch'
            ? ('backendFetchCompleted' as const)
            : ('backendRemoteAdded' as const),
      },
    }));
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'remotes'
          ? { kind: 'remotes', generation: repo.generation, remotes: [] }
          : { kind: 'activity', entries: [] },
      ),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'More actions for local-stella' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));
    const manager = await screen.findByRole('dialog', {
      name: 'Change Repository Information',
    });
    await user.type(
      within(manager).getByRole('textbox', { name: 'Repository URL' }),
      'https://example.test/stella.git',
    );
    await user.click(within(manager).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(preview).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: {
        kind: 'addRemote',
        remote: 'origin',
        url: 'https://example.test/stella.git',
      },
    });
    expect(execute.mock.calls.map(([request]) => request.action)).toEqual([
      {
        kind: 'addRemote',
        remote: 'origin',
        url: 'https://example.test/stella.git',
      },
      { kind: 'fetch', remote: 'origin' },
    ]);
  });

  it('changes the repository name and reconnects a changed path from repository information', async () => {
    const user = userEvent.setup();
    const oldRepo = repoSnapshot({ repoId: 'repo-old', path: '/tmp/old-stella' });
    const newRepo = repoSnapshot({ repoId: 'repo-new', path: '/tmp/new-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [oldRepo.path],
      repositoryNames: { [oldRepo.path]: 'Old Stella' },
    });
    const detach = vi.fn<NonNullable<WorkspaceAdapter['detach']>>(async () => undefined);
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionSetRemoteUrl' },
      summary: { id: 'actionSetRemoteUrl' },
      affectedPaths: [],
      affectedCommits: [],
      lostCommitOids: [],
      resolvedTargets: [],
      destructive: false,
    }));
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
      repoId: request.repoId,
      generation: newRepo.generation,
      snapshot: newRepo,
      summary: { id: 'backendRemoteUrlUpdated' },
    }));
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async (request) => {
        const repo = request.kind !== 'clone' && request.path === newRepo.path ? newRepo : oldRepo;
        return { repos: [repo], selectedRepoId: repo.repoId, activities: [] };
      }),
      detach,
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          return {
            kind: 'repositoryAvailability',
            path: request.path,
            availability: 'available',
          };
        }
        if (request.kind === 'remotes') {
          return {
            kind: 'remotes',
            generation: oldRepo.generation,
            remotes: [
              {
                name: 'origin',
                fetchUrls: ['https://example.test/old.git'],
                pushUrls: [],
              },
            ],
          };
        }
        return { kind: 'activity', entries: [] };
      }),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} directoryPicker={async () => newRepo.path} />);

    await user.click(await screen.findByRole('button', { name: 'More actions for Old Stella' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));
    const manager = await screen.findByRole('dialog', {
      name: 'Change Repository Information',
    });
    const remoteInput = within(manager).getByRole('textbox', { name: 'Fetch URLs' });
    await user.clear(remoteInput);
    await user.type(remoteInput, 'https://example.test/new.git');
    await user.click(within(manager).getByRole('tab', { name: 'Local' }));
    const nameInput = within(manager).getByRole('textbox', { name: 'Repository name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'New Stella');
    await user.click(within(manager).getByRole('button', { name: 'Choose Repository' }));
    await user.click(within(manager).getByRole('button', { name: 'Save' }));

    const confirmation = await screen.findByRole('alertdialog', { name: 'Confirm New Location' });
    expect(confirmation).toHaveTextContent(oldRepo.path);
    expect(confirmation).toHaveTextContent(newRepo.path);
    await user.click(within(confirmation).getByRole('button', { name: 'Update Registration' }));

    await waitFor(() => expect(detach).toHaveBeenCalledWith(oldRepo.repoId));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(preview).toHaveBeenCalledWith({
      repoId: newRepo.repoId,
      action: {
        kind: 'setRemoteUrl',
        remote: 'origin',
        urlKind: 'fetch',
        expectedUrl: 'https://example.test/old.git',
        newUrl: 'https://example.test/new.git',
      },
    });
    expect(readPreferences()).toMatchObject({
      registeredRepoPaths: [newRepo.path],
      repositoryNames: { [newRepo.path]: 'New Stella' },
    });
  });

  it('saves changed remote URLs without confirmation and fetches each changed remote once', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ name: 'remote-stella', path: '/tmp/remote-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
    });
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionSetRemoteUrl' },
      summary: { id: 'actionSetRemoteUrl' },
      affectedPaths: [],
      affectedCommits: [],
      lostCommitOids: [],
      resolvedTargets: [],
      destructive: false,
    }));
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
      repoId: request.repoId,
      generation: repo.generation,
      snapshot: repo,
      summary: {
        id:
          request.action.kind === 'fetch'
            ? ('backendFetchCompleted' as const)
            : ('backendRemoteUrlUpdated' as const),
      },
    }));
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          return { kind: 'repositoryAvailability', path: request.path, availability: 'available' };
        }
        if (request.kind === 'remotes') {
          return {
            kind: 'remotes',
            generation: repo.generation,
            remotes: [
              {
                name: 'origin',
                fetchUrls: ['https://example.test/old.git'],
                pushUrls: ['ssh://example.test/old.git'],
              },
            ],
          };
        }
        return { kind: 'activity', entries: [] };
      }),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.dblClick(screen.getByRole('option', { name: 'remote-stella/tmp/remote-stella' }));
    await user.click(
      await screen.findByRole('button', { name: /Current repository remote-stella/u }),
    );
    const switcher = screen.getByRole('dialog', { name: 'Switch Repository' });
    await user.click(
      within(switcher).getByRole('button', { name: 'More actions for remote-stella' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));
    const manager = await screen.findByRole('dialog', {
      name: 'Change Repository Information',
    });
    const [fetchInput, pushInput] = within(manager).getAllByRole('textbox', { name: /URLs$/u });
    await user.clear(fetchInput!);
    await user.type(fetchInput!, 'https://example.test/new.git');
    await user.clear(pushInput!);
    await user.type(pushInput!, 'ssh://example.test/new.git');
    await user.click(within(manager).getByRole('tab', { name: 'Local' }));
    const nameInput = within(manager).getByRole('textbox', { name: 'Repository name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Stella Desktop');
    await user.click(within(manager).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([request]) => request.action)).toEqual([
      {
        kind: 'setRemoteUrl',
        remote: 'origin',
        urlKind: 'fetch',
        expectedUrl: 'https://example.test/old.git',
        newUrl: 'https://example.test/new.git',
      },
      {
        kind: 'setRemoteUrl',
        remote: 'origin',
        urlKind: 'push',
        expectedUrl: 'ssh://example.test/old.git',
        newUrl: 'ssh://example.test/new.git',
      },
      { kind: 'fetch', remote: 'origin' },
    ]);
    expect(
      screen.queryByRole('alertdialog', { name: 'Change remote URL' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Change Repository Information' }),
    ).not.toBeInTheDocument();
    expect(readPreferences().repositoryNames).toEqual({ [repo.path]: 'Stella Desktop' });
  });

  it('keeps the remote URL dialog open and reloads URLs after a save failure', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ name: 'remote-stella', path: '/tmp/remote-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
    });
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'repositoryAvailability') {
        return { kind: 'repositoryAvailability', path: request.path, availability: 'available' };
      }
      if (request.kind === 'remotes') {
        return {
          kind: 'remotes',
          generation: repo.generation,
          remotes: [
            {
              name: 'origin',
              fetchUrls: ['https://example.test/old.git'],
              pushUrls: [],
            },
          ],
        };
      }
      return { kind: 'activity', entries: [] };
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query,
      preview: vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
        repoId: request.repoId,
        title: { id: 'actionSetRemoteUrl' },
        summary: { id: 'actionSetRemoteUrl' },
        affectedPaths: [],
        affectedCommits: [],
        lostCommitOids: [],
        resolvedTargets: [],
        destructive: false,
      })),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('save failed');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.dblClick(screen.getByRole('option', { name: 'remote-stella/tmp/remote-stella' }));
    await user.click(
      await screen.findByRole('button', { name: /Current repository remote-stella/u }),
    );
    const switcher = screen.getByRole('dialog', { name: 'Switch Repository' });
    await user.click(
      within(switcher).getByRole('button', { name: 'More actions for remote-stella' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));
    const manager = await screen.findByRole('dialog', {
      name: 'Change Repository Information',
    });
    const input = within(manager).getByRole('textbox', { name: 'Fetch URLs' });
    await user.clear(input);
    await user.type(input, 'https://example.test/new.git');
    await user.click(within(manager).getByRole('button', { name: 'Save' }));

    const error = await screen.findByRole('alertdialog', { name: 'Operation failed' });
    await waitFor(() =>
      expect(query.mock.calls.filter(([request]) => request.kind === 'remotes')).toHaveLength(2),
    );
    await user.click(within(error).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Change Repository Information' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Fetch URLs' })).toHaveValue(
      'https://example.test/old.git',
    );
  });

  it('opens a Finder-selected local directory through the shared Add sheet', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ path: '/tmp/finder-stella' });
    const directoryPicker = vi.fn<() => Promise<string>>(async () => repo.path);
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} directoryPicker={directoryPicker} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.click(screen.getByRole('tab', { name: 'Local' }));
    await user.click(screen.getByRole('button', { name: 'Choose Repository' }));

    expect(directoryPicker).toHaveBeenCalledWith('Choose Repository');
    expect(screen.getByRole('textbox', { name: 'Repository path' })).toHaveValue(repo.path);
    expect(adapter.attach).not.toHaveBeenCalled();
    const repositoryName = screen.getByRole('textbox', { name: 'Repository name' });
    expect(repositoryName).toHaveValue('finder-stella');
    await user.clear(repositoryName);
    await user.type(repositoryName, 'Stella Desktop');
    await user.click(addRepositorySubmitButton());
    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({ kind: 'open', path: repo.path }),
    );
    expect(
      screen.getByRole('button', { name: /Current repository Stella Desktop/u }),
    ).toBeVisible();
    expect(readPreferences().repositoryNames).toEqual({ [repo.path]: 'Stella Desktop' });
  });

  it('uses a Finder-selected Clone destination and rejects an invalid remote location', async () => {
    const user = userEvent.setup();
    const directoryPicker = vi.fn<() => Promise<string>>(async () => '/tmp/clones');
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} directoryPicker={directoryPicker} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.click(screen.getByRole('button', { name: 'Choose Repository' }));
    expect(directoryPicker).toHaveBeenCalledWith('Choose Repository');
    expect(screen.getByRole('textbox', { name: 'Repository path' })).toHaveValue('/tmp/clones');
    await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'repository');
    await user.type(screen.getByRole('textbox', { name: 'Repository URL' }), 'invalid');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a supported remote URL.');
    expect(adapter.attach).not.toHaveBeenCalled();
  });

  it('requires an absolute destination path without opening Finder', async () => {
    const user = userEvent.setup();
    const directoryPicker = vi.fn<() => Promise<string | null>>(async () => null);
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} directoryPicker={directoryPicker} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'git@example.com:owner/repository.git',
    );
    const destination = screen.getByRole('textbox', { name: 'Repository path' });
    await user.clear(destination);
    await user.type(destination, 'relative/path');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute local path.');
    expect(directoryPicker).not.toHaveBeenCalled();
    expect(adapter.attach).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Add Repository' })).toBeVisible();
  });

  it('updates repository analytics after switching repositories', async () => {
    const user = userEvent.setup();
    const first = repoSnapshot({ repoId: 'repo-1', name: 'first', path: '/tmp/first' });
    const second = repoSnapshot({ repoId: 'repo-2', name: 'second', path: '/tmp/second' });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [first, second],
        selectedRepoId: first.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'activity') return { kind: 'activity', entries: [] };
        if (request.kind === 'commitActivity') {
          const selected = request.repoId === first.repoId ? first : second;
          return commitActivityResult(
            selected,
            request.bucketBoundariesUnixSeconds,
            selected === first ? 1 : 2,
          );
        }
        if (request.kind === 'snapshot') {
          return { kind: 'snapshot', snapshot: request.repoId === first.repoId ? first : second };
        }
        if (request.kind === 'branches') return { kind: 'branches', branches: [] };
        throw new Error(`Unexpected query: ${request.kind}`);
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, first.path);
    await user.click(addRepositorySubmitButton());
    await screen.findByRole('button', { name: /Current repository first/u });
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('1 commit')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Diff' }));
    await selectRepository(user, 'second');
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByText('2 commits')).toBeVisible();
    expect(adapter.query).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'commitActivity', repoId: second.repoId }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('opens the repository switcher from its hidden shortcut without rendering shortcut copy', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'snapshot'
          ? { kind: 'snapshot' as const, snapshot: repo }
          : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await screen.findByRole('button', { name: /Current repository stella/u });

    fireEvent.keyDown(window, { key: 'o', metaKey: true, shiftKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
    expect(dialog).toBeVisible();
    expect(dialog).not.toHaveTextContent(/[⌘⇧]/u);
  });

  it('loads local branches, checks out a selection, and creates the next branch directly', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      branch: {
        name: 'main',
        oid: 'main-oid',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
      },
    });
    const checkedOut = repoSnapshot({
      generation: 2,
      eventSeq: 2,
      branch: { name: 'feature', oid: 'feature-oid', detached: false, ahead: 0, behind: 0 },
    });
    const created = repoSnapshot({
      generation: 3,
      eventSeq: 3,
      branch: {
        name: 'feature/new-flow',
        oid: 'feature-oid',
        detached: false,
        ahead: 0,
        behind: 0,
      },
    });
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => {
      const snapshot = request.action.kind === 'createBranch' ? created : checkedOut;
      return {
        repoId: snapshot.repoId,
        generation: snapshot.generation,
        snapshot,
        summary: {
          id:
            request.action.kind === 'createBranch'
              ? ('backendBranchCreated' as const)
              : ('backendBranchCheckedOut' as const),
        },
      };
    });
    const branchPreview: ActionPreview = {
      repoId: repo.repoId,
      title: { id: 'actionCreateBranch' },
      summary: { id: 'actionCreateBranch' },
      affectedPaths: [],
      affectedCommits: ['feature-oid'],
      lostCommitOids: [],
      resolvedTargets: [{ input: 'feature-oid', oid: 'feature-oid' }],
      destructive: false,
    };
    const preview = vi.fn<WorkspaceAdapter['preview']>(async () => branchPreview);
    let resolveBranches!: (result: QueryResult) => void;
    const branchesResult = new Promise<QueryResult>((resolve) => {
      resolveBranches = resolve;
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return branchesResult;
        if (request.kind === 'snapshot') return { kind: 'snapshot' as const, snapshot: repo };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: /Current branch main/u }));
    await waitFor(() =>
      expect(adapter.query).toHaveBeenCalledWith({ kind: 'branches', repoId: repo.repoId }),
    );
    expect(screen.queryByRole('dialog', { name: 'Switch Branch' })).not.toBeInTheDocument();
    act(() =>
      resolveBranches({
        kind: 'branches',
        branches: [
          {
            fullName: 'refs/heads/main',
            shortName: 'main',
            oid: 'main-oid',
            current: true,
            remote: false,
          },
          {
            fullName: 'refs/heads/feature',
            shortName: 'feature',
            oid: 'feature-oid',
            current: false,
            remote: false,
          },
        ],
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Switch Branch' });
    await user.dblClick(within(dialog).getByRole('option', { name: 'feature' }));

    expect(execute).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'checkoutBranch', name: 'feature' },
    });
    expect(await screen.findByRole('button', { name: /Current branch feature/u })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Current branch feature/u }));
    const reopened = await screen.findByRole('dialog', { name: 'Switch Branch' });
    expect(within(reopened).queryByText('Git Flow')).not.toBeInTheDocument();
    await user.click(within(reopened).getByRole('option', { name: 'feature' }));
    await user.click(within(reopened).getByRole('button', { name: 'Create branch' }));
    const createDialog = screen.getByRole('dialog', { name: 'Create branch' });
    await user.type(
      within(createDialog).getByRole('textbox', { name: 'Branch name' }),
      'feature/new-flow',
    );
    await user.click(within(createDialog).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith({
        repoId: repo.repoId,
        action: {
          kind: 'createBranch',
          name: 'feature/new-flow',
          startOid: 'feature-oid',
          checkout: true,
        },
      }),
    );
    expect(screen.queryByRole('alertdialog', { name: 'Create Branch' })).not.toBeInTheDocument();
    expect(execute).toHaveBeenLastCalledWith({
      repoId: repo.repoId,
      action: {
        kind: 'createBranch',
        name: 'feature/new-flow',
        startOid: 'feature-oid',
        checkout: true,
      },
      preview: branchPreview,
    });
    expect(
      await screen.findByRole('button', { name: /Current branch feature\/new-flow/u }),
    ).toBeVisible();
  });

  it('requires preview when creating a branch from History', async () => {
    const user = userEvent.setup();
    const historyCommit: RepoSnapshot['history'][number] = {
      oid: '0123456789abcdef0123456789abcdef01234567',
      shortOid: '0123456',
      subject: 'feat: history branch',
      authorName: 'Stella',
      authoredAt: '2026-08-22T00:00:00Z',
      parents: [],
      refs: [],
      lane: 0,
    };
    const repo = repoSnapshot({ history: [historyCommit] });
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionCreateBranch' },
      summary: { id: 'actionCreateBranch' },
      affectedPaths: [],
      affectedCommits: [historyCommit.oid],
      lostCommitOids: [],
      resolvedTargets: [{ input: historyCommit.oid, oid: historyCommit.oid }],
      destructive: false,
    }));
    const execute = vi.fn<WorkspaceAdapter['execute']>(async () => {
      throw new Error('unused');
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: { ...historyCommit, body: '' } };
        }
        if (request.kind === 'history') return { kind: 'history' as const, commits: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(
      await screen.findByRole('button', {
        name: `More actions for commit ${historyCommit.shortOid}`,
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Create Branch' }));
    const historyDialog = screen.getByRole('dialog', { name: 'Create branch' });
    await user.type(
      within(historyDialog).getByRole('textbox', { name: 'Branch name' }),
      'feature/history-preview',
    );
    await user.click(within(historyDialog).getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith({
        repoId: repo.repoId,
        action: {
          kind: 'createBranch',
          name: 'feature/history-preview',
          startOid: historyCommit.oid,
        },
      }),
    );
    expect(screen.getByRole('alertdialog', { name: 'Create Branch' })).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
  });

  it('updates Stage state without showing a routine success notice', async () => {
    const user = userEvent.setup();
    writePreferences({ ...DEFAULT_PREFERENCES, splitStageView: true });
    const repo = repoSnapshot({
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const stagedRepo = repoSnapshot({
      generation: 2,
      eventSeq: 2,
      changes: [{ path: 'src/app.ts', area: 'staged', status: 'modified' }],
    });
    let currentRepo = repo;
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => {
      currentRepo = stagedRepo;
      return {
        repoId: request.repoId,
        generation: stagedRepo.generation,
        snapshot: stagedRepo,
        summary: { id: 'backendChangesStaged' },
      };
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'snapshot') {
          return { kind: 'snapshot' as const, snapshot: currentRepo };
        }
        if (request.kind === 'diff') {
          return {
            kind: 'diff' as const,
            diff: {
              diffId: `diff-${currentRepo.generation}`,
              repoId: currentRepo.repoId,
              path: request.path,
              area: request.area,
              generation: currentRepo.generation,
              patch: `diff --git a/${request.path} b/${request.path}\n`,
            },
          };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('checkbox', { name: 'Stage src/app.ts' }));

    expect(execute).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'stageFiles', paths: ['src/app.ts'] },
    });
    expect(await screen.findByRole('checkbox', { name: 'Unstage src/app.ts' })).toBeChecked();
    expect(screen.queryByText('Changes staged')).not.toBeInTheDocument();
  });

  it('uses one Add dialog with Remote and Local tabs after a repository is open', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : request.kind === 'snapshot'
            ? { kind: 'snapshot' as const, snapshot: repo }
            : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, '/tmp/stella');
    await user.click(addRepositorySubmitButton());
    await screen.findByRole('button', { name: /Current repository stella/u });

    await openAddRepositoryDialog(user);
    const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
    const remoteTab = within(dialog).getByRole('tab', { name: 'Remote' });
    const localTab = within(dialog).getByRole('tab', { name: 'Local' });
    expect(remoteTab).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Repository URL' })).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Repository path' })).toHaveValue('/tmp');
    const name = within(dialog).getByRole('textbox', { name: 'Repository name' });
    const remoteUrl = within(dialog).getByRole('textbox', { name: 'Repository URL' });
    await user.type(remoteUrl, 'https://example.com/stella.git');
    expect(name).toHaveValue('stella');
    await user.clear(name);
    await user.type(name, 'Stella Display');
    expect(addRepositorySubmitButton()).toBeEnabled();
    await user.clear(remoteUrl);
    expect(name).toHaveValue('Stella Display');
    await user.type(remoteUrl, 'https://example.com/renamed.git');
    expect(name).toHaveValue('Stella Display');

    await user.click(localTab);
    expect(localTab).toHaveAttribute('aria-selected', 'true');
    expect(addRepositorySubmitButton()).toBeDisabled();
    expect(
      within(dialog).queryByRole('textbox', { name: 'Repository URL' }),
    ).not.toBeInTheDocument();
    const localPath = within(dialog).getByRole('textbox', { name: 'Repository path' });
    await user.type(localPath, '/tmp/local-stella');
    expect(addRepositorySubmitButton()).toBeEnabled();
    expect(within(dialog).getByRole('textbox', { name: 'Repository name' })).toHaveValue(
      'local-stella',
    );
    await user.click(remoteTab);
    expect(addRepositorySubmitButton()).toBeEnabled();
    expect(within(dialog).getByRole('textbox', { name: 'Repository URL' })).toHaveValue(
      'https://example.com/renamed.git',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Repository name' })).toHaveValue(
      'Stella Display',
    );
    await user.click(localTab);
    expect(within(dialog).getByRole('textbox', { name: 'Repository path' })).toHaveValue(
      '/tmp/local-stella',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Repository name' })).toHaveValue(
      'local-stella',
    );
    const restoredLocalPath = within(dialog).getByRole('textbox', { name: 'Repository path' });
    const localName = within(dialog).getByRole('textbox', { name: 'Repository name' });
    await user.clear(localName);
    await user.type(localName, 'Local Display');
    await user.clear(restoredLocalPath);
    expect(localName).toHaveValue('Local Display');
    await user.type(restoredLocalPath, '/tmp/renamed-local');
    expect(localName).toHaveValue('Local Display');
  });

  it('returns to the repository switcher after dismissing a dialog opened from it', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'snapshot') return { kind: 'snapshot' as const, snapshot: repo };
        if (request.kind === 'remotes')
          return { kind: 'remotes' as const, remotes: [], generation: repo.generation };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await screen.findByRole('button', { name: /Current repository stella/u });

    await user.click(screen.getByRole('button', { name: /Switch repository/u }));
    let switcher = screen.getByRole('dialog', { name: 'Switch Repository' });
    await user.click(within(switcher).getByRole('button', { name: 'Add Repository' }));
    let child = screen.getByRole('dialog', { name: 'Add Repository' });
    await user.click(within(child).getByRole('button', { name: 'Cancel' }));
    switcher = screen.getByRole('dialog', { name: 'Switch Repository' });

    await user.click(within(switcher).getByRole('button', { name: 'Add Repository' }));
    child = screen.getByRole('dialog', { name: 'Add Repository' });
    await user.click(within(child).getByRole('button', { name: 'Close dialog' }));
    switcher = screen.getByRole('dialog', { name: 'Switch Repository' });

    await user.click(within(switcher).getByRole('button', { name: 'More actions for stella' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));
    child = await screen.findByRole('dialog', { name: 'Change Repository Information' });
    await user.click(within(child).getByRole('button', { name: 'Cancel' }));
    switcher = screen.getByRole('dialog', { name: 'Switch Repository' });

    await user.click(within(switcher).getByRole('button', { name: 'More actions for stella' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete Repository' }));
    child = screen.getByRole('alertdialog', { name: 'Delete Repository' });
    await user.click(within(child).getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByRole('dialog', { name: 'Switch Repository' })).toBeVisible();
  });

  it('guards selection of a newly attached repository while a conflict Result is dirty', async () => {
    const user = userEvent.setup();
    const first = repoSnapshot({
      repoId: 'repo-1',
      name: 'first',
      path: '/tmp/first',
      operation: {
        kind: 'merge',
        label: { id: 'operationResolvingMerge' },
        unresolvedCount: 1,
        canContinue: false,
        canSkip: false,
        canAbort: true,
      },
      changes: [{ path: 'src/app.ts', area: 'conflicted', status: 'conflicted' }],
    });
    const second = repoSnapshot({
      repoId: 'repo-2',
      name: 'second',
      path: '/tmp/second',
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async (request) => {
        const repo = request.kind === 'open' && request.path === second.path ? second : first;
        return { repos: [repo], selectedRepoId: repo.repoId, activities: [] };
      }),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'conflict')
          return { kind: 'conflict' as const, document: conflictDocument() };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'snapshot')
          return {
            kind: 'snapshot' as const,
            snapshot: request.repoId === first.repoId ? first : second,
          };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, first.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await openAddRepositoryDialog(user);
    await enterRepositoryPath(user, second.path);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );

    const leaveDialog = await screen.findByRole('alertdialog', {
      name: 'Unsaved changes',
    });
    expect(leaveDialog).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and Leave' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Leave Without Saving' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current repository first/u })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Current repository first/u })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Switch Repository' })).toBeVisible();
    expect(readPreferences().lastSelectedRepoPath).toBe(first.path);
  });

  it('uses the latest dirty state when a deferred attach completes', async () => {
    const user = userEvent.setup();
    const first = repoSnapshot({
      repoId: 'repo-1',
      name: 'first',
      path: '/tmp/first',
      operation: {
        kind: 'merge',
        label: { id: 'operationResolvingMerge' },
        unresolvedCount: 1,
        canContinue: false,
        canSkip: false,
        canAbort: true,
      },
      changes: [{ path: 'src/app.ts', area: 'conflicted', status: 'conflicted' }],
    });
    const second = repoSnapshot({
      repoId: 'repo-2',
      name: 'second',
      path: '/tmp/second',
    });
    let resolveAttach: ((snapshot: WorkspaceSnapshot) => void) | undefined;
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async (request) => {
        if (request.kind !== 'open' || request.path === first.path) {
          return { repos: [first], selectedRepoId: first.repoId, activities: [] };
        }
        return await new Promise<WorkspaceSnapshot>((resolve) => {
          resolveAttach = resolve;
        });
      }),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'conflict') {
          return { kind: 'conflict' as const, document: conflictDocument() };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'snapshot') {
          return {
            kind: 'snapshot' as const,
            snapshot: request.repoId === first.repoId ? first : second,
          };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, first.path);
    await user.click(addRepositorySubmitButton());
    await screen.findByRole('button', { name: 'Edit Result' });

    await openAddRepositoryDialog(user);
    await enterRepositoryPath(user, second.path);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );
    await waitFor(() => expect(resolveAttach).toBeDefined());

    act(() => {
      screen.getByRole('button', { name: 'Edit Result' }).click();
    });
    act(() => {
      resolveAttach?.({ repos: [second], selectedRepoId: second.repoId, activities: [] });
    });

    expect(await screen.findByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current repository first/u })).toBeVisible();
  });

  it('shows affected commits in preview and preserves the redacted Git error output', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      operation: {
        kind: 'rebase',
        label: { id: 'operationResolvingRebase' },
        unresolvedCount: 0,
        canContinue: true,
        canSkip: true,
        canAbort: true,
      },
    });
    let resolveRefresh: (() => void) | undefined;
    let rejectRefresh: (() => void) | undefined;
    const initialPreview: ActionPreview = {
      repoId: repo.repoId,
      title: { id: 'actionAbortOperation' },
      summary: { id: 'previewAbort' },
      affectedPaths: [],
      affectedCommits: ['1234567890abcdef'],
      lostCommitOids: [],
      resolvedTargets: [],
      destructive: true,
      typedConfirmation: 'abort',
    };
    const changedPreview: ActionPreview = {
      ...initialPreview,
      affectedCommits: ['fedcba9876543210'],
    };
    const preview = vi
      .fn<WorkspaceAdapter['preview']>()
      .mockResolvedValueOnce(initialPreview)
      .mockResolvedValueOnce(changedPreview)
      .mockResolvedValueOnce(initialPreview)
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolveRefresh = () => resolve(changedPreview);
          }),
      )
      .mockResolvedValueOnce(initialPreview)
      .mockImplementationOnce(
        async () =>
          await new Promise((_, reject) => {
            rejectRefresh = () => reject(new Error('preview denied'));
          }),
      );
    const execute = vi
      .fn<WorkspaceAdapter['execute']>()
      .mockRejectedValueOnce(
        new WorkspaceAdapterError('hookFailed', 'Git operation failed.', {
          stderr: 'policy denied this operation',
          exitCode: '1',
        }),
      )
      .mockResolvedValueOnce({
        repoId: repo.repoId,
        generation: repo.generation,
        summary: { id: 'backendOperationAborted' },
        snapshot: repo,
      })
      .mockRejectedValueOnce(
        new WorkspaceAdapterError('hookFailed', 'Git operation failed.', {
          stderr: 'policy denied this operation',
          exitCode: '1',
        }),
      )
      .mockRejectedValueOnce(
        new WorkspaceAdapterError('hookFailed', 'Git operation failed.', {
          stderr: 'policy denied this operation',
          exitCode: '1',
        }),
      );
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'snapshot'
          ? { kind: 'snapshot' as const, snapshot: repo }
          : request.kind === 'branches'
            ? { kind: 'branches' as const, branches: [] }
            : { kind: 'activity' as const, entries: [] },
      ),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, '/tmp/stella');
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Abort' }));
    expect(await screen.findByText('1234567890ab')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'abort');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('dialog', { name: 'Abort Operation' })).toHaveTextContent(
      'The operation failed.',
    );
    expect(screen.getByLabelText('stderr')).toHaveTextContent('policy denied this operation');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Abort Operation' })).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('abort');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(execute).toHaveBeenCalledOnce();
    expect(await screen.findByText('fedcba987654')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('abort');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alertdialog', { name: 'Abort Operation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abort' }));
    await user.type(screen.getByRole('textbox'), 'abort');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(4));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      resolveRefresh?.();
      await Promise.resolve();
    });
    expect(screen.queryByRole('alertdialog', { name: 'Abort Operation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abort' }));
    await user.type(screen.getByRole('textbox'), 'abort');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(6));
    expect(rejectRefresh).toBeTypeOf('function');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      rejectRefresh?.();
      await new Promise((resolve) => window.setTimeout(resolve));
    });
    await user.click(
      within(
        await screen.findByRole('alertdialog', { name: 'Could not preview operation' }),
      ).getByRole('button', { name: 'Close' }),
    );
    expect(
      screen.queryByRole('alertdialog', { name: 'Abort Operation', hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('previews file deletion and gives the destructive confirmation a specific label', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      path: '/tmp/file-actions',
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionMoveFileToTrash' },
      summary: { id: 'previewDeleteFiles', args: { count: 1 } },
      affectedPaths: ['src/app.ts'],
      affectedCommits: [],
      lostCommitOids: [],
      resolvedTargets: [],
      destructive: true,
    }));
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
      repoId: request.repoId,
      generation: 2,
      summary: { id: 'backendFilesDeleted', args: { count: 1 } },
      snapshot: { ...repo, generation: 2, eventSeq: 2 },
    }));
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'diff')
          return {
            kind: 'diff' as const,
            diff: {
              diffId: 'file-action-diff',
              repoId: repo.repoId,
              path: request.path,
              area: request.area,
              generation: repo.generation,
              patch: `diff --git a/${request.path} b/${request.path}\n`,
            },
          };
        if (request.kind === 'snapshot') return { kind: 'snapshot' as const, snapshot: repo };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview,
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'More actions for src/app.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete File' }));

    expect(preview).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'fileAction', paths: ['src/app.ts'], operation: 'moveToTrash' },
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Move Files to Trash' });
    expect(within(dialog).getByText('src/app.ts')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(execute).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'fileAction', paths: ['src/app.ts'], operation: 'moveToTrash' },
      preview: expect.objectContaining({ repoId: repo.repoId }),
    });
  });

  it('remounts repository-scoped Commit drafts when switching repositories', async () => {
    const user = userEvent.setup();
    const change = {
      path: 'src/app.ts',
      area: 'staged' as const,
      status: 'modified' as const,
    };
    const first = repoSnapshot({
      repoId: 'repo-1',
      name: 'first',
      path: '/tmp/first',
      changes: [change],
    });
    const second = repoSnapshot({
      repoId: 'repo-2',
      name: 'second',
      path: '/tmp/second',
      changes: [{ ...change, path: 'src/other.ts' }],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [first, second],
        selectedRepoId: first.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'diff')
          return {
            kind: 'diff' as const,
            diff: {
              diffId: `${request.repoId}:${request.path}`,
              repoId: request.repoId,
              path: request.path,
              area: request.area,
              generation: 1,
              patch: `diff --git a/${request.path} b/${request.path}\n`,
            },
          };
        if (request.kind === 'snapshot')
          return {
            kind: 'snapshot' as const,
            snapshot: request.repoId === first.repoId ? first : second,
          };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, '/tmp/first');
    await user.click(addRepositorySubmitButton());
    await user.click(
      within(await screen.findByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    const description = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(description, 'first draft');
    await selectRepository(user, 'second');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await selectRepository(user, 'first');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('first draft');
    await selectRepository(user, 'second');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  });

  it('does not let a late older snapshot overwrite newer repository state', async () => {
    const user = userEvent.setup();
    const initial = repoSnapshot();
    let subscriber: Parameters<WorkspaceAdapter['subscribe']>[0] | undefined;
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [initial],
        selectedRepoId: initial.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'snapshot'
          ? { kind: 'snapshot' as const, snapshot: initial }
          : request.kind === 'branches'
            ? { kind: 'branches' as const, branches: [] }
            : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async (onEvent) => {
        subscriber = onEvent;
        return () => undefined;
      }),
    };
    render(<App adapter={adapter} />);
    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, '/tmp/stella');
    await user.click(addRepositorySubmitButton());
    await waitFor(() => expect(subscriber).toBeDefined());

    act(() => {
      subscriber?.({
        kind: 'snapshotChanged',
        snapshot: {
          ...initial,
          generation: 2,
          eventSeq: 5,
          branch: { ...initial.branch, name: 'new-branch' },
        },
      });
    });
    expect(screen.getAllByText('new-branch').length).toBeGreaterThan(0);
    act(() => {
      subscriber?.({
        kind: 'snapshotChanged',
        snapshot: {
          ...initial,
          generation: 2,
          eventSeq: 4,
          branch: { ...initial.branch, name: 'old-branch' },
        },
      });
    });
    expect(screen.queryByText('old-branch')).not.toBeInTheDocument();
    expect(screen.getAllByText('new-branch').length).toBeGreaterThan(0);
  });

  it('opens Settings and persists a fixed appearance', async () => {
    const user = userEvent.setup();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(screen.getByRole('button', { name: 'General' })).toHaveFocus();
    expect(settings).toHaveAttribute('aria-current', 'page');
    const appNavigation = screen.getByRole('navigation', { name: 'App navigation' });
    expect(within(appNavigation).getByRole('button', { name: 'Diff' })).toBeDisabled();
    expect(within(appNavigation).getByRole('button', { name: 'History' })).toBeDisabled();
    expect(within(appNavigation).getByRole('button', { name: 'Activity' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Repository' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveValue('system');
    expect(screen.getByRole('combobox', { name: 'Font Size' })).toHaveValue('100');
    expect(screen.getByRole('combobox', { name: 'Interface Font' })).toHaveValue('system');
    expect(screen.getByRole('combobox', { name: 'Code Font' })).toHaveValue('sfMono');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Appearance' }), 'dark');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Font Size' }), '120');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Interface Font' }),
      'avenirNext',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Code Font' }), 'menlo');
    await user.click(screen.getByRole('button', { name: 'Editor' }));
    expect(screen.getByRole('combobox', { name: 'Diff layout' })).toHaveValue('unified');
    expect(screen.getByRole('combobox', { name: 'Image Preview Layout' })).toHaveValue('split');
    expect(screen.getByRole('combobox', { name: 'Line Wrapping' })).toHaveValue('disabled');
    expect(screen.getByRole('spinbutton', { name: 'Wrap Length' })).toHaveValue(120);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Diff layout' }), 'split');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Image Preview Layout' }),
      'unified',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line Wrapping' }), 'enabled');
    const wrapColumn = screen.getByRole('spinbutton', { name: 'Wrap Length' });
    await user.clear(wrapColumn);
    await user.type(wrapColumn, '100');
    await user.click(
      within(screen.getByRole('navigation', { name: 'Settings categories' })).getByRole('button', {
        name: 'Diff',
      }),
    );
    expect(screen.getByRole('combobox', { name: 'Conventional Commits' })).toHaveValue('disabled');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Conventional Commits' }),
      'enabled',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).toHaveAttribute('data-font-size', '120');
    expect(document.documentElement).toHaveAttribute('data-ui-font', 'avenirNext');
    expect(document.documentElement).toHaveAttribute('data-code-font', 'menlo');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}')).toMatchObject({
        appearance: 'dark',
        fontSize: 120,
        uiFont: 'avenirNext',
        codeFont: 'menlo',
        diffStyle: 'split',
        imagePreviewLayout: 'unified',
        useConventionalCommits: true,
        editorLineWrapping: true,
        editorWrapColumn: 100,
      }),
    );

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(settings).toHaveAttribute('aria-current', 'page');
  });

  it('switches Japanese and English immediately, persists the choice, and keeps the theme', async () => {
    const user = userEvent.setup();
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Appearance' }), 'dark');
    await user.click(screen.getByRole('button', { name: 'General' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja');

    expect(screen.getByRole('heading', { name: '設定' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'アプリのナビゲーション' })).toBeVisible();
    expect(screen.getByRole('button', { name: '設定' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'リポジトリ' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '言語' })).toHaveValue('ja');
    expect(screen.getByRole('option', { name: 'English' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('lang', 'ja');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}')).toMatchObject({
        language: 'ja',
        appearance: 'dark',
      }),
    );

    await user.selectOptions(screen.getByRole('combobox', { name: '言語' }), 'en');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('queues runtime errors without overwriting them and keeps warnings non-modal', async () => {
    const user = userEvent.setup();
    let subscriber: Parameters<WorkspaceAdapter['subscribe']>[0] | undefined;
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async (onEvent) => {
        subscriber = onEvent;
        return () => undefined;
      }),
    };
    render(<App adapter={adapter} />);
    await waitFor(() => expect(subscriber).toBeDefined());

    act(() => {
      subscriber?.({ kind: 'notice', level: 'error', message: { id: 'errorGitFailed' } });
      subscriber?.({ kind: 'notice', level: 'error', message: { id: 'errorInternal' } });
    });
    expect(screen.getByRole('alertdialog', { name: 'Workspace error' })).toHaveTextContent(
      'Git could not complete the operation.',
    );
    expect(screen.queryByText('An unexpected error occurred.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Workspace error' })).toHaveTextContent(
      'An unexpected error occurred.',
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));

    act(() => {
      subscriber?.({
        kind: 'notice',
        level: 'warning',
        message: { id: 'backendOperationInProgress' },
      });
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Operation in progress');
  });

  it.each([
    {
      name: 'diverged Pull',
      failure: new WorkspaceAdapterError('pullDiverged', 'Fast-forward is not possible.'),
      expectedResolution: true,
    },
    {
      name: 'generic Pull failure',
      failure: new WorkspaceAdapterError('gitFailed', 'Could not contact the remote.', {
        stderr: 'fatal: unable to access the remote',
      }),
      expectedResolution: false,
    },
  ])('routes $name to the correct error surface', async ({ failure, expectedResolution }) => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const execute = vi.fn<WorkspaceAdapter['execute']>(async () => {
      throw failure;
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'snapshot') return { kind: 'snapshot' as const, snapshot: repo };
        if (request.kind === 'branches') {
          return {
            kind: 'branches' as const,
            branches: [
              {
                fullName: 'refs/remotes/origin/main',
                shortName: 'origin/main',
                oid: 'remote-main',
                current: false,
                remote: true,
              },
            ],
          };
        }
        if (request.kind === 'remotes') {
          return {
            kind: 'remotes' as const,
            remotes: [{ name: 'origin', fetchUrls: ['example'], pushUrls: ['example'] }],
            generation: 1,
          };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(screen.getByRole('button', { name: 'Pull' }));
    const pullDialog = await screen.findByRole('dialog', { name: 'Pull' });
    await waitFor(() =>
      expect(within(pullDialog).getByRole('combobox', { name: 'Remote branch' })).toHaveValue(
        'origin/main',
      ),
    );
    await user.click(within(pullDialog).getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        Boolean(screen.queryByText('Fast-forward unavailable')) ||
          Boolean(screen.queryByRole('dialog', { name: 'Pull' })),
      ).toBe(true),
    );

    const resolution = screen.queryByText('Fast-forward unavailable');
    const errorDialog = screen.queryByRole('dialog', { name: 'Pull' });
    expect(Boolean(resolution)).toBe(expectedResolution);
    expect(Boolean(errorDialog)).toBe(!expectedResolution);
    expect(errorDialog?.textContent ?? '').toContain(
      expectedResolution ? '' : 'The operation failed.',
    );
  });

  it('guards Activity and Settings with cancel, discard, and save conflict leave paths', async () => {
    const user = userEvent.setup();
    const conflictedRepo = repoSnapshot({
      operation: {
        kind: 'merge',
        label: { id: 'operationResolvingMerge' },
        unresolvedCount: 1,
        canContinue: false,
        canSkip: false,
        canAbort: true,
      },
      changes: [{ path: 'src/app.ts', area: 'conflicted', status: 'conflicted' }],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [conflictedRepo],
        selectedRepoId: conflictedRepo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'conflict') {
          return { kind: 'conflict' as const, document: conflictDocument() };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'snapshot') {
          return { kind: 'snapshot' as const, snapshot: conflictedRepo };
        }
        if (request.kind === 'commitActivity') {
          return commitActivityResult(conflictedRepo, request.bucketBoundariesUnixSeconds, 1);
        }
        return { kind: 'activity' as const, entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
        repoId: request.repoId,
        generation: conflictedRepo.generation,
        summary: { id: 'backendConflictResultSaved' },
        conflictDocument: conflictDocument({
          documentRevision: 'revision-saved',
          result: { text: 'dirty result', lineEnding: 'lf' },
        }),
      })),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, conflictedRepo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Leave Without Saving' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Diff' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Leave Without Saving' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await user.click(
      within(screen.getByRole('navigation', { name: 'App navigation' })).getByRole('button', {
        name: 'Diff',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Save and Leave' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ kind: 'saveConflict' }) }),
    );
  });

  it('uses the shared unsaved guard when leaving a normal file editor', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    let savedText = 'const value = 1;\n';
    let savedHash = 'hash-1';
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => {
      if (request.action.kind === 'saveFile') {
        savedText = request.action.text;
        savedHash = 'hash-2';
      }
      return {
        repoId: request.repoId,
        generation: repo.generation,
        summary: { id: 'backendFileSaved' },
      };
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'snapshot') return { kind: 'snapshot', snapshot: repo };
        if (request.kind === 'diff') {
          return {
            kind: 'diff',
            diff: {
              diffId: 'diff-1',
              repoId: repo.repoId,
              path: request.path,
              area: request.area,
              generation: repo.generation,
              patch: 'diff --git a/src/app.ts b/src/app.ts\n',
              binary: false,
              tooLarge: false,
            },
          };
        }
        if (request.kind === 'fileContents') {
          return {
            kind: 'fileContents',
            document: {
              repoId: repo.repoId,
              path: request.path,
              text: savedText,
              lineEnding: 'lf',
              hasUtf8Bom: false,
              contentHash: savedHash,
              generation: repo.generation,
            },
          };
        }
        if (request.kind === 'commitActivity') {
          return commitActivityResult(repo, request.bucketBoundariesUnixSeconds, 1);
        }
        return { kind: 'activity', entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Toggle file editing' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit src/app.ts' }), {
      target: { value: 'const value = 2;\n' },
    });

    await user.click(screen.getByRole('button', { name: 'History' }));
    const unsavedDialog = await screen.findByRole('alertdialog', { name: 'Unsaved changes' });
    expect(unsavedDialog).toBeVisible();
    await user.click(within(unsavedDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: 'Edit src/app.ts' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(screen.getByRole('button', { name: 'Save and Leave' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: {
          kind: 'saveFile',
          path: 'src/app.ts',
          text: 'const value = 2;\n',
          expectedContentHash: 'hash-1',
        },
      }),
    );
  });

  it('intercepts native window close while a file draft is unsaved', async () => {
    Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    tauriWindowMock.destroy.mockClear();
    tauriWindowMock.handler = undefined;
    const user = userEvent.setup();
    const repo = repoSnapshot({
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'snapshot') return { kind: 'snapshot', snapshot: repo };
        if (request.kind === 'diff') {
          return {
            kind: 'diff',
            diff: {
              diffId: 'diff-close',
              repoId: repo.repoId,
              path: request.path,
              area: request.area,
              generation: repo.generation,
              patch: 'diff --git a/src/app.ts b/src/app.ts\n',
              binary: false,
              tooLarge: false,
            },
          };
        }
        if (request.kind === 'fileContents') {
          return {
            kind: 'fileContents',
            document: {
              repoId: repo.repoId,
              path: request.path,
              text: 'original\n',
              lineEnding: 'lf',
              hasUtf8Bom: false,
              contentHash: 'hash-close',
              generation: repo.generation,
            },
          };
        }
        return { kind: 'activity', entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const rendered = render(<App adapter={adapter} />);
    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, repo.path);
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Toggle file editing' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit src/app.ts' }), {
      target: { value: 'draft\n' },
    });
    await waitFor(() => expect(tauriWindowMock.handler).toBeTypeOf('function'));

    const preventDefault = vi.fn<() => void>();
    act(() => tauriWindowMock.handler?.({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved changes' });
    expect(within(dialog).getByRole('button', { name: 'Save and Close' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Close Without Saving' })).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Close Without Saving' }));
    await waitFor(() => expect(tauriWindowMock.destroy).toHaveBeenCalledOnce());
    rendered.unmount();
    Reflect.deleteProperty(globalThis, '__TAURI_INTERNALS__');
  });

  it.each([
    { label: 'Continue', kind: 'continueOperation' as const, invocation: 'execute' as const },
    { label: 'Skip', kind: 'skipOperation' as const, invocation: 'execute' as const },
    { label: 'Abort', kind: 'abortOperation' as const, invocation: 'preview' as const },
  ])(
    'guards dirty conflict edits before $label and runs the operation once after leaving',
    async ({ label, kind, invocation }) => {
      const user = userEvent.setup();
      const conflictedRepo = repoSnapshot({
        operation: {
          kind: 'rebase',
          label: { id: 'operationResolvingRebase' },
          unresolvedCount: 1,
          canContinue: kind === 'continueOperation',
          canSkip: true,
          canAbort: true,
        },
        changes: [{ path: 'src/app.ts', area: 'conflicted', status: 'conflicted' }],
      });
      const settledRepo = repoSnapshot({ generation: 2, eventSeq: 2 });
      const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
        repoId: request.repoId,
        title: { id: 'actionAbortOperation' },
        summary: { id: 'previewAbort' },
        affectedPaths: [],
        affectedCommits: [],
        lostCommitOids: [],
        resolvedTargets: [],
        destructive: true,
      }));
      const execute = vi.fn<WorkspaceAdapter['execute']>(async () => ({
        repoId: settledRepo.repoId,
        generation: settledRepo.generation,
        summary: { id: 'backendOperationAborted' },
        snapshot: settledRepo,
      }));
      const adapter: WorkspaceAdapter = {
        attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
          repos: [conflictedRepo],
          selectedRepoId: conflictedRepo.repoId,
          activities: [],
        })),
        query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
          if (request.kind === 'conflict') {
            return {
              kind: 'conflict' as const,
              document: conflictDocument({ operation: 'rebase' }),
            };
          }
          if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
          if (request.kind === 'snapshot') {
            return { kind: 'snapshot' as const, snapshot: conflictedRepo };
          }
          return { kind: 'activity' as const, entries: [] };
        }),
        preview,
        execute,
        cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
        subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
      };
      render(<App adapter={adapter} />);

      await user.click(screen.getByRole('button', { name: 'Add Repository' }));
      await enterRepositoryPath(user, conflictedRepo.path);
      await user.click(addRepositorySubmitButton());
      await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

      const operation = screen.getByRole('button', { name: label });
      await user.click(operation);
      let guard = await screen.findByRole('alertdialog', { name: 'Unsaved result' });
      await user.click(within(guard).getByRole('button', { name: 'Cancel' }));
      expect(preview).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(operation).toHaveFocus();

      await user.click(operation);
      guard = await screen.findByRole('alertdialog', { name: 'Unsaved result' });
      const discardLabel =
        kind === 'continueOperation'
          ? 'Discard Result and Continue'
          : kind === 'skipOperation'
            ? 'Discard Result and Skip'
            : 'Discard Result and Abort';
      await user.click(within(guard).getByRole('button', { name: discardLabel }));

      const invoked = invocation === 'execute' ? execute : preview;
      const notInvoked = invocation === 'execute' ? preview : execute;
      await waitFor(() => expect(invoked).toHaveBeenCalledOnce());
      expect(invoked).toHaveBeenCalledWith(
        expect.objectContaining({ action: { kind }, repoId: conflictedRepo.repoId }),
      );
      expect(notInvoked).not.toHaveBeenCalled();

      await waitFor(() => {
        const expectedStateReached =
          invocation === 'execute'
            ? screen.getByRole('button', { name: 'Diff' }).getAttribute('aria-current') === 'page'
            : within(screen.getByRole('alertdialog', { name: 'Abort Operation' })).getByRole(
                'button',
                { name: 'Cancel' },
              ) === document.activeElement;
        expect(expectedStateReached).toBe(true);
      });
    },
  );
});

describe('App repository recovery', () => {
  it('keeps the newest repository availability when checks finish out of order', async () => {
    const path = '/tmp/moved-repository';
    writePreferences({ ...DEFAULT_PREFERENCES, registeredRepoPaths: [path] });
    const resolvers: Array<(availability: RepositoryAvailability) => void> = [];
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'repositoryAvailability') {
        const availability = await new Promise<RepositoryAvailability>((resolve) =>
          resolvers.push(resolve),
        );
        return { kind: 'repositoryAvailability', path: request.path, availability };
      }
      if (request.kind === 'activity') return { kind: 'activity', entries: [] };
      throw new Error(`Unexpected query: ${request.kind}`);
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query,
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await waitFor(() => expect(resolvers).toHaveLength(1));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[1]?.('missing'));
    await act(async () => resolvers[0]?.('available'));

    expect(await screen.findByText('Check location')).toBeInTheDocument();
  });

  it('rechecks registered repository access when the app regains focus', async () => {
    const user = userEvent.setup();
    const path = '/tmp/protected-repository';
    const repositoryBasePath = '/tmp/repositories';
    let availability: RepositoryAvailability = 'inaccessible';
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
    });
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'repositoryAvailability') {
        return { kind: 'repositoryAvailability', path: request.path, availability };
      }
      if (request.kind === 'activity') return { kind: 'activity', entries: [] };
      throw new Error(`Unexpected query: ${request.kind}`);
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query,
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const directoryPicker = vi.fn<() => Promise<string>>(async () => repositoryBasePath);
    render(<App adapter={adapter} directoryPicker={directoryPicker} />);

    await waitFor(() =>
      expect(query).toHaveBeenCalledWith({ kind: 'repositoryAvailability', path }),
    );
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Permissions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One or more registered repositories cannot be accessed.',
    );
    await user.click(screen.getByRole('button', { name: 'Choose Location' }));
    expect(directoryPicker).toHaveBeenCalledWith('Choose Location');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Repository Location' })).toHaveValue(
        repositoryBasePath,
      ),
    );

    const checksBeforeReturn = query.mock.calls.filter(
      ([request]) => request.kind === 'repositoryAvailability',
    ).length;
    availability = 'available';
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(
      query.mock.calls.filter(([request]) => request.kind === 'repositoryAvailability').length,
    ).toBe(checksBeforeReturn + 1);
  });

  it('asks whether to remove only the registration or delete the local repository', async () => {
    const user = userEvent.setup();
    const path = '/tmp/repository-to-delete';
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [path],
      repositoryNames: { [path]: 'Repository to Delete' },
    });
    const deleteRepository = vi.fn<NonNullable<WorkspaceAdapter['deleteRepository']>>(
      async () => undefined,
    );
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'repositoryAvailability'
          ? { kind: 'repositoryAvailability', path: request.path, availability: 'available' }
          : { kind: 'activity', entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      deleteRepository,
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(
      await screen.findByRole('button', { name: 'More actions for Repository to Delete' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete Repository' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete Repository' });
    expect(
      within(confirmation).getByRole('button', { name: 'Remove Registration Only' }),
    ).toBeVisible();
    await user.click(within(confirmation).getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => expect(deleteRepository).toHaveBeenCalledWith(path));
    expect(readPreferences().registeredRepoPaths).toEqual([]);
  });

  it('validates and confirms a relocated registered repository before migrating its settings', async () => {
    const user = userEvent.setup();
    const oldPath = '/tmp/old-repository';
    const newPath = '/tmp/new-repository';
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [oldPath],
      repositoryNames: { [oldPath]: 'Moved Repository' },
      repositoryHealthIssues: {
        [oldPath]: [{ kind: 'remote', remote: 'origin', reason: 'network' }],
      },
      commitDrafts: {
        [oldPath]: {
          plainMessage: 'plain draft',
          conventional: {
            type: 'fix',
            breaking: false,
            description: 'structured draft',
          },
        },
      },
    });
    const relocated = repoSnapshot({ repoId: 'repo-relocated', path: newPath });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [relocated],
        selectedRepoId: relocated.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          return {
            kind: 'repositoryAvailability',
            path: request.path,
            availability: request.path === oldPath ? 'missing' : 'available',
          };
        }
        if (request.kind === 'snapshot') return { kind: 'snapshot', snapshot: relocated };
        return { kind: 'activity', entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    const directoryPicker = vi.fn<() => Promise<string>>(async () => newPath);
    render(<App adapter={adapter} directoryPicker={directoryPicker} />);

    await user.click(
      await screen.findByRole('button', { name: 'More actions for Moved Repository' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Switch Repository' }));
    const confirmation = await screen.findByRole('alertdialog', { name: 'Confirm New Location' });
    expect(confirmation).toHaveTextContent(oldPath);
    expect(confirmation).toHaveTextContent(newPath);
    await user.click(within(confirmation).getByRole('button', { name: 'Update Registration' }));

    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({ kind: 'openExisting', path: newPath }),
    );
    expect(readPreferences()).toMatchObject({
      registeredRepoPaths: [newPath],
      repositoryNames: { [newPath]: 'Moved Repository' },
      repositoryHealthIssues: {
        [newPath]: [{ kind: 'remote', remote: 'origin', reason: 'network' }],
      },
      commitDrafts: {
        [newPath]: {
          plainMessage: 'plain draft',
          conventional: { description: 'structured draft' },
        },
      },
    });
  });

  async function prepareFileRelocation(newBaseHash: string) {
    const user = userEvent.setup();
    const oldPath = '/tmp/old-editing-repository';
    const newPath = '/tmp/new-editing-repository';
    const change = { path: 'src/app.ts', area: 'unstaged' as const, status: 'modified' as const };
    const oldRepo = repoSnapshot({ repoId: 'repo-old', path: oldPath, changes: [change] });
    const newRepo = repoSnapshot({ repoId: 'repo-new', path: newPath, changes: [change] });
    let oldPathMissing = false;
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [oldPath],
    });
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
      repoId: request.repoId,
      generation: newRepo.generation,
      summary: { id: 'backendFileSaved' },
      snapshot: newRepo,
    }));
    const detach = vi.fn<NonNullable<WorkspaceAdapter['detach']>>(async () => undefined);
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async (request) => {
        const repository = request.kind !== 'clone' && request.path === newPath ? newRepo : oldRepo;
        return {
          repos: [repository],
          selectedRepoId: repository.repoId,
          activities: [],
        };
      }),
      detach,
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'repositoryAvailability') {
          return {
            kind: 'repositoryAvailability',
            path: request.path,
            availability: request.path === oldPath && oldPathMissing ? 'missing' : 'available',
          };
        }
        if (request.kind === 'snapshot') {
          return {
            kind: 'snapshot',
            snapshot: request.repoId === newRepo.repoId ? newRepo : oldRepo,
          };
        }
        if (request.kind === 'diff') {
          return {
            kind: 'diff',
            diff: {
              diffId: `diff-${request.repoId}`,
              repoId: request.repoId,
              path: request.path,
              area: request.area,
              generation: oldRepo.generation,
              patch: 'diff --git a/src/app.ts b/src/app.ts\n',
            },
          };
        }
        if (request.kind === 'fileContents') {
          const moved = request.repoId === newRepo.repoId;
          return {
            kind: 'fileContents',
            document: {
              repoId: request.repoId,
              path: request.path,
              text: moved ? 'moved contents\n' : 'original contents\n',
              lineEnding: 'lf',
              hasUtf8Bom: false,
              contentHash: moved ? newBaseHash : 'base-hash',
              generation: oldRepo.generation,
            },
          };
        }
        if (request.kind === 'commitActivity') {
          return commitActivityResult(oldRepo, request.bucketBoundariesUnixSeconds);
        }
        return { kind: 'activity', entries: [] };
      }),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} directoryPicker={async () => newPath} />);

    await user.dblClick(
      screen.getByRole('option', {
        name: 'old-editing-repository/tmp/old-editing-repository',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Toggle file editing' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit src/app.ts' }), {
      target: { value: 'local draft\n' },
    });
    oldPathMissing = true;
    fireEvent.focus(window);
    await user.click(await screen.findByRole('button', { name: 'Choose Location' }));
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Confirm New Location',
    });
    await user.click(within(confirmation).getByRole('button', { name: 'Update Registration' }));

    return { user, oldPath, newPath, oldRepo, newRepo, execute, detach };
  }

  it('未保存のファイル編集は移動先の基準が一致する場合に引き継ぐ', async () => {
    const { oldRepo, newRepo, newPath, execute, detach } = await prepareFileRelocation('base-hash');

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        repoId: newRepo.repoId,
        action: {
          kind: 'saveFile',
          path: 'src/app.ts',
          text: 'local draft\n',
          expectedContentHash: 'base-hash',
        },
      }),
    );
    expect(detach).toHaveBeenCalledWith(oldRepo.repoId);
    expect(readPreferences().registeredRepoPaths).toEqual([newPath]);
  });

  it('移動先の基準が異なる場合は未保存のファイル編集と旧登録を保持する', async () => {
    const { user, oldPath, newRepo, execute, detach } =
      await prepareFileRelocation('external-hash');

    const error = await screen.findByRole('alertdialog', {
      name: 'Could not update repository registration',
    });
    await user.click(within(error).getByRole('button', { name: 'Close' }));
    expect(execute).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledWith(newRepo.repoId);
    expect(screen.getByRole('textbox', { name: 'Edit src/app.ts' })).toHaveValue('local draft\n');
    expect(readPreferences().registeredRepoPaths).toEqual([oldPath]);
  });
});
