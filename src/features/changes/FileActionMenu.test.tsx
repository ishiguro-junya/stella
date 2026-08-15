import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FileActionMenu, type FileActionKind, type FileActionMenuProps } from './FileActionMenu';

function Harness({
  onAction,
  ...props
}: Partial<Omit<FileActionMenuProps, 'open' | 'onOpenChange'>> & {
  onAction?: (action: FileActionKind) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Before</button>
      <FileActionMenu
        path="src/app.ts"
        selectedPaths={['src/app.ts']}
        open={open}
        disabled={false}
        openDisabled={false}
        discardDisabled={false}
        deleteDisabled={false}
        onOpenChange={setOpen}
        onTriggerOpen={() => undefined}
        onAction={onAction ?? (async () => undefined)}
        {...props}
      />
      <button type="button">Outside</button>
    </>
  );
}

describe('FileActionMenu', () => {
  it('supports menu-button and roving keyboard navigation and restores focus with Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for src/app.ts' });

    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('More actions');
    await user.unhover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'src/app.ts actions' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.keyboard(' ');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('opens at the last enabled item with ArrowUp and closes on Tab or outside click', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for src/app.ts' });
    trigger.focus();

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();

    await user.click(trigger);
    await user.tab({ shift: true });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
  });

  it('skips disabled actions and closes before routing an enabled action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: FileActionKind) => Promise<void>>(async () => undefined);
    render(
      <Harness editDisabled openDisabled discardDisabled deleteDisabled onAction={onAction} />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions for src/app.ts' });

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toHaveFocus();

    await user.click(screen.getByRole('menuitem', { name: 'Copy Path' }));
    expect(onAction).toHaveBeenCalledWith('copyPath');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('disables the trigger while a global operation is busy', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    const trigger = screen.getByRole('button', { name: 'More actions for src/app.ts' });

    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
