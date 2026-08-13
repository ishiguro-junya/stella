import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import type { QueryResult } from '../../domain/workspace';
import { repoSnapshot } from '../../test/fixtures';
import { RemoteOperationDialog } from './RemoteOperationDialog';

const branches: QueryResult = {
  kind: 'branches',
  branches: [
    {
      fullName: 'refs/remotes/origin/HEAD',
      shortName: 'origin/HEAD',
      oid: 'head',
      current: false,
      remote: true,
    },
    {
      fullName: 'refs/remotes/origin/main',
      shortName: 'origin/main',
      oid: 'main',
      current: false,
      remote: true,
    },
    {
      fullName: 'refs/remotes/backup/feature/topic',
      shortName: 'backup/feature/topic',
      oid: 'topic',
      current: false,
      remote: true,
    },
  ],
};

const remotes: QueryResult = {
  kind: 'remotes',
  remotes: [
    { name: 'origin', fetchUrls: ['origin'], pushUrls: ['origin'] },
    { name: 'backup', fetchUrls: ['backup'], pushUrls: ['backup'] },
  ],
  generation: 1,
};

function adapterWithTargets(): WorkspaceAdapter {
  return {
    attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
    query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'branches') return branches;
      if (request.kind === 'remotes') return remotes;
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
}

