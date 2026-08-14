import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAdapterError, type WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import type { ConflictDocument, QueryResult, WorkspaceAction } from '../../domain/workspace';
import { conflictDocument, repoSnapshot } from '../../test/fixtures';
import { ChangesView } from './ChangesView';

interface MockConflictSurfaceProps {
  document: ConflictDocument;
  lineWrapping?: boolean;
  wrapColumn?: number;
  externalStateChanged?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onLeaveHandleChange?: (handle: { save: () => Promise<boolean> } | null) => void;
}

interface MockDiffSurfaceProps {
  lineWrapping?: boolean;
  wrapColumn?: number;
  selectable?: boolean;
  collapsed?: boolean;
  showFileHeaders?: boolean;
  source?: { cacheKey?: string; path?: string };
  initialSelection?: {
    side: 'additions' | 'deletions';
    startLine: number;
    endLine: number;
    itemId?: string;
    patchActionable: boolean;
  };
  hunkAction?: {
    kind: 'stage' | 'unstage';
    editDisabled?: boolean;
    onEdit?: (selection: { hunkIndex: number; startLine: number }) => void;
    disabled?: boolean;
    onAction?: (selection: { hunkIndex: number }) => void;
    discardDisabled?: boolean;
    onDiscard?: (selection: { hunkIndex: number }) => void;
  };
  onSelectionChange?: (selection: {
    side: 'additions' | 'deletions';
    startLine: number;
    endLine: number;
    patchActionable: boolean;
  }) => void;
  onSelectionContextMenu?: (
    selection: { side: 'additions'; startLine: number; endLine: number },
    point: { x: number; y: number },
    text: string,
  ) => void;
  onSelectionCopy?: (text: string) => void;
}

interface MockFileEditorSurfaceProps {
  document: { path: string; text: string };
  lineWrapping?: boolean;
  wrapColumn?: number;
  initialScrollLine?: number;
  headerActions?: ReactNode;
  onDisplay: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onLeaveHandleChange?: (handle: { save: () => Promise<boolean> } | null) => void;
}

const { conflictSaveMock, conflictSurfaceMock, diffSurfaceMock } = vi.hoisted(() => ({
  conflictSaveMock: vi.fn<() => void>(),
  conflictSurfaceMock: vi.fn<(props: MockConflictSurfaceProps) => void>(),
  diffSurfaceMock: vi.fn<(props: MockDiffSurfaceProps) => void>(),
}));

vi.mock('../diff/DiffSurface', () => ({
  DiffSurface: (props: MockDiffSurfaceProps) => {
    diffSurfaceMock(props);
    return (
      <div>
        <span>Diff</span>
        <button
          type="button"
          onClick={() =>
            props.onSelectionChange?.({
              side: 'additions',
              startLine: 2,
              endLine: 3,
              patchActionable: true,
            })
          }
        >
          Select diff lines
        </button>
        <button
          type="button"
          onClick={() =>
            props.onSelectionChange?.({
              side: 'additions',
              startLine: 4,
              endLine: 4,
              patchActionable: false,
            })
          }
        >
          Select unchanged line
        </button>
        <button
          type="button"
          onClick={() =>
            props.onSelectionChange?.({
              side: 'deletions',
              startLine: 3,
              endLine: 3,
              patchActionable: true,
            })
          }
        >
          Select deleted line
        </button>
        <button
          type="button"
          onClick={() =>
            props.onSelectionContextMenu?.(
              { side: 'additions', startLine: 2, endLine: 3 },
              { x: 120, y: 160 },
              'second line\nthird line',
            )
          }
        >
          Open selection menu
        </button>
        <button type="button" onClick={() => props.onSelectionCopy?.('second line\nthird line')}>
          Copy selection shortcut
        </button>
        {props.hunkAction ? (
          <>
            {props.hunkAction.onEdit ? (
              <button
                type="button"
                disabled={props.hunkAction.editDisabled}
                onClick={() => props.hunkAction?.onEdit?.({ hunkIndex: 1, startLine: 12 })}
              >
                Edit mock hunk
              </button>
            ) : null}
            {props.hunkAction.onAction ? (
              <button
                type="button"
                disabled={props.hunkAction.disabled}
                onClick={() => props.hunkAction?.onAction?.({ hunkIndex: 1 })}
              >
                {props.hunkAction.kind === 'stage' ? 'Stage mock hunk' : 'Unstage mock hunk'}
              </button>
            ) : null}
            {props.hunkAction.onDiscard ? (
              <button
                type="button"
                disabled={props.hunkAction.discardDisabled}
                onClick={() => props.hunkAction?.onDiscard?.({ hunkIndex: 1 })}
              >
                Discard mock hunk
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    );
  },
}));
vi.mock('../conflict/ConflictSurface', () => ({
  ConflictSurface: (props: MockConflictSurfaceProps) => {
    conflictSurfaceMock(props);
    return (
      <div>
        <span>Conflict editor</span>
        <span data-testid="conflict-version">
          {props.document.sessionId}:{props.document.contentHash}
        </span>
        {props.externalStateChanged ? <span>External conflict state changed</span> : null}
        <button
          type="button"
          onClick={() => {
            props.onDirtyChange?.(true);
            props.onLeaveHandleChange?.({
              save: async () => {
                conflictSaveMock();
                props.onDirtyChange?.(false);
                return true;
              },
            });
          }}
        >
          Edit Result
        </button>
      </div>
    );
  },
}));
vi.mock('./FileEditorSurface', () => ({
  FileEditorSurface: (props: MockFileEditorSurfaceProps) => (
    <main
      data-initial-scroll-line={props.initialScrollLine}
      data-line-wrapping={props.lineWrapping}
      data-wrap-column={props.wrapColumn}
    >
      <header>
        <button type="button" onClick={props.onDisplay}>
          Display
        </button>
        {props.headerActions}
      </header>
      <textarea aria-label={`Edit ${props.document.path}`} value={props.document.text} readOnly />
      <button
        type="button"
        onClick={() => {
          props.onDirtyChange?.(true);
          props.onLeaveHandleChange?.({
            save: async () => {
              props.onDirtyChange?.(false);
              return true;
            },
          });
        }}
      >
        Edit File Draft
      </button>
    </main>
  ),
}));

function adapterWithDiff(
  options: { patch?: string; tooLarge?: boolean; truncated?: boolean } = {},
): WorkspaceAdapter {
  let revision = 0;
  return {
    attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
    query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind !== 'diff') return { kind: 'activity' as const, entries: [] };
      revision += 1;
      return {
        kind: 'diff' as const,
        diff: {
          diffId: `revision-${revision}`,
          repoId: request.repoId,
          path: request.path,
          area: request.area,
          generation: revision,
          patch: options.patch ?? `diff --git a/${request.path} b/${request.path}\n`,
          binary: false,
          tooLarge: options.tooLarge ?? Boolean(options.truncated),
          ...(options.truncated === undefined ? {} : { truncated: options.truncated }),
        },
      };
    }),
    preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
      throw new Error('unused');
    }),
    execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
      throw new Error('unused');
    }),
    cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
    subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
  };
}

