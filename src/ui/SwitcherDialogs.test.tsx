import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { BranchSummary } from '../domain/workspace';
import { repoSnapshot } from '../test/fixtures';
import { BranchSwitcherDialog } from './BranchSwitcherDialog';
import { RepositorySwitcherDialog } from './RepositorySwitcherDialog';

const BRANCHES: BranchSummary[] = [
  {
    fullName: 'refs/heads/main',
    shortName: 'main',
    oid: 'main-oid',
    current: true,
    remote: false,
    upstream: 'origin/main',
  },
  {
    fullName: 'refs/heads/feature/search',
    shortName: 'feature/search',
    oid: 'feature-oid',
    current: false,
    remote: false,
  },
  {
    fullName: 'refs/remotes/origin/remote-only',
    shortName: 'origin/remote-only',
    oid: 'remote-oid',
    current: false,
    remote: true,
  },
];

function branchSummary(shortName: string, current = false): BranchSummary {
  return {
    fullName: `refs/heads/${shortName}`,
    shortName,
    oid: `${shortName}-oid`,
    current,
    remote: false,
  };
}

describe('RepositorySwitcherDialog', () => {
  it('dismisses on a backdrop click but stays open when the dialog is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn<() => void>();
    render(
      <RepositorySwitcherDialog
        repos={[repoSnapshot()]}
        registeredRepositories={[]}
        onDismiss={onDismiss}
        onSelectOpen={() => undefined}
        onSelectRegistered={() => undefined}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
        onAddLocal={() => undefined}
        onClone={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
    expect(within(dialog).queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument();
    await user.click(dialog);
    expect(onDismiss).not.toHaveBeenCalled();
    if (!dialog.parentElement) throw new Error('Repository switcher backdrop was not rendered.');
    await user.click(dialog.parentElement);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('flattens open and recent repositories, deduplicates paths, and shows no grouping or shortcut copy', async () => {
    const user = userEvent.setup();
    const first = repoSnapshot({ repoId: 'repo-1', name: 'first', path: '/tmp/first' });
    const second = repoSnapshot({
      repoId: 'repo-2',
      name: 'second',
      path: '/tmp/second',
      branch: { name: 'topic', detached: false, ahead: 0, behind: 0 },
      changes: [
        { path: 'README.md', area: 'staged', status: 'modified' },
        { path: 'README.md', area: 'unstaged', status: 'modified' },
        { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
      ],
    });
    const onSelectRegistered = vi.fn<(path: string) => void>();
    render(
      <RepositorySwitcherDialog
        repos={[first, second]}
        registeredRepositories={[
          { path: '/tmp/second', name: 'second' },
          { path: '/tmp/recent', name: 'Saved Custom', logoUrl: 'asset://recent/logo.svg' },
        ]}
        selectedRepoId={second.repoId}
        onDismiss={() => undefined}
        onSelectOpen={() => undefined}
        onSelectRegistered={onSelectRegistered}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
        onAddLocal={() => undefined}
        onClone={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(3);
    const options = within(dialog).getAllByRole('option');
    expect(options[0]).toHaveAccessibleName(/second.*\/tmp\/second.*Uncommitted changes.*2 files/u);
    expect(options[0]).not.toHaveTextContent('topic');
    expect(within(dialog).getByRole('option', { name: /second/u })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const currentOption = within(dialog).getByRole('option', {
      name: /second.*\/tmp\/second.*Uncommitted changes.*2 files/u,
    });
    expect(currentOption).toBeVisible();
    const countBadge = within(currentOption).getByLabelText('Uncommitted changes, 2 files');
    expect(countBadge).toHaveClass('switcher-count-badge');
    expect(countBadge).toHaveTextContent('2');
    expect(currentOption.lastElementChild).toBe(countBadge);
    expect(currentOption.nextElementSibling).toHaveClass('switcher-action-trigger');
    expect(currentOption.querySelector('.switcher-status-dot.warning')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Open repositories|Recent/u)).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/[⌘⇧]/u);
    expect(
      within(dialog)
        .getByRole('option', { name: /Saved Custom/u })
        .querySelector('img'),
    ).toHaveAttribute('src', 'asset://recent/logo.svg');
    expect(within(dialog).getByRole('button', { name: 'Clone Repository' })).not.toHaveClass(
      'primary',
    );
    expect(within(dialog).getByRole('button', { name: 'Add Repository' })).not.toHaveClass(
      'primary',
    );

    expect(options[0]).toHaveFocus();
    expect(options[0]?.closest('.switcher-option-row')).toHaveClass('is-focused');
    const search = within(dialog).getByRole('combobox', {
      name: 'Search by repository name',
    });
    expect(search).toHaveAttribute('placeholder', 'Search by repository name');
    await user.click(search);
    await user.type(search, 'recent');
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    await user.click(within(dialog).getByRole('option', { name: /Saved Custom/u }));
    expect(onSelectRegistered).not.toHaveBeenCalled();
    search.focus();
    await user.keyboard('{Enter}');
    expect(onSelectRegistered).toHaveBeenCalledWith('/tmp/recent');
  });

  it('supports Arrow, Home, and End navigation before selection', async () => {
    const user = userEvent.setup();
    const repos = [
      repoSnapshot({ repoId: 'repo-1', name: 'first', path: '/tmp/first' }),
      repoSnapshot({ repoId: 'repo-2', name: 'second', path: '/tmp/second' }),
      repoSnapshot({ repoId: 'repo-3', name: 'third', path: '/tmp/third' }),
    ];
    const onSelectOpen = vi.fn<(repoId: string) => void>();
    render(
      <RepositorySwitcherDialog
        repos={repos}
        registeredRepositories={[]}
        selectedRepoId="repo-1"
        onDismiss={() => undefined}
        onSelectOpen={onSelectOpen}
        onSelectRegistered={() => undefined}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
        onAddLocal={() => undefined}
        onClone={() => undefined}
      />,
    );

    const [first, second, last] = screen.getAllByRole('option');
    const search = screen.getByRole('combobox', { name: 'Search by repository name' });
    search.focus();
    await user.keyboard('{End}{ArrowDown}');
    expect(last).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}{ArrowUp}');
    expect(first).toHaveAttribute('aria-selected', 'true');

    first?.focus();
    await user.keyboard('{End}{ArrowDown}');
    expect(last).toHaveFocus();
    await user.keyboard('{Home}{ArrowUp}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(second).toHaveFocus();
    expect(onSelectOpen).toHaveBeenCalledWith('repo-2');
  });

  it('opens the same repository actions from right-click and the persistent ellipsis', async () => {
    const user = userEvent.setup();
    const first = repoSnapshot({ repoId: 'repo-1', name: 'first', path: '/tmp/first' });
    const second = repoSnapshot({ repoId: 'repo-2', name: 'second', path: '/tmp/second' });
    const onManageRemotes = vi.fn<(path: string) => void>();
    const onForget = vi.fn<(path: string) => void>();
    const onSelectOpen = vi.fn<(repoId: string) => void>();
    render(
      <RepositorySwitcherDialog
        repos={[first, second]}
        registeredRepositories={[
          { path: first.path, name: first.name },
          { path: second.path, name: second.name },
        ]}
        selectedRepoId={first.repoId}
        onDismiss={() => undefined}
        onSelectOpen={onSelectOpen}
        onSelectRegistered={() => undefined}
        onManageRemotes={onManageRemotes}
        onForget={onForget}
        onAddLocal={() => undefined}
        onClone={() => undefined}
      />,
    );

    await user.dblClick(screen.getByRole('option', { name: /first/u }));
    expect(onSelectOpen).not.toHaveBeenCalled();
    const secondOption = screen.getByRole('option', { name: /second/u });
    fireEvent.contextMenu(secondOption, { clientX: 120, clientY: 180 });
    let menu = screen.getByRole('menu', { name: 'second actions' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Switch', 'Change Remote URLs', 'Delete']);
    await user.keyboard('{Escape}');
    expect(secondOption).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'More actions for second' }));
    await user.click(screen.getByRole('menuitem', { name: 'Switch' }));
    expect(onSelectOpen).toHaveBeenCalledWith('repo-2');
    expect(secondOption).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'More actions for second' }));
    menu = screen.getByRole('menu', { name: 'second actions' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Change Remote URLs' }));
    expect(onManageRemotes).toHaveBeenCalledWith('/tmp/second');

    await user.click(screen.getByRole('button', { name: 'More actions for second' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onForget).toHaveBeenCalledWith('/tmp/second');

    await user.click(screen.getByRole('button', { name: 'More actions for first' }));
    expect(screen.getByRole('menuitem', { name: 'Switch' })).toBeDisabled();
  });
});

describe('BranchSwitcherDialog', () => {
  it('dismisses on a backdrop click but stays open when the dialog is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn<() => void>();
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={BRANCHES}
        onDismiss={onDismiss}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Branch' });
    await user.click(dialog);
    expect(onDismiss).not.toHaveBeenCalled();
    if (!dialog.parentElement) throw new Error('Branch switcher backdrop was not rendered.');
    await user.click(dialog.parentElement);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps an unborn current branch available before the first commit', () => {
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={[]}
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const current = screen.getByRole('option', { name: 'main' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled();
    expect(
      screen.getByText('Create the first commit before creating another branch.'),
    ).toBeVisible();
  });

  it('filters local branches and checks out the keyboard selection', async () => {
    const user = userEvent.setup();
    const onCheckout = vi.fn<(branchName: string) => void>();
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={BRANCHES}
        onDismiss={() => undefined}
        onCheckout={onCheckout}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Branch' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(2);
    expect(within(dialog).queryByRole('option', { name: /remote-only/u })).not.toBeInTheDocument();
    const search = within(dialog).getByRole('combobox', { name: 'Search by branch name' });
    expect(search).toHaveAttribute('placeholder', 'Search by branch name');
    await user.click(search);
    await user.type(search, 'feature');
    await user.keyboard('{Enter}');
    expect(onCheckout).toHaveBeenCalledWith('feature/search');
  });

  it('allows checkout and branch creation while changes exist', async () => {
    const user = userEvent.setup();
    const onCheckout = vi.fn<(branchName: string) => void>();
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot({
          changes: [{ path: 'README.md', area: 'unstaged', status: 'modified' }],
        })}
        branches={BRANCHES}
        onDismiss={() => undefined}
        onCheckout={onCheckout}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const feature = screen.getByRole('option', { name: 'feature/search' });
    expect(feature).not.toHaveAttribute('aria-disabled', 'true');
    const createBranch = screen.getByRole('button', { name: 'Create branch' });
    expect(createBranch).toBeEnabled();
    expect(createBranch).not.toHaveClass('primary');
    await user.click(feature);
    expect(onCheckout).not.toHaveBeenCalled();
    await user.dblClick(feature);
    expect(onCheckout).toHaveBeenCalledWith('feature/search');

    await user.click(createBranch);
    expect(screen.getByRole('textbox', { name: 'Branch name' })).toBeEnabled();
  });

  it('opens branch actions from right-click and the persistent ellipsis', async () => {
    const user = userEvent.setup();
    const onCheckout = vi.fn<(branchName: string) => void>();
    const onDelete = vi.fn<(branchName: string) => void>();
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={BRANCHES}
        onDismiss={() => undefined}
        onCheckout={onCheckout}
        onCreate={() => undefined}
        onDelete={onDelete}
      />,
    );

    const feature = screen.getByRole('option', { name: 'feature/search' });
    fireEvent.contextMenu(feature, { clientX: 80, clientY: 120 });
    let menu = screen.getByRole('menu', { name: 'feature/search actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Switch' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(feature).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'More actions for feature/search' }));
    menu = screen.getByRole('menu', { name: 'feature/search actions' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Switch' }));
    expect(onCheckout).toHaveBeenCalledWith('feature/search');

    await user.click(screen.getByRole('button', { name: 'More actions for feature/search' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('feature/search');

    await user.click(screen.getByRole('button', { name: 'More actions for main' }));
    expect(screen.getByRole('menuitem', { name: 'Switch' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });

  it('orders the current and exact base branches before the remaining Git order', () => {
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot({
          branch: {
            name: 'feature/current',
            oid: 'current-oid',
            detached: false,
            ahead: 0,
            behind: 0,
          },
        })}
        branches={[
          branchSummary('feature/z'),
          branchSummary('release/next'),
          branchSummary('develop'),
          branchSummary('main'),
          branchSummary('feature/current', true),
          branchSummary('master'),
          branchSummary('staging'),
          branchSummary('feature/a'),
        ]}
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'feature/current',
      'main',
      'master',
      'staging',
      'develop',
      'feature/z',
      'release/next',
      'feature/a',
    ]);
    expect(screen.getAllByRole('option')[0]).toHaveFocus();
  });

  it('shows and focuses the known current branch while the remaining branches load', () => {
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={[]}
        loading
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByRole('option', { name: 'main' })).toHaveFocus();
    expect(screen.getByRole('listbox', { name: 'Switch Branch' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText('Loading…')).toHaveClass('sr-only');
    expect(document.querySelector('.switcher-loading .loading-pulse')).toBeVisible();
  });

  it('focuses search when detached HEAD has no current branch item', () => {
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot({
          branch: { name: null, detached: true, oid: 'detached-oid', ahead: 0, behind: 0 },
        })}
        branches={[]}
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Search by branch name' })).toHaveFocus();
  });

  it('continues to block branch changes during another Git operation or busy state', () => {
    const operation = {
      kind: 'merge' as const,
      label: { id: 'gitOperationInProgress' as const },
      unresolvedCount: 0,
      canContinue: false,
      canSkip: false,
      canAbort: true,
    };
    const { rerender } = render(
      <BranchSwitcherDialog
        repo={repoSnapshot({ operation })}
        branches={BRANCHES}
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByRole('option', { name: 'feature/search' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled();

    rerender(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={BRANCHES}
        busy
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(screen.getByRole('option', { name: 'feature/search' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled();
  });

  it('opens branch creation instead of Git Flow and submits the current commit', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn<(branchName: string, startOid: string) => void>();
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot()}
        branches={BRANCHES}
        onDismiss={() => undefined}
        onCheckout={() => undefined}
        onCreate={onCreate}
        onDelete={() => undefined}
      />,
    );

    const switcher = screen.getByRole('dialog', { name: 'Switch Branch' });
    expect(within(switcher).queryByText('Git Flow')).not.toBeInTheDocument();
    await user.click(within(switcher).getByRole('button', { name: 'Create branch' }));

    const creation = screen.getByRole('dialog', { name: 'Create branch' });
    expect(creation).toHaveTextContent('Create a branch from the current commit and switch to it.');
    const input = within(creation).getByRole('textbox', { name: 'Branch name' });
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute('placeholder');
    await user.type(input, 'feature/new-flow');
    await user.click(within(creation).getByRole('button', { name: 'Review impact' }));

    expect(onCreate).toHaveBeenCalledWith('feature/new-flow', 'main-oid');
  });
});
