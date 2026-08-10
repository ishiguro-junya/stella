import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceAdapterError, type WorkspaceAdapter } from './adapters/workspaceAdapter';
import { App } from './App';
import type { QueryResult, RepoSnapshot, WorkspaceSnapshot } from './domain/workspace';
import { DEFAULT_PREFERENCES, writePreferences } from './persistence/preferences';
import { conflictDocument, repoSnapshot } from './test/fixtures';

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
  await user.click(within(dialog).getByRole('option', { name: new RegExp(repositoryName, 'u') }));
}

async function openAddRepositoryDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Switch repository/u }));
  const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
  await user.click(within(dialog).getByRole('button', { name: 'Add Repository…' }));
}

describe('App repository attach', () => {
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
    expect(screen.getByText('No repositories have been added yet.')).toBeVisible();
    expect(container.querySelector('.brand, .brand-mark')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Repository' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Activity' })).not.toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings).toBeVisible();
    const titlebarActions = container.querySelector('.titlebar-actions');
    if (!(titlebarActions instanceof HTMLElement)) throw new Error('Titlebar actions are missing.');
    const titlebarContext = container.querySelector('.titlebar-context');
    if (!(titlebarContext instanceof HTMLElement)) throw new Error('Titlebar context is missing.');
    expect(titlebarContext).toHaveAttribute('data-tauri-drag-region');
    expect(titlebarActions).toHaveAttribute('data-tauri-drag-region');
    expect(settings).not.toHaveAttribute('data-tauri-drag-region');
    expect(within(titlebarActions).getAllByRole('button')).toEqual([settings]);
    expect(container).not.toHaveTextContent('Workspace Log');
  });

  it('keeps Changes, History, Activity, and Settings as peer titlebar destinations', async () => {
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const changes = await screen.findByRole('button', { name: 'Changes' });
    const history = screen.getByRole('button', { name: 'History' });
    const activity = screen.getByRole('button', { name: 'Activity' });
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(changes).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    await user.click(activity);
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Current repository/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current branch/u })).toBeVisible();

    await user.click(activity);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(activity).toHaveFocus();

    await user.click(changes);
    expect(changes).toHaveAttribute('aria-current', 'page');
    expect(changes).toHaveFocus();
    expect(activity).not.toHaveAttribute('aria-current');

    await user.click(history);
    expect(history).toHaveAttribute('aria-current', 'page');
    expect(history).toHaveFocus();

    await user.click(settings);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute('aria-current', 'page');

    await user.click(activity);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-current', 'page');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(activity).toHaveAttribute('aria-current', 'page');
    expect(activity).toHaveFocus();
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
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

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL or path' }),
      'https://example.com/repository.git',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveAccessibleDescription(
        'Operation running',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Repositories' }));
    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAccessibleDescription(
      'Operation running',
    );
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
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
    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL or path' }),
      'https://example.com/another.git',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), '/tmp/stella');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({ kind: 'open', path: '/tmp/stella' }),
    );
    expect(screen.getByRole('button', { name: /Current repository stella/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Current branch main/u })).toBeVisible();
    const changes = screen.getByRole('button', { name: 'Changes' });
    const history = screen.getByRole('button', { name: 'History' });
    expect(changes.closest('.titlebar')).toBeInTheDocument();
    expect(history.closest('.titlebar')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    await user.click(history);
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('History')).toBeVisible();

    await user.click(changes);
    expect(changes).toHaveFocus();
    expect(changes).toHaveAttribute('aria-current', 'page');
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

    await user.click(screen.getByRole('button', { name: /registered-stella/u }));

    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({
        kind: 'openExisting',
        path: '/tmp/registered-stella',
      }),
    );
  });

  it('restores the previously open repository with OpenExisting', async () => {
    const repo = repoSnapshot({ path: '/tmp/restored-stella' });
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: [repo.path],
      openRepoPaths: [repo.path],
      selectedRepoPath: repo.path,
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

    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({
        kind: 'openExisting',
        path: repo.path,
      }),
    );
    expect(await screen.findByRole('button', { name: /Current repository stella/u })).toBeVisible();
  });

  it('前回のリポジトリを復元している間は Repository Landing を表示しない', async () => {
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
    expect(await screen.findByRole('button', { name: /Current repository stella/u })).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: 'Choose in Finder…' }));

    expect(directoryPicker).toHaveBeenCalledWith('Choose Repository');
    await waitFor(() =>
      expect(adapter.attach).toHaveBeenCalledWith({ kind: 'open', path: repo.path }),
    );
  });

  it('rejects an invalid remote location before asking for a Clone destination', async () => {
    const user = userEvent.setup();
    const directoryPicker = vi.fn<() => Promise<string>>(async () => '/tmp');
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a supported remote URL or an absolute local path.',
    );
    expect(directoryPicker).not.toHaveBeenCalled();
    expect(adapter.attach).not.toHaveBeenCalled();
  });

  it('keeps the Add sheet open when choosing a Clone destination is cancelled', async () => {
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
      screen.getByRole('textbox', { name: 'Repository URL or path' }),
      'git@example.com:owner/repository.git',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(directoryPicker).toHaveBeenCalledWith('Choose Clone Location');
    expect(adapter.attach).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Add Repository' })).toBeVisible();
  });

  it('updates repository analytics after switching through peer titlebar navigation', async () => {
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), first.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('button', { name: /Current repository first/u });
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('1 commit')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Changes' }));
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('button', { name: /Current repository stella/u });

    fireEvent.keyDown(window, { key: 'o', metaKey: true, shiftKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
    expect(dialog).toBeVisible();
    expect(dialog).not.toHaveTextContent(/[⌘⇧]/u);
  });

  it('loads local branches from the separate titlebar toggle and checks out the selection', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot();
    const checkedOut = repoSnapshot({
      generation: 2,
      eventSeq: 2,
      branch: { name: 'feature', detached: false, ahead: 0, behind: 0 },
    });
    const execute = vi.fn<WorkspaceAdapter['execute']>(async () => ({
      repoId: checkedOut.repoId,
      generation: checkedOut.generation,
      snapshot: checkedOut,
      summary: { id: 'backendBranchCheckedOut' },
    }));
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: [],
      })),
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches')
          return {
            kind: 'branches' as const,
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
          };
        if (request.kind === 'snapshot') return { kind: 'snapshot' as const, snapshot: repo };
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('button', { name: /Current branch main/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch Branch' });
    await user.click(within(dialog).getByRole('option', { name: 'feature' }));

    expect(execute).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'checkoutBranch', name: 'feature' },
    });
    expect(await screen.findByRole('button', { name: /Current branch feature/u })).toBeVisible();
  });

  it('updates Stage state without showing a routine success notice', async () => {
    const user = userEvent.setup();
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Stage src/app.ts' }));

    expect(execute).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'stageFiles', paths: ['src/app.ts'] },
    });
    expect(await screen.findByRole('checkbox', { name: 'Unstage src/app.ts' })).toBeChecked();
    expect(screen.queryByText('Changes staged')).not.toBeInTheDocument();
  });

  it('uses the same Add Repository sheet after a repository is open', async () => {
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), '/tmp/stella');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('button', { name: /Current repository stella/u });

    await openAddRepositoryDialog(user);
    const dialog = screen.getByRole('alertdialog', { name: 'Add Repository' });
    expect(within(dialog).getByRole('textbox', { name: 'Repository URL or path' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Choose in Finder…' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument();
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), first.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await openAddRepositoryDialog(user);
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), second.path);
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add',
      }),
    );

    const leaveDialog = await screen.findByRole('alertdialog', {
      name: 'Unsaved result',
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), first.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('button', { name: 'Edit Result' });

    await openAddRepositoryDialog(user);
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), second.path);
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add',
      }),
    );
    await waitFor(() => expect(resolveAttach).toBeDefined());

    act(() => {
      screen.getByRole('button', { name: 'Edit Result' }).click();
    });
    act(() => {
      resolveAttach?.({ repos: [second], selectedRepoId: second.repoId, activities: [] });
    });

    expect(await screen.findByRole('alertdialog', { name: 'Unsaved result' })).toBeVisible();
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), '/tmp/stella');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('button', { name: 'Abort' }));
    expect(await screen.findByText('1234567890ab')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('alertdialog', { name: 'Operation failed' })).toHaveTextContent(
      'Git operation failed.',
    );
    await user.click(screen.getByText('Show Git output'));
    expect(screen.getByLabelText('stderr')).toHaveTextContent('policy denied this operation');
  });

  it('previews Move to Trash and gives the destructive confirmation a specific label', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      path: '/tmp/file-actions',
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const preview = vi.fn<WorkspaceAdapter['preview']>(async (request) => ({
      repoId: request.repoId,
      title: { id: 'actionMoveFileToTrash' },
      summary: { id: 'previewMovePathToTrash', args: { path: 'src/app.ts' } },
      affectedPaths: ['src/app.ts'],
      affectedCommits: [],
      lostCommitOids: [],
      resolvedTargets: [],
      destructive: true,
    }));
    const execute = vi.fn<WorkspaceAdapter['execute']>(async (request) => ({
      repoId: request.repoId,
      generation: 2,
      summary: { id: 'backendFileTrashed' },
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('button', { name: 'More actions for src/app.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move to Trash…' }));

    expect(preview).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'fileAction', path: 'src/app.ts', operation: 'moveToTrash' },
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Move File to Trash' });
    expect(within(dialog).getByText('src/app.ts')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
    expect(execute).toHaveBeenCalledWith({
      repoId: repo.repoId,
      action: { kind: 'fileAction', path: 'src/app.ts', operation: 'moveToTrash' },
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), '/tmp/first');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(
      within(await screen.findByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.type(description, 'first draft');
    await selectRepository(user, 'second');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
    await selectRepository(user, 'first');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('first draft');
    await selectRepository(user, 'second');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
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
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), '/tmp/stella');
    await user.click(screen.getByRole('button', { name: 'Add' }));
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
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}')).toMatchObject({
        appearance: 'dark',
      }),
    );

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(settings).toHaveAttribute('aria-current', 'page');

    await user.click(repositories);
    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Repositories' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    expect(screen.getByRole('alertdialog', { name: 'Add Repository' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('alertdialog', { name: 'Add Repository' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Repository' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
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
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await user.click(screen.getByRole('radio', { name: '日本語' }));

    expect(screen.getByRole('heading', { name: '設定' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'アプリのナビゲーション' })).toBeVisible();
    expect(screen.getByRole('button', { name: '設定' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'リポジトリ' })).toBeVisible();
    expect(screen.getByRole('radio', { name: '日本語' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'English' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('lang', 'ja');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}')).toMatchObject({
        language: 'ja',
        appearance: 'dark',
      }),
    );

    await user.click(screen.getByRole('radio', { name: 'English' }));
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
      query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'snapshot'
          ? { kind: 'snapshot' as const, snapshot: repo }
          : { kind: 'activity' as const, entries: [] },
      ),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute,
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    render(<App adapter={adapter} />);

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(screen.getByRole('textbox', { name: 'Repository URL or path' }), repo.path);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Pull' }));
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
    expect(errorDialog?.textContent ?? '').toContain(expectedResolution ? '' : failure.message);
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
    await user.type(
      screen.getByRole('textbox', { name: 'Repository URL or path' }),
      conflictedRepo.path,
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('alertdialog', { name: 'Unsaved result' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Changes' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByRole('alertdialog', { name: 'Unsaved result' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Leave Without Saving' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Changes' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('alertdialog', { name: 'Unsaved result' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Leave Without Saving' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Changes' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Result' }));

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Save and Leave' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ kind: 'saveConflict' }) }),
    );
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
      await user.type(
        screen.getByRole('textbox', { name: 'Repository URL or path' }),
        conflictedRepo.path,
      );
      await user.click(screen.getByRole('button', { name: 'Add' }));
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
            ? screen.getByRole('button', { name: 'Changes' }).getAttribute('aria-current') ===
              'page'
            : within(screen.getByRole('alertdialog', { name: 'Abort Operation' })).getByRole(
                'button',
                { name: 'Cancel' },
              ) === document.activeElement;
        expect(expectedStateReached).toBe(true);
      });
    },
  );
});
