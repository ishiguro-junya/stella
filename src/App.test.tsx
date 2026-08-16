import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceAdapterError, type WorkspaceAdapter } from './adapters/workspaceAdapter';
import { App } from './App';
import type {
  QueryResult,
  RepositoryAvailability,
  RepoSnapshot,
  WorkspaceSnapshot,
} from './domain/workspace';
import type { AppUpdateInfo, AppUpdateInstallEvent } from './features/update/appUpdate';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from './persistence/preferences';
import { conflictDocument, repoSnapshot } from './test/fixtures';

const tauriWindowMock = vi.hoisted(() => ({
  destroy: vi.fn<() => Promise<void>>(async () => undefined),
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

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: tauriWindowMock.destroy,
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
  await user.type(within(dialog).getByRole('textbox', { name: 'Repository path' }), path);
}

function addRepositorySubmitButton(): HTMLElement {
  const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
  return within(dialog).getByRole('button', { name: 'Add Repository' });
}

describe('App repository attach', () => {
  it('shows an available update as an icon button on the titlebar left', async () => {
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
    const updateButton = screen.getByRole('button', { name: 'Update to version 1.0.0-beta.1' });
    const leftActions = container.querySelector<HTMLElement>('.titlebar-left-actions');
    if (!leftActions) throw new Error('titlebar left actions not found');
    expect(within(leftActions).getAllByRole('button')).toEqual([updateButton]);
    expect(updateButton.textContent).toBe('');
    expect(updateButton.querySelector('svg')).toBeInTheDocument();

    const actions = container.querySelector<HTMLElement>('.titlebar-actions');
    if (!actions) throw new Error('titlebar actions not found');
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Settings']);

    fireEvent.focus(updateButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Update to version 1.0.0-beta.1');
  });

  it('shows the delayed loading indicator for a manual update check already in flight', async () => {
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
    expect(container.querySelector('.titlebar-update-loading')).toHaveAttribute(
      'aria-label',
      'Loading…',
    );

    await act(async () => resolveCheck(undefined));
    await waitFor(() =>
      expect(container.querySelector('.titlebar-update-loading')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('The app is up to date.')).toBeVisible();
  });

  it('keeps product branding out of the window content and names icon-only controls', () => {
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

    const { container } = render(<App adapter={adapter} />);

    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Add your first repository' })).toBeVisible();
    expect(container.querySelector('.brand, .brand-mark')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Repository' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clone Repository' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Activity' })).not.toBeInTheDocument();
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
    expect(within(titlebarActions).getAllByRole('button')).toEqual([settings]);
    expect(container).not.toHaveTextContent('Workspace Log');
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

    const diff = await screen.findByRole('button', { name: 'Diff' });
    const history = screen.getByRole('button', { name: 'History' });
    const activity = screen.getByRole('button', { name: 'Activity' });
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(diff).toHaveAttribute('aria-current', 'page');
    expect(diff.querySelector('.lucide-file-diff')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Sidebar' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close Sidebar' }));
    expect(screen.getByTestId('app-shell')).toHaveClass('is-sidebar-closed');
    await user.click(screen.getByRole('button', { name: 'Open Sidebar' }));
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
    expect(screen.getByRole('button', { name: /Current repository/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current branch/u })).toBeVisible();
    const activityMetric = await screen.findByRole('combobox', { name: 'Activity metric' });
    expect(activityMetric).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Activity range' })).toBeVisible();
    expect(document.querySelector('.activity-analytics-header select')).toBe(activityMetric);
    expect(activityMetric.closest('.left-pane-toolbar')).toBeInTheDocument();
    const activityResizer = await screen.findByRole('separator', {
      name: 'Repository analytics width',
    });
    expect(activityResizer).toHaveAttribute('aria-valuenow', '384');
    activityResizer.focus();
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(activityResizer).toHaveAttribute('aria-valuenow', '360');

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
      '360',
    );

    await user.click(history);
    expect(history).toHaveAttribute('aria-current', 'page');
    expect(history).toHaveFocus();
    const historyResizer = await screen.findByRole('separator', { name: 'History list width' });
    expect(historyResizer).toHaveAttribute('aria-valuenow', '360');
    historyResizer.focus();
    await user.keyboard('{ArrowRight}');
    expect(historyResizer).toHaveAttribute('aria-valuenow', '368');

    await user.click(settings);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /Current repository/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Current branch/u })).not.toBeInTheDocument();

    await user.click(activity);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('separator', { name: 'Repository analytics width' })).toHaveAttribute(
      'aria-valuenow',
      '368',
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}')).toMatchObject({
        paneWidths: { left: 368, right: 336 },
      }),
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
            repositoryName: 'stella',
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

    await user.click(screen.getByRole('button', { name: 'Clone Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'https://example.com/repository.git',
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Clone Repository' })).getByRole('button', {
        name: 'Clone Repository',
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Repositories' }));
    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(
      screen.getByRole('row', { name: /Running Clone Repository Cloning repository/u }),
    ).toHaveFocus();
    expect(attach).toHaveBeenCalledWith({
      kind: 'clone',
      remoteUrl: 'https://example.com/repository.git',
      destination: '/tmp/repository',
    });
    await user.click(screen.getByRole('row', { name: /Running Clone Repository/u }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        repoId: 'clone-temporary',
        activityId: 'clone-operation',
      }),
    );
    expect(await screen.findByText('The operation was cancelled.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Repositories' }));
    await user.click(screen.getByRole('button', { name: 'Clone Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'https://example.com/another.git',
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Clone Repository' })).getByRole('button', {
        name: 'Clone Repository',
      }),
    );
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2));
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

    await user.click(
      screen.getByRole('button', { name: 'registered-stella/tmp/registered-stella' }),
    );

    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({
        kind: 'openExisting',
        path: '/tmp/registered-stella',
      }),
    );
  });

  it('restores the previously open repository on Diff despite a legacy History view', async () => {
    const repo = repoSnapshot({ path: '/tmp/restored-stella' });
    localStorage.setItem(
      'stella.preferences.v1',
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        registeredRepoPaths: [repo.path],
        openRepoPaths: [repo.path],
        selectedRepoPath: repo.path,
        view: 'history',
      }),
    );
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
    render(<App adapter={adapter} />);

    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({
        kind: 'openExisting',
        path: repo.path,
      }),
    );
    expect(
      await screen.findByRole('button', { name: /Current repository restored-stella/u }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'History' })).not.toHaveAttribute('aria-current');
  });

  it('saves changed remote URLs without confirmation and fetches each changed remote once', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ name: 'remote-stella', path: '/tmp/remote-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
      openRepoPaths: [repo.path],
      selectedRepoPath: repo.path,
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

    await user.click(
      await screen.findByRole('button', { name: /Current repository remote-stella/u }),
    );
    const switcher = screen.getByRole('dialog', { name: 'Switch Repository' });
    await user.click(
      within(switcher).getByRole('button', { name: 'More actions for remote-stella' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Change Remote URLs' }));
    const manager = await screen.findByRole('dialog', { name: 'Change Remote URLs' });
    const inputs = within(manager).getAllByRole('textbox');
    await user.clear(inputs[0]!);
    await user.type(inputs[0]!, 'https://example.test/new.git');
    await user.clear(inputs[1]!);
    await user.type(inputs[1]!, 'ssh://example.test/new.git');
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
    expect(screen.queryByRole('dialog', { name: 'Change Remote URLs' })).not.toBeInTheDocument();
  });

  it('keeps the remote URL dialog open and reloads URLs after a save failure', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ name: 'remote-stella', path: '/tmp/remote-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
      openRepoPaths: [repo.path],
      selectedRepoPath: repo.path,
    });
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
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

    await user.click(
      await screen.findByRole('button', { name: /Current repository remote-stella/u }),
    );
    const switcher = screen.getByRole('dialog', { name: 'Switch Repository' });
    await user.click(
      within(switcher).getByRole('button', { name: 'More actions for remote-stella' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Change Remote URLs' }));
    const manager = await screen.findByRole('dialog', { name: 'Change Remote URLs' });
    const input = within(manager).getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'https://example.test/new.git');
    await user.click(within(manager).getByRole('button', { name: 'Save' }));

    const error = await screen.findByRole('alertdialog', { name: 'Operation failed' });
    await waitFor(() =>
      expect(query.mock.calls.filter(([request]) => request.kind === 'remotes')).toHaveLength(2),
    );
    await user.click(within(error).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Change Remote URLs' })).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('https://example.test/old.git');
  });

  it('前回のリポジトリを復元している間はリポジトリ開始画面を表示しない', async () => {
    const repo = repoSnapshot({ path: '/tmp/restored-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
      openRepoPaths: [repo.path],
      selectedRepoPath: repo.path,
    });
    let resolveAttach: ((snapshot: WorkspaceSnapshot) => void) | undefined;
    const pendingAttach = new Promise<WorkspaceSnapshot>((resolve) => {
      resolveAttach = resolve;
    });
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => await pendingAttach),
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
    render(
      <StrictMode>
        <App adapter={adapter} />
      </StrictMode>,
    );

    await waitFor(() => expect(adapter.attach).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Repositories' })).not.toBeInTheDocument();

    await act(async () => {
      resolveAttach?.({ repos: [repo], selectedRepoId: repo.repoId, activities: [] });
      await pendingAttach;
    });
    expect(
      await screen.findByRole('button', { name: /Current repository restored-stella/u }),
    ).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: 'Choose Repository' }));

    expect(directoryPicker).toHaveBeenCalledWith('Choose Repository');
    expect(screen.getByRole('textbox', { name: 'Repository path' })).toHaveValue(repo.path);
    expect(adapter.attach).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'Stella Desktop');
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

    await user.click(screen.getByRole('button', { name: 'Clone Repository' }));
    await user.click(screen.getByRole('button', { name: 'Choose Repository' }));
    expect(directoryPicker).toHaveBeenCalledWith('Choose Repository');
    expect(screen.getByRole('textbox', { name: 'Repository path' })).toHaveValue('/tmp/clones');
    await user.type(screen.getByRole('textbox', { name: 'Repository URL' }), 'invalid');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Clone Repository' })).getByRole('button', {
        name: 'Clone Repository',
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

    await user.click(screen.getByRole('button', { name: 'Clone Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL' }),
      'git@example.com:owner/repository.git',
    );
    const destination = screen.getByRole('textbox', { name: 'Repository path' });
    await user.clear(destination);
    await user.type(destination, 'relative/path');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Clone Repository' })).getByRole('button', {
        name: 'Clone Repository',
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute local path.');
    expect(directoryPicker).not.toHaveBeenCalled();
    expect(adapter.attach).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Clone Repository' })).toBeVisible();
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

  it('loads local branches, checks out a selection, and creates the next branch', async () => {
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
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionCreateBranch' },
      summary: { id: 'actionCreateBranch' },
      affectedPaths: [],
      affectedCommits: ['feature-oid'],
      lostCommitOids: [],
      resolvedTargets: [{ input: 'feature-oid', oid: 'feature-oid' }],
      destructive: false,
    }));
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
            oid: 'main',
            current: true,
            remote: false,
          },
          {
            fullName: 'refs/heads/feature',
            shortName: 'feature',
            oid: 'feature',
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
    await user.click(within(reopened).getByRole('button', { name: 'Create branch' }));
    const createDialog = screen.getByRole('dialog', { name: 'Create branch' });
    await user.type(
      within(createDialog).getByRole('textbox', { name: 'Branch name' }),
      'feature/new-flow',
    );
    await user.click(within(createDialog).getByRole('button', { name: 'Review impact' }));

    expect(preview).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: {
        kind: 'createBranch',
        name: 'feature/new-flow',
        startOid: 'feature-oid',
        checkout: true,
      },
    });
    const confirmation = screen.getByRole('alertdialog', { name: 'Create Branch' });
    await user.click(within(confirmation).getByRole('button', { name: 'Create' }));
    expect(execute).toHaveBeenLastCalledWith({
      repoId: repo.repoId,
      action: {
        kind: 'createBranch',
        name: 'feature/new-flow',
        startOid: 'feature-oid',
        checkout: true,
      },
      preview: expect.objectContaining({ repoId: repo.repoId }),
    });
    expect(
      await screen.findByRole('button', { name: /Current branch feature\/new-flow/u }),
    ).toBeVisible();
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

  it('opens separate Add and Clone dialogs after a repository is open', async () => {
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
    expect(
      within(dialog).queryByRole('textbox', { name: 'Repository URL' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Repository path' })).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Repository name' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Choose Repository' })).toBeVisible();
    expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: /Switch repository/u }));
    const switcher = screen.getByRole('dialog', { name: 'Switch Repository' });
    await user.click(within(switcher).getByRole('button', { name: 'Clone Repository' }));
    const cloneDialog = screen.getByRole('dialog', { name: 'Clone Repository' });
    expect(within(cloneDialog).getByRole('textbox', { name: 'Repository URL' })).toBeVisible();
    expect(within(cloneDialog).getByRole('textbox', { name: 'Repository path' })).toHaveValue(
      '/tmp',
    );
    expect(within(cloneDialog).getByRole('textbox', { name: 'Repository name' })).toBeVisible();
    expect(within(cloneDialog).getByRole('button', { name: 'Choose Repository' })).toBeVisible();
    expect(within(cloneDialog).queryByRole('tab')).not.toBeInTheDocument();
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
      preview: vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
        repoId: request.repoId,
        title: { id: 'actionAbortOperation' },
        summary: { id: 'previewAbort' },
        affectedPaths: [],
        affectedCommits: ['1234567890abcdef'],
        lostCommitOids: [],
        resolvedTargets: [],
        destructive: true,
      })),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new WorkspaceAdapterError('hookFailed', 'Git operation failed.', {
          stderr: 'policy denied this operation',
          exitCode: '1',
        });
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await enterRepositoryPath(user, '/tmp/stella');
    await user.click(addRepositorySubmitButton());
    await user.click(await screen.findByRole('button', { name: 'Abort' }));
    expect(await screen.findByText('1234567890ab')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('alertdialog', { name: 'Operation failed' })).toHaveTextContent(
      'The operation failed.',
    );
    expect(screen.getByLabelText('stderr')).toHaveTextContent('policy denied this operation');
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

  it('opens Settings, persists a fixed appearance, and returns through peer navigation', async () => {
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
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Activity' })).not.toBeInTheDocument();
    const repositories = screen.getByRole('button', { name: 'Repositories' });
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

    await user.click(repositories);
    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Repositories' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    expect(screen.getByRole('dialog', { name: 'Add Repository' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('dialog', { name: 'Add Repository' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Repository' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Repositories' }));
    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Repositories' })).toHaveFocus();
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
    expect(screen.getByRole('button', { name: 'リポジトリ' })).toBeVisible();
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
          Boolean(screen.queryByRole('alertdialog', { name: 'Operation failed' })),
      ).toBe(true),
    );

    const resolution = screen.queryByText('Fast-forward unavailable');
    const errorDialog = screen.queryByRole('alertdialog', { name: 'Operation failed' });
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
      await screen.findByRole('button', { name: 'Delete repository Repository to Delete' }),
    );
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

    await user.click(await screen.findByRole('button', { name: 'Choose Location' }));
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
      openRepoPaths: [oldPath],
      selectedRepoPath: oldPath,
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
