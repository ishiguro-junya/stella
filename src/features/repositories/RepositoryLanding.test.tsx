import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryLanding } from './RepositoryLanding';

describe('RepositoryLanding', () => {
  it('shows one Add action in the empty state', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn<() => void>();
    render(
      <RepositoryLanding
        repositories={[]}
        busy={false}
        onAdd={onAdd}
        onOpen={() => undefined}
        onRepair={() => undefined}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Repositories' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Repositories' })).toBeVisible();
    expect(document.querySelector('.repository-landing-brand')).not.toBeInTheDocument();
    const emptyState = screen.getByRole('region', { name: 'Add your first repository' });
    expect(
      within(emptyState).getByText('Add an existing local repository, or clone one from a URL.'),
    ).toBeVisible();

    const addButton = within(emptyState).getByRole('button', {
      name: 'Add Repository',
    });
    expect(addButton).toHaveTextContent('Add');
    expect(addButton).toHaveClass('primary');
    expect(within(emptyState).getAllByRole('button')).toEqual([addButton]);
    await user.click(addButton);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('focuses and navigates repository rows without switching on a single click', async () => {
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
        currentPath="/Users/stella/most-recent"
        busy={false}
        onAdd={() => undefined}
        onOpen={onOpen}
        onRepair={() => undefined}
        onManageRemotes={() => undefined}
        onForget={() => undefined}
      />,
    );

    expect(screen.getByText('2 repositories')).toBeVisible();
    const controls = document.querySelector('.repository-landing-controls');
    if (!(controls instanceof HTMLElement)) throw new Error('Repository controls are missing.');
    expect(within(controls).getByRole('searchbox')).toBeVisible();
    expect(
      within(controls)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Add']);
    expect(within(controls).getByRole('button', { name: 'Add Repository' })).toHaveClass('primary');
    const list = screen.getByRole('listbox', { name: 'Repositories' });
    const rows = within(list).getAllByRole('option');
    expect(rows[0]).toHaveTextContent('Most Recent');
    expect(rows[0]).toHaveTextContent('/Users/stella/most-recent');
    expect(rows[0]?.querySelector('img')).toHaveAttribute('src', 'asset://recent/logo.svg');
    expect(rows[1]).toHaveTextContent('Older');
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows[0]?.querySelector('.switcher-check .lucide-check')).toBeInTheDocument();
    expect(rows[1]?.querySelector('.switcher-check .lucide-check')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /More actions for/u })).toHaveLength(2);
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(list).toHaveClass('is-keyboard-navigating');

    fireEvent.pointerMove(list);
    expect(list).not.toHaveClass('is-keyboard-navigating');

    screen.getByRole('searchbox').focus();
    fireEvent.click(rows[1]!);
    expect(rows[1]).toHaveFocus();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.contextMenu(rows[0]!.closest('li')!, { clientX: 120, clientY: 180 });
    expect(screen.getByRole('menu', { name: 'Most Recent actions' })).toBeVisible();
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows[1]).toHaveAttribute('aria-selected', 'false');
    expect(document.querySelectorAll('.registered-repositories > .is-selected')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(rows[0]).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'More actions for Older' }));
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelectorAll('.registered-repositories > .is-selected')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(rows[1]).toHaveFocus();

    await user.type(screen.getByPlaceholderText('Search by repository name'), 'older');
    expect(screen.getByText('1 repository')).toBeVisible();
    expect(screen.queryByText('Most Recent')).not.toBeInTheDocument();
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /More actions for/u })).toHaveLength(1);
    const olderActions = screen.getByRole('button', { name: 'More actions for Older' });
    await user.click(olderActions);
    expect(olderActions.closest('li')).toHaveClass('is-selected');
    await user.click(screen.getByRole('menuitem', { name: 'Switch Repository' }));
    expect(onOpen).toHaveBeenLastCalledWith('/Users/stella/older');
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
        onAdd={() => undefined}
        onOpen={() => undefined}
        onRepair={onRepair}
        onManageRemotes={onManageRemotes}
        onForget={() => undefined}
      />,
    );

    expect(screen.getByText('Check location')).toBeVisible();
    expect(screen.getByText('Check authentication')).toBeVisible();
    await user.dblClick(screen.getByRole('option', { name: /Missing.*Check location/u }));
    await user.click(screen.getByRole('button', { name: 'More actions for Remote' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Repository Information' }));
    expect(onRepair).toHaveBeenCalledWith('/missing');
    expect(onManageRemotes).toHaveBeenCalledWith('/remote');
  });
});
