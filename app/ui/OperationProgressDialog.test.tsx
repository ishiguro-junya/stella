import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OperationProgressDialog } from './OperationProgressDialog';

describe('OperationProgressDialog', () => {
  it('keeps an indeterminate running operation modal while allowing one cancellation request', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn<() => void>();
    render(
      <OperationProgressDialog
        action={{ id: 'actionFetch' }}
        repositoryName="stella"
        summary={{ id: 'backendOperationInProgress' }}
        status="running"
        canCancel
        onCancel={onCancel}
        onDismiss={vi.fn<() => void>()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Fetch' });
    const progress = screen.getByRole('progressbar', { name: 'Fetch' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('operation-progress-sheet');
    expect(progress).toHaveClass('sr-only');
    expect(progress).not.toHaveAttribute('value');
    expect(dialog.querySelector('.operation-progress-track')).toBeVisible();
    expect(dialog.querySelector('.operation-progress-segment')).toBeVisible();
    expect(screen.getByText('stella')).toBeVisible();
    expect(screen.getByText('Operation in progress')).toHaveAttribute('aria-live', 'polite');

    await user.keyboard('{Escape}');
    fireEvent.click(dialog.parentElement!);
    expect(dialog).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses the same dialog for failures and focuses Close', () => {
    render(
      <OperationProgressDialog
        action={{ id: 'actionPush' }}
        repositoryName="stella"
        summary={{ id: 'backendOperationInProgress' }}
        status="failed"
        error={{ message: 'The operation failed.', stderr: 'permission denied' }}
        canCancel={false}
        onCancel={vi.fn<() => void>()}
        onDismiss={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Push' })).toHaveTextContent('permission denied');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('announces a failure and focuses Close after an unbound operation fails', () => {
    const { rerender } = render(
      <OperationProgressDialog
        action={{ id: 'actionFetch' }}
        repositoryName="stella"
        summary={{ id: 'backendOperationInProgress' }}
        status="running"
        canCancel={false}
        onCancel={vi.fn<() => void>()}
        onDismiss={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Fetch' })).toHaveFocus();

    rerender(
      <OperationProgressDialog
        action={{ id: 'actionFetch' }}
        repositoryName="stella"
        summary={{ id: 'backendOperationInProgress' }}
        status="failed"
        error={{ message: 'The operation failed.', stderr: 'permission denied' }}
        canCancel={false}
        onCancel={vi.fn<() => void>()}
        onDismiss={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('permission denied');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
