import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useImperativeHandle, type ReactNode, type RefObject } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAdapterError, type WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import type { ConflictDocument, QueryResult, WorkspaceAction } from '../../domain/workspace';
import { conflictDocument, repoSnapshot } from '../../test/unit/fixtures';
import { DiffView } from './DiffView';

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
  leadingHeaderActions?: ReactNode;
  headerActions?: ReactNode;
  displayRequestRef?: RefObject<(() => void) | null>;
  onDisplay: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onLeaveHandleChange?: (handle: { save: () => Promise<boolean> } | null) => void;
}

const { conflictSaveMock, conflictSurfaceMock, diffSurfaceMock, imagePreviewToggleMock } =
  vi.hoisted(() => ({
    conflictSaveMock: vi.fn<() => void>(),
    conflictSurfaceMock: vi.fn<(props: MockConflictSurfaceProps) => void>(),
    diffSurfaceMock: vi.fn<(props: MockDiffSurfaceProps) => void>(),
    imagePreviewToggleMock: vi.fn<(pressed: boolean, disabled: boolean | undefined) => void>(),
  }));

vi.mock('./DiffSurface', () => ({
  DiffSurface: (props: MockDiffSurfaceProps) => {
    diffSurfaceMock(props);
    return (
      <div>
        <span data-testid="diff-surface">Diff</span>
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
vi.mock('./ImageDiffPreview', () => ({
  ImageDiffPreview: ({
    hidden,
    onProbeResult,
  }: {
    hidden?: boolean;
    onProbeResult?: (previewable: boolean) => void;
  }) => {
    useEffect(() => onProbeResult?.(true), [onProbeResult]);
    return hidden ? null : <div>Image preview content</div>;
  },
  ImagePreviewToggle: ({
    pressed,
    disabled,
    onPressedChange,
  }: {
    pressed: boolean;
    disabled?: boolean;
    onPressedChange: (pressed: boolean) => void;
  }) => {
    imagePreviewToggleMock(pressed, disabled);
    return (
      <button
        type="button"
        aria-label="Image preview"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={() => onPressedChange(!pressed)}
      >
        Image
      </button>
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
  FileEditorSurface: (props: MockFileEditorSurfaceProps) => {
    useImperativeHandle(props.displayRequestRef, () => props.onDisplay);
    return (
      <main
        data-initial-scroll-line={props.initialScrollLine}
        data-line-wrapping={props.lineWrapping}
        data-wrap-column={props.wrapColumn}
      >
        <header>
          {props.leadingHeaderActions}
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
    );
  },
}));

function adapterWithDiff(
  options: { patch?: string; binary?: boolean; tooLarge?: boolean; truncated?: boolean } = {},
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
          binary: options.binary ?? false,
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
  imagePreviewToggleMock.mockClear();
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

describe('DiffView diff lifecycle', () => {
  it('does not show the image preview toggle for a raster image', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'image.png', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({
          binary: true,
          patch: `diff --git a/image.png b/image.png
GIT binary patch
literal 1
abc
`,
        })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText('Image preview content')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Image preview' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions for image.png' }));
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Preview Image' }),
    ).not.toBeInTheDocument();
  });

  it('uses an independent image toggle without changing the file mode toggle', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'image.svg', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({
          patch: `diff --git a/image.svg b/image.svg
--- a/image.svg
+++ b/image.svg
@@ -1 +1 @@
-<svg />
+<svg id="updated" />
`,
        })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Image preview' });
    const viewToggle = screen.getByRole('button', { name: 'Toggle file editing' });
    expect(imagePreviewToggleMock.mock.calls[0]).toEqual([true, false]);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    expect(viewToggle).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByText('Image preview content')).toBeVisible();
    expect(toggle.compareDocumentPosition(viewToggle) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    const actions = toggle.closest('.diff-file-actions');
    if (!actions) throw new Error('Expected the selected file actions.');
    const menu = actions.querySelector<HTMLButtonElement>('.file-action-trigger');
    if (!menu) throw new Error('Expected the selected file menu.');
    expect(toggle.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await user.click(screen.getByRole('button', { name: 'More actions for image.svg' }));
    const rowImagePreview = screen.getByRole('menuitemcheckbox', {
      name: 'Stop Previewing Image',
    });
    expect(rowImagePreview).toHaveAttribute('aria-checked', 'true');
    expect(rowImagePreview).toBeEnabled();
    await user.click(rowImagePreview);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(menu);
    const detailImagePreview = screen.getByRole('menuitemcheckbox', { name: 'Preview Image' });
    expect(detailImagePreview).toHaveAttribute('aria-checked', 'false');
    expect(detailImagePreview).toBeEnabled();
    await user.click(detailImagePreview);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Image preview content')).toBeVisible();
    expect(viewToggle).toBeVisible();
  });

  it('keeps the image preview toggle mounted while switching between SVG files', async () => {
    const user = userEvent.setup();
    let resolveSecondQuery!: () => void;
    const secondQuery = new Promise<void>((resolve) => {
      resolveSecondQuery = resolve;
    });
    const workspace = adapterWithDiff();
    const queryDiff = workspace.query;
    workspace.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'diff' && request.path === 'second.svg') await secondQuery;
      return await queryDiff(request);
    });
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [
            { path: 'first.svg', area: 'unstaged', status: 'modified' },
            { path: 'second.svg', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={workspace}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Image preview' });
    const preview = await screen.findByText('Image preview content');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(changeRow(/second\.svg/u));
    await waitFor(() =>
      expect(workspace.query).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'diff', path: 'second.svg' }),
      ),
    );

    expect(screen.getByRole('button', { name: 'Image preview' })).toBe(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Image preview content')).toBe(preview);

    await act(async () => {
      resolveSecondQuery();
      await secondQuery;
    });
    await waitFor(() => expect(screen.getByText('Image preview content')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Image preview' })).toBe(toggle);
  });

  it('clears the retained diff when loading the next file fails', async () => {
    const user = userEvent.setup();
    const failure = new Error('Second diff query failed.');
    const workspace = adapterWithDiff();
    const queryDiff = workspace.query;
    workspace.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'diff' && request.path === 'second.ts') throw failure;
      return await queryDiff(request);
    });
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [
            { path: 'first.ts', area: 'unstaged', status: 'modified' },
            { path: 'second.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={workspace}
        onError={onError}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'first.ts' })).toBeVisible();
    expect(screen.getByTestId('diff-surface')).toBeVisible();
    await user.click(changeRow(/second\.ts/u));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.any(String), failure, expect.any(String)),
    );

    expect(screen.getByRole('heading', { name: 'second.ts' })).toBeVisible();
    expect(screen.queryByTestId('diff-surface')).not.toBeInTheDocument();
  });

  it('ends image preview and file editing from the editor menu', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'image.svg', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile('<svg xmlns="http://www.w3.org/2000/svg" />\n', {
          patch: `diff --git a/image.svg b/image.svg
--- a/image.svg
+++ b/image.svg
@@ -1 +1 @@
-<svg />
+<svg xmlns="http://www.w3.org/2000/svg" />
`,
        })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByText('Image preview content');
    await user.click(screen.getByRole('button', { name: 'Toggle file editing' }));
    await screen.findByRole('textbox', { name: 'Edit image.svg' });

    expect(screen.getByRole('button', { name: 'Image preview' })).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'More actions for selected file image.svg' }),
    );
    expect(screen.getByRole('menuitem', { name: 'Stop Editing File' })).toBeEnabled();
    const stopPreview = screen.getByRole('menuitemcheckbox', {
      name: 'Stop Previewing Image',
    });
    expect(stopPreview).toBeEnabled();
    await user.click(stopPreview);
    expect(screen.getByRole('button', { name: 'Image preview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'More actions for image.svg' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stop Editing File' }));
    expect(await screen.findByTestId('diff-surface')).toBeVisible();
  });

  it('keeps image preview disabled when the same selected file receives a new diff', async () => {
    const user = userEvent.setup();
    const workspace = adapterWithDiff({
      patch: `diff --git a/image.svg b/image.svg
--- a/image.svg
+++ b/image.svg
@@ -1 +1 @@
-<svg />
+<svg id="updated" />
`,
    });
    const view = render(
      <DiffView
        repo={repoSnapshot({
          generation: 1,
          changes: [{ path: 'image.svg', area: 'unstaged', status: 'modified' }],
        })}
        adapter={workspace}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Image preview' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    view.rerender(
      <DiffView
        repo={repoSnapshot({
          generation: 2,
          changes: [{ path: 'image.svg', area: 'unstaged', status: 'modified' }],
        })}
        adapter={workspace}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() => expect(workspace.query).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Image preview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows a pure raster rename only after its bytes pass the image probe', async () => {
    const workspace = adapterWithDiff({
      patch: `diff --git a/old.png b/new.png
similarity index 100%
rename from old.png
rename to new.png
`,
    });
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [
            {
              path: 'new.png',
              previousPath: 'old.png',
              area: 'staged',
              status: 'renamed',
            },
          ],
        })}
        adapter={workspace}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText('Image preview content')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(workspace.query).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'diff',
        path: 'new.png',
        previousPath: 'old.png',
      }),
    );
  });

  it('toggles image previews independently for multiple selected files', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithDiff();
    adapter.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind !== 'diff') return { kind: 'activity', entries: [] };
      const path = request.path;
      return {
        kind: 'diff',
        diff: {
          diffId: `revision-${path}`,
          repoId: request.repoId,
          path,
          area: request.area,
          generation: 1,
          patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
          binary: false,
          tooLarge: false,
        },
      };
    });
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [
            { path: 'first.svg', area: 'unstaged', status: 'modified' },
            { path: 'second.svg', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    const first = changeRow(/first\.svg/u);
    const second = changeRow(/second\.svg/u);
    await user.click(first);
    fireEvent.click(second, { shiftKey: true });

    await waitFor(() => expect(screen.getAllByText('Image preview content')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'More actions for first.svg' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Stop Previewing Image' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.keyboard('{Escape}');
    const toggles = screen.getAllByRole('button', { name: 'Image preview' });
    expect(toggles).toHaveLength(2);
    await user.click(toggles[0]!);
    expect(toggles[0]).toHaveAttribute('aria-pressed', 'false');
    expect(toggles[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Image preview content')).toHaveLength(1);
    expect(screen.getAllByTestId('diff-surface')).toHaveLength(1);
  });

  it('forwards diff query failures to the shared error dialog handler', async () => {
    const failure = new Error('Diff query failed.');
    const adapter = adapterWithDiff();
    adapter.query = vi.fn<WorkspaceAdapter['query']>(async () => {
      throw failure;
    });
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    render(
      <DiffView
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
      <DiffView
        repo={repoSnapshot({ changes: [] })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Diff' });
    const changedFiles = within(sidebar).getByRole('region', { name: 'Changed files' });
    const actions = screen.getByRole('group', { name: 'Actions' });
    const footer = within(sidebar).getByRole('contentinfo');
    expect(changedFiles.nextElementSibling).toBe(footer);
    expect(footer).toContainElement(actions);
    expect(within(footer).getByText('0 files')).toBeVisible();
    expect(within(footer).getByText('+0')).toBeVisible();
    expect(within(footer).getByText('−0')).toBeVisible();
    expect(screen.getByText('No diff.')).toHaveClass('diff-empty-state');
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
    expect(screen.getByRole('separator', { name: 'Diff list width' })).toBeVisible();
    expect(screen.getByRole('separator', { name: 'Diff list width' })).toHaveAttribute(
      'aria-valuemin',
      '360',
    );
    expect(screen.getByRole('separator', { name: 'Diff list width' })).toHaveAttribute(
      'aria-valuenow',
      '360',
    );
    expect(screen.queryByRole('separator', { name: 'Commit pane width' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Diff' })).not.toBeInTheDocument();
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
    const view = render(<DiffView {...props} diffFileListDisplay="tree" />);
    const sidebar = screen.getByRole('complementary', { name: 'Diff' });
    const footer = within(sidebar).getByRole('contentinfo');
    expect(within(footer).getByText('2 files')).toBeVisible();
    expect(within(footer).getByText('+13')).toBeVisible();
    expect(within(footer).getByText('−5')).toBeVisible();

    view.rerender(<DiffView {...props} diffFileListDisplay="fullPath" />);
    expect(within(footer).getByText('2 files')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Modified src/second.ts' }), {
      metaKey: true,
    });
    expect(within(footer).getByText('2 files selected')).toBeVisible();
  });

  it('defaults the file list to names and parent paths', () => {
    render(
      <DiffView
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
    expect(row.querySelector('.file-path strong')).toHaveTextContent('app.ts');
    expect(row.querySelector('.file-path small')).toHaveTextContent('src/features');
    expect(row).not.toHaveClass('is-single-line');
  });

  it('keeps the left pane resizable without changing the persisted History inspector width', async () => {
    const user = userEvent.setup();
    const onPaneWidthsChange = vi.fn<(widths: { left: number; right: number }) => void>();
    render(
      <DiffView
        repo={repoSnapshot({ changes: [] })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={onPaneWidthsChange}
      />,
    );

    screen.getByRole('separator', { name: 'Diff list width' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onPaneWidthsChange).toHaveBeenCalledWith({ left: 368, right: 330 });
  });

  it('labels a truncated diff and disables line selection', async () => {
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/large.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({ truncated: true })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(/cannot be displayed/u)).toBeVisible();
    expect(diffSurfaceMock).not.toHaveBeenCalled();
  });

  it('defers a single soft-limit diff until it is expanded', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/large.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({ patch: '+x\n'.repeat(20_001) })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(/too large to display/u)).toBeVisible();
    expect(diffSurfaceMock).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: 'Expand src/large.ts diff' });
    expect(toggle).toHaveAttribute('aria-controls', 'selected-file-diff-body');
    const body = document.getElementById('selected-file-diff-body');
    expect(body).toBeInTheDocument();
    expect(body).not.toContainElement(toggle);
    await user.click(toggle);
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ performanceMode: true }),
    );
  });

  it('keeps line selection enabled for a single-file performance diff', async () => {
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/large.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff({ tooLarge: true })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
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
      <DiffView
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

    await screen.findByTestId('diff-surface');
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
        <DiffView
          repo={repoSnapshot({
            changes: [{ path: 'src/app.ts', area, status: 'modified' }],
          })}
          adapter={adapterWithDiff()}
          onAction={onAction}
          paneWidths={{ left: 240, right: 330 }}
          onPaneWidthsChange={() => undefined}
        />,
      );
      await screen.findByTestId('diff-surface');
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
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
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
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
    await user.click(screen.getByRole('button', { name: 'Select diff lines' }));
    await user.click(screen.getByRole('button', { name: 'Copy selection shortcut' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('second line\nthird line'));
    expect(screen.getByRole('status')).toHaveTextContent('Copied the selected lines.');
  });

  it('hides line and Hunk staging actions when Stage display is hidden', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
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

    await screen.findByTestId('diff-surface');
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
      <DiffView
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
      <DiffView
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
      <DiffView
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
      <DiffView
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
      <DiffView
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
    expect(screen.getByRole('menuitem', { name: 'Discard Changes' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete File' })).toBeDisabled();
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
      <DiffView
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
    const { rerender } = render(<DiffView repo={initial} {...props} />);
    await screen.findByText('Conflict editor');
    await user.click(screen.getByRole('button', { name: 'Edit Result' }));

    rerender(
      <DiffView
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
      <DiffView
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
      <DiffView
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
    expect(pull).toHaveClass('diff-action-button');
    fireEvent.focus(pull);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pull');
    expect(pull).not.toHaveAttribute('title');
    expect(pull.querySelector('span')).not.toBeInTheDocument();
    expect(pull).toHaveAttribute('aria-expanded', 'false');
    for (const label of ['Commit', 'Push', 'Fetch']) {
      const action = within(actions).getByRole('button', { name: label });
      expect(action).toHaveClass('diff-action-button');
      expect(action).not.toHaveAttribute('title');
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
      <DiffView
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
      <DiffView
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
      <DiffView
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
      <DiffView
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

    await screen.findByTestId('diff-surface');
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
    expect(screen.getByRole('menuitem', { name: 'Discard Changes' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete File' })).toBeDisabled();
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
      <DiffView
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
    const { rerender } = render(<DiffView repo={repo} {...props} />);

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
    rerender(<DiffView repo={{ ...repo, generation: 2 }} {...props} />);
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
      <DiffView
        repo={first}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');
    expect(adapter.query).toHaveBeenCalledTimes(1);

    rerender(
      <DiffView
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
    const { rerender } = render(<DiffView repo={first} {...props} />);
    await screen.findByTestId('diff-surface');

    rerender(<DiffView repo={{ ...first, generation: 2 }} {...props} />);
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId('diff-surface')).toBeVisible();
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
      <DiffView
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
    await screen.findByTestId('diff-surface');
    expect(screen.queryByRole('group', { name: 'Diff layout' })).not.toBeInTheDocument();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        diffStyle: 'split',
        lineWrapping: true,
        wrapColumn: 96,
      }),
    );
  });

  it('opens a changed file from the Diff mode toggles and returns through Display', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
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
    await screen.findByTestId('diff-surface');

    const editButton = screen.getByRole('button', { name: 'Toggle file editing' });
    fireEvent.focus(editButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Toggle file editing');
    expect(editButton).not.toHaveAttribute('title');
    expect(editButton).toHaveAttribute('aria-pressed', 'false');
    expect(editButton).not.toHaveAttribute('data-animate-on-mount');
    expect(editButton).not.toHaveTextContent('Edit');
    await user.click(editButton);
    expect(await screen.findByRole('textbox', { name: 'Edit src/app.ts' })).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Edit src/app.ts' }).closest('main'),
    ).toHaveAttribute('data-line-wrapping', 'true');
    expect(
      screen.getByRole('textbox', { name: 'Edit src/app.ts' }).closest('main'),
    ).toHaveAttribute('data-wrap-column', '96');
    expect(screen.queryByTestId('diff-surface')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Display' }));
    expect(await screen.findByTestId('diff-surface')).toBeVisible();
  });

  it('opens an unchanged selected line from the mode toggles and restores it in the Diff', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');

    await user.click(screen.getByRole('button', { name: 'Select unchanged line' }));
    await user.click(screen.getByRole('button', { name: 'Open selection menu' }));
    const menu = screen.getByRole('menu', { name: 'Selected lines' });
    expect(within(menu).getByRole('menuitem', { name: 'Edit Lines' })).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: 'Copy Selected Lines' })).toBeVisible();
    expect(within(menu).queryByRole('menuitem', { name: 'Stage Selected Lines' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Discard Selected Lines' })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Toggle file editing' }));
    const editor = await screen.findByRole('textbox', { name: 'Edit src/app.ts' });
    expect(editor.closest('main')).toHaveAttribute('data-initial-scroll-line', '4');

    await user.click(screen.getByRole('button', { name: 'Display' }));
    await screen.findByTestId('diff-surface');
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
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile('keep-1\nkeep-4\n', { patch })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');

    await user.click(screen.getByRole('button', { name: 'Select deleted line' }));
    await user.click(screen.getByRole('button', { name: 'Toggle file editing' }));

    const editor = await screen.findByRole('textbox', { name: 'Edit src/app.ts' });
    expect(editor.closest('main')).toHaveAttribute('data-initial-scroll-line', '2');
  });

  it('keeps the ellipsis file menu in the editor and restricts destructive actions while dirty', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');
    await user.click(screen.getByRole('button', { name: 'Toggle file editing' }));
    await screen.findByRole('textbox', { name: 'Edit src/app.ts' });

    const menuTrigger = screen.getByRole('button', {
      name: 'More actions for selected file src/app.ts',
    });
    expect(menuTrigger).toBeVisible();
    await user.click(menuTrigger);
    expect(screen.getByRole('menuitem', { name: 'Stop Editing File' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeEnabled();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Edit File Draft' }));
    await user.click(menuTrigger);
    expect(screen.getByRole('menuitem', { name: 'Stop Editing File' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Open in Default App' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Changes' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete File' })).toBeDisabled();
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
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapter}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');

    await user.click(screen.getByRole('button', { name: 'Toggle file editing' }));

    expect(screen.getByTestId('diff-surface')).toBeVisible();
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
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');
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
      <DiffView
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
    await waitFor(() => expect(screen.getAllByTestId('diff-surface')).toHaveLength(2));

    const secondMenus = screen.getAllByRole('button', { name: 'More actions for src/second.ts' });
    const secondMenu = secondMenus[0];
    if (!secondMenu) throw new Error('Expected the row action menu.');
    await user.click(secondMenu);
    await user.click(screen.getByRole('menuitem', { name: 'Edit File' }));

    expect(await screen.findByRole('textbox', { name: 'Edit src/second.ts' })).toBeVisible();
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows mode toggles for every selected Diff and edits the chosen file', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
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
    await waitFor(() => expect(screen.getAllByTestId('diff-surface')).toHaveLength(2));

    const editToggles = screen.getAllByRole('button', { name: 'Toggle file editing' });
    expect(editToggles).toHaveLength(2);
    expect(editToggles.every((toggle) => toggle.getAttribute('aria-pressed') === 'false')).toBe(
      true,
    );
    await user.click(editToggles[1]!);

    expect(await screen.findByRole('textbox', { name: 'Edit src/second.ts' })).toBeVisible();
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('blocks repository mutations while a file editor is dirty', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithFile()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    await screen.findByTestId('diff-surface');
    await user.click(screen.getByRole('button', { name: 'Toggle file editing' }));
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
    const { rerender } = render(<DiffView repo={initial} {...props} />);
    await screen.findByTestId('diff-surface');

    await user.click(screen.getByRole('checkbox', { name: 'Stage src/app.ts' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'stageFiles', paths: ['src/app.ts'] });

    rerender(
      <DiffView
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
    ['Delete File', 'moveToTrash'],
  ] as const)('routes %s through the typed file action', async (itemName, operation) => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <DiffView
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

  it('restores a deleted file but does not reveal its missing path in Finder', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/deleted.ts', area: 'unstaged', status: 'deleted' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
    await user.click(screen.getByRole('button', { name: 'More actions for src/deleted.ts' }));
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Discard Changes' })).toBeEnabled();
    await user.keyboard('{Escape}');

    await user.click(
      screen.getByRole('button', { name: 'More actions for selected file src/deleted.ts' }),
    );
    expect(screen.getByRole('menuitem', { name: 'Show in Finder' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Discard Changes' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'discardFiles', paths: ['src/deleted.ts'] });
  });

  it('renames a modified file from the inline field opened by double-click', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
    await user.dblClick(screen.getByRole('button', { name: 'Modified src/app.ts' }));
    const input = screen.getByRole('textbox', { name: 'Rename src/app.ts' });
    await user.clear(input);
    await user.type(input, 'renamed.ts{Enter}');

    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        kind: 'renameFile',
        path: 'src/app.ts',
        newPath: 'src/renamed.ts',
      }),
    );
  });

  it('opens the same inline rename field from the right-pane file menu', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
    const toolbar = screen.getByRole('heading', { name: 'src/app.ts' }).closest('.pane-toolbar');
    if (!toolbar) throw new Error('Expected a file header toolbar.');
    fireEvent.contextMenu(toolbar, { clientX: 240, clientY: 180 });
    await user.click(screen.getByRole('menuitem', { name: 'Rename File' }));

    expect(screen.getByRole('textbox', { name: 'Rename src/app.ts' })).toHaveValue('app.ts');
  });

  it('routes multiple selected files through the discard action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <DiffView
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
    await user.click(screen.getByRole('menuitem', { name: 'Discard Changes' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'discardFiles',
      paths: ['src/first.ts', 'src/second.ts'],
    });
  });

  it('renders every file selected in the left pane in the right pane', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    render(
      <DiffView
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

    await waitFor(() => expect(screen.getAllByTestId('diff-surface')).toHaveLength(2));
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
    expect(firstToolbar.closest('.multi-diff-item')).toHaveClass('is-collapsed');
    const latestPropsFor = (path: string) =>
      diffSurfaceMock.mock.calls.findLast(([props]) => props.source?.path === path)?.[0];
    expect(latestPropsFor('src/first.ts')).toEqual(expect.objectContaining({ collapsed: true }));
    expect(latestPropsFor('src/second.ts')).toEqual(expect.objectContaining({ collapsed: false }));
  });

  it('defers every selected file when their combined profiles exceed the soft limit', async () => {
    const user = userEvent.setup();
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [
            { path: 'src/first.ts', area: 'unstaged', status: 'modified' },
            { path: 'src/second.ts', area: 'unstaged', status: 'modified' },
          ],
        })}
        adapter={adapterWithDiff({ patch: '+x\n'.repeat(10_001) })}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.click(changeRow(/first\.ts/u));
    fireEvent.click(changeRow(/second\.ts/u), { shiftKey: true });

    const firstToggle = await screen.findByRole('button', { name: 'Expand src/first.ts diff' });
    expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    const controlledId = firstToggle.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    const controlledBody = controlledId ? document.getElementById(controlledId) : null;
    expect(controlledBody).toBeInTheDocument();
    expect(controlledBody).not.toContainElement(firstToggle);
    expect(screen.getByRole('button', { name: 'Expand src/second.ts diff' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    diffSurfaceMock.mockClear();
    expect(diffSurfaceMock).not.toHaveBeenCalled();

    await user.click(firstToggle);
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        performanceMode: true,
        source: expect.objectContaining({ path: 'src/first.ts' }),
      }),
    );
  });

  it('keeps file headers in the normal scroll flow by default', async () => {
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
    const toolbar = screen.getByRole('heading', { name: 'src/app.ts' }).closest('.pane-toolbar');
    expect(toolbar).not.toHaveClass('is-sticky');
    expect(toolbar?.closest('.diff-pane')).toHaveClass('has-static-file-headers');
  });

  it('opens the ellipsis file menu from a right-click on the file header', async () => {
    render(
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
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
      <DiffView
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
      <DiffView
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
      <DiffView
        repo={repoSnapshot({
          changes: [{ path: 'src/app.ts', area: 'unstaged', status: 'modified' }],
        })}
        adapter={adapterWithDiff()}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await screen.findByTestId('diff-surface');
    expect(
      screen.queryByRole('button', { name: 'Collapse src/app.ts diff' }),
    ).not.toBeInTheDocument();
    expect(diffSurfaceMock.mock.lastCall?.[0]).not.toHaveProperty('collapsed');
  });

  it('disables every file-action trigger while the app is globally busy', () => {
    render(
      <DiffView
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