function adapterWithConflict(): WorkspaceAdapter {
  const adapter = adapterWithDiff();
  const queryDiff = adapter.query;
  return {
    ...adapter,
    query: vi.fn<WorkspaceAdapter['query']>(async (request) =>
      request.kind === 'conflict'
        ? {
            kind: 'conflict' as const,
            document: conflictDocument({ repoId: request.repoId, path: request.path }),
          }
        : await queryDiff(request),
    ),
  };
}

function adapterWithFile(
  text = 'const value = 1;\n',
  diffOptions: { patch?: string; tooLarge?: boolean; truncated?: boolean } = {},
): WorkspaceAdapter {
  const adapter = adapterWithDiff(diffOptions);
  const queryDiff = adapter.query;
  return {
    ...adapter,
    query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'fileContents') {
        return {
          kind: 'fileContents' as const,
          document: {
            repoId: request.repoId,
            path: request.path,
            text,
            lineEnding: 'lf' as const,
            hasUtf8Bom: false,
            contentHash: 'file-hash-1',
            generation: 1,
          },
        };
      }
      if (request.kind === 'snapshot') {
        return {
          kind: 'snapshot' as const,
          snapshot: repoSnapshot({
            repoId: request.repoId,
            changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
          }),
        };
      }
      return await queryDiff(request);
    }),
  };
}

beforeEach(() => {
  conflictSaveMock.mockClear();
  conflictSurfaceMock.mockClear();
  diffSurfaceMock.mockClear();
});

function changeRow(name: RegExp): HTMLButtonElement {
  const row = screen
    .getAllByRole('button', { name })
    .find((candidate): candidate is HTMLButtonElement =>
      candidate.classList.contains('change-row'),
    );
  if (!row) throw new Error(`Expected change row matching ${name.source}`);
  return row;
}

async function openCommit(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const actions = screen.getByRole('group', { name: 'Actions' });
  const trigger = within(actions).getByRole('button', { name: 'Commit' });
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('dialog', { name: 'Commit' })).toBeVisible();
  return trigger;
}

