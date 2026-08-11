import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { HISTORY_PAGE_SIZE } from '../../domain/historyLanes';
import type {
  CommitDetails,
  CommitSummary,
  QueryResult,
  WorkspaceAction,
} from '../../domain/workspace';
import { repoSnapshot } from '../../test/fixtures';
import { HistoryView } from './HistoryView';

const { diffSurfaceMock } = vi.hoisted(() => ({
  diffSurfaceMock: vi.fn<(props: unknown) => void>(),
}));

let intersectionObserverCallback: IntersectionObserverCallback | undefined;
const observeIntersection = vi.fn<(target: Element) => void>();
const disconnectIntersection = vi.fn<() => void>();
const unobserveIntersection = vi.fn<(target: Element) => void>();

const intersectionObserverArgument: IntersectionObserver = {
  root: null,
  rootMargin: '0px',
  scrollMargin: '0px',
  thresholds: [0],
  disconnect: disconnectIntersection,
  observe: observeIntersection,
  takeRecords: () => [],
  unobserve: unobserveIntersection,
};

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];

  constructor(callback: IntersectionObserverCallback) {
    intersectionObserverCallback = callback;
  }

  disconnect(): void {
    disconnectIntersection();
  }

  observe(target: Element): void {
    observeIntersection(target);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(): void {}
}

vi.mock('../diff/DiffSurface', () => ({
  DiffSurface: (props: unknown) => {
    diffSurfaceMock(props);
    return <div>Diff</div>;
  },
}));

function adapterWithQuery(query: WorkspaceAdapter['query']): WorkspaceAdapter {
  return {
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
}

function commitDetails(diff: CommitDetails['diff']): CommitDetails {
  return {
    oid: 'head',
    shortOid: 'head',
    subject: 'feat: current',
    body: '',
    authorName: 'Stella',
    authoredAt: '2026-08-08T00:00:00Z',
    parents: [],
    refs: ['main'],
    lane: 0,
    ...(diff ? { diff } : {}),
  };
}

function commitSummary(oid: string, parents: string[] = [], refs: string[] = []): CommitSummary {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    subject: oid,
    authorName: 'Stella',
    authoredAt: '2026-08-08T00:00:00Z',
    parents,
    refs,
    lane: 0,
  };
}

function linearHistory(prefix: string, count: number): CommitSummary[] {
  return Array.from({ length: count }, (_, index) =>
    commitSummary(
      `${prefix}-${index}`,
      index + 1 < count ? [`${prefix}-${index + 1}`] : [`${prefix}-${count}`],
      index === 0 ? ['main'] : [],
    ),
  );
}

beforeEach(() => {
  diffSurfaceMock.mockClear();
  intersectionObserverCallback = undefined;
  observeIntersection.mockClear();
  disconnectIntersection.mockClear();
  unobserveIntersection.mockClear();
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
});

function reachHistoryEnd(): void {
  const target = screen.getByTestId('history-load-sentinel');
  if (!intersectionObserverCallback) throw new Error('History observer is not ready.');
  const callback = intersectionObserverCallback;
  const bounds = target.getBoundingClientRect();
  act(() => {
    callback(
      [
        {
          boundingClientRect: bounds,
          intersectionRatio: 1,
          intersectionRect: bounds,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      intersectionObserverArgument,
    );
  });
}

async function openCommitMenu(
  user: ReturnType<typeof userEvent.setup>,
  oid = 'head',
): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole('button', { name: `More actions for commit ${oid.slice(0, 7)}` }),
  );
  return screen.findByRole('menu');
}

async function openCommitAction(
  user: ReturnType<typeof userEvent.setup>,
  action: string,
  dialogName: string,
  oid = 'head',
): Promise<HTMLElement> {
  await openCommitMenu(user, oid);
  await user.click(screen.getByRole('menuitem', { name: action }));
  return screen.findByRole('dialog', { name: dialogName });
}

