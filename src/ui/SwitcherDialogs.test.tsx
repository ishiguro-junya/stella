import { render, screen, within } from '@testing-library/react';
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
        onAdd={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
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
      changes: [{ path: 'README.md', area: 'unstaged', status: 'modified' }],
    });
    const onSelectRegistered = vi.fn<(path: string) => void>();
    render(
      <RepositorySwitcherDialog
        repos={[first, second]}
        registeredRepositories={[
          { path: '/tmp/second', name: 'second' },
          { path: '/tmp/recent', name: 'Saved Custom', logoUrl: 'asset://recent/logo.svg' },
        ]}
        selectedRepoId={first.repoId}
        onDismiss={() => undefined}
        onSelectOpen={() => undefined}
        onSelectRegistered={onSelectRegistered}
        onAdd={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Repository' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(3);
    expect(within(dialog).getByRole('option', { name: /first/u })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(dialog).getByRole('option', { name: /second.*topic.*Modified/u })).toBeVisible();
    expect(within(dialog).queryByText(/Open repositories|Recent/u)).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/[⌘⇧]/u);
    expect(
      within(dialog)
        .getByRole('option', { name: /Saved Custom/u })
        .querySelector('img'),
    ).toHaveAttribute('src', 'asset://recent/logo.svg');

    const search = within(dialog).getByRole('combobox', { name: 'Search repositories' });
    expect(search).toHaveFocus();
    await user.type(search, 'recent');
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
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
        onAdd={() => undefined}
      />,
    );

    await user.keyboard('{End}{ArrowUp}{Home}{ArrowDown}{Enter}');
    expect(onSelectOpen).toHaveBeenCalledWith('repo-2');
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
      />,
    );

    expect(screen.getByRole('option', { name: 'main' })).toHaveAttribute('aria-current', 'true');
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
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Switch Branch' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(2);
    expect(within(dialog).queryByRole('option', { name: /remote-only/u })).not.toBeInTheDocument();
    const search = within(dialog).getByRole('combobox', { name: 'Search branches' });
    await user.type(search, 'feature');
    await user.keyboard('{Enter}');
    expect(onCheckout).toHaveBeenCalledWith('feature/search');
  });

  it('keeps the current branch reachable but blocks checkout while changes exist', async () => {
    const user = userEvent.setup();
    const onCheckout = vi.fn<(branchName: string) => void>();
    const onDismiss = vi.fn<() => void>();
    render(
      <BranchSwitcherDialog
        repo={repoSnapshot({
          changes: [{ path: 'README.md', area: 'unstaged', status: 'modified' }],
        })}
        branches={BRANCHES}
        onDismiss={onDismiss}
        onCheckout={onCheckout}
        onCreate={() => undefined}
      />,
    );

    expect(screen.getByText('Commit or discard changes before switching branches.')).toBeVisible();
    const feature = screen.getByRole('option', { name: 'feature/search' });
    expect(feature).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled();
    await user.click(feature);
    expect(onCheckout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: /main.*origin\/main/u }));
    expect(onDismiss).toHaveBeenCalledOnce();
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
