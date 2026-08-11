import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryLanding } from './RepositoryLanding';

describe('RepositoryLanding', () => {
  it('shows the empty state and the single add action', () => {
    render(
      <RepositoryLanding
        repositories={[]}
        busy={false}
        onAdd={() => undefined}
        onOpen={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    expect(screen.getByText('No repositories have been added yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Repository' })).toBeVisible();
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
        onAdd={() => undefined}
        onOpen={onOpen}
      />,
    );

    const list = screen.getByRole('list', { name: 'Repositories' });
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Most Recent');
    expect(rows[0]).toHaveTextContent('/Users/stella/most-recent');
    expect(rows[0]?.querySelector('img')).toHaveAttribute('src', 'asset://recent/logo.svg');
    expect(rows[1]).toHaveTextContent('Older');

    const older = rows[1];
    if (!older) throw new Error('Expected the older repository row.');
    await user.click(older);
    expect(onOpen).toHaveBeenCalledWith('/Users/stella/older');
  });
});
