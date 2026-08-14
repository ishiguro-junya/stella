import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryLanding } from './RepositoryLanding';

describe('RepositoryLanding', () => {
  it('shows separate local Add and URL Clone actions in the empty state', async () => {
    const user = userEvent.setup();
    const onAddLocal = vi.fn<() => void>();
    const onClone = vi.fn<() => void>();
    render(
      <RepositoryLanding
        repositories={[]}
        busy={false}
        onAddLocal={onAddLocal}
        onClone={onClone}
        onOpen={() => undefined}
        onRepair={() => undefined}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    const emptyState = screen.getByRole('region', { name: 'Add your first repository' });
    expect(
      within(emptyState).getByText('Add an existing local repository, or clone one from a URL.'),
    ).toBeVisible();

    const addButton = within(emptyState).getByRole('button', {
      name: 'Add Repository',
    });
    const cloneButton = within(emptyState).getByRole('button', {
      name: 'Clone Repository',
    });
    await user.click(addButton);
    await user.click(cloneButton);
    expect(onAddLocal).toHaveBeenCalledOnce();
    expect(onClone).toHaveBeenCalledOnce();
  });

  it('renders registered repositories in MRU order and opens the selected path', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn<(path: string) => void>();
    render(
      <RepositoryLanding
        repositories={[
          {
            path: '/Users/stella/most-recent',
            name: 'Most Recent',
            logoUrl: 'asset://recent/logo.svg',
          },
          { path: '/Users/stella/older', name: 'Older' },
        ]}
        busy={false}
        onAddLocal={() => undefined}
        onClone={() => undefined}
        onOpen={onOpen}
        onRepair={() => undefined}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
      />,
    );

    const list = screen.getByRole('list', { name: 'Repositories' });
    const rows = within(list)
      .getAllByRole('button')
      .filter((button) => button.classList.contains('registered-repository-row'));
    expect(rows[0]).toHaveTextContent('Most Recent');
    expect(rows[0]).toHaveTextContent('/Users/stella/most-recent');
    expect(rows[0]?.querySelector('img')).toHaveAttribute('src', 'asset://recent/logo.svg');
    expect(rows[1]).toHaveTextContent('Older');

    const older = rows[1];
    if (!older) throw new Error('Expected the older repository row.');
    await user.click(older);
    expect(onOpen).toHaveBeenCalledWith('/Users/stella/older');
  });

  it('routes local and remote warnings to their recovery actions', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn<(path: string) => void>();
    const onManageRemotes = vi.fn<(path: string) => void>();
    render(
      <RepositoryLanding
        repositories={[
          { path: '/missing', name: 'Missing', availability: 'missing' },
          {
            path: '/remote',
            name: 'Remote',
            availability: 'available',
            healthIssues: [{ kind: 'remote', remote: 'origin', reason: 'authentication' }],
          },
        ]}
        busy={false}
        onAddLocal={() => undefined}
        onClone={() => undefined}
        onOpen={() => undefined}
        onRepair={onRepair}
        onManageRemotes={onManageRemotes}
        onForget={() => undefined}
      />,
    );

    expect(screen.getByText('Check location')).toBeVisible();
    expect(screen.getByText('Check authentication')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choose Location' }));
    await user.click(screen.getByRole('button', { name: 'Change Remote URLs' }));
    expect(onRepair).toHaveBeenCalledWith('/missing');
    expect(onManageRemotes).toHaveBeenCalledWith('/remote');
  });
});
