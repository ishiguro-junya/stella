import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceErrorDialog } from './WorkspaceErrorDialog';

describe('WorkspaceErrorDialog', () => {
  it('focuses Close and preserves redacted Git output in accessible details', async () => {
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
    await user.click(screen.getByText('Show Git output'));
    expect(screen.getByText('Exit code: 1')).toBeVisible();
    expect(screen.getByLabelText('stderr')).toHaveTextContent('policy denied');
    expect(screen.getByLabelText('stdout')).toHaveTextContent('hook output');

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
