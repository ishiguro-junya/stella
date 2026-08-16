import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog, DialogBody, DialogFooter, DialogHeader } from './Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open ? (
        <Dialog labelledBy="dialog-title" onDismiss={() => setOpen(false)}>
          <DialogHeader titleId="dialog-title" title="Confirm" description="Description" />
          <DialogBody>Body</DialogBody>
          <DialogFooter>
            <button type="button" data-dialog-initial-focus onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button">Continue</button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}

function StackedHarness() {
  const [firstOpen, setFirstOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setFirstOpen(true)}>
        Open first
      </button>
      <button type="button" data-testid="remove-first" onClick={() => setFirstOpen(false)}>
        Remove first
      </button>
      {firstOpen ? (
        <Dialog labelledBy="first-title" onDismiss={() => setFirstOpen(false)}>
          <h2 id="first-title">First dialog</h2>
          <button type="button" onClick={() => setSecondOpen(true)}>
            Open second
          </button>
        </Dialog>
      ) : null}
      {secondOpen ? (
        <Dialog labelledBy="second-title" onDismiss={() => setSecondOpen(false)}>
          <h2 id="second-title">Second dialog</h2>
          <button type="button">Second action</button>
        </Dialog>
      ) : null}
    </>
  );
}

describe('Dialog', () => {
  it('focuses Cancel, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not close when Escape cancels an active IME composition', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });

    expect(screen.getByRole('alertdialog', { name: 'Confirm' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('uses the common regions and closes from the close button or backdrop only', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm' });
    expect(dialog.querySelector('.dialog-header')).toBeInTheDocument();
    expect(dialog.querySelector('.dialog-body')).toHaveTextContent('Body');
    expect(dialog.querySelector('.dialog-footer')).toBeInTheDocument();

    fireEvent.click(dialog);
    expect(dialog).toBeVisible();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('ignores every dismiss action when dismissal is disabled', async () => {
    const onDismiss = vi.fn<() => void>();
    render(
      <Dialog labelledBy="locked-title" dismissible={false} onDismiss={onDismiss}>
        <DialogHeader titleId="locked-title" title="Locked" />
      </Dialog>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Locked' });
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('only lets the topmost dialog handle Escape and restores the underlying dialog', async () => {
    const user = userEvent.setup();
    render(<StackedHarness />);

    await user.click(screen.getByRole('button', { name: 'Open first' }));
    await user.click(screen.getByRole('button', { name: 'Open second' }));
    expect(screen.getByRole('alertdialog', { name: 'Second dialog' })).toBeVisible();
    expect(document.querySelector('[aria-labelledby="first-title"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog', { name: 'Second dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: 'First dialog' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open second' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('inherits a stable focus target when an underlying dialog is replaced', async () => {
    const user = userEvent.setup();
    render(<StackedHarness />);
    const opener = screen.getByRole('button', { name: 'Open first' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Open second' }));
    fireEvent.click(screen.getByTestId('remove-first'));
    expect(screen.queryByRole('alertdialog', { name: 'First dialog' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
