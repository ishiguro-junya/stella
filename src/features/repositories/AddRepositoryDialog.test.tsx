import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddRepositoryDialog } from './AddRepositoryDialog';

describe('AddRepositoryDialog', () => {
  it('offers URL input and Finder selection without an Open or Clone choice', async () => {
    const user = userEvent.setup();
    const onChooseLocal = vi.fn<() => void>();
    const onLocationChange = vi.fn<(location: string) => void>();
    render(
      <AddRepositoryDialog
        location=""
        busy={false}
        onLocationChange={onLocationChange}
        onChooseLocal={onChooseLocal}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Add Repository' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Repository URL or path' }),
      'https://example.com/stella.git',
    );
    expect(onLocationChange).toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Choose in Finder…' }));
    expect(onChooseLocal).toHaveBeenCalledOnce();
    expect(within(dialog).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument();
  });

  it('announces an invalid location next to the shared field', () => {
    render(
      <AddRepositoryDialog
        location="invalid"
        error="Enter a supported remote URL or an absolute local path."
        busy={false}
        onLocationChange={() => undefined}
        onChooseLocal={() => undefined}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a supported remote URL or an absolute local path.',
    );
    expect(screen.getByRole('textbox', { name: 'Repository URL or path' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