describe('HistoryView', () => {
  it('checks out an unambiguous local branch when its history item is double-clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return {
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), oid: request.oid, shortOid: request.oid },
          };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'main-oid', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('main-oid', [], ['HEAD -> refs/heads/main']),
            commitSummary('feature-oid', [], ['refs/heads/feature']),
            commitSummary('ambiguous-oid', [], ['refs/heads/topic-a', 'refs/heads/topic-b']),
            commitSummary('remote-oid', [], ['refs/remotes/origin/remote']),
          ],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.dblClick(screen.getByRole('button', { name: /feature-oid/u }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'checkoutBranch', name: 'feature' });

    onAction.mockClear();
    await user.dblClick(screen.getByRole('button', { name: /main-oid/u }));
    await user.dblClick(screen.getByRole('button', { name: /remote-oid/u }));
    await user.dblClick(screen.getByRole('button', { name: /ambiguous-oid/u }));
    expect(onAction).not.toHaveBeenCalled();

    await user.dblClick(screen.getByText('topic-b'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'checkoutBranch', name: 'topic-b' });
  });

  it('shows uncommitted changes before the commit list and opens Changes when selected', async () => {
    const user = userEvent.setup();
    const onShowChanges = vi.fn<() => void>();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const dirtyRepo = repoSnapshot({
      history: [commitSummary('head')],
      changes: [
        { path: 'src/app.ts', area: 'staged', status: 'modified' },
        { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
        { path: 'README.md', area: 'untracked', status: 'added' },
      ],
    });
    const { rerender } = render(
      <HistoryView
        repo={dirtyRepo}
        adapter={adapter}
        onShowChanges={onShowChanges}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const historyPane = screen.getByRole('complementary', { name: 'Commit history' });
    const historyList = within(historyPane).getByRole('list');
    expect(historyList.firstElementChild).toHaveClass('history-working-tree-item');
    const workingTreeButton = within(historyPane).getByRole('button', {
      name: 'Uncommitted changes, 2 files',
    });
    expect(workingTreeButton).toHaveClass('commit-row', 'history-working-tree-entry');
    expect(within(historyPane).getByText('Uncommitted changes')).toBeVisible();
    expect(within(historyPane).getByText('2 files')).toBeVisible();
    const workingTreeGraph = within(historyPane).getByTestId('history-graph-working-tree');
    expect(workingTreeGraph).toHaveStyle('--history-lane-color: var(--text-muted)');
    expect(workingTreeGraph.querySelector('[data-edge-kind="working-tree"]')).toBeInTheDocument();
    expect(
      within(historyPane)
        .getByTestId('history-graph-head')
        .querySelector('[data-edge-kind="working-tree"]'),
    ).toBeInTheDocument();
    await user.click(workingTreeButton);
    expect(onShowChanges).toHaveBeenCalledOnce();

    rerender(
      <HistoryView
        repo={{ ...dirtyRepo, changes: [] }}
        adapter={adapter}
        onShowChanges={onShowChanges}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    expect(within(historyPane).queryByText('Uncommitted changes')).not.toBeInTheDocument();
  });

  it('searches operation history through the adapter and focuses the field with Command-F', async () => {
    const user = userEvent.setup();
    const searchResult = {
      ...commitSummary('remote-match', [], ['refs/remotes/origin/feature']),
      subject: 'fix: remote result',
      authorName: 'Search Author',
    };
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') {
        return {
          kind: 'history' as const,
          commits: request.search === 'origin/feature' ? [searchResult] : [],
        };
      }
      if (request.kind === 'commitDetails') {
        return {
          kind: 'commitDetails' as const,
          commit: {
            ...commitDetails(undefined),
            oid: request.oid,
            shortOid: request.oid.slice(0, 7),
          },
        };
      }
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'local-head', detached: false, ahead: 0, behind: 0 },
          history: [commitSummary('local-head')],
        })}
        adapter={adapterWithQuery(query)}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Search history' });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }),
      );
    });
    expect(search).toHaveFocus();

    await user.type(search, 'origin/feature');
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith({
        kind: 'history',
        repoId: 'repo-1',
        limit: HISTORY_PAGE_SIZE,
        skip: 0,
        search: 'origin/feature',
      }),
    );
    expect(await screen.findByRole('button', { name: /fix: remote result/u })).toBeVisible();
    expect(screen.getByText('origin/feature')).toBeVisible();
    expect(screen.queryByRole('button', { name: /local-head/u })).not.toBeInTheDocument();

    await user.clear(search);
    expect(await screen.findByRole('button', { name: /local-head/u })).toBeVisible();
  });

  it('shows an empty state when operation history has no search matches', async () => {
    const user = userEvent.setup();
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') return { kind: 'history' as const, commits: [] };
      if (request.kind === 'commitDetails') {
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      }
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitSummary('head')] })}
        adapter={adapterWithQuery(query)}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search history' }), 'missing');
    expect(await screen.findByText('No commits match your search.')).toBeVisible();
  });

  it('forwards query failures to the shared error dialog handler', async () => {
    const failure = new Error('History query failed.');
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    const currentCommit = commitDetails(undefined);
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [currentCommit],
        })}
        adapter={adapterWithQuery(
          vi.fn<WorkspaceAdapter['query']>(async () => {
            throw failure;
          }),
        )}
        onError={onError}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        'Could not load commit details',
        failure,
        'Could not load commit details.',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves History actions to each commit menu and restores focus through the focused dialog', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const historyPane = screen.getByRole('complementary', { name: 'Commit history' });
    expect(historyPane.firstElementChild).toHaveClass('history-search');
    expect(within(historyPane).queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(historyPane).queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
    expect(historyPane.querySelector('.history-branch-context')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();

    const toggle = await screen.findByRole('button', { name: 'More actions for commit head' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu');

    const menu = await openCommitMenu(user);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Create Branch', 'Create Tag', 'Merge', 'Rebase', 'Cherry-pick', 'Revert', 'Reset']);
    expect(within(menu).getByRole('menuitem', { name: 'Create Branch' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();

    const dialog = await openCommitAction(user, 'Create Branch', 'Create branch');
    expect(within(dialog).getByText('feat: current')).toBeVisible();
    expect(within(dialog).getByText('head')).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Branch name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Create branch' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /feat: current/u })).toHaveFocus();
  });

  it('keeps the detail action trigger visible at the right edge of the commit title', async () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const listTrigger = screen.getByRole('button', { name: 'More actions for commit head' });
    const detailTrigger = await screen.findByRole('button', {
      name: 'More actions for selected commit head',
    });
    expect(listTrigger).not.toHaveClass('is-persistent');
    expect(detailTrigger).toHaveClass('is-persistent');
    expect(detailTrigger.closest('.commit-detail-heading')).toContainElement(
      screen.getByRole('heading', { name: 'feat: current' }),
    );
  });

  it('selects a commit and opens the same menu at the pointer on right-click', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitSummary('first'), commitSummary('second')] })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const second = screen.getByRole('button', { name: /^second/u });
    fireEvent.contextMenu(second, { clientX: 120, clientY: 180 });
    const menu = screen.getByRole('menu', { name: 'second second actions' });
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Create Branch' })).toHaveFocus();
    expect(menu).toBeVisible();
    expect(menu).toHaveStyle({ left: '120px', top: '180px' });
    expect(screen.queryByRole('menuitem', { name: 'Checkout' })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole('menuitem', { name: 'Rebase' }));
    expect(screen.getByRole('dialog', { name: 'Rebase' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Source ref' })).toHaveValue('second');
  });

  it('creates a local Tag from the selected commit', async () => {
    const user = userEvent.setup();
    const currentCommit = commitDetails(undefined);
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'commitDetails'
          ? { kind: 'commitDetails' as const, commit: currentCommit }
          : { kind: 'activity' as const, entries: [] },
      ),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [currentCommit] })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const dialog = await openCommitAction(user, 'Create Tag', 'Create Tag');
    const input = within(dialog).getByRole('textbox', { name: 'Tag name' });
    expect(
      screen.getByText('Creates a lightweight Tag locally. It is not pushed to a remote.'),
    ).toBeVisible();
    await user.type(input, 'v1.0.0');
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'createTag',
      name: 'v1.0.0',
      targetOid: currentCommit.oid,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create Tag' })).not.toBeInTheDocument(),
    );
  });

  it('shows commits from every ref without a visibility toggle', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    const baseCommit = {
      authorName: 'Stella',
      authoredAt: '2026-08-08T00:00:00Z',
      refs: [] as string[],
      lane: 0,
    };
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [
        {
          ...baseCommit,
          oid: 'head',
          shortOid: 'head',
          subject: 'current head',
          parents: ['base'],
          refs: ['main'],
        },
        {
          ...baseCommit,
          oid: 'other',
          shortOid: 'other',
          subject: 'other branch only',
          parents: [],
        },
        {
          ...baseCommit,
          oid: 'base',
          shortOid: 'base',
          subject: 'shared base',
          parents: [],
        },
      ],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const currentHead = screen.getByRole('button', { name: /current head/u });
    expect(currentHead).toBeInTheDocument();
    const commitMetadata = currentHead.querySelector('.commit-metadata');
    const authoredAt = commitMetadata?.querySelector('time');
    expect(commitMetadata?.querySelector('.commit-author')).toHaveTextContent('Stella');
    expect(commitMetadata?.querySelector('.commit-oid')).toHaveTextContent('head');
    expect(commitMetadata?.querySelector('.commit-metadata-separator')).not.toBeInTheDocument();
    expect(commitMetadata).not.toHaveTextContent('·');
    expect(authoredAt).toHaveAttribute('datetime', '2026-08-08T00:00:00Z');
    expect(authoredAt?.textContent).toMatch(/\d{1,2}:\d{2}/u);
    expect(currentHead.querySelector(':scope > time')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shared base/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /other branch only/u })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'All refs' })).not.toBeInTheDocument();
  });

  it('shows the Commit ID beside the date and suppresses a duplicated commit body', async () => {
    const details = {
      ...commitDetails(undefined),
      subject: 'docs: update documentation',
      body: 'docs: update documentation',
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: details };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [details] })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const detailPane = await screen.findByRole('main', { name: details.subject });
    expect(within(detailPane).getAllByText(details.subject)).toHaveLength(1);
    expect(detailPane.querySelector('.commit-detail-heading .eyebrow')).not.toBeInTheDocument();
    const commitIdGroup = within(detailPane)
      .getByText('Commit ID', { selector: 'dt' })
      .closest<HTMLElement>('div');
    expect(commitIdGroup).toHaveTextContent('Commit ID');
    if (!commitIdGroup) throw new Error('Commit ID metadata was not found.');
    expect(within(commitIdGroup).getByText(details.shortOid, { selector: 'code' })).toBeVisible();
    expect(commitIdGroup.nextElementSibling).toHaveTextContent('Date');
  });

  it('shows Tag and shortened branch decorations in the list and commit details', async () => {
    const refs = ['refs/remotes/origin/main', 'tag: refs/tags/v1.2.3', 'HEAD -> refs/heads/main'];
    const details = { ...commitDetails(undefined), refs };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: details };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [{ ...details, refs }],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getAllByLabelText('Tag v1.2.3')).toHaveLength(2));
    expect(screen.getAllByText('main')).toHaveLength(2);
    expect(screen.getAllByText('origin/main')).toHaveLength(2);
    expect(screen.getAllByTitle('tag: refs/tags/v1.2.3')).toHaveLength(2);
  });

  it('lays out lanes from every ref immediately', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'main-tip', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('main-tip', ['main-base'], ['main']),
            commitSummary('hidden-tip', ['hidden-base'], ['feature']),
            commitSummary('main-base', ['root']),
            commitSummary('hidden-base', ['root']),
            commitSummary('root'),
          ],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const graph = screen.getByTestId('history-graph-main-base');
    const mainEdge = graph.querySelector<SVGPathElement>(
      '[data-edge-kind="incoming"][data-from-lane="0"]',
    );
    const sideEdge = graph.querySelector<SVGPathElement>(
      '[data-edge-kind="active"][data-from-lane="1"]',
    );
    expect(mainEdge?.style.getPropertyValue('--history-lane-color')).toBe('var(--history-lane-0)');
    expect(sideEdge?.style.getPropertyValue('--history-lane-color')).toBe('var(--history-lane-1)');
    expect(graph.style.getPropertyValue('--history-lane-color')).toBe('var(--history-lane-0)');
  });

  it('renders merge connectors as decorative SVG while exposing parent ids in the row', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'merge', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('merge', ['left', 'right']),
            commitSummary('left', ['root']),
            commitSummary('right', ['root']),
            commitSummary('root'),
          ],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const graph = screen.getByTestId('history-graph-merge');
    expect(graph).toHaveAttribute('aria-hidden', 'true');
    expect(graph.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(graph.querySelector('svg')).toHaveAttribute('preserveAspectRatio', 'none');
    expect(graph.querySelectorAll('[data-edge-kind="parent"]')).toHaveLength(2);
    expect(
      graph.querySelector('[data-edge-kind="parent"][data-to-lane="1"]')?.getAttribute('d'),
    ).toContain(' C ');
    expect(
      graph
        .querySelector<SVGPathElement>('[data-edge-kind="parent"][data-to-lane="1"]')
        ?.style.getPropertyValue('--history-lane-color'),
    ).toBe('var(--history-lane-1)');
    expect(screen.getByRole('button', { name: /merge.*Parents left, right/u })).toBeInTheDocument();
  });

  it('loads another page and keeps commits from every ref in the combined list', async () => {
    const initial = linearHistory('current', HISTORY_PAGE_SIZE);
    const nextPage = [
      commitSummary(`current-${HISTORY_PAGE_SIZE}`),
      commitSummary('other-tip', [], ['refs/remotes/origin/feature']),
    ];
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') return { kind: 'history' as const, commits: nextPage };
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: {
            name: 'main',
            oid: 'current-0',
            detached: false,
            ahead: 0,
            behind: 0,
          },
          history: initial,
        })}
        adapter={adapterWithQuery(query)}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    reachHistoryEnd();
    expect(
      (await screen.findByTestId(`history-graph-current-${HISTORY_PAGE_SIZE}`)).closest('button'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /other-tip/u })).toBeVisible();
    expect(screen.getByText('origin/feature')).toBeVisible();
    expect(query).toHaveBeenCalledWith({
      kind: 'history',
      repoId: 'repo-1',
      limit: HISTORY_PAGE_SIZE,
      skip: HISTORY_PAGE_SIZE,
    });
    expect(screen.queryByTestId('history-load-sentinel')).not.toBeInTheDocument();
  });

  it('waits until the scroll sentinel is visible before loading the next all-refs page', async () => {
    const initial = linearHistory('other', HISTORY_PAGE_SIZE);
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history')
        return { kind: 'history' as const, commits: [commitSummary('current-head')] };
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: {
            name: 'main',
            oid: 'current-head',
            detached: false,
            ahead: 0,
            behind: 0,
          },
          history: initial,
        })}
        adapter={adapterWithQuery(query)}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(screen.getByTestId('history-load-sentinel')).toBeInTheDocument();
    await waitFor(() =>
      expect(query.mock.calls.some(([request]) => request.kind === 'commitDetails')).toBe(true),
    );
    expect(query.mock.calls.some(([request]) => request.kind === 'history')).toBe(false);

    reachHistoryEnd();
    await waitFor(() =>
      expect(query.mock.calls.some(([request]) => request.kind === 'history')).toBe(true),
    );
  });

  it('drops loaded pages and restarts from the first page when HEAD changes', async () => {
    const initial = linearHistory('old', HISTORY_PAGE_SIZE);
    const extra = [commitSummary(`old-${HISTORY_PAGE_SIZE}`)];
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') return { kind: 'history' as const, commits: extra };
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    const props = {
      adapter: adapterWithQuery(query),
      onShowChanges: () => undefined,
      onAction: async () => undefined,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    } as const;
    const { rerender } = render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'old-0', detached: false, ahead: 0, behind: 0 },
          history: initial,
        })}
        {...props}
      />,
    );

    reachHistoryEnd();
    expect(
      (await screen.findByTestId(`history-graph-old-${HISTORY_PAGE_SIZE}`)).closest('button'),
    ).toBeVisible();

    rerender(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'new-head', detached: false, ahead: 0, behind: 0 },
          history: [commitSummary('new-head')],
        })}
        {...props}
      />,
    );
    expect(await screen.findByRole('button', { name: /new-head/u })).toBeVisible();
    expect(screen.queryByTestId(`history-graph-old-${HISTORY_PAGE_SIZE}`)).not.toBeInTheDocument();
  });

  it('passes the selected mainline parent for merge Cherry-pick and Revert', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const mergeCommit = {
      ...commitDetails(undefined),
      parents: ['parent-1', 'parent-2'],
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: mergeCommit };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [mergeCommit],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    let dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));
    dialog = await openCommitAction(user, 'Revert', 'Revert');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));

    expect(onAction).toHaveBeenNthCalledWith(1, {
      kind: 'cherryPick',
      oid: mergeCommit.oid,
      mainline: 2,
    });
    expect(onAction).toHaveBeenNthCalledWith(2, {
      kind: 'revert',
      oid: mergeCommit.oid,
      mainline: 2,
    });
  });

  it('binds each mainline dialog to its clicked commit and resets the default parent', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const octopus = {
      ...commitSummary('octopus', ['merge-two', 'side-a', 'side-b']),
      subject: 'octopus merge',
    };
    const twoParent = {
      ...commitSummary('merge-two', ['parent-a', 'parent-b']),
      subject: 'two parent merge',
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return {
            kind: 'commitDetails' as const,
            commit: {
              ...commitDetails(undefined),
              ...(request.oid === octopus.oid ? octopus : twoParent),
            },
          };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: octopus.oid, detached: false, ahead: 0, behind: 0 },
          history: [octopus, twoParent],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    let dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick', octopus.oid);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '3',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /two parent merge/u }));
    dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick', twoParent.oid);
    expect(within(dialog).getByRole('combobox', { name: 'Mainline parent' })).toHaveValue('1');
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'cherryPick',
      oid: twoParent.oid,
      mainline: 1,
    });
  });

  it('binds commit actions to the clicked row while the next commit details load', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const first = commitSummary('first', ['second']);
    const second = commitSummary('second');
    let resolveSecond!: (result: QueryResult) => void;
    const secondDetails = new Promise<QueryResult>((resolve) => {
      resolveSecond = resolve;
    });
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>((request) => {
        if (request.kind === 'branches')
          return Promise.resolve({ kind: 'branches' as const, branches: [] });
        if (request.kind === 'commitDetails' && request.oid === second.oid) return secondDetails;
        if (request.kind === 'commitDetails')
          return Promise.resolve({
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), ...first },
          });
        return Promise.resolve({ kind: 'activity' as const, entries: [] });
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: first.oid, detached: false, ahead: 0, behind: 0 },
          history: [first, second],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByRole('heading', { name: first.subject })).toBeInTheDocument();
    await user.click(screen.getByTestId(`history-graph-${second.oid}`).closest('button')!);

    expect(screen.getByText('Loading commit details…')).toBeInTheDocument();
    const dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick', second.oid);
    expect(within(dialog).getByText(second.shortOid, { selector: 'code' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'cherryPick', oid: second.oid });

    resolveSecond({
      kind: 'commitDetails',
      commit: { ...commitDetails(undefined), ...second },
    });
    expect(await screen.findByRole('heading', { name: second.subject })).toBeInTheDocument();
  });

  it('closes open menus and idle action dialogs when repository work becomes busy', async () => {
    const user = userEvent.setup();
    const currentCommit = commitDetails(undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'commitDetails'
          ? { kind: 'commitDetails' as const, commit: currentCommit }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    const view = (busy: boolean) => (
      <HistoryView
        repo={repoSnapshot({ history: [currentCommit] })}
        adapter={adapter}
        busy={busy}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />
    );
    const { rerender } = render(view(false));

    await openCommitMenu(user);
    rerender(view(true));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'More actions for commit head' })).toBeDisabled();

    rerender(view(false));
    await openCommitAction(user, 'Create Tag', 'Create Tag');
    rerender(view(true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create Tag' })).not.toBeInTheDocument(),
    );
  });

  it('disables repository-changing History actions while a Git operation is in progress', async () => {
    const user = userEvent.setup();
    const currentCommit = commitDetails(undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: currentCommit };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          operation: {
            kind: 'rebase',
            label: { id: 'operationResolvingRebase' },
            unresolvedCount: 0,
            canContinue: true,
            canSkip: true,
            canAbort: true,
          },
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [currentCommit],
        })}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const trigger = await screen.findByRole('button', { name: 'More actions for commit head' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: /feat: current/u }), {
      clientX: 80,
      clientY: 100,
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not pass a binary commit patch to DiffSurface', async () => {
    const binaryDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'binary-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'GIT binary patch\n',
      binary: true,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(binaryDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(
      await screen.findByText('Binary diffs cannot be displayed as text.'),
    ).toBeInTheDocument();
    expect(diffSurfaceMock).not.toHaveBeenCalled();
  });

  it('uses the Diff layout selected in Settings without showing a local switch', async () => {
    const textDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'text-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'diff --git a/a b/a\n',
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(textDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        diffStyle="split"
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');
    expect(screen.queryByRole('group', { name: 'Diff layout' })).not.toBeInTheDocument();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ diffStyle: 'split' }),
    );
  });

  it('labels a truncated commit patch as a partial view', async () => {
    const truncatedDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'truncated-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'diff --git a/a b/a\n',
      binary: false,
      tooLarge: true,
      truncated: true,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(truncatedDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(/The diff exceeded the display limit/u)).toBeVisible();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ performanceMode: true }),
    );
  });

  it('uses CodeView with file headers and simple separators for a multi-file commit', async () => {
    const multiFileDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'multi-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'diff --git a/a b/a\n--- a/a\n+++ b/a\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n',
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(multiFileDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });
    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowChanges={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ kind: 'codeView' }),
        showFileHeaders: true,
        collapsibleFileHeaders: true,
        hunkSeparators: 'simple',
      }),
    );
  });
});
