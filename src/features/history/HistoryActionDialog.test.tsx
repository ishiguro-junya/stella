import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceAction } from '../../domain/workspace';
import { HistoryActionDialog, type HistoryActionDialogRequest } from './HistoryActionDialog';

const target = {
  oid: '0123456789abcdef0123456789abcdef01234567',
  shortOid: '0123456',
  subject: 'feat: selected commit',
  parents: [] as string[],
};

function renderDialog(
  request: HistoryActionDialogRequest,
  onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined),
) {
  const onDismiss = vi.fn<() => void>();
  render(
    <HistoryActionDialog
      request={request}
      disabled={false}
      onDismiss={onDismiss}
      onAction={onAction}
    />,
  );
  return { onAction, onDismiss };
}

describe('HistoryActionDialog', () => {
  it('creates a Branch from the bound commit after reviewing the focused form', async () => {
    const user = userEvent.setup();
    const { onAction, onDismiss } = renderDialog({ kind: 'createBranch', target });
    const dialog = screen.getByRole('dialog', { name: 'Create branch' });

    expect(within(dialog).getByText(target.subject)).toBeVisible();
    expect(within(dialog).getByText(target.shortOid)).toBeVisible();
    const input = within(dialog).getByRole('textbox', { name: 'Branch name' });
    expect(input).toHaveFocus();
    await user.type(input, 'feature/history-menu');
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'createBranch',
      name: 'feature/history-menu',
      startOid: target.oid,
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps the local lightweight Tag explanation in the Tag form', async () => {
    const user = userEvent.setup();
    const { onAction } = renderDialog({ kind: 'createTag', target });
    const dialog = screen.getByRole('dialog', { name: 'Create Tag' });
    expect(
      within(dialog).getByText('Creates a lightweight Tag locally. It is not pushed to a remote.'),
    ).toBeVisible();

    await user.type(within(dialog).getByRole('textbox', { name: 'Tag name' }), 'v2.0.0');
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));
    expect(onAction).toHaveBeenCalledWith({
      kind: 'createTag',
      name: 'v2.0.0',
      targetOid: target.oid,
    });
  });

  it.each([
    ['merge', 'Merge', { kind: 'merge', sourceRef: 'origin/topic' }],
    ['rebase', 'Rebase', { kind: 'rebase', ontoRef: 'origin/topic' }],
  ] as const)(
    'prefills the selected Commit OID for %s but allows another source ref',
    async (kind, dialogName, expected) => {
      const user = userEvent.setup();
      const { onAction } = renderDialog({ kind, target });
      const dialog = screen.getByRole('dialog', { name: dialogName });
      const input = within(dialog).getByRole('textbox', { name: 'Source ref' });
      expect(input).toHaveValue(target.oid);
      await user.clear(input);
      await user.type(input, 'origin/topic');
      await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));
      expect(onAction).toHaveBeenCalledWith(expected);
    },
  );

  it.each([
    ['cherryPick', 'Cherry-pick'],
    ['revert', 'Revert'],
  ] as const)('always shows a focused %s dialog for a normal Commit', async (kind, dialogName) => {
    const user = userEvent.setup();
    const { onAction } = renderDialog({ kind, target });
    const dialog = screen.getByRole('dialog', { name: dialogName });
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    const review = within(dialog).getByRole('button', { name: 'Review impact' });
    expect(review).toHaveFocus();
    await user.click(review);
    expect(onAction).toHaveBeenCalledWith({ kind, oid: target.oid });
  });

  it('passes the selected Mainline Parent for a merge Commit', async () => {
    const user = userEvent.setup();
    const mergeTarget = { ...target, parents: ['parent-a', 'parent-b'] };
    const { onAction } = renderDialog({ kind: 'revert', target: mergeTarget });
    const dialog = screen.getByRole('dialog', { name: 'Revert' });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'revert', oid: target.oid, mainline: 2 });
  });

  it('defaults Reset to Mixed and forwards a changed mode', async () => {
    const user = userEvent.setup();
    const { onAction } = renderDialog({ kind: 'reset', target });
    const dialog = screen.getByRole('dialog', { name: 'Reset' });
    const mode = within(dialog).getByRole('combobox', { name: 'Reset mode' });
    expect(mode).toHaveValue('mixed');
    await user.selectOptions(mode, 'hard');
    const review = within(dialog).getByRole('button', { name: 'Review impact' });
    expect(review).toHaveClass('danger');
    await user.click(review);
    expect(onAction).toHaveBeenCalledWith({ kind: 'reset', oid: target.oid, mode: 'hard' });
  });

  it('preserves input and re-enables the form when preview preparation fails', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => {
      throw new Error('preview failed');
    });
    const { onDismiss } = renderDialog({ kind: 'createTag', target }, onAction);
    const dialog = screen.getByRole('dialog', { name: 'Create Tag' });
    const input = within(dialog).getByRole('textbox', { name: 'Tag name' });
    await user.type(input, 'v2.0.0');
    await user.click(within(dialog).getByRole('button', { name: 'Review impact' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(input).toHaveValue('v2.0.0');
    expect(within(dialog).getByRole('button', { name: 'Review impact' })).toBeEnabled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
