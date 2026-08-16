import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ChangeEntry } from '../../domain/workspace';
import { DiffFileList, type DiffFileListProps, type StageTransitionRequest } from './DiffFileList';
import type { FileActionKind } from './FileActionMenu';

const changes: ChangeEntry[] = [
  { path: 'src/app.ts', area: 'staged', status: 'modified' },
  { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
  { path: 'src/new.ts', area: 'untracked', status: 'added' },
  { path: 'src/conflict.ts', area: 'conflicted', status: 'conflicted' },
];

function renderList(overrides: Partial<DiffFileListProps> = {}) {
  const onSelect = vi.fn<(key: string) => void>();
  const onSelectedKeysChange = vi.fn<(keys: string[]) => void>();
  const onStageTransition = vi.fn<(request: StageTransitionRequest) => Promise<void>>(
    async () => undefined,
  );
  const onFileAction = vi.fn<(entries: ChangeEntry[], action: FileActionKind) => Promise<void>>(
    async () => undefined,
  );
  const result = render(
    <DiffFileList
      repoId="repo-1"
      generation={1}
      entries={changes}
      selectedKey="unstaged:src/app.ts"
      disabled={false}
      fileActionsDisabled={false}
      fileOpenDisabled={false}
      fileTrashDisabled={false}
      onSelect={onSelect}
      onSelectedKeysChange={onSelectedKeysChange}
      onStageTransition={onStageTransition}
      onFileAction={onFileAction}
      {...overrides}
    />,
  );
  return { ...result, onSelect, onSelectedKeysChange, onStageTransition, onFileAction };
}

function changeRows(name: RegExp, container: HTMLElement = document.body): HTMLButtonElement[] {
  return within(container)
    .getAllByRole('button', { name })
    .filter((candidate): candidate is HTMLButtonElement =>
      candidate.classList.contains('change-row'),
    );
}

function changeRow(name: RegExp, container?: HTMLElement): HTMLButtonElement {
  const row = changeRows(name, container)[0];
  if (!row) throw new Error(`Expected change row matching ${name.source}`);
  return row;
}

function BusyAfterFileActionHarness() {
  const [busy, setBusy] = useState(false);
  return (
    <DiffFileList
      repoId="repo-1"
      generation={1}
      entries={[{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }]}
      selectedKey="unstaged:src/app.ts"
      disabled={busy}
      fileActionsDisabled={busy}
      fileOpenDisabled={false}
      fileTrashDisabled={false}
      onSelect={() => undefined}
      onStageTransition={async () => undefined}
      onFileAction={async () => setBusy(true)}
    />
  );
}

describe('DiffFileList staging controls', () => {
  it('focuses the selected file when opened so arrow navigation works immediately', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList({
      entries: [
        { path: 'src/one.ts', area: 'unstaged', status: 'modified' },
        { path: 'src/two.ts', area: 'unstaged', status: 'modified' },
      ],
      selectedKey: 'unstaged:src/one.ts',
    });
    const first = changeRow(/Modified src\/one\.ts/u);
    const second = changeRow(/Modified src\/two\.ts/u);

    await waitFor(() => expect(first).toHaveFocus());
    await user.keyboard('{ArrowDown}');

    expect(onSelect).toHaveBeenLastCalledWith('unstaged:src/two.ts');
    expect(second).toHaveFocus();
  });

  it('moves file selection with the up and down arrow keys within each group', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList({
      entries: [
        { path: 'src/staged-one.ts', area: 'staged', status: 'modified' },
        { path: 'src/staged-two.ts', area: 'staged', status: 'modified' },
        { path: 'src/unstaged-one.ts', area: 'unstaged', status: 'modified' },
        { path: 'src/unstaged-two.ts', area: 'unstaged', status: 'modified' },
      ],
      selectedKey: 'staged:src/staged-one.ts',
    });
    const staged = screen.getByRole('region', { name: 'Staged' });
    const unstaged = screen.getByRole('region', { name: 'Unstaged' });
    const stagedOne = changeRow(/Modified src\/staged-one\.ts/u, staged);
    const stagedTwo = changeRow(/Modified src\/staged-two\.ts/u, staged);
    const unstagedOne = changeRow(/Modified src\/unstaged-one\.ts/u, unstaged);
    const unstagedTwo = changeRow(/Modified src\/unstaged-two\.ts/u, unstaged);

    await user.click(stagedOne);
    expect(stagedOne).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith('staged:src/staged-two.ts');
    expect(stagedTwo).toHaveFocus();

    const selectionCountAtStagedBoundary = onSelect.mock.calls.length;
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenCalledTimes(selectionCountAtStagedBoundary);
    expect(stagedTwo).toHaveFocus();

    await user.click(unstagedTwo);
    expect(unstagedTwo).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(onSelect).toHaveBeenLastCalledWith('unstaged:src/unstaged-one.ts');
    expect(unstagedOne).toHaveFocus();

    const selectionCountAtUnstagedBoundary = onSelect.mock.calls.length;
    await user.keyboard('{ArrowUp}');
    expect(onSelect).toHaveBeenCalledTimes(selectionCountAtUnstagedBoundary);
    expect(unstagedOne).toHaveFocus();
  });

  it('includes each Git status in the file row accessible name', () => {
    const statusCases: Array<{
      area: ChangeEntry['area'];
      iconClass: string;
      label: string;
      status: ChangeEntry['status'];
    }> = [
      {
        area: 'untracked',
        iconClass: 'lucide-file-plus-corner',
        label: 'Added',
        status: 'added',
      },
      {
        area: 'unstaged',
        iconClass: 'lucide-file-pen-line',
        label: 'Modified',
        status: 'modified',
      },
      { area: 'unstaged', iconClass: 'lucide-trash-2', label: 'Deleted', status: 'deleted' },
      { area: 'unstaged', iconClass: 'lucide-arrow-right', label: 'Renamed', status: 'renamed' },
      { area: 'unstaged', iconClass: 'lucide-binary', label: 'Binary', status: 'binary' },
      {
        area: 'conflicted',
        iconClass: 'lucide-triangle-alert',
        label: 'Conflicted',
        status: 'conflicted',
      },
    ];
    const entries = statusCases.map(({ area, status }) => ({
      area,
      path: `src/${status}.ts`,
      status,
    }));
    renderList({ entries });

    for (const { iconClass, label, status } of statusCases) {
      const row = screen.getByRole('button', { name: `${label} src/${status}.ts` });
      expect(row).toHaveClass('change-row');
      expect(row.querySelector(`.${iconClass}`)).toBeInTheDocument();
      expect(row.querySelector('.file-status')).toHaveTextContent('');
    }
  });

  it('switches between two-line, full-path, and collapsible tree displays', async () => {
    const entries: ChangeEntry[] = [
      { path: 'README.md', area: 'unstaged', status: 'modified' },
      { path: 'src/features/app.ts', area: 'unstaged', status: 'modified' },
    ];
    const twoLine = renderList({
      entries,
      selectedKey: 'unstaged:src/features/app.ts',
    });
    const twoLineRow = changeRow(/Modified src\/features\/app\.ts/u);
    expect(within(twoLineRow).getByText('app.ts')).toBeVisible();
    expect(within(twoLineRow).getByText('src/features')).toBeVisible();
    twoLine.unmount();

    const fullPath = renderList({
      entries,
      display: 'fullPath',
      selectedKey: 'unstaged:src/features/app.ts',
    });
    const fullPathRow = changeRow(/Modified src\/features\/app\.ts/u);
    const fullPathLabel = fullPathRow.querySelector<HTMLElement>('.file-path strong');
    if (!fullPathLabel) throw new Error('The full-path label was not found.');
    expect(fullPathLabel).toHaveTextContent('src/features/app.ts');
    expect(fullPathLabel.querySelector('.file-path-prefix')).not.toBeInTheDocument();
    expect(fullPathRow).toHaveClass('is-single-line', 'is-full-path');
    fullPath.unmount();

    const user = userEvent.setup();
    renderList({
      entries,
      display: 'tree',
      splitStageView: false,
      selectedKey: 'unstaged:src/features/app.ts',
    });
    const srcDirectory = screen.getByRole('button', { name: 'Collapse src' });
    const featuresDirectory = screen.getByRole('button', { name: 'Collapse src/features' });
    const nestedFile = changeRow(/Modified src\/features\/app\.ts/u);
    const rootFile = changeRow(/Modified README\.md/u);
    expect(srcDirectory).toHaveStyle({ paddingLeft: '16px' });
    expect(featuresDirectory).toHaveStyle({ paddingLeft: '30px' });
    expect(rootFile).toHaveStyle({ paddingLeft: '26px' });
    expect(nestedFile).toHaveStyle({ paddingLeft: '54px' });

    await user.click(screen.getByRole('button', { name: 'Collapse src' }));
    expect(screen.getByRole('button', { name: 'Expand src' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Modified src/features/app.ts' })).toBeNull();
    expect(changeRow(/Modified README\.md/u)).toBeVisible();
  });

  it('always shows Staged and Unstaged as separate groups, including zero-count groups', () => {
    renderList({
      entries: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });

    const staged = screen.getByRole('region', { name: 'Staged' });
    expect(staged).toBeVisible();
    expect(within(staged).getByText('0')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Unstaged' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Conflicted' })).not.toBeInTheDocument();
  });

  it('collapses and expands Staged and Unstaged from toggles between the checkbox and label', async () => {
    const user = userEvent.setup();
    renderList();

    const stagedHeading = screen.getByRole('heading', { name: 'Staged' });
    const unstagedHeading = screen.getByRole('heading', { name: 'Unstaged' });
    expect(stagedHeading).toBeVisible();
    expect(unstagedHeading).toBeVisible();
    expect(within(stagedHeading).getByText('1')).toHaveClass('change-count');
    expect(within(unstagedHeading).getByText('2')).toHaveClass('change-count');
    expect(stagedHeading.querySelector('.change-group-title')?.nextElementSibling).toHaveClass(
      'change-count',
    );
    expect(unstagedHeading.querySelector('.change-group-title')?.nextElementSibling).toHaveClass(
      'change-count',
    );
    expect(screen.getByRole('checkbox', { name: 'Unstage src/app.ts' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Stage src/new.ts' })).toBeVisible();

    const collapseStaged = screen.getByRole('button', { name: 'Collapse Staged' });
    const collapseUnstaged = screen.getByRole('button', { name: 'Collapse Unstaged' });
    expect(collapseStaged).toHaveAttribute('aria-expanded', 'true');
    expect(collapseUnstaged).toHaveAttribute('aria-expanded', 'true');
    expect(collapseStaged).toHaveClass('change-group-collapse-toggle');
    const stagedGroupCheckbox = screen.getByRole('checkbox', { name: 'Unstage all 1 staged file' });
    expect(
      stagedGroupCheckbox.compareDocumentPosition(collapseStaged) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      collapseStaged.compareDocumentPosition(stagedHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    await user.click(collapseStaged);
    expect(screen.getByRole('button', { name: 'Expand Staged' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('checkbox', { name: 'Unstage src/app.ts' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Stage src/new.ts' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Diff' })).toHaveClass('is-staged-collapsed');

    await user.click(collapseUnstaged);
    expect(screen.getByRole('button', { name: 'Expand Unstaged' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('group', { name: 'Diff' })).toHaveClass(
      'is-staged-collapsed',
      'is-worktree-collapsed',
    );

    await user.click(screen.getByRole('button', { name: 'Expand Staged' }));
    expect(screen.getByRole('checkbox', { name: 'Unstage src/app.ts' })).toBeVisible();
  });

  it('uses checked state for Staged and routes each checkbox without changing the Diff selection', async () => {
    const user = userEvent.setup();
    const { onSelect, onStageTransition } = renderList();

    const staged = screen.getByRole('checkbox', { name: 'Unstage src/app.ts' });
    const unstaged = screen.getByRole('checkbox', { name: 'Stage src/app.ts' });
    expect(staged).toBeChecked();
    expect(unstaged).not.toBeChecked();

    await user.click(unstaged);
    expect(onStageTransition).toHaveBeenLastCalledWith({
      kind: 'stage',
      paths: ['src/app.ts'],
      sourceArea: 'unstaged',
    });
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(staged);
    expect(onStageTransition).toHaveBeenLastCalledWith({
      kind: 'unstage',
      paths: ['src/app.ts'],
      sourceArea: 'staged',
    });
  });

  it('expands a collapsed destination before moving a file into it', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: 'Collapse Staged' }));
    expect(screen.getByRole('button', { name: 'Expand Staged' })).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'Stage src/new.ts' }));
    expect(screen.getByRole('button', { name: 'Collapse Staged' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('stages a whole group through one typed multi-path action', async () => {
    const user = userEvent.setup();
    const onStageTransition = vi.fn<(request: StageTransitionRequest) => Promise<void>>(
      async () => undefined,
    );
    renderList({
      entries: [
        { path: 'src/one.ts', area: 'unstaged', status: 'modified' },
        { path: 'src/two.ts', area: 'unstaged', status: 'deleted' },
      ],
      onStageTransition,
    });

    await user.click(screen.getByRole('checkbox', { name: 'Stage all 2 unstaged files' }));
    expect(onStageTransition).toHaveBeenCalledOnce();
    expect(onStageTransition).toHaveBeenCalledWith({
      kind: 'stage',
      paths: ['src/one.ts', 'src/two.ts'],
      sourceArea: 'unstaged',
    });
  });

  it('stages tracked and untracked rows together from the combined Unstaged group', async () => {
    const user = userEvent.setup();
    const onStageTransition = vi.fn<(request: StageTransitionRequest) => Promise<void>>(
      async () => undefined,
    );
    renderList({
      repoId: 'repo-mixed-worktree',
      entries: [
        { path: 'src/modified.ts', area: 'unstaged', status: 'modified' },
        { path: 'src/new.ts', area: 'untracked', status: 'added' },
      ],
      selectedKey: 'untracked:src/new.ts',
      onStageTransition,
    });

    const unstaged = screen.getByRole('region', { name: 'Unstaged' });
    expect(
      within(unstaged).getByRole('button', { name: 'Modified src/modified.ts' }),
    ).toBeVisible();
    expect(within(unstaged).getByRole('button', { name: 'Added src/new.ts' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Untracked' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Stage all 2 unstaged files' }));
    expect(onStageTransition).toHaveBeenCalledOnce();
    expect(onStageTransition).toHaveBeenCalledWith({
      kind: 'stage',
      paths: ['src/modified.ts', 'src/new.ts'],
      sourceArea: 'untracked',
    });
  });

  it('keeps conflicts out of staging and disables Stage checkboxes while unavailable', async () => {
    const user = userEvent.setup();
    const { onStageTransition } = renderList({
      disabled: true,
      disabledReasonId: 'disabled-reason',
    });

    const staged = screen.getByRole('checkbox', { name: 'Unstage src/app.ts' });
    expect(staged).toBeDisabled();
    expect(staged).toHaveAttribute('aria-describedby', 'disabled-reason');
    await user.click(staged);
    expect(onStageTransition).not.toHaveBeenCalled();

    const conflicted = screen.getByRole('region', { name: 'Conflicted' });
    expect(within(conflicted).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      within(conflicted).queryByRole('button', { name: 'Conflicted' }),
    ).not.toBeInTheDocument();
  });

  it('does not expose file rows as a Stage or Unstage drag source', () => {
    renderList();

    const rows = document.querySelectorAll('.change-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toHaveAttribute('draggable');
  });

  it('restores focus to the same path after it moves to the destination group', async () => {
    const user = userEvent.setup();
    const props = {
      repoId: 'repo-1',
      selectedKey: 'unstaged:src/app.ts',
      disabled: false,
      fileActionsDisabled: false,
      fileOpenDisabled: false,
      fileTrashDisabled: false,
      onSelect: () => undefined,
      onStageTransition: async () => undefined,
      onFileAction: async () => undefined,
    } as const;
    const { rerender } = render(
      <DiffFileList
        {...props}
        generation={1}
        entries={[{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }]}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Stage src/app.ts' }));

    rerender(
      <DiffFileList
        {...props}
        generation={2}
        entries={[{ path: 'src/app.ts', area: 'staged', status: 'modified' }]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Unstage src/app.ts' })).toHaveFocus(),
    );
  });
});

describe('DiffFileList file actions', () => {
  it('shows the selected image preview state in the row menu', async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn<(pressed: boolean) => void>();
    renderList({
      entries: [{ path: 'image.png', area: 'unstaged', status: 'binary' }],
      selectedKey: 'unstaged:image.png',
      imagePreview: (entry) =>
        entry.path === 'image.png' ? { pressed: true, onPressedChange } : undefined,
    });

    await user.click(screen.getByRole('button', { name: 'More actions for image.png' }));
    const imagePreview = screen.getByRole('menuitemcheckbox', { name: 'Preview Image' });
    expect(imagePreview).toHaveAttribute('aria-checked', 'true');

    await user.click(imagePreview);
    expect(onPressedChange).toHaveBeenCalledWith(false);
  });

  it('selects a range and opens the selected files menu from a right-click', async () => {
    const user = userEvent.setup();
    const entries: ChangeEntry[] = [
      { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
      { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
      { path: 'src/third.ts', area: 'unstaged', status: 'modified' },
    ];
    const { onFileAction, onSelectedKeysChange } = renderList({
      entries,
      selectedKey: 'unstaged:src/first.ts',
    });
    const first = changeRow(/Modified src\/first\.ts/u);
    const second = changeRow(/Modified src\/second\.ts/u);
    const third = changeRow(/Modified src\/third\.ts/u);

    await user.click(first);
    fireEvent.click(third, { shiftKey: true });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(third).toHaveAttribute('aria-pressed', 'true');
    expect(onSelectedKeysChange).toHaveBeenLastCalledWith([
      'unstaged:src/first.ts',
      'unstaged:src/second.ts',
      'unstaged:src/third.ts',
    ]);

    fireEvent.contextMenu(second, { clientX: 120, clientY: 180 });
    expect(screen.getByRole('menu', { name: 'Actions for 3 selected files' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Discard Changes' }));
    expect(onFileAction).toHaveBeenCalledWith(entries, 'discardChanges');
  });

  it('selects every visible file with Command+A and deletes them from the context menu', async () => {
    const user = userEvent.setup();
    const entries: ChangeEntry[] = [
      { path: 'src/first.ts', area: 'untracked', status: 'added' },
      { path: 'src/second.ts', area: 'untracked', status: 'added' },
    ];
    const { onFileAction } = renderList({
      entries,
      selectedKey: 'untracked:src/first.ts',
    });
    const first = changeRow(/Added src\/first\.ts/u);
    const second = changeRow(/Added src\/second\.ts/u);

    first.focus();
    fireEvent.keyDown(first, { key: 'a', metaKey: true });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');

    fireEvent.contextMenu(first, { clientX: 80, clientY: 100 });
    expect(screen.getByRole('menu', { name: 'Actions for 2 selected files' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Discard Changes' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Delete File' }));
    expect(onFileAction).toHaveBeenCalledWith(entries, 'moveToTrash');
  });

  it('keeps the remaining file active when Command-click removes the current file', () => {
    const entries: ChangeEntry[] = [
      { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
      { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
    ];
    const { onSelect } = renderList({
      entries,
      selectedKey: 'unstaged:src/first.ts',
    });
    const first = changeRow(/Modified src\/first\.ts/u);
    const second = changeRow(/Modified src\/second\.ts/u);

    fireEvent.click(second, { metaKey: true });
    fireEvent.click(second, { metaKey: true });

    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(onSelect).toHaveBeenLastCalledWith('unstaged:src/first.ts');
  });

  it('renders a trailing menu for every row and routes actions without changing Diff selection', async () => {
    const user = userEvent.setup();
    const { onFileAction, onSelect } = renderList();
    expect(screen.getAllByRole('button', { name: /^More actions for /u })).toHaveLength(
      changes.length,
    );

    const unstaged = screen.getByRole('region', { name: 'Unstaged' });
    await user.click(within(unstaged).getByRole('button', { name: 'More actions for src/new.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show in Finder' }));

    expect(onFileAction).toHaveBeenCalledWith([changes[2]], 'revealInFinder');
    expect(onSelect).toHaveBeenCalledWith('untracked:src/new.ts');
    expect(changeRow(/new\.ts/u)).toHaveFocus();
  });

  it('moves focus to the stable row before an action disables its menu trigger', async () => {
    const user = userEvent.setup();
    render(<BusyAfterFileActionHarness />);
    await user.click(screen.getByRole('button', { name: 'More actions for src/app.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open in Default App' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More actions for src/app.ts' })).toBeDisabled(),
    );
    expect(changeRow(/app\.ts/u)).toHaveFocus();
  });

  it('disables the whole menu while busy and closes an open menu when busy starts', async () => {
    const user = userEvent.setup();
    const { rerender, onSelect, onStageTransition, onFileAction } = renderList({
      entries: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const trigger = screen.getByRole('button', { name: 'More actions for src/app.ts' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeVisible();

    rerender(
      <DiffFileList
        repoId="repo-1"
        generation={1}
        entries={[{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }]}
        selectedKey="unstaged:src/app.ts"
        disabled
        fileActionsDisabled
        fileOpenDisabled={false}
        fileTrashDisabled={false}
        onSelect={onSelect}
        onStageTransition={onStageTransition}
        onFileAction={onFileAction}
      />,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for src/app.ts' })).toBeDisabled();
  });

  it.each([
    {
      label: 'a Git operation or dirty conflict',
      entry: { path: 'src/app.ts', area: 'unstaged', status: 'modified' } as const,
      openDisabled: true,
      trashDisabled: true,
    },
    {
      label: 'a conflicted row',
      entry: { path: 'src/conflict.ts', area: 'conflicted', status: 'conflicted' } as const,
      openDisabled: false,
      trashDisabled: false,
    },
    {
      label: 'a deleted row',
      entry: { path: 'src/deleted.ts', area: 'unstaged', status: 'deleted' } as const,
      openDisabled: false,
      trashDisabled: false,
    },
  ])('keeps only Finder and Copy available for $label', async (fixture) => {
    const user = userEvent.setup();
    renderList({
      entries: [fixture.entry],
      selectedKey: `${fixture.entry.area}:${fixture.entry.path}`,
      fileOpenDisabled: fixture.openDisabled,
      fileTrashDisabled: fixture.trashDisabled,
    });
    await user.click(
      screen.getByRole('button', { name: `More actions for ${fixture.entry.path}` }),
    );

    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Changes' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete File' })).toBeDisabled();
  });

  it('closes the open menu when repository generation or identity changes', async () => {
    const user = userEvent.setup();
    const props = {
      repoId: 'repo-1',
      entries: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }] as ChangeEntry[],
      selectedKey: 'unstaged:src/app.ts',
      disabled: false,
      fileActionsDisabled: false,
      fileOpenDisabled: false,
      fileTrashDisabled: false,
      onSelect: () => undefined,
      onStageTransition: async () => undefined,
      onFileAction: async () => undefined,
    } as const;
    const { rerender } = render(<DiffFileList {...props} generation={1} />);
    await user.click(screen.getByRole('button', { name: 'More actions for src/app.ts' }));
    expect(screen.getByRole('menu')).toBeVisible();

    rerender(<DiffFileList {...props} generation={2} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More actions for src/app.ts' }));
    expect(screen.getByRole('menu')).toBeVisible();
    rerender(<DiffFileList {...props} repoId="repo-2" generation={2} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves focus to the next row when a trashed untracked file disappears', async () => {
    const user = userEvent.setup();
    const onFileAction = vi.fn<(entries: ChangeEntry[], action: FileActionKind) => Promise<void>>(
      async () => undefined,
    );
    const props = {
      repoId: 'repo-1',
      selectedKey: 'untracked:src/first.ts',
      disabled: false,
      fileActionsDisabled: false,
      fileOpenDisabled: false,
      fileTrashDisabled: false,
      onSelect: () => undefined,
      onStageTransition: async () => undefined,
      onFileAction,
    } as const;
    const { rerender } = render(
      <DiffFileList
        {...props}
        generation={1}
        entries={[
          { path: 'src/first.ts', area: 'untracked', status: 'added' },
          { path: 'src/second.ts', area: 'untracked', status: 'added' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for src/first.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete File' }));

    rerender(
      <DiffFileList
        {...props}
        generation={2}
        entries={[{ path: 'src/second.ts', area: 'untracked', status: 'added' }]}
      />,
    );
    await waitFor(() => expect(changeRow(/second\.ts/u)).toHaveFocus());
  });

  it('restores focus to the same tracked path when Trash moves it to another area', async () => {
    const user = userEvent.setup();
    const props = {
      repoId: 'repo-1',
      selectedKey: 'unstaged:src/app.ts',
      disabled: false,
      fileActionsDisabled: false,
      fileOpenDisabled: false,
      fileTrashDisabled: false,
      onSelect: () => undefined,
      onStageTransition: async () => undefined,
      onFileAction: async () => undefined,
    } as const;
    const { rerender } = render(
      <DiffFileList
        {...props}
        generation={1}
        entries={[{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for src/app.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete File' }));
    expect(changeRow(/app\.ts/u)).toHaveFocus();

    rerender(
      <DiffFileList
        {...props}
        generation={2}
        entries={[{ path: 'src/app.ts', area: 'staged', status: 'deleted' }]}
      />,
    );
    await waitFor(() => expect(changeRow(/app\.ts/u)).toHaveFocus());
  });

  it('moves focus to a group heading when the last trashed row disappears', async () => {
    const user = userEvent.setup();
    const props = {
      repoId: 'repo-1',
      selectedKey: 'untracked:src/only.ts',
      disabled: false,
      fileActionsDisabled: false,
      fileOpenDisabled: false,
      fileTrashDisabled: false,
      onSelect: () => undefined,
      onStageTransition: async () => undefined,
      onFileAction: async () => undefined,
    } as const;
    const { rerender } = render(
      <DiffFileList
        {...props}
        generation={1}
        entries={[{ path: 'src/only.ts', area: 'untracked', status: 'added' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for src/only.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete File' }));

    rerender(<DiffFileList {...props} generation={2} entries={[]} />);
    expect(screen.getByRole('region', { name: 'Staged' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Unstaged' })).toBeVisible();
    await waitFor(() => expect(screen.getByText('Unstaged')).toHaveFocus());
  });
});

describe('DiffFileList Stage display', () => {
  it('shows one Diff group without staging controls when Stage display is hidden', () => {
    const entries: ChangeEntry[] = [
      { path: 'src/staged.ts', area: 'staged', status: 'modified' },
      { path: 'src/unstaged.ts', area: 'unstaged', status: 'modified' },
    ];
    const { onStageTransition } = renderList({
      entries,
      selectedKey: 'unstaged:src/unstaged.ts',
      splitStageView: false,
    });

    expect(screen.queryByRole('region', { name: 'Staged' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unstaged' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Diff' })).toBeVisible();
    expect(
      document.querySelector('.change-group-combined .change-group-header'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.querySelector('.change-groups')).toHaveClass('is-stage-hidden');
    expect(onStageTransition).not.toHaveBeenCalled();
  });
});
