import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from './adapters/workspaceAdapter';
import { App } from './App';
import { repoSnapshot } from './test/fixtures';

const activityHarness = vi.hoisted(() => ({
  onReady: undefined as (() => void) | undefined,
}));

vi.mock('./features/activity/ActivityView', () => ({
  ActivityView: ({ onReady }: { onReady?: () => void }) => {
    activityHarness.onReady = onReady;
    return (
      <main data-testid="activity-harness" aria-labelledby="activity-title">
        <h1 id="activity-title" className="sr-only">
          Activity
        </h1>
        Activity content
      </main>
    );
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: async () => '/tmp',
}));

describe('App deferred Activity navigation', () => {
  it('discards an unstarted Clone when Activity closes before its lazy view is ready', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({ path: '/tmp/repository' });
    const attach = vi.fn<WorkspaceAdapter['attach']>(async (request) =>
      request.kind === 'clone'
        ? { repos: [], activities: [] }
        : { repos: [repo], selectedRepoId: repo.repoId, activities: [] },
    );
    const adapter: WorkspaceAdapter = {
      attach,
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
    expect(attach).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Repositories' }));
    expect(screen.getByRole('heading', { name: 'Repositories' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add Repository' }));
    await user.type(screen.getByRole('textbox', { name: 'Repository path' }), repo.path);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Repository' })).getByRole('button', {
        name: 'Add Repository',
      }),
    );

    expect(attach).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenLastCalledWith({ kind: 'open', path: repo.path });
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    act(() => activityHarness.onReady?.());

    expect(attach).toHaveBeenCalledOnce();
  });
});
