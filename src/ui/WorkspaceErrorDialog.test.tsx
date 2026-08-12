import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceErrorDialog } from './WorkspaceErrorDialog';

describe('WorkspaceErrorDialog', () => {
  it('focuses Close and always shows bounded Git output without an error label or toggle', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn<() => void>();
    render(
      <WorkspaceErrorDialog
        title="Operation failed"
        error={{
          message: 'The hook rejected this operation.',
          stderr: 'policy denied',
          stdout: 'hook output',
          exitCode: '1',
        }}
        onDismiss={onDismiss}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Operation failed' });
    expect(dialog).toHaveAccessibleDescription(/The hook rejected this operation\./u);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
    expect(dialog.querySelector('details')).not.toBeInTheDocument();
    expect(dialog.querySelector('summary')).not.toBeInTheDocument();
    expect(screen.getByText('Exit code: 1')).toBeVisible();
    expect(screen.getByLabelText('stderr')).toHaveTextContent('policy denied');
    expect(screen.getByLabelText('stdout')).toHaveTextContent('hook output');
    expect(screen.getByLabelText('stderr').parentElement).toHaveClass('notice-output-streams');

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
