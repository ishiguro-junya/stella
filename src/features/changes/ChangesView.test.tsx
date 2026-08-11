import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAdapterError, type WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import type { ConflictDocument, QueryResult, WorkspaceAction } from '../../domain/workspace';
import { conflictDocument, repoSnapshot } from '../../test/fixtures';
import { ChangesView } from './ChangesView';

interface MockConflictSurfaceProps {
  document: ConflictDocument;
  externalStateChanged?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onLeaveHandleChange?: (handle: { save: () => Promise<boolean> } | null) => void;
}

interface MockDiffSurfaceProps {
  selectable?: boolean;
  onSelectionChange?: (selection: {
    side: 'additions' | 'deletions';
    startLine: number;
    endLine: number;
  }) => void;
}

const { conflictSaveMock, conflictSurfaceMock, diffSurfaceMock } = vi.hoisted(() => ({
  conflictSaveMock: vi.fn<() => void>(),
  conflictSurfaceMock: vi.fn<(props: MockConflictSurfaceProps) => void>(),
  diffSurfaceMock: vi.fn<(props: unknown) => void>(),
}));

vi.mock('../diff/DiffSurface', () => ({
  DiffSurface: (props: MockDiffSurfaceProps) => {
    diffSurfaceMock(props);
    return (
      <div>
        <span>Diff</span>
        <button
          type="button"
          onClick={() => props.onSelectionChange?.({ side: 'additions', startLine: 2, endLine: 3 })}
        >
          Select diff lines
        </button>
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

  it('keeps the action bar above changed files and opens Commit as a dialog', async () => {
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
    const actions = within(sidebar).getByRole('group', { name: 'Actions' });
    const actionSection = actions.closest('.changes-action-section');
    expect(sidebar.firstElementChild).toBe(actionSection);
    expect(actionSection?.nextElementSibling).toBe(changedFiles);
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
    expect(screen.queryByRole('separator', { name: 'Commit pane width' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Changes' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ files/u)).not.toBeInTheDocument();
    expect(screen.queryByText('Check to stage · Drag rows to move')).not.toBeInTheDocument();
    expect(screen.getByText(/Use the checkboxes to stage or unstage files/u)).toHaveClass(
      'sr-only',
    );
    expect(screen.queryByText('No selection')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a change')).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Diff' })).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
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

    expect(onPaneWidthsChange).toHaveBeenCalledWith({ left: 248, right: 330 });
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
  });

  it.each([
    ['unstaged', 'Stage', 'stageSelection'],
    ['unstaged', 'Discard', 'discardSelection'],
    ['staged', 'Unstage', 'unstageSelection'],
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
      const toolbar = screen.getByRole('toolbar', { name: 'Selected lines' });
      await user.click(within(toolbar).getByRole('button', { name: buttonName }));

      expect(onAction).toHaveBeenCalledWith({
        kind: actionKind,
        selection: {
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

  it('keeps Commit left of Pull in the labeled action bar with Fetch last', () => {
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
    ).toEqual(['Commit', 'Pull', 'Push', 'Fetch']);
    const pull = screen.getByRole('button', { name: 'Pull' });
    expect(pull).toBeDisabled();
    expect(pull).toHaveClass('changes-action-button');
    expect(pull).toHaveAttribute('title', 'Pull');
    expect(pull).toHaveTextContent('Pull');
    expect(pull).toHaveAccessibleDescription('Set an upstream branch before pulling.');
    expect(screen.getByText('Set an upstream branch before pulling.')).toHaveClass('sr-only');
    for (const label of ['Commit', 'Push', 'Fetch']) {
      const action = within(actions).getByRole('button', { name: label });
      expect(action).toHaveClass('changes-action-button');
      expect(action).toHaveAttribute('title', label);
      expect(action).toHaveTextContent(label);
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Commit hook failed.');
    expect(screen.getByRole('dialog', { name: 'Commit' })).toBeVisible();
    expect(description).toHaveValue('handle commit errors');
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
        type: 'feat',
        breaking: false,
        description: 'preserve this draft',
      },
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
    for (const button of screen.getAllByRole('button', { name: 'Stage' }))
      expect(button).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Discard' }))
      expect(button).toBeDisabled();
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
      if (action.kind === 'pullFastForward')
        throw new WorkspaceAdapterError('pullDiverged', 'Fast-forward is not possible.');
    });
    const props = {
      adapter: adapterWithDiff(),
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
    expect(await screen.findByText('Fast-forward unavailable')).toBeVisible();
    expect(commit).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Commit' })).not.toBeInTheDocument();
    rerender(<ChangesView repo={{ ...repo, generation: 2 }} {...props} />);
    expect(screen.getByText('Fast-forward unavailable')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() =>
      expect(onAction).toHaveBeenLastCalledWith({ kind: 'merge', sourceRef: 'FETCH_HEAD' }),
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

  it('switches a normal working-tree diff between Unified and Split', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithDiff();
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
    await user.click(screen.getByRole('button', { name: 'Split' }));
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ diffStyle: 'split' }),
    );
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
