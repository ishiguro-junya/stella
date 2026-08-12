import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UnsavedChangesHandle } from '../../domain/unsavedChanges';
import type { FileDocument } from '../../domain/workspace';
import { FileEditorSurface } from './FileEditorSurface';

interface MockTextEditorProps {
  value: string;
  ariaLabel: string;
  readOnly?: boolean;
  initialScrollLine?: number;
  onChange: (value: string) => void;
  onSave: () => void;
}

vi.mock('../../ui/TextEditor', () => ({
  TextEditor: (props: MockTextEditorProps) => (
    <textarea
      aria-label={props.ariaLabel}
      value={props.value}
      readOnly={props.readOnly}
      data-initial-scroll-line={props.initialScrollLine}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.metaKey && event.key === 's') props.onSave();
      }}
    />
  ),
}));

function fileDocument(overrides: Partial<FileDocument> = {}): FileDocument {
  return {
    repoId: 'repo-1',
    path: 'src/app.ts',
    text: 'const value = 1;\n',
    lineEnding: 'lf',
    hasUtf8Bom: false,
    contentHash: 'hash-1',
    generation: 1,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<React.ComponentProps<typeof FileEditorSurface>> = {}) {
  const document = fileDocument();
  const onSave = vi.fn<React.ComponentProps<typeof FileEditorSurface>['onSave']>(async () =>
    fileDocument({ text: 'const value = 2;\n', contentHash: 'hash-2', generation: 2 }),
  );
  const props: React.ComponentProps<typeof FileEditorSurface> = {
    document,
    entry: { path: document.path, area: 'unstaged', status: 'modified' },
    busy: false,
    onDisplay: vi.fn<() => void>(),
    onSave,
    onReload: async () => document,
    onSaved: vi.fn<(document: FileDocument | undefined) => void>(),
    ...overrides,
  };
  return { ...render(<FileEditorSurface {...props} />), props, onSave };
}

describe('FileEditorSurface', () => {
  it('passes the requested initial line to the editor before it is mounted', () => {
    renderEditor({ initialScrollLine: 48 });

    expect(screen.getByRole('textbox', { name: 'Edit src/app.ts' })).toHaveAttribute(
      'data-initial-scroll-line',
      '48',
    );
  });

  it('shows icon-only mode tabs and saves through Command-S with the original hash', async () => {
    const user = userEvent.setup();
    const { props, onSave } = renderEditor();
    const editor = screen.getByRole('textbox', { name: 'Edit src/app.ts' });
    const displayTab = screen.getByRole('tab', { name: 'Display' });
    const editTab = screen.getByRole('tab', { name: 'Edit' });

    expect(displayTab).toHaveAttribute('aria-selected', 'false');
    expect(displayTab).toHaveAttribute('title', 'Display');
    expect(editTab).toHaveAttribute('aria-selected', 'true');
    expect(editTab).toHaveAttribute('title', 'Edit');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.clear(editor);
    await user.type(editor, 'const value = 2;{enter}');
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Unsaved' })).toBeVisible();

    fireEvent.keyDown(editor, { key: 's', metaKey: true });
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        path: 'src/app.ts',
        text: 'const value = 2;\n',
        expectedContentHash: 'hash-1',
      }),
    );
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ contentHash: 'hash-2' }));
    expect(screen.queryByRole('status', { name: 'Unsaved' })).not.toBeInTheDocument();
  });

  it('returns to the Diff immediately when the editor is clean', async () => {
    const user = userEvent.setup();
    const { props, onSave } = renderEditor();

    await user.click(screen.getByRole('tab', { name: 'Display' }));

    expect(props.onDisplay).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('confirms an unsaved switch and supports cancelling or displaying without saving', async () => {
    const user = userEvent.setup();
    const { props, onSave } = renderEditor();
    const editor = screen.getByRole('textbox', { name: 'Edit src/app.ts' });
    await user.clear(editor);
    await user.type(editor, 'draft');

    await user.click(screen.getByRole('tab', { name: 'Display' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    expect(dialog).toHaveTextContent('Save or discard the edits before returning to the Diff.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onDisplay).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Display' }));
    dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    await user.click(within(dialog).getByRole('button', { name: 'Display Without Saving' }));

    expect(props.onDisplay).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves an unsaved draft before switching to the Diff', async () => {
    const user = userEvent.setup();
    const { props, onSave } = renderEditor();
    const editor = screen.getByRole('textbox', { name: 'Edit src/app.ts' });
    fireEvent.change(editor, { target: { value: 'changed\n' } });

    await user.click(screen.getByRole('tab', { name: 'Display' }));
    await user.click(screen.getByRole('button', { name: 'Save and Display' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(props.onDisplay).toHaveBeenCalledOnce();
  });

  it('keeps the draft in the editor when Save and Display fails', async () => {
    const user = userEvent.setup();
    const document = fileDocument();
    const onSave = vi.fn<React.ComponentProps<typeof FileEditorSurface>['onSave']>(async () => {
      throw new Error('disk full');
    });
    const { props } = renderEditor({ onSave, onReload: async () => document });
    const editor = screen.getByRole('textbox', { name: 'Edit src/app.ts' });
    fireEvent.change(editor, { target: { value: 'draft\n' } });

    await user.click(screen.getByRole('tab', { name: 'Display' }));
    await user.click(screen.getByRole('button', { name: 'Save and Display' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(editor).toHaveValue('draft\n');
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    expect(props.onDisplay).not.toHaveBeenCalled();
  });

  it('exposes the same explicit save through Command-S and the unsaved leave handle', async () => {
    let leaveHandle: UnsavedChangesHandle | null = null;
    const onLeaveHandleChange = vi.fn<(handle: UnsavedChangesHandle | null) => void>((handle) => {
      leaveHandle = handle;
    });
    const { onSave } = renderEditor({ onLeaveHandleChange });
    const editor = screen.getByRole('textbox', { name: 'Edit src/app.ts' });
    fireEvent.change(editor, { target: { value: 'changed\n' } });

    fireEvent.keyDown(editor, { key: 's', metaKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    fireEvent.change(editor, { target: { value: 'changed again\n' } });
    await act(async () => {
      expect(await leaveHandle?.save()).toBe(true);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed draft and blocks saving after an external change', async () => {
    const user = userEvent.setup();
    const failure = new Error('disk full');
    const onSave = vi.fn<React.ComponentProps<typeof FileEditorSurface>['onSave']>(async () => {
      throw failure;
    });
    const base = fileDocument();
    renderEditor({
      entry: { path: base.path, area: 'staged', status: 'modified' },
      onSave,
      onReload: async () => fileDocument({ contentHash: 'external-hash', generation: 2 }),
    });
    const editor = screen.getByRole('textbox', { name: 'Edit src/app.ts' });
    await user.clear(editor);
    await user.type(editor, 'draft');
    fireEvent.keyDown(editor, { key: 's', metaKey: true });

    expect(await screen.findByText('This file changed outside the editor')).toBeVisible();
    expect(editor).toHaveValue('draft');
    expect(editor).toHaveAttribute('readonly');
    expect(
      screen.getByText('Saving creates an Unstaged change. The index is not changed.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy Draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Display' }));
    expect(screen.getByRole('button', { name: 'Save and Display' })).toBeDisabled();
  });
});