describe('RemoteOperationDialog', () => {
  it('selects the upstream Pull target and can choose another remote branch', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithTargets();
    const onRefreshBranches = vi.fn<
      Parameters<typeof RemoteOperationDialog>[0]['onRefreshBranches']
    >(async () => undefined);
    const onPull = vi.fn<(remote: string, remoteBranch: string) => Promise<void>>(
      async () => undefined,
    );
    render(
      <RemoteOperationDialog
        kind="pull"
        repo={repoSnapshot()}
        adapter={adapter}
        busy={false}
        onDismiss={() => undefined}
        onRefreshBranches={onRefreshBranches}
        onPull={onPull}
        onPush={async () => undefined}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Pull' })).not.toBeInTheDocument();
    const dialog = await screen.findByRole('dialog', { name: 'Pull' });
    expect(
      within(dialog).getByText('Select the remote branch to pull into the current branch.'),
    ).toBeVisible();
    const target = await within(dialog).findByRole('combobox', { name: 'Remote branch' });
    expect(target.parentElement).toHaveClass('select-control');
    expect(target.parentElement?.querySelector('.lucide-chevron-down')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Local branch' })).toHaveValue('main');
    expect(within(dialog).getByRole('textbox', { name: 'Local branch' })).toBeDisabled();
    const commitMerge = within(dialog).getByRole('checkbox', {
      name: 'Commit merged changes immediately',
    });
    expect(commitMerge).toBeChecked();
    await user.click(commitMerge);
    expect(target).toHaveValue('origin/main');
    expect(within(dialog).queryByRole('option', { name: 'origin/HEAD' })).not.toBeInTheDocument();
    const refresh = within(dialog).getByRole('button', { name: 'Refresh branches' });
    expect(refresh).not.toHaveTextContent('Refresh branches');
    expect(refresh.querySelector('svg')).toBeInTheDocument();
    await user.click(refresh);
    expect(onRefreshBranches).toHaveBeenCalledWith('origin');
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(4));
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Remote branch' }),
      'backup/feature/topic',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Pull' }));

    expect(onPull).toHaveBeenCalledWith('backup', 'feature/topic', false);
  });

  it('keeps the Pull fields visible while refreshed targets reload', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithTargets();
    render(
      <RemoteOperationDialog
        kind="pull"
        repo={repoSnapshot()}
        adapter={adapter}
        busy={false}
        onDismiss={() => undefined}
        onRefreshBranches={async () => undefined}
        onPull={async () => undefined}
        onPush={async () => undefined}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Pull' });
    const target = within(dialog).getByRole('combobox', { name: 'Remote branch' });
    let finishReload: (() => void) | undefined;
    const reload = new Promise<void>((resolve) => {
      finishReload = resolve;
    });
    vi.mocked(adapter.query).mockClear();
    vi.mocked(adapter.query).mockImplementation(async (request) => {
      await reload;
      if (request.kind === 'branches') return branches;
      if (request.kind === 'remotes') return remotes;
      throw new Error(`Unexpected query: ${request.kind}`);
    });

    const refresh = within(dialog).getByRole('button', { name: 'Refresh branches' });
    await user.click(refresh);
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2));
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(target).toBeVisible();
    expect(target).toHaveValue('origin/main');
    expect(within(dialog).getByRole('textbox', { name: 'Local branch' })).toBeDisabled();
    expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument();

    finishReload?.();
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(refresh).toHaveAttribute('aria-busy', 'false');
  });

  it('uses the tracked Push target and submits optional flags without changing button styling', async () => {
    const user = userEvent.setup();
    const onRefreshBranches = vi.fn<
      Parameters<typeof RemoteOperationDialog>[0]['onRefreshBranches']
    >(async () => undefined);
    const onPush = vi.fn<Parameters<typeof RemoteOperationDialog>[0]['onPush']>(
      async () => undefined,
    );
    render(
      <RemoteOperationDialog
        kind="push"
        repo={repoSnapshot()}
        adapter={adapterWithTargets()}
        busy={false}
        onDismiss={() => undefined}
        onRefreshBranches={onRefreshBranches}
        onPull={async () => undefined}
        onPush={onPush}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Push' });
    const remote = within(dialog).getByRole('combobox', { name: 'Remote' });
    const branch = within(dialog).getByRole('combobox', { name: 'Remote branch' });
    expect(remote).toHaveValue('origin');
    expect(branch).toHaveValue('main');
    await user.selectOptions(remote, 'backup');
    expect(branch).toHaveValue('main');
    await user.click(within(dialog).getByRole('button', { name: 'Refresh branches' }));
    expect(onRefreshBranches).toHaveBeenCalledWith('backup');
    await within(dialog).findByRole('combobox', { name: 'Remote' });
    const force = within(dialog).getByRole('checkbox', {
      name: 'Force push safely (--force-with-lease)',
    });
    const tags = within(dialog).getByRole('checkbox', { name: 'Push all local tags' });
    expect(force).not.toBeChecked();
    expect(tags).not.toBeChecked();
    await user.click(force);
    await user.click(tags);
    expect(
      within(dialog).getByText('This can rewrite remote branch history.', { exact: false }),
    ).toHaveTextContent('This can rewrite remote branch history.');
    const submit = within(dialog).getByRole('button', { name: 'Push' });
    expect(submit).toHaveClass('primary');
    expect(submit).not.toHaveClass('danger');
    await user.click(submit);

    expect(onPush).toHaveBeenCalledWith({
      kind: 'push',
      remote: 'backup',
      remoteBranch: 'main',
      forceWithLease: true,
      pushTags: true,
    });
  });

  it('uses origin and the current branch without an upstream, and keeps input after failure', async () => {
    const user = userEvent.setup();
    const onPush = vi.fn<Parameters<typeof RemoteOperationDialog>[0]['onPush']>(async () => {
      throw new Error('rejected');
    });
    render(
      <RemoteOperationDialog
        kind="push"
        repo={repoSnapshot({
          branch: { name: 'feature/new', detached: false, ahead: 0, behind: 0 },
        })}
        adapter={adapterWithTargets()}
        busy={false}
        onDismiss={() => undefined}
        onRefreshBranches={async () => undefined}
        onPull={async () => undefined}
        onPush={onPush}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Push' });
    expect(within(dialog).getByRole('combobox', { name: 'Remote' })).toHaveValue('origin');
    const branch = within(dialog).getByRole('combobox', { name: 'Remote branch' });
    expect(branch).toHaveValue('feature/new');
    await user.clear(branch);
    await user.type(branch, 'review/new');
    await user.click(within(dialog).getByRole('button', { name: 'Push' }));

    await waitFor(() => expect(onPush).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', { name: 'Push' })).toBeVisible();
    expect(branch).toHaveValue('review/new');
  });

  it('can be dismissed while a Push is running', async () => {
    const user = userEvent.setup();
    let finishPush: (() => void) | undefined;
    const push = new Promise<void>((resolve) => {
      finishPush = resolve;
    });
    const onDismiss = vi.fn<() => void>();
    const onPush = vi.fn<Parameters<typeof RemoteOperationDialog>[0]['onPush']>(() => push);
    render(
      <RemoteOperationDialog
        kind="push"
        repo={repoSnapshot()}
        adapter={adapterWithTargets()}
        busy={false}
        onDismiss={onDismiss}
        onRefreshBranches={async () => undefined}
        onPull={async () => undefined}
        onPush={onPush}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Push' });
    await user.click(within(dialog).getByRole('button', { name: 'Push' }));
    await waitFor(() => expect(onPush).toHaveBeenCalledOnce());
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close).toBeEnabled();
    await user.click(close);
    expect(onDismiss).toHaveBeenCalledOnce();

    finishPush?.();
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
  });

  it('keeps Pull usable without an upstream and reports target loading failures', async () => {
    const repo = repoSnapshot({
      branch: { name: 'main', detached: false, ahead: 0, behind: 0 },
    });
    const { unmount } = render(
      <RemoteOperationDialog
        kind="pull"
        repo={repo}
        adapter={adapterWithTargets()}
        busy={false}
        onDismiss={() => undefined}
        onRefreshBranches={async () => undefined}
        onPull={async () => undefined}
        onPush={async () => undefined}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Pull' });
    expect(within(dialog).getByRole('combobox', { name: 'Remote branch' })).toHaveValue('');
    expect(within(dialog).getByRole('option', { name: 'origin/main' })).toBeVisible();
    unmount();

    const failingAdapter = adapterWithTargets();
    let finishRetry: (() => void) | undefined;
    const retry = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    vi.mocked(failingAdapter.query)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockImplementation(async (request) => {
        await retry;
        if (request.kind === 'branches') return branches;
        if (request.kind === 'remotes') return remotes;
        throw new Error(`Unexpected query: ${request.kind}`);
      });
    render(
      <RemoteOperationDialog
        kind="pull"
        repo={repo}
        adapter={failingAdapter}
        busy={false}
        onDismiss={() => undefined}
        onRefreshBranches={async () => undefined}
        onPull={async () => undefined}
        onPush={async () => undefined}
      />,
    );
    const failedDialog = await screen.findByRole('dialog', { name: 'Pull' });
    expect(within(failedDialog).getByText('Could not load remotes and branches.')).toBeVisible();
    expect(within(failedDialog).getByRole('button', { name: 'Pull' })).toBeDisabled();
    await userEvent.setup().click(within(failedDialog).getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('dialog', { name: 'Pull' })).toBeVisible();
    expect(screen.getByText('Could not load remotes and branches.')).toBeVisible();

    finishRetry?.();
    expect(
      await within(failedDialog).findByRole('combobox', { name: 'Remote branch' }),
    ).toBeVisible();
  });
});
