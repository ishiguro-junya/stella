import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UnsavedChangesHandle } from '../../domain/unsavedChanges';
import { conflictDocument } from '../../test/fixtures';
import { markWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import { ConflictSurface, type ConflictSurfaceActions } from './ConflictSurface';

vi.mock('../diff/DiffSurface', () => ({ DiffSurface: () => <div>Diff</div> }));
vi.mock('./ConflictResultEditor', () => ({
  ConflictResultEditor: ({
    onChange,
    onSave,
    onMarkResolved,
  }: {
    onChange: (value: string) => void;
    onSave: () => void;
    onMarkResolved: () => void;
  }) => (
    <>
      <textarea
        aria-label="Result editor"
        data-testid="editor-shortcut-target"
        readOnly
        onKeyDown={(event) => {
          if (!event.metaKey) return;
          if (event.key.toLowerCase() === 's') onSave();
          if (event.shiftKey && event.key === 'Enter') onMarkResolved();
        }}
      />
      <button type="button" onClick={() => onChange('local draft\n')}>
        Edit Result
      </button>
      {(['A', 'B', 'C'] as const).map((value) => (
        <button key={value} type="button" onClick={() => onChange(`manual ${value}\n`)}>
          Edit {value}
        </button>
      ))}
    </>
  ),
}));

function actions(): ConflictSurfaceActions {
  return {
    choose: vi.fn<ConflictSurfaceActions['choose']>(async (input) => input.conflict),
    save: vi.fn<ConflictSurfaceActions['save']>(async (input) => input.conflict),
    markResolved: vi.fn<ConflictSurfaceActions['markResolved']>(async () => undefined),
    reload: vi.fn<ConflictSurfaceActions['reload']>(async (conflict) => conflict),
    materialize: vi.fn<ConflictSurfaceActions['materialize']>(async () => undefined),
    openExternal: vi.fn<ConflictSurfaceActions['openExternal']>(async () => undefined),
  };
}

function noop(): void {}

type RuntimeOperation = 'choice' | 'save' | 'mark' | 'reload' | 'copy' | 'open' | 'materialize';

const EXPECTED_RUNTIME_ERRORS: Record<RuntimeOperation, { title: string; fallback: string }> = {
  choice: {
    title: 'Could not apply conflict choice',
    fallback: 'Could not apply the choice.',
  },
  save: {
    title: 'Could not save conflict result',
    fallback: 'Could not save the result.',
  },
  mark: {
    title: 'Could not mark conflict resolved',
    fallback: 'Could not mark the file as resolved.',
  },
  reload: {
    title: 'Could not reload conflict',
    fallback: 'Could not reload external changes.',
  },
  copy: {
    title: 'Could not copy conflict result',
    fallback: 'Could not copy the result to the clipboard.',
  },
  open: {
    title: 'Could not open external editor',
    fallback: 'Could not open the external editor.',
  },
  materialize: {
    title: 'Could not apply whole-file choice',
    fallback: 'Could not apply the whole-file choice.',
  },
};

function externalOnlyDocument(): ReturnType<typeof conflictDocument> {
  return conflictDocument({
    kind: 'binary',
    blocks: [],
    capabilities: {
      inAppEdit: false,
      performanceView: false,
      chooseCurrent: false,
      chooseIncoming: false,
      chooseBoth: false,
      delete: false,
      externalEditor: true,
    },
  });
}

function wholeFileDocument(): ReturnType<typeof conflictDocument> {
  return conflictDocument({
    kind: 'addAdd',
    capabilities: {
      inAppEdit: false,
      performanceView: false,
      chooseCurrent: true,
      chooseIncoming: true,
      chooseBoth: false,
      delete: false,
      externalEditor: true,
    },
  });
}

describe('ConflictSurface', () => {
  it('exposes a relocation draft with the original conflict hash', async () => {
    const user = userEvent.setup();
    const document = conflictDocument({ contentHash: 'conflict-base-hash' });
    const leaveHandle = { current: null as UnsavedChangesHandle | null };

    render(
      <ConflictSurface
        document={document}
        actions={actions()}
        onLeaveHandleChange={(handle) => {
          leaveHandle.current = handle;
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));

    expect(leaveHandle.current?.relocationDraft?.()).toEqual({
      kind: 'conflict',
      path: document.path,
      baseHash: 'conflict-base-hash',
      text: 'local draft\n',
    });
  });

  it.each<RuntimeOperation>(['choice', 'save', 'mark', 'reload', 'copy', 'open', 'materialize'])(
    'forwards %s runtime errors to the shared dialog handler',
    async (operation) => {
      const user = userEvent.setup();
      const handlers = actions();
      const failure = new Error(`${operation} backend failure`);
      const onError = vi.fn<ShowWorkspaceError>();
      let document = conflictDocument();
      let externalStateChanged = false;
      let restoreClipboard = noop;

      switch (operation) {
        case 'choice':
          vi.mocked(handlers.choose).mockRejectedValue(failure);
          break;
        case 'save':
          vi.mocked(handlers.save).mockRejectedValue(failure);
          break;
        case 'mark': {
          const blocks = structuredClone(document.blocks);
          for (const block of blocks) block.state = 'current';
          document = conflictDocument({ blocks });
          vi.mocked(handlers.markResolved).mockRejectedValue(failure);
          break;
        }
        case 'reload':
          document = externalOnlyDocument();
          vi.mocked(handlers.reload).mockRejectedValue(failure);
          break;
        case 'copy':
          externalStateChanged = true;
          {
            const clipboardSpy = vi
              .spyOn(navigator.clipboard, 'writeText')
              .mockRejectedValue(failure);
            restoreClipboard = () => clipboardSpy.mockRestore();
          }
          break;
        case 'open':
          document = externalOnlyDocument();
          vi.mocked(handlers.openExternal).mockRejectedValue(failure);
          break;
        case 'materialize':
          document = wholeFileDocument();
          vi.mocked(handlers.materialize).mockRejectedValue(failure);
          break;
      }

      render(
        <ConflictSurface
          document={document}
          actions={handlers}
          externalStateChanged={externalStateChanged}
          onError={onError}
        />,
      );

      switch (operation) {
        case 'choice':
          await user.click(screen.getByRole('button', { name: 'Apply current to conflict 1' }));
          break;
        case 'save':
          await user.click(screen.getByRole('button', { name: 'Edit Result' }));
          await user.click(screen.getByRole('button', { name: /Save/u }));
          break;
        case 'mark':
          await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
          break;
        case 'reload':
          await user.click(screen.getByRole('button', { name: 'Reload Git Status' }));
          break;
        case 'copy':
          await user.click(screen.getByRole('button', { name: 'Copy Result' }));
          break;
        case 'open':
          await user.click(screen.getByRole('button', { name: 'Open in External Editor' }));
          break;
        case 'materialize':
          await user.click(screen.getByRole('button', { name: 'Current' }));
          break;
      }

      const expected = EXPECTED_RUNTIME_ERRORS[operation];
      await vi.waitFor(() =>
        expect(onError).toHaveBeenCalledWith(expected.title, failure, expected.fallback),
      );
      expect(screen.queryByText(failure.message)).not.toBeInTheDocument();
      restoreClipboard();
    },
  );

  it('keeps inline runtime errors when no shared handler is supplied', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    vi.mocked(handlers.choose).mockRejectedValue(new Error('Choice backend failed'));
    render(<ConflictSurface document={conflictDocument()} actions={handlers} />);

    await user.click(screen.getByRole('button', { name: 'Apply current to conflict 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not apply the choice.');
  });

  it('does not queue a second dialog for a materialize error already handled by App', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const failure = markWorkspaceErrorHandled(
      new Error('Materialize backend failure'),
      'Could not apply the whole-file choice.',
    );
    const onError = vi.fn<ShowWorkspaceError>();
    vi.mocked(handlers.materialize).mockRejectedValue(failure);

    render(<ConflictSurface document={wholeFileDocument()} actions={handlers} onError={onError} />);

    await user.click(screen.getByRole('button', { name: 'Current' }));
    await vi.waitFor(() => expect(handlers.materialize).toHaveBeenCalledOnce());
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText(failure.message)).not.toBeInTheDocument();
  });

  it('handles editor Save and Mark shortcuts exactly once', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const resolvedBlocks = structuredClone(conflictDocument().blocks);
    for (const block of resolvedBlocks) block.state = 'current';
    const resolvedDocument = conflictDocument({
      blocks: resolvedBlocks,
    });
    const { rerender } = render(<ConflictSurface document={resolvedDocument} actions={handlers} />);
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));
    fireEvent.keyDown(screen.getByTestId('editor-shortcut-target'), {
      key: 's',
      metaKey: true,
    });
    await vi.waitFor(() => expect(handlers.save).toHaveBeenCalledTimes(1));

    rerender(<ConflictSurface document={resolvedDocument} actions={handlers} />);
    fireEvent.keyDown(screen.getByTestId('editor-shortcut-target'), {
      key: 'Enter',
      metaKey: true,
      shiftKey: true,
    });
    await vi.waitFor(() => expect(handlers.markResolved).toHaveBeenCalledTimes(1));
  });

  it('switches the Current and Incoming tabs with the ARIA tab keyboard pattern', async () => {
    const user = userEvent.setup();
    render(<ConflictSurface document={conflictDocument()} actions={actions()} />);
    const current = screen.getByRole('tab', { name: 'Current' });
    const incoming = screen.getByRole('tab', { name: 'Incoming' });

    fireEvent.click(incoming);
    expect(incoming).toHaveFocus();

    current.focus();
    await user.keyboard('{ArrowRight}');
    expect(incoming).toHaveFocus();
    expect(incoming).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(current).toHaveFocus();
    expect(current).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}{ArrowLeft}');
    expect(current).toHaveFocus();
    expect(current).toHaveAttribute('aria-selected', 'true');
  });

  it('shows one fixed resolution group for the selected conflict block', async () => {
    const user = userEvent.setup();
    const firstBlock = conflictDocument().blocks[0];
    if (!firstBlock) throw new Error('Expected conflict fixture block');
    const secondBlock = {
      ...structuredClone(firstBlock),
      id: 'block-2',
      rangeUtf16: { from: 13, to: 25 },
    };
    render(
      <ConflictSurface
        document={conflictDocument({ blocks: [firstBlock, secondBlock] })}
        actions={actions()}
      />,
    );

    const blockList = screen.getByRole('list', { name: 'Conflict blocks' });
    expect(within(blockList).getAllByRole('button')).toHaveLength(2);
    expect(within(blockList).queryByRole('group')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('group', { name: /Resolution options for conflict \d+/u }),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Apply current to conflict 1' })).toHaveTextContent(
      'Current',
    );
    expect(
      screen.queryByRole('button', { name: 'Apply current to conflict 2' }),
    ).not.toBeInTheDocument();

    await user.click(within(blockList).getByRole('button', { name: /Conflict 2\/2/u }));

    expect(
      screen.getByRole('group', { name: 'Resolution options for conflict 2' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply current to conflict 2' })).toHaveTextContent(
      'Current',
    );
    expect(
      screen.queryByRole('button', { name: 'Apply current to conflict 1' }),
    ).not.toBeInTheDocument();
  });

  it('offers only supported whole-file choices and sends them through materialize', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const document = conflictDocument({
      kind: 'addAdd',
      capabilities: {
        inAppEdit: false,
        performanceView: false,
        chooseCurrent: true,
        chooseIncoming: true,
        chooseBoth: false,
        delete: false,
        externalEditor: true,
      },
    });
    render(<ConflictSurface document={document} actions={handlers} />);

    await user.click(screen.getByRole('button', { name: 'Current' }));
    expect(handlers.materialize).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'current',
    );
    expect(screen.queryByRole('button', { name: 'Both' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in External Editor' })).toBeEnabled();
  });

  it('can mark a clean external-only conflict as resolved after Git state is reloaded', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    render(
      <ConflictSurface
        document={conflictDocument({
          kind: 'binary',
          blocks: [],
          capabilities: {
            inAppEdit: false,
            performanceView: false,
            chooseCurrent: false,
            chooseIncoming: false,
            chooseBoth: false,
            delete: false,
            externalEditor: true,
          },
        })}
        actions={handlers}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(handlers.markResolved).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', kind: 'binary' }),
    );
  });

  it('keeps a dirty draft when polling returns a new same-path session', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const initial = conflictDocument();
    const { rerender } = render(<ConflictSurface document={initial} actions={handlers} />);
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));
    expect(screen.getByRole('button', { name: /Save/u })).toBeEnabled();

    rerender(
      <ConflictSurface
        document={conflictDocument({ sessionId: 'session-2', contentHash: 'hash-2' })}
        actions={handlers}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('External changes detected');
    expect(screen.getByRole('button', { name: 'Copy Result' })).toHaveTextContent('Copy');
  });

  it('keeps a dirty draft copyable when the conflict disappears from an external snapshot', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const { rerender } = render(
      <ConflictSurface document={conflictDocument()} actions={handlers} />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));

    rerender(
      <ConflictSurface document={conflictDocument()} actions={handlers} externalStateChanged />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('External changes detected');
    expect(screen.getByRole('button', { name: 'Copy Result' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Save/u })).toBeDisabled();
  });

  it('adopts a replacement session without reporting an external change when content is unchanged', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const initial = conflictDocument();
    const { rerender } = render(<ConflictSurface document={initial} actions={handlers} />);
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));

    rerender(
      <ConflictSurface
        document={conflictDocument({ sessionId: 'session-2' })}
        actions={handlers}
      />,
    );
    expect(screen.queryByText('External changes detected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/u })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Save/u }));
    expect(handlers.save).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: expect.objectContaining({ sessionId: 'session-2' }) }),
    );
  });

  it('sends the snapshot base revision after multiple manual edits and undo across a Choice', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    let responseIndex = 0;
    vi.mocked(handlers.choose).mockImplementation(async (input) => {
      responseIndex += 1;
      return conflictDocument({
        ...input.conflict,
        documentRevision: `choice-revision-${responseIndex}`,
        result: { text: `${input.choice} result\n`, lineEnding: 'lf' },
        blocks: input.conflict.blocks.map((block) => ({
          ...block,
          state: input.choice === 'delete' ? 'manual' : input.choice,
        })),
      });
    });
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1_000;
      return now;
    });

    render(<ConflictSurface document={conflictDocument()} actions={handlers} />);
    await user.click(screen.getByRole('button', { name: 'Edit A' }));
    await user.click(screen.getByRole('button', { name: 'Edit B' }));
    await user.click(screen.getByRole('button', { name: 'Edit C' }));
    await user.click(screen.getByRole('button', { name: 'Apply current to conflict 1' }));
    await vi.waitFor(() => expect(handlers.choose).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Apply incoming to conflict 1' }));
    await vi.waitFor(() => expect(handlers.choose).toHaveBeenCalledTimes(2));

    expect(handlers.choose).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ draftText: 'manual C\n', baseDocumentRevision: 'revision-1' }),
    );
    expect(handlers.choose).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ draftText: 'manual B\n', baseDocumentRevision: 'revision-1' }),
    );
    nowSpy.mockRestore();
  });

  it('clears Undo history after Save replaces the backend session', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    vi.mocked(handlers.save).mockImplementation(async (input) =>
      conflictDocument({
        ...input.conflict,
        sessionId: 'session-after-save',
        documentRevision: 'revision-after-save',
        result: { ...input.conflict.result, text: input.draftText },
      }),
    );
    render(<ConflictSurface document={conflictDocument()} actions={handlers} />);

    await user.click(screen.getByRole('button', { name: 'Edit A' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Save/u }));
    await vi.waitFor(() => expect(handlers.save).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