describe('ChangesView diff lifecycle', () => {
  it('forwards diff query failures to the shared error dialog handler', async () => {
    const failure = new Error('Diff query failed.');
    const adapter = adapterWithDiff();
    adapter.query = vi.fn<WorkspaceAdapter['query']>(async () => {
      throw failure;
    });
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapter}
        onError={onError}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        'Could not load changes',
        failure,
        'Could not load changes.',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders icon-only repository actions in the left pane footer and opens Commit as a dialog', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({ changes: [] })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Changes' });
    const changedFiles = within(sidebar).getByRole('region', { name: 'Changed files' });
    const actions = screen.getByRole('group', { name: 'Actions' });
    const footer = within(sidebar).getByRole('contentinfo');
    expect(changedFiles.nextElementSibling).toBe(footer);
    expect(footer).toContainElement(actions);
    expect(within(footer).getByText('0 files')).toBeVisible();
    expect(within(footer).getByText('+0')).toBeVisible();
    expect(within(footer).getByText('−0')).toBeVisible();
    expect(within(sidebar).queryByRole('tablist')).not.toBeInTheDocument();
    expect(changedFiles).toBeVisible();
    const trigger = within(actions).getByRole('button', { name: 'Commit' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Commit' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Message' })).toHaveFocus();
    expect(within(dialog).getByText('Stage changes to commit.')).toHaveClass('sr-only');
    expect(screen.getByRole('separator', { name: 'Changes list width' })).toBeVisible();
    expect(screen.getByRole('separator', { name: 'Changes list width' })).toHaveAttribute(
      'aria-valuemin',
      '360',
    );
    expect(screen.getByRole('separator', { name: 'Changes list width' })).toHaveAttribute(
      'aria-valuenow',
      '360',
    );
    expect(screen.queryByRole('separator', { name: 'Commit pane width' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('No selection')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a change')).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Diff' })).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('keeps the change summary below every file list format and shows the selection count', () => {
    const changes = [
      {
        path: 'src/first.ts',
        area: 'unstaged' as const,
        status: 'modified' as const,
      },
      {
        path: 'src/second.ts',
        area: 'unstaged' as const,
        status: 'modified' as const,
      },
    ];
    const props = {
      repo: repoSnapshot({ changes, additions: 13, deletions: 5 }),
      adapter: adapterWithDiff(),
      onAction: async () => undefined,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    };
    const view = render(<ChangesView {...props} changeListDisplay="tree" />);
    const sidebar = screen.getByRole('complementary', { name: 'Changes' });
    const footer = within(sidebar).getByRole('contentinfo');
    expect(within(footer).getByText('2 files')).toBeVisible();
    expect(within(footer).getByText('+13')).toBeVisible();
    expect(within(footer).getByText('−5')).toBeVisible();

    view.rerender(<ChangesView {...props} changeListDisplay="fullPath" />);
    expect(within(footer).getByText('2 files')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Modified src/second.ts' }), {
      metaKey: true,
    });
    expect(within(footer).getByText('2 files selected')).toBeVisible();
  });

  it('defaults the file list to full paths', () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/features/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const row = changeRow(/Modified src\/features\/app\.ts/u);
    expect(within(row).getByText('src/features/app.ts')).toBeVisible();
    expect(row).toHaveClass('is-single-line');
  });

  it('keeps the left pane resizable without changing the persisted History inspector width', async () => {
    const user = userEvent.setup();
    const onPaneWidthsChange = vi.fn<(widths: { left: number; right: number }) => void>();
    render(
      <ChangesView
        repo={repoSnapshot({ changes: [] })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={onPaneWidthsChange}
      />,
    );

    screen.getByRole('separator', { name: 'Changes list width' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onPaneWidthsChange).toHaveBeenCalledWith({ left: 368, right: 330 });
  });

  it('labels a truncated diff and disables line selection', async () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/large.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({ truncated: true })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(/The diff exceeded the display limit/u)).toBeVisible();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ selectable: false, performanceMode: true }),
    );
    expect(diffSurfaceMock.mock.lastCall?.[0]).not.toHaveProperty('hunkAction');
  });

  it('keeps line selection enabled for a single-file performance diff', async () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/large.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({ tooLarge: true })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        selectable: true,
        performanceMode: true,
        hunkAction: expect.objectContaining({ kind: 'stage', disabled: false }),
        source: expect.objectContaining({ kind: 'codeView' }),
      }),
    );
  });

  it('disables line selection for a patch containing multiple files', async () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({
          patch: 'diff --git a/src/app.ts b/src/app.ts\ndiff --git a/src/other.ts b/src/other.ts\n',
        })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        selectable: false,
        source: expect.objectContaining({ kind: 'codeView' }),
      }),
    );
    expect(diffSurfaceMock.mock.lastCall?.[0]).not.toHaveProperty('hunkAction');
  });

  it.each([
    ['unstaged', 'Stage Selected Lines', 'stageSelection'],
    ['unstaged', 'Discard Selected Lines', 'discardSelection'],
    ['staged', 'Unstage Selected Lines', 'unstageSelection'],
  ] as const)(
    'routes an %s direct diff selection to %s through the typed %s action',
    async (area, buttonName, actionKind) => {
      const user = userEvent.setup();
      const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
      render(
        <ChangesView
          repo={repoSnapshot({
            changes: [{ path: 'src/app.ts', area, status: 'modified' }],
          })}
          adapter={adapterWithDiff()}
          onAction={onAction}
          paneWidths={{ left: 240, right: 330 }}
          onPaneWidthsChange={() => undefined}
        />,
      );
      await screen.findByText('Diff');
      await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
      await user.click(screen.getByRole('button', { name: 'Open selection menu' }));
      const menu = screen.getByRole('menu', { name: 'Selected lines' });
      await user.click(within(menu).getByRole('menuitem', { name: buttonName }));

      expect(onAction).toHaveBeenCalledWith({
        kind: actionKind,
        selection: {
          kind: 'lines',
          diffId: 'revision-1',
          path: 'src/app.ts',
          generation: 1,
          side: 'additions',
          startLine: 2,
          endLine: 3,
        },
      });
    },
  );

  it('copies the selected line contents from the context menu', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
    await user.click(screen.getByRole('button', { name: 'Open selection menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy Selected Lines' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('second line\nthird line'));
    expect(screen.getByRole('status')).toHaveTextContent('Copied the selected lines.');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('copies the selected line contents from the Diff shortcut', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
    await user.click(screen.getByRole('button', { name: 'Copy selection shortcut' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('second line\nthird line'));
    expect(screen.getByRole('status')).toHaveTextContent('Copied the selected lines.');
  });

  it('hides line and Hunk staging actions when Stage display is hidden', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        splitStageView={false}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    expect(screen.getByRole('button', { name: 'Edit mock hunk' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stage mock hunk' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard mock hunk' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
    await user.click(screen.getByRole('button', { name: 'Open selection menu' }));

    expect(
      screen.queryByRole('menuitem', { name: 'Stage Selected Lines' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit Lines' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Copy Selected Lines' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Discard Selected Lines' })).toBeVisible();
  });

  it.each([
    ['unstaged', 'Stage mock hunk', 'stageSelection'],
    ['unstaged', 'Discard mock hunk', 'discardSelection'],
    ['staged', 'Unstage mock hunk', 'unstageSelection'],
  ] as const)('routes an %s hunk action through %s', async (area, buttonName, actionKind) => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area, status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.click(await screen.findByRole('button', { name: buttonName }));

    expect(onAction).toHaveBeenCalledWith({
      kind: actionKind,
      selection: {
        kind: 'hunk',
        diffId: 'revision-1',
        path: 'src/app.ts',
        generation: 1,
        hunkIndex: 1,
      },
    });
  });

  it('keeps a partially staged path in its source area and follows it when the source disappears', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const { rerender } = render(
      <ChangesView
        repo={repoSnapshot({
          generation: 1,
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Stage mock hunk' }));

    rerender(
      <ChangesView
        repo={repoSnapshot({
          generation: 2,
          changes: [
            { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/app.ts', area: 'staged', status: 'modified' },
          ],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Stage mock hunk' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Stage mock hunk' }));
    rerender(
      <ChangesView
        repo={repoSnapshot({
          generation: 3,
          changes: [{ path: 'src/app.ts', area: 'staged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Unstage mock hunk' })).toBeVisible();
  });

  it('guards a dirty conflict when selecting another file and supports Cancel or Save', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [
            { path: 'src/conflict.ts', area: 'conflicted', status: 'conflicted' },
            { path: 'src/other.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapterWithConflict()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Conflict editor');
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));
    expect(screen.getByRole('checkbox', { name: 'Stage src/other.ts' })).toBeDisabled();
    const otherActions = screen.getByRole('button', {
      name: 'More actions for src/other.ts',
    });
    expect(otherActions).toBeEnabled();
    await user.click(otherActions);
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Files…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(changeRow(/other\.ts/u));

    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved result' });
    expect(dialog).toBeVisible();
    expect(screen.getByRole('button', { name: 'Leave Without Saving' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and Leave' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Conflict editor')).toBeVisible();

    await user.click(changeRow(/other\.ts/u));
    await user.click(screen.getByRole('button', { name: 'Save and Leave' }));
    expect(conflictSaveMock).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'src/other.ts' })).toBeVisible();
  });

  it('hides the previous conflict editor while the newly selected file is loading', async () => {
    const user = userEvent.setup();
    const base = adapterWithDiff();
    let resolveDiffQuery: ((result: QueryResult) => void) | undefined;
    const adapter: WorkspaceAdapter = {
      ...base,
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'conflict')
          return {
            kind: 'conflict' as const,
            document: conflictDocument({ repoId: request.repoId, path: request.path }),
          };
        if (request.kind === 'diff')
          return await new Promise<QueryResult>((resolve) => {
            resolveDiffQuery = resolve;
          });
        return await base.query(request);
      }),
    };
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [
            { path: 'src/conflict.ts', area: 'conflicted', status: 'conflicted' },
            { path: 'src/other.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Conflict editor');

    await user.click(changeRow(/other\.ts/u));
    await waitFor(() => expect(resolveDiffQuery).toBeTypeOf('function'));

    expect(screen.queryByText('Conflict editor')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'src/other.ts' })).toBeVisible();
  });

  it('pins a dirty conflict when an external snapshot removes its path', async () => {
    const user = userEvent.setup();
    const initial = repoSnapshot({
      changes: [
        { path: 'src/conflict.ts', area: 'conflicted', status: 'conflicted' },
        { path: 'src/other.ts', area: 'unstaged', status: 'modified' },
      ],
    });
    const props = {
      adapter: adapterWithConflict(),
      onAction: async () => undefined,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    } as const;
    const { rerender } = render(<ChangesView repo={initial} {...props} />);
    await screen.findByText('Conflict editor');
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));

    rerender(
      <ChangesView
        repo={{
          ...initial,
          generation: initial.generation + 1,
          changes: [{ path: 'src/other.ts', area: 'unstaged', status: 'modified' }],
        }}
        {...props}
      />,
    );
    expect(await screen.findByText('External conflict state changed')).toBeVisible();
    expect(screen.getByText('Conflict editor')).toBeVisible();

    await user.click(changeRow(/other\.ts/u));
    await user.click(screen.getByRole('button', { name: 'Leave Without Saving' }));
    expect(await screen.findByRole('heading', { name: 'src/other.ts' })).toBeVisible();
  });

  it('lets a same-path background query replace an action outcome document', async () => {
    let resolveConflictQuery: ((result: QueryResult) => void) | undefined;
    const base = adapterWithDiff();
    const queryDiff = base.query;
    const adapter: WorkspaceAdapter = {
      ...base,
      query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind !== 'conflict') return await queryDiff(request);
        return await new Promise<QueryResult>((resolve) => {
          resolveConflictQuery = resolve;
        });
      }),
    };
    const actionDocument = conflictDocument({
      sessionId: 'action-session',
      contentHash: 'action-hash',
    });
    render(
      <ChangesView
        repo={repoSnapshot({
          operation: {
            kind: 'merge',
            label: { id: 'operationResolvingMerge' },
            unresolvedCount: 1,
            canContinue: false,
            canSkip: false,
            canAbort: true,
          },
          changes: [{ path: actionDocument.path, area: 'conflicted', status: 'conflicted' }],
        })}
        adapter={adapter}
        externalConflict={actionDocument}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByTestId('conflict-version')).toHaveTextContent(
      'action-session:action-hash',
    );
    act(() => {
      resolveConflictQuery?.({
        kind: 'conflict',
        document: conflictDocument({ sessionId: 'query-session', contentHash: 'query-hash' }),
      });
    });
    expect(await screen.findByTestId('conflict-version')).toHaveTextContent(
      'query-session:query-hash',
    );
    expect(conflictSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        document: expect.objectContaining({
          sessionId: 'query-session',
          contentHash: 'query-hash',
        }),
      }),
    );
  });

  it('keeps Commit left of Pull in the icon-only footer actions with Fetch last', () => {
    render(
      <ChangesView
        repo={repoSnapshot({ branch: { name: 'main', detached: false, ahead: 0, behind: 0 } })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const actions = screen.getByRole('group', { name: 'Actions' });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['', '', '', '']);
    const pull = screen.getByRole('button', { name: 'Pull' });
    expect(pull).toBeEnabled();
    expect(pull).toHaveClass('changes-action-button');
    expect(pull).toHaveAttribute('title', 'Pull');
    expect(pull.querySelector('span')).not.toBeInTheDocument();
    expect(pull).toHaveAttribute('aria-expanded', 'false');
    for (const label of ['Commit', 'Push', 'Fetch']) {
      const action = within(actions).getByRole('button', { name: label });
      expect(action).toHaveClass('changes-action-button');
      expect(action).toHaveAttribute('title', label);
      expect(action.querySelector('span')).not.toBeInTheDocument();
    }
  });

  it('keeps Commit open with its draft when submission fails', async () => {
    const user = userEvent.setup();
    let rejectCommit: ((cause: unknown) => void) | undefined;
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async (action) => {
      if (action.kind !== 'commit') return;
      await new Promise<void>((_resolve, reject) => {
        rejectCommit = reject;
      });
    });
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'staged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await openCommit(user);
    const dialog = screen.getByRole('dialog', { name: 'Commit' });
    const description = within(dialog).getByRole('textbox', { name: 'Message' });
    await user.type(description, 'handle commit errors');
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(rejectCommit).toBeDefined());

    act(() => rejectCommit?.(new Error('Commit hook failed.')));

    expect(await screen.findByRole('alert')).toHaveTextContent('Commit failed.');
    expect(screen.getByRole('dialog', { name: 'Commit' })).toBeVisible();
    expect(description).toHaveValue('handle commit errors');
  });

  it('commits every change when Stage display is hidden', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          path: '/tmp/commit-all',
          changes: [
            { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/new.ts', area: 'untracked', status: 'added' },
          ],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        splitStageView={false}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await openCommit(user);
    const dialog = screen.getByRole('dialog', { name: 'Commit' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'commit all');
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'commit',
      input: { format: 'plain', message: 'commit all' },
      includeAllChanges: true,
    });
  });

  it('preserves a cancelled draft and closes with a cleared draft after success', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          path: '/tmp/dialog-draft',
          changes: [{ path: 'src/app.ts', area: 'staged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const trigger = await openCommit(user);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'preserve this draft');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await openCommit(user);
    const dialog = screen.getByRole('dialog', { name: 'Commit' });
    expect(within(dialog).getByRole('textbox', { name: 'Message' })).toHaveValue(
      'preserve this draft',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Commit' })).toBeNull());
    expect(onAction).toHaveBeenCalledWith({
      kind: 'commit',
      input: {
        format: 'plain',
        message: 'preserve this draft',
      },
      includeAllChanges: false,
    });

    await openCommit(user);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  });

  it('disables file, line, and remote mutations while a Git operation is in progress', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          operation: {
            kind: 'rebase',
            label: { id: 'operationResolvingRebase' },
            unresolvedCount: 0,
            canContinue: true,
            canSkip: true,
            canAbort: true,
          },
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ selectable: false }),
    );
    expect(
      screen.getByText(
        'Resolving rebase. Stage, Unstage, Discard, and remote actions are unavailable until you finish or abort the operation.',
      ),
    ).toHaveClass('sr-only');
    expect(screen.getByRole('checkbox', { name: 'Stage src/app.ts' })).toBeDisabled();
    await openCommit(user);
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();

    const fileActions = screen.getByRole('button', { name: 'More actions for src/app.ts' });
    expect(fileActions).toBeEnabled();
    await user.click(fileActions);
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Files…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toBeDisabled();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
    await user.click(screen.getByRole('button', { name: 'Open selection menu' }));
    expect(screen.getByRole('menuitem', { name: 'Stage Selected Lines' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Selected Lines' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Selected Lines' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stage mock hunk' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard mock hunk' })).toBeDisabled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps a merge Commit disabled until every conflict is marked resolved', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          operation: {
            kind: 'merge',
            label: { id: 'operationResolvingMerge' },
            unresolvedCount: 1,
            canContinue: false,
            canSkip: false,
            canAbort: true,
          },
          changes: [
            { path: 'ready.ts', area: 'staged', status: 'modified' },
            { path: 'conflict.ts', area: 'conflicted', status: 'conflicted' },
          ],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await openCommit(user);
    const dialog = screen.getByRole('dialog', { name: 'Commit' });
    const commit = within(dialog).getByRole('button', { name: 'Commit' });
    expect(commit).toBeDisabled();
    expect(commit).toHaveAccessibleDescription('Resolve all conflicts before committing.');
    expect(within(dialog).getByText('Resolve all conflicts before committing.')).toBeVisible();
  });

  it('keeps the diverged Pull choice visible across the Fetch generation refresh', async () => {
    const user = userEvent.setup();
    const repo = repoSnapshot({
      generation: 1,
      branch: {
        name: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 1,
        behind: 1,
      },
    });
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async (action) => {
      if (action.kind === 'pull')
        throw new WorkspaceAdapterError('pullDiverged', 'Fast-forward is not possible.');
    });
    const adapter = adapterWithDiff();
    const queryDiff = adapter.query;
    adapter.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'branches')
        return {
          kind: 'branches',
          branches: [
            {
              fullName: 'refs/remotes/origin/main',
              shortName: 'origin/main',
              oid: 'remote-main',
              current: false,
              remote: true,
            },
          ],
        };
      if (request.kind === 'remotes')
        return {
          kind: 'remotes',
          remotes: [{ name: 'origin', fetchUrls: ['example'], pushUrls: ['example'] }],
          generation: 1,
        };
      return await queryDiff(request);
    });
    const props = {
      adapter,
      onAction,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    } as const;
    const { rerender } = render(<ChangesView repo={repo} {...props} />);

    const commit = within(screen.getByRole('group', { name: 'Actions' })).getByRole('button', {
      name: 'Commit',
    });
    expect(commit).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Pull' }));
    const pullDialog = await screen.findByRole('dialog', { name: 'Pull' });
    expect(
      within(pullDialog).getByRole('checkbox', {
        name: 'Commit merged changes immediately',
      }),
    ).toBeChecked();
    await user.click(within(pullDialog).getByRole('button', { name: 'Pull' }));
    expect(await screen.findByText('Fast-forward unavailable')).toBeVisible();
    expect(commit).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Pull' })).not.toBeInTheDocument();
    rerender(<ChangesView repo={{ ...repo, generation: 2 }} {...props} />);
    expect(screen.getByText('Fast-forward unavailable')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() =>
      expect(onAction).toHaveBeenLastCalledWith({
        kind: 'merge',
        sourceRef: 'FETCH_HEAD',
        commitImmediately: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Fast-forward unavailable')).not.toBeInTheDocument(),
    );
  });

  it('requeries the selected diff when repository generation changes', async () => {
    const adapter = adapterWithDiff();
    const first = repoSnapshot({
      generation: 1,
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const { rerender } = render(
      <ChangesView
        repo={first}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');
    expect(adapter.query).toHaveBeenCalledTimes(1);

    rerender(
      <ChangesView
        repo={{ ...first, generation: 2 }}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2));
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ patch: 'diff --git a/src/app.ts b/src/app.ts\n' }),
      }),
    );
  });

  it('keeps the current diff visible without a loading message while refreshing it', async () => {
    const adapter = adapterWithDiff();
    const queryDiff = adapter.query;
    let queryCount = 0;
    let resolveRefresh: ((result: QueryResult) => void) | undefined;
    adapter.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      queryCount += 1;
      if (queryCount === 1) return await queryDiff(request);
      return await new Promise<QueryResult>((resolve) => {
        resolveRefresh = resolve;
      });
    });
    const first = repoSnapshot({
      generation: 1,
      changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
    });
    const props = {
      adapter,
      onAction: async () => undefined,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    } as const;
    const { rerender } = render(<ChangesView repo={first} {...props} />);
    await screen.findByText('Diff');

    rerender(<ChangesView repo={{ ...first, generation: 2 }} {...props} />);
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2));

    expect(screen.getByText('Diff')).toBeVisible();
    expect(screen.queryByText('Loading diff…')).not.toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.({
        kind: 'diff',
        diff: {
          diffId: 'revision-refreshed',
          repoId: first.repoId,
          path: 'src/app.ts',
          area: 'unstaged',
          generation: 2,
          patch: 'diff --git a/src/app.ts b/src/app.ts\n',
          binary: false,
          tooLarge: false,
        },
      });
    });
  });

  it('uses the Diff layout selected in Settings without showing a local switch', async () => {
    const adapter = adapterWithDiff();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapter}
        onAction={async () => undefined}
        diffStyle="split"
        editorLineWrapping
        editorWrapColumn={96}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');
    expect(screen.queryByRole('group', { name: 'Diff layout' })).not.toBeInTheDocument();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        diffStyle: 'split',
        lineWrapping: true,
        wrapColumn: 96,
      }),
    );
  });

  it('opens a changed file from the Diff mode tabs and returns through Display', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={async () => undefined}
        editorLineWrapping
        editorWrapColumn={96}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');

    const displayTab = screen.getByRole('tab', { name: 'Display' });
    const editButton = screen.getByRole('tab', { name: 'Edit' });
    expect(displayTab).toHaveAttribute('aria-selected', 'true');
    expect(editButton).toHaveAttribute('title', 'Edit');
    expect(editButton).toHaveAttribute('aria-selected', 'false');
    expect(editButton).not.toHaveTextContent('Edit');
    await user.click(editButton);
    expect(await screen.findByRole('textbox', { name: 'Edit src/app.ts' })).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Edit src/app.ts' }).closest('main'),
    ).toHaveAttribute('data-line-wrapping', 'true');
    expect(
      screen.getByRole('textbox', { name: 'Edit src/app.ts' }).closest('main'),
    ).toHaveAttribute('data-wrap-column', '96');
    expect(screen.queryByText('Diff')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Display' }));
    expect(await screen.findByText('Diff')).toBeVisible();
  });

  it('opens an unchanged selected line from the mode tabs and restores it in the Diff', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');

    await user.click(screen.getByRole('button', { name: 'Select unchanged line' }));
    await user.click(screen.getByRole('button', { name: 'Open selection menu' }));
    const menu = screen.getByRole('menu', { name: 'Selected lines' });
    expect(within(menu).getByRole('menuitem', { name: 'Edit Lines' })).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: 'Copy Selected Lines' })).toBeVisible();
    expect(within(menu).queryByRole('menuitem', { name: 'Stage Selected Lines' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Discard Selected Lines' })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('tab', { name: 'Edit' }));
    const editor = await screen.findByRole('textbox', { name: 'Edit src/app.ts' });
    expect(editor.closest('main')).toHaveAttribute('data-initial-scroll-line', '4');

    await user.click(screen.getByRole('button', { name: 'Display' }));
    await screen.findByText('Diff');
    expect(diffSurfaceMock.mock.lastCall?.[0].initialSelection).toEqual({
      side: 'additions',
      startLine: 4,
      endLine: 4,
      patchActionable: false,
    });
  });

  it('opens a deleted selection at the next line remaining in the edited file', async () => {
    const user = userEvent.setup();
    const patch = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,2 @@
 keep-1
-delete-2
-delete-3
 keep-4
`;
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile('keep-1\nkeep-4\n', { patch })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');

    await user.click(screen.getByRole('button', { name: 'Select deleted line' }));
    await user.click(screen.getByRole('tab', { name: 'Edit' }));

    const editor = await screen.findByRole('textbox', { name: 'Edit src/app.ts' });
    expect(editor.closest('main')).toHaveAttribute('data-initial-scroll-line', '2');
  });

  it('keeps the ellipsis file menu in the editor and restricts destructive actions while dirty', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');
    await user.click(screen.getByRole('tab', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Edit src/app.ts' });

    const menuTrigger = screen.getByRole('button', {
      name: 'More actions for selected file src/app.ts',
    });
    expect(menuTrigger).toBeVisible();
    await user.click(menuTrigger);
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeEnabled();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Edit File Draft' }));
    await user.click(menuTrigger);
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Files…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete Files…' })).toBeDisabled();
  });

  it('keeps the Diff visible until the editor document is ready', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithFile();
    const query = adapter.query;
    let resolveFileQuery: ((result: QueryResult) => void) | undefined;
    adapter.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind !== 'fileContents') return await query(request);
      return await new Promise<QueryResult>((resolve) => {
        resolveFileQuery = resolve;
      });
    });
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');

    await user.click(screen.getByRole('tab', { name: 'Edit' }));

    expect(screen.getByText('Diff')).toBeVisible();
    expect(document.querySelector('.loading-state')).not.toBeInTheDocument();
    await act(async () => {
      resolveFileQuery?.({
        kind: 'fileContents',
        document: {
          repoId: 'repo-1',
          path: 'src/app.ts',
          text: 'const value = 1;\n',
          lineEnding: 'lf',
          hasUtf8Bom: false,
          contentHash: 'file-hash-1',
          generation: 1,
        },
      });
    });
    expect(await screen.findByRole('textbox', { name: 'Edit src/app.ts' })).toBeVisible();
  });

  it.each([
    ['Hunk', 'Edit mock hunk'],
    ['lines', 'Edit Lines'],
  ] as const)('opens the whole-file editor from %s editing', async (source, actionName) => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');
    if (source === 'lines') {
      await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
      await user.click(screen.getByRole('button', { name: 'Open selection menu' }));
    }

    await user.click(
      screen.getByRole(source === 'lines' ? 'menuitem' : 'button', { name: actionName }),
    );

    const editor = await screen.findByRole('textbox', { name: 'Edit src/app.ts' });
    expect(editor).toBeVisible();
    expect(editor.closest('main')).toHaveAttribute(
      'data-initial-scroll-line',
      source === 'Hunk' ? '12' : '2',
    );
    expect(onAction).not.toHaveBeenCalled();
  });

  it('narrows a multiple selection to the file whose row menu starts editing', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithFile();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [
            { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    const first = changeRow(/first\.ts/u);
    const second = changeRow(/second\.ts/u);
    await user.click(first);
    fireEvent.click(second, { shiftKey: true });
    await waitFor(() => expect(screen.getAllByText('Diff')).toHaveLength(2));

    const secondMenus = screen.getAllByRole('button', { name: 'More actions for src/second.ts' });
    const secondMenu = secondMenus[0];
    if (!secondMenu) throw new Error('Expected the row action menu.');
    await user.click(secondMenu);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByRole('textbox', { name: 'Edit src/second.ts' })).toBeVisible();
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows mode tabs for every selected Diff and edits the chosen file', async () => {
    const user = userEvent.setup();
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [
            { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapterWithFile()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    const first = changeRow(/first\.ts/u);
    const second = changeRow(/second\.ts/u);
    await user.click(first);
    fireEvent.click(second, { shiftKey: true });
    await waitFor(() => expect(screen.getAllByText('Diff')).toHaveLength(2));

    const displayTabs = screen.getAllByRole('tab', { name: 'Display' });
    const editTabs = screen.getAllByRole('tab', { name: 'Edit' });
    expect(displayTabs).toHaveLength(2);
    expect(displayTabs.every((tab) => tab.getAttribute('aria-selected') === 'true')).toBe(true);
    expect(editTabs).toHaveLength(2);
    await user.click(editTabs[1]!);

    expect(await screen.findByRole('textbox', { name: 'Edit src/second.ts' })).toBeVisible();
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('blocks repository mutations while a file editor is dirty', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByText('Diff');
    await user.click(screen.getByRole('tab', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Edit src/app.ts' });
    await user.click(screen.getByRole('button', { name: 'Edit File Draft' }));
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Stage src/app.ts' })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Unsaved' })).toBeVisible();

    expect(onAction).not.toHaveBeenCalled();
  });

  it('stages through the checkbox and keeps the same file selected after it moves', async () => {
    const user = userEvent.setup();
    const initial = repoSnapshot({
      generation: 1,
      changes: [
        { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
        { path: 'src/other.ts', area: 'unstaged', status: 'modified' },
      ],
    });
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const props = {
      adapter: adapterWithDiff(),
      onAction,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    } as const;
    const { rerender } = render(<ChangesView repo={initial} {...props} />);
    await screen.findByText('Diff');

    await user.click(screen.getByRole('checkbox', { name: 'Stage src/app.ts' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'stageFiles', paths: ['src/app.ts'] });

    rerender(
      <ChangesView
        repo={{
          ...initial,
          generation: 2,
          changes: [
            { path: 'src/app.ts', area: 'staged', status: 'modified' },
            { path: 'src/other.ts', area: 'unstaged', status: 'modified' },
          ],
        }}
        {...props}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'src/app.ts' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Unstage src/app.ts' })).toHaveFocus();
  });

  it.each([
    ['Open in Default App', 'openInDefaultApp'],
    ['Show in Finder', 'revealInFinder'],
    ['Delete Files…', 'moveToTrash'],
  ] as const)('routes %s through the typed file action', async (itemName, operation) => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'More actions for src/app.ts' }));
    await user.click(screen.getByRole('menuitem', { name: itemName }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: 'fileAction',
        paths: ['src/app.ts'],
        operation,
      }),
    );
  });

  it('routes multiple selected files through the discard action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [
            { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    const first = changeRow(/first\.ts/u);
    const second = changeRow(/second\.ts/u);
    await user.click(first);
    fireEvent.click(second, { shiftKey: true });
    fireEvent.contextMenu(second, { clientX: 100, clientY: 100 });
    await user.click(screen.getByRole('menuitem', { name: 'Discard Files…' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'discardFiles',
      paths: ['src/first.ts', 'src/second.ts'],
    });
  });

  it('renders every file selected in the left pane in the right pane', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [
            { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        stickyFileHeaders
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    const first = changeRow(/first\.ts/u);
    const second = changeRow(/second\.ts/u);

    await user.click(first);
    fireEvent.click(second, { shiftKey: true });

    await waitFor(() => expect(screen.getAllByText('Diff')).toHaveLength(2));
    const multiSources = diffSurfaceMock.mock.calls
      .map(([props]) => props)
      .filter((props) => props.source?.path)
      .slice(-2);
    expect(multiSources).toEqual([
      expect.objectContaining({
        collapsed: false,
        hunkAction: expect.objectContaining({ kind: 'stage' }),
        source: expect.objectContaining({ path: 'src/first.ts' }),
      }),
      expect.objectContaining({
        collapsed: false,
        hunkAction: expect.objectContaining({ kind: 'stage' }),
        source: expect.objectContaining({ path: 'src/second.ts' }),
      }),
    ]);
    expect(screen.getAllByRole('button', { name: 'Stage mock hunk' })).toHaveLength(2);

    multiSources[0]?.hunkAction?.onAction?.({ hunkIndex: 1 });
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: 'stageSelection',
        selection: {
          kind: 'hunk',
          diffId: multiSources[0]?.source?.cacheKey,
          path: 'src/first.ts',
          generation: expect.any(Number),
          hunkIndex: 1,
        },
      }),
    );

    const firstHeading = screen.getByRole('heading', { name: 'src/first.ts' });
    const firstToolbar = firstHeading.closest('.pane-toolbar');
    expect(firstToolbar).toHaveClass('is-sticky');
    expect(firstToolbar?.closest('.diff-pane')).not.toHaveClass('has-static-file-headers');
    expect(firstToolbar).toContainElement(
      screen.getByRole('button', { name: 'More actions for selected file src/first.ts' }),
    );
    expect(firstToolbar?.querySelector('.selected-file-heading .file-status')).toHaveClass(
      'modified',
    );
    if (!firstToolbar) throw new Error('Expected the first selected file header.');
    fireEvent.contextMenu(firstToolbar, { clientX: 160, clientY: 140 });
    const firstMenu = screen.getByRole('menu', { name: 'src/first.ts actions' });
    expect(firstMenu).toBeVisible();
    fireEvent.keyDown(firstMenu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'src/first.ts actions' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse src/first.ts diff' }));
    expect(screen.getByRole('button', { name: 'Expand src/first.ts diff' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const latestPropsFor = (path: string) =>
      diffSurfaceMock.mock.calls.findLast(([props]) => props.source?.path === path)?.[0];
    expect(latestPropsFor('src/first.ts')).toEqual(expect.objectContaining({ collapsed: true }));
    expect(latestPropsFor('src/second.ts')).toEqual(expect.objectContaining({ collapsed: false }));
  });

  it('keeps file headers in the normal scroll flow by default', async () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    const toolbar = screen.getByRole('heading', { name: 'src/app.ts' }).closest('.pane-toolbar');
    expect(toolbar).not.toHaveClass('is-sticky');
    expect(toolbar?.closest('.diff-pane')).toHaveClass('has-static-file-headers');
  });

  it('opens the ellipsis file menu from a right-click on the file header', async () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    const toolbar = screen.getByRole('heading', { name: 'src/app.ts' }).closest('.pane-toolbar');
    if (!toolbar) throw new Error('Expected a file header toolbar.');
    fireEvent.contextMenu(toolbar, { clientX: 240, clientY: 180 });

    const menu = screen.getByRole('menu', { name: 'src/app.ts actions' });
    expect(menu).toBeVisible();
    expect(menu).toHaveStyle({ left: '240px', top: '180px' });
    expect(
      screen.getByRole('button', { name: 'More actions for selected file src/app.ts' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('copies an absolute path and announces the result visibly', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <ChangesView
        repo={repoSnapshot({
          path: '/tmp/stella/',
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'More actions for src/app.ts' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy Path' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/tmp/stella/src/app.ts'));
    expect(screen.getByRole('status')).toHaveTextContent('Copied /tmp/stella/src/app.ts');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps the detail action trigger visible at the right edge of the file title', () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const listTrigger = screen.getByRole('button', { name: 'More actions for src/app.ts' });
    const detailTrigger = screen.getByRole('button', {
      name: 'More actions for selected file src/app.ts',
    });
    expect(listTrigger).not.toHaveClass('is-persistent');
    expect(detailTrigger).toHaveClass('is-persistent');
    expect(detailTrigger.closest('.pane-toolbar')).toContainElement(
      screen.getByRole('heading', { name: 'src/app.ts' }),
    );
    expect(
      detailTrigger.closest('.pane-toolbar')?.querySelector('.selected-file-heading .file-status'),
    ).toHaveClass('modified');
  });

  it('does not show a collapse toggle for a single selected file', async () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Diff');
    expect(
      screen.queryByRole('button', { name: 'Collapse src/app.ts diff' }),
    ).not.toBeInTheDocument();
    expect(diffSurfaceMock.mock.lastCall?.[0]).not.toHaveProperty('collapsed');
  });

  it('disables every file-action trigger while the app is globally busy', () => {
    render(
      <ChangesView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        busy
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'More actions for src/app.ts' })).toBeDisabled();
  });
});
