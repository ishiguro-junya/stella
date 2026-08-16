import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { HISTORY_PAGE_SIZE } from '../../domain/historyLanes';
import type {
  CommitDetails,
  CommitSummary,
  QueryResult,
  WorkspaceAction,
} from '../../domain/workspace';
import { repoSnapshot } from '../../test/fixtures';
import { HistoryView } from './HistoryView';

const { diffSurfaceMock, imagePreviewToggleMock, imageProbeState } = vi.hoisted(() => ({
  diffSurfaceMock: vi.fn<(props: unknown) => void>(),
  imagePreviewToggleMock: vi.fn<(pressed: boolean, disabled: boolean | undefined) => void>(),
  imageProbeState: { previewable: true },
}));

interface IntersectionObserverRecord {
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
  options: IntersectionObserverInit;
  target?: Element;
}

let intersectionObserver: IntersectionObserverRecord | undefined;

function latestIntersectionObserver(): IntersectionObserverRecord {
  const observer = intersectionObserver;
  if (!observer?.target) throw new Error('History sentinel was not observed.');
  return observer;
}

function intersect(observer = latestIntersectionObserver()): void {
  act(() => {
    const target = observer.target;
    if (!target) throw new Error('History sentinel was not observed.');
    const rect = target.getBoundingClientRect();
    const entry: IntersectionObserverEntry = {
      time: 0,
      target,
      rootBounds: null,
      boundingClientRect: rect,
      intersectionRect: rect,
      isIntersecting: true,
      intersectionRatio: 1,
    };
    observer.callback([entry], observer.observer);
  });
}

vi.mock('../diff/DiffSurface', () => ({
  DiffSurface: (props: unknown) => {
    diffSurfaceMock(props);
    return <div>Diff</div>;
  },
  DiffFileHeader: ({
    path,
    status,
    collapsed,
    onToggle,
    trailing,
  }: {
    path: string;
    status: string;
    collapsed: boolean;
    onToggle: () => void;
    trailing?: ReactNode;
  }) => (
    <div className="diff-file-custom-header" data-testid="diff-file-header">
      <div className="diff-file-custom-header-title">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${path} diff`}
          onClick={onToggle}
        >
          Toggle
        </button>
        <span className={`file-status ${status}`} />
        <span>{path}</span>
      </div>
      {trailing}
    </div>
  ),
}));
vi.mock('../diff/ImageDiffPreview', () => ({
  ImageDiffPreview: ({
    candidate,
    hidden,
    onProbeResult,
  }: {
    candidate: { path: string };
    hidden?: boolean;
    onProbeResult?: (previewable: boolean) => void;
  }) => {
    useEffect(() => onProbeResult?.(imageProbeState.previewable), [onProbeResult]);
    return hidden ? null : <div>Image preview content: {candidate.path}</div>;
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

function adapterWithQuery(query: WorkspaceAdapter['query']): WorkspaceAdapter {
  return {
    attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
    query,
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

function commitDetails(diff: CommitDetails['diff']): CommitDetails {
  return {
    oid: 'head',
    shortOid: 'head',
    subject: 'feat: current',
    body: '',
    authorName: 'Stella',
    authoredAt: '2026-08-08T00:00:00Z',
    parents: [],
    refs: ['main'],
    lane: 0,
    ...(diff ? { diff } : {}),
  };
}

function commitSummary(oid: string, parents: string[] = [], refs: string[] = []): CommitSummary {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    subject: oid,
    authorName: 'Stella',
    authoredAt: '2026-08-08T00:00:00Z',
    parents,
    refs,
    lane: 0,
  };
}

function linearHistory(prefix: string, count: number): CommitSummary[] {
  return Array.from({ length: count }, (_, index) =>
    commitSummary(
      `${prefix}-${index}`,
      index + 1 < count ? [`${prefix}-${index + 1}`] : [`${prefix}-${count}`],
      index === 0 ? ['main'] : [],
    ),
  );
}

beforeEach(() => {
  diffSurfaceMock.mockClear();
  imagePreviewToggleMock.mockClear();
  imageProbeState.previewable = true;
  intersectionObserver = undefined;
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly scrollMargin: string;
    readonly thresholds: readonly number[];

    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? '0px';
      this.scrollMargin = options.scrollMargin ?? '0px';
      this.thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold ?? 0];
      intersectionObserver = { callback, observer: this, options };
    }

    observe(target: Element): void {
      if (intersectionObserver) intersectionObserver.target = target;
    }

    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    unobserve(): void {}
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => vi.unstubAllGlobals());

async function openCommitMenu(
  user: ReturnType<typeof userEvent.setup>,
  oid = 'head',
): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole('button', { name: `More actions for commit ${oid.slice(0, 7)}` }),
  );
  return screen.findByRole('menu');
}

async function openCommitAction(
  user: ReturnType<typeof userEvent.setup>,
  action: string,
  dialogName: string,
  oid = 'head',
): Promise<HTMLElement> {
  await openCommitMenu(user, oid);
  await user.click(screen.getByRole('menuitem', { name: action }));
  return screen.findByRole('dialog', { name: dialogName });
}

describe('HistoryView', () => {
  it('shows the empty History state in the detail pane when the repository has no commits', () => {
    render(
      <HistoryView
        repo={repoSnapshot({ history: [] })}
        adapter={adapterWithQuery(async () => ({ kind: 'activity', entries: [] }))}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const emptyState = screen.getByText('No history.');
    expect(emptyState).toHaveClass('diff-empty-state');
    expect(emptyState.closest('.commit-detail-pane')).not.toBeNull();
    expect(screen.queryByText('Select a commit.')).not.toBeInTheDocument();
  });

  it('shows no Diff content or empty-state message for an empty commit', async () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'feat: current' })).toBeVisible();
    expect(screen.queryByText('Diff')).not.toBeInTheDocument();
    expect(screen.queryByText('No changes in this commit.')).not.toBeInTheDocument();
  });

  it('does not show the image preview toggle for a raster image', async () => {
    const rasterDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'raster-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: `diff --git a/image.png b/image.png
GIT binary patch
literal 1
abc
`,
      binary: true,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(rasterDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText('Image preview content: image.png')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Image preview' })).not.toBeInTheDocument();
  });

  it('toggles only the image section and keeps a mixed commit diff visible', async () => {
    const user = userEvent.setup();
    const mixedDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'mixed-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-old
+new
diff --git a/image.svg b/image.svg
--- a/image.svg
+++ b/image.svg
@@ -1 +1 @@
-<svg />
+<svg id="updated" />
`,
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(mixedDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Image preview' });
    expect(imagePreviewToggleMock.mock.calls[0]).toEqual([true, false]);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('Image preview content: image.svg')).toBeVisible();
    expect(screen.getAllByText('Diff')).toHaveLength(1);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Image preview content: image.svg')).not.toBeInTheDocument();
    expect(screen.getAllByText('Diff')).toHaveLength(2);
  });

  it('shows a pure raster rename without an image preview toggle after the probe', async () => {
    const renameDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'rename-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: `diff --git a/old.png b/new.png
similarity index 100%
rename from old.png
rename to new.png
`,
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(renameDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByText('Image preview content: new.png')).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Diff')).not.toBeInTheDocument();
  });

  it('falls back to a normal file diff when a pure rename is not an image', async () => {
    imageProbeState.previewable = false;
    const renameDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'text-rename-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`,
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(renameDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText('Diff')).toBeVisible();
    expect(screen.queryByText('Image preview content: new.txt')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ kind: 'patch', path: 'new.txt' }),
        showFileHeaders: true,
      }),
    );
  });

  it('uses the shared file header with independent controls for each History image', async () => {
    const user = userEvent.setup();
    const imageDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'two-images-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: `diff --git a/first.svg b/first.svg
--- a/first.svg
+++ b/first.svg
@@ -1 +1 @@
-<svg />
+<svg id="first" />
diff --git a/second.svg b/second.svg
--- a/second.svg
+++ b/second.svg
@@ -1 +1 @@
-<svg />
+<svg id="second" />
`,
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(imageDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    const { container } = render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const toggles = await screen.findAllByRole('button', { name: 'Image preview' });
    expect(toggles).toHaveLength(2);
    expect(screen.getAllByTestId('diff-file-header')).toHaveLength(2);
    expect(container.querySelector('.commit-detail-actions .image-preview-toggle')).toBeNull();
    expect(toggles[0]?.closest('.history-image-file-header')).toHaveTextContent('first.svg');
    expect(toggles[1]?.closest('.history-image-file-header')).toHaveTextContent('second.svg');
    expect(
      toggles[0]?.closest('.history-image-file-header')?.querySelector('.file-status.modified'),
    ).toBeInTheDocument();
    expect(diffSurfaceMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Collapse first.svg diff' })).toBeVisible(),
    );
    await user.click(screen.getByRole('button', { name: 'Collapse first.svg diff' }));
    expect(screen.queryByText('Image preview content: first.svg')).not.toBeInTheDocument();
    expect(screen.getByText('Image preview content: second.svg')).toBeVisible();
    expect(toggles[0]).toHaveAttribute('aria-pressed', 'false');
    expect(toggles[1]).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggles[0]!);
    expect(screen.getByText('Image preview content: first.svg')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Collapse first.svg diff' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('focuses the selected commit when opened and moves it with the arrow keys', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return {
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), oid: request.oid, shortOid: request.oid },
          };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          selectedCommitOid: 'first',
          history: [commitSummary('first'), commitSummary('second')],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    const first = document.querySelector<HTMLButtonElement>('[data-history-commit-oid="first"]')!;
    const second = document.querySelector<HTMLButtonElement>('[data-history-commit-oid="second"]')!;

    await waitFor(() => expect(first).toHaveFocus());
    await user.keyboard('{ArrowDown}');

    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-current', 'true');
    const historyList = second.closest('.commit-list');
    expect(historyList).toHaveClass('is-keyboard-navigating');

    fireEvent.pointerMove(historyList!);
    expect(historyList).not.toHaveClass('is-keyboard-navigating');

    const historySearch = document.querySelector<HTMLInputElement>('.history-search input');
    if (!historySearch) throw new Error('History search input was not rendered.');
    historySearch.focus();
    fireEvent.click(second);
    expect(second).toHaveFocus();

    second.blur();
    expect(document.body).toHaveFocus();
    await user.keyboard('{ArrowUp}');

    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('moves once for every rapid global arrow-key event', async () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return {
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), oid: request.oid, shortOid: request.oid },
          };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          selectedCommitOid: 'first',
          history: ['first', 'second', 'third', 'fourth'].map((oid) => commitSummary(oid)),
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const first = document.querySelector<HTMLButtonElement>('[data-history-commit-oid="first"]')!;
    const fourth = document.querySelector<HTMLButtonElement>('[data-history-commit-oid="fourth"]')!;
    await waitFor(() => expect(first).toHaveFocus());
    first.blur();

    act(() => {
      for (let index = 0; index < 3; index += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }
    });

    expect(fourth).toHaveFocus();
    expect(fourth).toHaveAttribute('aria-current', 'true');
  });

  it('moves the left selection without rerendering the loaded detail pane', async () => {
    const user = userEvent.setup();
    const diff = {
      diffId: 'first-diff',
      repoId: 'repo-1',
      path: 'src/app.ts',
      area: 'staged' as const,
      generation: 1,
      patch: `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new
`,
      binary: false,
      tooLarge: false,
    };
    const pendingDetails = new Promise<QueryResult>(() => undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>((request) => {
        if (request.kind !== 'commitDetails') {
          return Promise.resolve({ kind: 'activity' as const, entries: [] });
        }
        if (request.oid === 'first') {
          return Promise.resolve({
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(diff), oid: 'first', shortOid: 'first' },
          });
        }
        return pendingDetails;
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          selectedCommitOid: 'first',
          history: [commitSummary('first'), commitSummary('second')],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const first = document.querySelector<HTMLButtonElement>('[data-history-commit-oid="first"]')!;
    const second = document.querySelector<HTMLButtonElement>('[data-history-commit-oid="second"]')!;
    await waitFor(() => expect(diffSurfaceMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(first).toHaveFocus());
    diffSurfaceMock.mockClear();
    const focus = vi.spyOn(second, 'focus');
    const scrollIntoView = vi.fn<HTMLElement['scrollIntoView']>();
    second.scrollIntoView = scrollIntoView;

    await user.keyboard('{ArrowDown}');

    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }),
    );
    expect(diffSurfaceMock).not.toHaveBeenCalled();
  });

  it('checks out an unambiguous local branch when its history item is double-clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return {
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), oid: request.oid, shortOid: request.oid },
          };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'main-oid', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('main-oid', [], ['HEAD -> refs/heads/main']),
            commitSummary('feature-oid', [], ['refs/heads/feature']),
            commitSummary('ambiguous-oid', [], ['refs/heads/topic-a', 'refs/heads/topic-b']),
            commitSummary('remote-oid', [], ['refs/remotes/origin/remote']),
          ],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.dblClick(screen.getByRole('button', { name: /feature-oid/u }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'checkoutBranch', name: 'feature' });

    onAction.mockClear();
    await user.dblClick(screen.getByRole('button', { name: /main-oid/u }));
    await user.dblClick(screen.getByRole('button', { name: /remote-oid/u }));
    await user.dblClick(screen.getByRole('button', { name: /ambiguous-oid/u }));
    expect(onAction).not.toHaveBeenCalled();

    await user.dblClick(screen.getByText('topic-b'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'checkoutBranch', name: 'topic-b' });
  });

  it('shows uncommitted changes before the commit list and opens Diff when selected', async () => {
    const user = userEvent.setup();
    const onShowDiff = vi.fn<() => void>();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const dirtyRepo = repoSnapshot({
      history: [commitSummary('head')],
      changes: [
        { path: 'src/app.ts', area: 'staged', status: 'modified' },
        { path: 'src/app.ts', area: 'unstaged', status: 'modified' },
        { path: 'README.md', area: 'untracked', status: 'added' },
      ],
    });
    const { rerender } = render(
      <HistoryView
        repo={dirtyRepo}
        adapter={adapter}
        onShowDiff={onShowDiff}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const historyPane = screen.getByRole('complementary', { name: 'Commit history' });
    const historyList = within(historyPane).getByRole('list');
    expect(historyList.firstElementChild).toHaveClass('history-working-tree-item');
    const workingTreeButton = within(historyPane).getByRole('button', {
      name: 'Uncommitted changes, 2 files',
    });
    expect(workingTreeButton).toHaveClass('commit-row', 'history-working-tree-entry');
    expect(within(historyPane).getByText('Uncommitted changes')).toBeVisible();
    expect(within(historyPane).getByText('2 files')).toBeVisible();
    const workingTreeGraph = within(historyPane).getByTestId('history-graph-working-tree');
    expect(workingTreeGraph).toHaveStyle('--history-lane-color: var(--history-working-tree)');
    expect(workingTreeGraph.querySelector('[data-edge-kind="working-tree"]')).toBeInTheDocument();
    expect(
      within(historyPane)
        .getByTestId('history-graph-head')
        .querySelector('[data-edge-kind="working-tree"]'),
    ).toBeInTheDocument();
    await user.click(workingTreeButton);
    expect(onShowDiff).toHaveBeenCalledOnce();

    rerender(
      <HistoryView
        repo={{ ...dirtyRepo, changes: [] }}
        adapter={adapter}
        onShowDiff={onShowDiff}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );
    expect(within(historyPane).queryByText('Uncommitted changes')).not.toBeInTheDocument();
  });

  it('searches operation history through the adapter and focuses the field with Command-F', async () => {
    const user = userEvent.setup();
    const searchResult = {
      ...commitSummary('remote-match', [], ['refs/remotes/origin/feature']),
      subject: 'fix: remote result',
      authorName: 'Search Author',
    };
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') {
        return {
          kind: 'history' as const,
          commits: request.search === 'origin/feature' ? [searchResult] : [],
        };
      }
      if (request.kind === 'commitDetails') {
        return {
          kind: 'commitDetails' as const,
          commit: {
            ...commitDetails(undefined),
            oid: request.oid,
            shortOid: request.oid.slice(0, 7),
          },
        };
      }
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'local-head', detached: false, ahead: 0, behind: 0 },
          history: [commitSummary('local-head')],
        })}
        adapter={adapterWithQuery(query)}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Search history' });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }),
      );
    });
    expect(search).toHaveFocus();

    await user.type(search, 'origin/feature');
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith({
        kind: 'history',
        repoId: 'repo-1',
        limit: HISTORY_PAGE_SIZE,
        skip: 0,
        search: 'origin/feature',
      }),
    );
    expect(await screen.findByRole('button', { name: /fix: remote result/u })).toBeVisible();
    expect(screen.getByText('origin/feature')).toBeVisible();
    expect(screen.queryByRole('button', { name: /local-head/u })).not.toBeInTheDocument();

    await user.clear(search);
    expect(await screen.findByRole('button', { name: /local-head/u })).toBeVisible();
  });

  it('shows an empty state when operation history has no search matches', async () => {
    const user = userEvent.setup();
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') return { kind: 'history' as const, commits: [] };
      if (request.kind === 'commitDetails') {
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      }
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitSummary('head')] })}
        adapter={adapterWithQuery(query)}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search history' }), 'missing');
    expect(await screen.findByText('No commits match your search.')).toBeVisible();
  });

  it('forwards query failures to the shared error dialog handler', async () => {
    const failure = new Error('History query failed.');
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    const currentCommit = commitDetails(undefined);
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [currentCommit],
        })}
        adapter={adapterWithQuery(
          vi.fn<WorkspaceAdapter['query']>(async () => {
            throw failure;
          }),
        )}
        onError={onError}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        'Could not load commit details',
        failure,
        'Could not load commit details.',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves History actions to each commit menu and restores focus through the focused dialog', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const historyPane = screen.getByRole('complementary', { name: 'Commit history' });
    expect(historyPane.firstElementChild).toHaveClass('commit-list');
    expect(historyPane.lastElementChild).toHaveClass('history-list-footer');
    expect(historyPane.lastElementChild?.firstElementChild).toHaveClass('history-search');
    expect(within(historyPane).queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(historyPane).queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
    expect(historyPane.querySelector('.history-branch-context')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();

    const toggle = await screen.findByRole('button', { name: 'More actions for commit head' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu');

    const menu = await openCommitMenu(user);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Create Branch', 'Create Tag', 'Merge', 'Rebase', 'Cherry-pick', 'Revert', 'Reset']);
    expect(within(menu).getByRole('menuitem', { name: 'Create Branch' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();

    const dialog = await openCommitAction(user, 'Create Branch', 'Create branch');
    expect(within(dialog).getByText('feat: current')).toBeVisible();
    expect(within(dialog).getByText('head')).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Branch name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Create branch' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /feat: current/u })).toHaveFocus();
  });

  it('keeps the detail action trigger visible at the right edge of the commit title', async () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitDetails(undefined)] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const listTrigger = screen.getByRole('button', { name: 'More actions for commit head' });
    const detailTrigger = await screen.findByRole('button', {
      name: 'More actions for selected commit head',
    });
    expect(listTrigger).not.toHaveClass('is-persistent');
    expect(detailTrigger).toHaveClass('is-persistent');
    expect(detailTrigger.closest('.commit-detail-heading')).toContainElement(
      screen.getByRole('heading', { name: 'feat: current' }),
    );
  });

  it('selects a commit and opens the same menu at the pointer on right-click', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [commitSummary('first'), commitSummary('second')] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const second = screen.getByRole('button', { name: /^second/u });
    fireEvent.contextMenu(second, { clientX: 120, clientY: 180 });
    const menu = screen.getByRole('menu', { name: 'second second actions' });
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Create Branch' })).toHaveFocus();
    expect(menu).toBeVisible();
    expect(menu).toHaveStyle({ left: '120px', top: '180px' });
    expect(screen.queryByRole('menuitem', { name: 'Checkout' })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole('menuitem', { name: 'Rebase' }));
    expect(screen.getByRole('dialog', { name: 'Rebase' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Source ref' })).toHaveValue('second');
  });

  it('creates a local Tag from the selected commit', async () => {
    const user = userEvent.setup();
    const currentCommit = commitDetails(undefined);
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'commitDetails'
          ? { kind: 'commitDetails' as const, commit: currentCommit }
          : { kind: 'activity' as const, entries: [] },
      ),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [currentCommit] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const dialog = await openCommitAction(user, 'Create Tag', 'Create Tag');
    const input = within(dialog).getByRole('textbox', { name: 'Tag name' });
    expect(
      screen.getByText('Creates a lightweight tag locally. It is not pushed to a remote.'),
    ).toBeVisible();
    await user.type(input, 'v1.0.0');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'createTag',
      name: 'v1.0.0',
      targetOid: currentCommit.oid,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create Tag' })).not.toBeInTheDocument(),
    );
  });

  it('shows commits from every ref without a visibility toggle', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    const baseCommit = {
      authorName: 'Stella',
      authoredAt: '2026-08-08T00:00:00Z',
      refs: [] as string[],
      lane: 0,
    };
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [
        {
          ...baseCommit,
          oid: 'head',
          shortOid: 'head',
          subject: 'current head',
          parents: ['base'],
          refs: ['main'],
        },
        {
          ...baseCommit,
          oid: 'other',
          shortOid: 'other',
          subject: 'other branch only',
          parents: [],
        },
        {
          ...baseCommit,
          oid: 'base',
          shortOid: 'base',
          subject: 'shared base',
          parents: [],
        },
      ],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const currentHead = screen.getByRole('button', { name: /current head/u });
    expect(currentHead).toBeInTheDocument();
    const commitMetadata = currentHead.querySelector('.commit-metadata');
    if (!commitMetadata) throw new Error('Commit metadata was not found.');
    const authoredAt = commitMetadata?.querySelector('time');
    expect(commitMetadata?.querySelector('.commit-author')).toHaveTextContent('Stella');
    expect(commitMetadata?.querySelector('.commit-oid')).toHaveTextContent('head');
    expect([...commitMetadata.children].map((element) => element.className)).toEqual([
      'commit-oid',
      'commit-author',
      '',
    ]);
    expect(commitMetadata?.querySelector('.commit-metadata-separator')).not.toBeInTheDocument();
    expect(commitMetadata).not.toHaveTextContent('·');
    expect(authoredAt).toHaveAttribute('datetime', '2026-08-08T00:00:00Z');
    expect(authoredAt?.textContent).toMatch(/\d{1,2}:\d{2}/u);
    expect(currentHead.querySelector(':scope > time')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shared base/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /other branch only/u })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'All refs' })).not.toBeInTheDocument();
  });

  it('shows the Commit ID, Author, and Date in order and suppresses a duplicated commit body', async () => {
    const details = {
      ...commitDetails(undefined),
      subject: 'docs: update documentation',
      body: 'docs: update documentation',
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: details };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [details] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const detailPane = await screen.findByRole('main', { name: details.subject });
    expect(within(detailPane).getAllByText(details.subject)).toHaveLength(1);
    expect(detailPane.querySelector('.commit-detail-heading .eyebrow')).not.toBeInTheDocument();
    const commitIdGroup = within(detailPane)
      .getByText('Commit ID', { selector: 'dt' })
      .closest<HTMLElement>('div');
    expect(commitIdGroup).toHaveTextContent('Commit ID');
    if (!commitIdGroup) throw new Error('Commit ID metadata was not found.');
    expect(within(commitIdGroup).getByText(details.shortOid, { selector: 'code' })).toBeVisible();
    expect(commitIdGroup.nextElementSibling).toHaveTextContent('Author');
    expect(commitIdGroup.nextElementSibling?.nextElementSibling).toHaveTextContent('Date');
  });

  it('shows a distinct commit body as secondary detail text', async () => {
    const details = {
      ...commitDetails(undefined),
      body: '変更理由を補足します。',
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: details };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({ history: [details] })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(details.body)).toHaveClass('commit-detail-body');
  });

  it('shows Tag and shortened branch decorations without tooltips', async () => {
    const refs = ['refs/remotes/origin/main', 'tag: refs/tags/v1.2.3', 'HEAD -> refs/heads/main'];
    const details = { ...commitDetails(undefined), refs };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails') {
          return { kind: 'commitDetails' as const, commit: details };
        }
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [{ ...details, refs }],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getAllByLabelText('Tag v1.2.3')).toHaveLength(2));
    const tags = screen.getAllByLabelText('Tag v1.2.3');
    const branchChips = document.querySelectorAll('.ref-chip.branch, .ref-chip.remote');
    expect(screen.getAllByText('main')).toHaveLength(2);
    expect(screen.getAllByText('origin/main')).toHaveLength(2);
    expect(branchChips).toHaveLength(4);
    expect([...branchChips].every((chip) => !chip.hasAttribute('tabindex'))).toBe(true);
    fireEvent.focus(branchChips[0]!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(tags.every((tag) => !tag.hasAttribute('title'))).toBe(true);
    expect(tags.every((tag) => !tag.hasAttribute('tabindex'))).toBe(true);
    fireEvent.focus(tags[0]!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('lays out lanes from every ref immediately', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'main-tip', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('main-tip', ['main-base'], ['main']),
            commitSummary('hidden-tip', ['hidden-base'], ['feature']),
            commitSummary('main-base', ['root']),
            commitSummary('hidden-base', ['root']),
            commitSummary('root'),
          ],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const graph = screen.getByTestId('history-graph-main-base');
    expect(graph.querySelectorAll('svg')).toHaveLength(1);
    const mainEdge = graph.querySelector<SVGPathElement>(
      '[data-edge-kind="incoming"][data-from-lane="0"]',
    );
    const sideEdge = graph.querySelector<SVGLineElement>(
      '[data-edge-kind="active"][data-from-lane="1"]',
    );
    expect(mainEdge?.style.getPropertyValue('--history-lane-color')).toBe('var(--history-lane-0)');
    expect(sideEdge?.style.getPropertyValue('--history-lane-color')).toBe('var(--history-lane-1)');
    expect(sideEdge).toHaveAttribute('y2', '100%');
    expect(graph.style.getPropertyValue('--history-lane-color')).toBe('var(--history-lane-0)');
    expect(
      screen
        .getByTestId('history-graph-root')
        .querySelector<SVGPathElement>(
          '[data-edge-kind="incoming"][data-from-lane="1"][data-to-lane="0"]',
        )
        ?.style.getPropertyValue('--history-lane-color'),
    ).toBe('var(--history-lane-1)');
  });

  it('keeps already active merge-parent lanes separate until the shared commit', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'amended', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('amended', ['base', 'side']),
            commitSummary('original', ['base', 'side']),
            commitSummary('side', ['base']),
            commitSummary('base'),
          ],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const branchGraph = screen.getByTestId('history-graph-original');
    const branchEdge = branchGraph.querySelector<SVGPathElement>(
      '.history-graph-outgoing-corner [data-edge-kind="parent"][data-from-lane="2"][data-to-lane="3"]',
    );
    expect(branchEdge?.getAttribute('d')).toBe('M 30 0 L 42 8');
    expect(branchEdge?.style.getPropertyValue('--history-lane-color')).toBe(
      'var(--history-lane-3)',
    );

    const sharedGraph = screen.getByTestId('history-graph-side');
    expect(
      sharedGraph
        .querySelector('[data-edge-kind="incoming"][data-from-lane="3"]')
        ?.getAttribute('d'),
    ).toBe('M 42 0 L 18 8');

    const graph = screen.getByTestId('history-graph-base');
    expect(
      graph.querySelector('[data-edge-kind="incoming"][data-from-lane="1"]')?.getAttribute('d'),
    ).toBe('M 18 0 L 6 8');
    expect(
      graph.querySelector('[data-edge-kind="incoming"][data-from-lane="2"]')?.getAttribute('d'),
    ).toBe('M 30 0 L 6 8');
  });

  it('starts a newly allocated merge-parent lane below the merge point', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'top', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('top', ['merge', 'first-side']),
            commitSummary('first-side', ['merge']),
            commitSummary('merge', ['base', 'second-side']),
            commitSummary('second-side', ['base']),
            commitSummary('base'),
          ],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const graph = screen.getByTestId('history-graph-merge');
    expect(
      graph
        .querySelector(
          '.history-graph-outgoing-corner [data-edge-kind="parent"][data-from-lane="0"][data-to-lane="1"]',
        )
        ?.getAttribute('d'),
    ).toBe('M 6 0 L 18 8');
    expect(
      graph.querySelector(
        '.history-graph-incoming-corner [data-edge-kind="parent"][data-from-lane="0"][data-to-lane="1"]',
      ),
    ).not.toBeInTheDocument();
  });

  it('renders merge connectors as decorative SVG while exposing parent ids in the row', () => {
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'branches'
          ? { kind: 'branches' as const, branches: [] }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'merge', detached: false, ahead: 0, behind: 0 },
          history: [
            commitSummary('merge', ['left', 'right']),
            commitSummary('left', ['root']),
            commitSummary('right', ['root']),
            commitSummary('root'),
          ],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const graph = screen.getByTestId('history-graph-merge');
    expect(graph).toHaveAttribute('aria-hidden', 'true');
    expect(graph.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(graph.querySelector('svg')).not.toHaveAttribute('preserveAspectRatio');
    expect(graph.querySelectorAll('[data-edge-kind="parent"]')).toHaveLength(2);
    const connectorPath = graph
      .querySelector('[data-edge-kind="parent"][data-to-lane="1"]')
      ?.getAttribute('d');
    expect(connectorPath).toBe('M 6 0 L 18 8');
    expect(
      graph
        .querySelector<SVGPathElement>('[data-edge-kind="parent"][data-to-lane="1"]')
        ?.style.getPropertyValue('--history-lane-color'),
    ).toBe('var(--history-lane-1)');
    expect(screen.getByRole('button', { name: /merge.*Parents left, right/u })).toBeInTheDocument();
  });

  it('loads another page and keeps commits from every ref in the combined list', async () => {
    const initial = linearHistory('current', HISTORY_PAGE_SIZE);
    const nextPage = [
      commitSummary(`current-${HISTORY_PAGE_SIZE}`),
      commitSummary('other-tip', [], ['refs/remotes/origin/feature']),
    ];
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') return { kind: 'history' as const, commits: nextPage };
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: {
            name: 'main',
            oid: 'current-0',
            detached: false,
            ahead: 0,
            behind: 0,
          },
          history: initial,
        })}
        adapter={adapterWithQuery(query)}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(query.mock.calls.filter(([request]) => request.kind === 'history')).toHaveLength(0);
    intersect();
    expect(
      (await screen.findByTestId(`history-graph-current-${HISTORY_PAGE_SIZE}`)).closest('button'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /other-tip/u })).toBeVisible();
    expect(screen.getByText('origin/feature')).toBeVisible();
    expect(query).toHaveBeenCalledWith({
      kind: 'history',
      repoId: 'repo-1',
      limit: HISTORY_PAGE_SIZE,
      skip: HISTORY_PAGE_SIZE,
    });
    expect(screen.queryByTestId('history-load-sentinel')).not.toBeInTheDocument();
  });

  it('loads at most one history page for each observed sentinel', async () => {
    const initial = linearHistory('current', HISTORY_PAGE_SIZE);
    const middle = linearHistory('current', HISTORY_PAGE_SIZE * 2).slice(HISTORY_PAGE_SIZE);
    let finishHistory!: (result: Awaited<ReturnType<WorkspaceAdapter['query']>>) => void;
    const finalPage = new Promise<Awaited<ReturnType<WorkspaceAdapter['query']>>>((resolve) => {
      finishHistory = resolve;
    });
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') {
        if (request.skip === HISTORY_PAGE_SIZE) {
          return { kind: 'history' as const, commits: middle };
        }
        return finalPage;
      }
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: {
            name: 'main',
            oid: 'current-0',
            detached: false,
            ahead: 0,
            behind: 0,
          },
          history: initial,
        })}
        adapter={adapterWithQuery(query)}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(query.mock.calls.filter(([request]) => request.kind === 'history')).toHaveLength(0);
    const firstObserver = latestIntersectionObserver();
    intersect(firstObserver);
    expect(await screen.findByTestId(`history-graph-current-${HISTORY_PAGE_SIZE}`)).toBeVisible();
    expect(query.mock.calls.filter(([request]) => request.kind === 'history')).toHaveLength(1);

    await waitFor(() => expect(latestIntersectionObserver()).not.toBe(firstObserver));
    intersect(latestIntersectionObserver());
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith({
        kind: 'history',
        repoId: 'repo-1',
        limit: HISTORY_PAGE_SIZE,
        skip: HISTORY_PAGE_SIZE * 2,
      }),
    );
    const list = screen.getByRole('list', { name: '' });
    expect(list).toHaveAttribute('aria-busy', 'true');
    finishHistory({
      kind: 'history',
      commits: [commitSummary(`current-${HISTORY_PAGE_SIZE * 2}`)],
    });
    expect(
      await screen.findByTestId(`history-graph-current-${HISTORY_PAGE_SIZE * 2}`),
    ).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveAttribute('aria-busy', 'false'));
  });

  it('loads the next all-refs page before scrolling reaches the end', async () => {
    const initial = linearHistory('other', HISTORY_PAGE_SIZE);
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history')
        return { kind: 'history' as const, commits: [commitSummary('current-head')] };
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: {
            name: 'main',
            oid: 'current-head',
            detached: false,
            ahead: 0,
            behind: 0,
          },
          history: initial,
        })}
        adapter={adapterWithQuery(query)}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const observer = latestIntersectionObserver();
    expect(observer.options.root).toBe(screen.getByRole('list', { name: '' }));
    expect(observer.options.rootMargin).toBe('0px 0px 2400px 0px');
    intersect(observer);
    await waitFor(() =>
      expect(query.mock.calls.some(([request]) => request.kind === 'history')).toBe(true),
    );
  });

  it('drops loaded pages and restarts from the first page when HEAD changes', async () => {
    const initial = linearHistory('old', HISTORY_PAGE_SIZE);
    const extra = [commitSummary(`old-${HISTORY_PAGE_SIZE}`)];
    const query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind === 'history') return { kind: 'history' as const, commits: extra };
      if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
      if (request.kind === 'commitDetails')
        return { kind: 'commitDetails' as const, commit: commitDetails(undefined) };
      return { kind: 'activity' as const, entries: [] };
    });
    const props = {
      adapter: adapterWithQuery(query),
      onShowDiff: () => undefined,
      onAction: async () => undefined,
      paneWidths: { left: 240, right: 330 },
      onPaneWidthsChange: () => undefined,
    } as const;
    const { rerender } = render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'old-0', detached: false, ahead: 0, behind: 0 },
          history: initial,
        })}
        {...props}
      />,
    );

    intersect();
    expect(
      (await screen.findByTestId(`history-graph-old-${HISTORY_PAGE_SIZE}`)).closest('button'),
    ).toBeVisible();

    rerender(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'new-head', detached: false, ahead: 0, behind: 0 },
          history: [commitSummary('new-head')],
        })}
        {...props}
      />,
    );
    expect(await screen.findByRole('button', { name: /new-head/u })).toBeVisible();
    expect(screen.queryByTestId(`history-graph-old-${HISTORY_PAGE_SIZE}`)).not.toBeInTheDocument();
  });

  it('passes the selected mainline parent for merge Cherry-pick and Revert', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const mergeCommit = {
      ...commitDetails(undefined),
      parents: ['parent-1', 'parent-2'],
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: mergeCommit };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [mergeCommit],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    let dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = await openCommitAction(user, 'Revert', 'Revert');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '2',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(onAction).toHaveBeenNthCalledWith(1, {
      kind: 'cherryPick',
      oid: mergeCommit.oid,
      mainline: 2,
    });
    expect(onAction).toHaveBeenNthCalledWith(2, {
      kind: 'revert',
      oid: mergeCommit.oid,
      mainline: 2,
    });
  });

  it('binds each mainline dialog to its clicked commit and resets the default parent', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const octopus = {
      ...commitSummary('octopus', ['merge-two', 'side-a', 'side-b']),
      subject: 'octopus merge',
    };
    const twoParent = {
      ...commitSummary('merge-two', ['parent-a', 'parent-b']),
      subject: 'two parent merge',
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return {
            kind: 'commitDetails' as const,
            commit: {
              ...commitDetails(undefined),
              ...(request.oid === octopus.oid ? octopus : twoParent),
            },
          };
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: octopus.oid, detached: false, ahead: 0, behind: 0 },
          history: [octopus, twoParent],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    let dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick', octopus.oid);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mainline parent' }),
      '3',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /two parent merge/u }));
    dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick', twoParent.oid);
    expect(within(dialog).getByRole('combobox', { name: 'Mainline parent' })).toHaveValue('1');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(onAction).toHaveBeenCalledWith({
      kind: 'cherryPick',
      oid: twoParent.oid,
      mainline: 1,
    });
  });

  it('binds commit actions to the clicked row while the next commit details load', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn<(action: WorkspaceAction) => Promise<void>>(async () => undefined);
    const first = commitSummary('first', ['second']);
    const second = commitSummary('second');
    let resolveSecond!: (result: QueryResult) => void;
    const secondDetails = new Promise<QueryResult>((resolve) => {
      resolveSecond = resolve;
    });
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>((request) => {
        if (request.kind === 'branches')
          return Promise.resolve({ kind: 'branches' as const, branches: [] });
        if (request.kind === 'commitDetails' && request.oid === second.oid) return secondDetails;
        if (request.kind === 'commitDetails')
          return Promise.resolve({
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), ...first },
          });
        return Promise.resolve({ kind: 'activity' as const, entries: [] });
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: first.oid, detached: false, ahead: 0, behind: 0 },
          history: [first, second],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={onAction}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByRole('heading', { name: first.subject })).toBeInTheDocument();
    await user.click(screen.getByTestId(`history-graph-${second.oid}`).closest('button')!);

    expect(screen.queryByText('Loading commit details…')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions for selected commit first' }),
    ).toBeDisabled();
    const dialog = await openCommitAction(user, 'Cherry-pick', 'Cherry-pick', second.oid);
    expect(within(dialog).getByText(second.shortOid, { selector: 'code' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'cherryPick', oid: second.oid });

    resolveSecond({
      kind: 'commitDetails',
      commit: { ...commitDetails(undefined), ...second },
    });
    expect(await screen.findByRole('heading', { name: second.subject })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions for selected commit second' }),
    ).toBeEnabled();
  });

  it('clears stale commit details when the next detail query fails', async () => {
    const user = userEvent.setup();
    const first = commitSummary('first', ['second']);
    const second = commitSummary('second');
    const failure = new Error('Second commit details failed.');
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails' && request.oid === second.oid) throw failure;
        if (request.kind === 'commitDetails') {
          return {
            kind: 'commitDetails' as const,
            commit: { ...commitDetails(undefined), ...first },
          };
        }
        return { kind: 'activity' as const, entries: [] };
      }),
    );

    render(
      <HistoryView
        repo={repoSnapshot({
          branch: { name: 'main', oid: first.oid, detached: false, ahead: 0, behind: 0 },
          history: [first, second],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const detailPane = screen.getByRole('main');
    expect(await within(detailPane).findByRole('heading', { name: first.subject })).toBeVisible();
    await user.click(screen.getByTestId(`history-graph-${second.oid}`).closest('button')!);

    expect(await within(detailPane).findByRole('alert')).toBeVisible();
    expect(
      within(detailPane).queryByRole('heading', { name: first.subject }),
    ).not.toBeInTheDocument();
    expect(within(detailPane).getByRole('heading', { name: 'Commit details' })).toBeVisible();
  });

  it('closes open menus and idle action dialogs when repository work becomes busy', async () => {
    const user = userEvent.setup();
    const currentCommit = commitDetails(undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) =>
        request.kind === 'commitDetails'
          ? { kind: 'commitDetails' as const, commit: currentCommit }
          : { kind: 'activity' as const, entries: [] },
      ),
    );
    const view = (busy: boolean) => (
      <HistoryView
        repo={repoSnapshot({ history: [currentCommit] })}
        adapter={adapter}
        busy={busy}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />
    );
    const { rerender } = render(view(false));

    await openCommitMenu(user);
    rerender(view(true));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'More actions for commit head' })).toBeDisabled();

    rerender(view(false));
    await openCommitAction(user, 'Create Tag', 'Create Tag');
    rerender(view(true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create Tag' })).not.toBeInTheDocument(),
    );
  });

  it('disables repository-changing History actions while a Git operation is in progress', async () => {
    const user = userEvent.setup();
    const currentCommit = commitDetails(undefined);
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: currentCommit };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    render(
      <HistoryView
        repo={repoSnapshot({
          operation: {
            kind: 'rebase',
            label: { id: 'operationResolvingRebase' },
            unresolvedCount: 0,
            canContinue: true,
            canSkip: true,
            canAbort: true,
          },
          branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
          history: [currentCommit],
        })}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    const trigger = await screen.findByRole('button', { name: 'More actions for commit head' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: /feat: current/u }), {
      clientX: 80,
      clientY: 100,
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not pass a binary commit patch to DiffSurface', async () => {
    const binaryDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'binary-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'GIT binary patch\n',
      binary: true,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(binaryDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(
      await screen.findByText('Binary diffs cannot be displayed as text.'),
    ).toBeInTheDocument();
    expect(diffSurfaceMock).not.toHaveBeenCalled();
  });

  it('uses the Diff layout selected in Settings without showing a local switch', async () => {
    const textDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'text-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'diff --git a/a b/a\n',
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(textDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        diffStyle="split"
        lineWrapping
        wrapColumn={96}
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

  it('labels a truncated commit patch as a partial view', async () => {
    const truncatedDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'truncated-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'diff --git a/a b/a\n',
      binary: false,
      tooLarge: true,
      truncated: true,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(truncatedDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });

    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(/The diff exceeded the display limit/u)).toBeVisible();
    expect(diffSurfaceMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ performanceMode: true }),
    );
  });

  it('renders multi-file commits in file order with shared headers and simple separators', async () => {
    const multiFileDiff: NonNullable<CommitDetails['diff']> = {
      diffId: 'multi-revision',
      repoId: 'repo-1',
      path: 'head',
      area: 'staged',
      generation: 1,
      patch: 'diff --git a/a b/a\n--- a/a\n+++ b/a\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n',
      binary: false,
      tooLarge: false,
    };
    const adapter = adapterWithQuery(
      vi.fn<WorkspaceAdapter['query']>(async (request) => {
        if (request.kind === 'branches') return { kind: 'branches' as const, branches: [] };
        if (request.kind === 'commitDetails')
          return { kind: 'commitDetails' as const, commit: commitDetails(multiFileDiff) };
        return { kind: 'activity' as const, entries: [] };
      }),
    );
    const repo = repoSnapshot({
      branch: { name: 'main', oid: 'head', detached: false, ahead: 0, behind: 0 },
      history: [commitDetails(undefined)],
    });
    render(
      <HistoryView
        repo={repo}
        adapter={adapter}
        onShowDiff={() => undefined}
        onAction={async () => undefined}
        stickyFileHeaders
        paneWidths={{ left: 240, right: 330 }}
        onPaneWidthsChange={() => undefined}
      />,
    );

    expect(await screen.findAllByText('Diff')).toHaveLength(2);
    expect(diffSurfaceMock).toHaveBeenCalledTimes(2);
    expect(diffSurfaceMock.mock.calls.map(([props]) => props)).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ kind: 'patch', path: 'a' }),
        showFileHeaders: true,
        stickyFileHeaders: true,
        hunkSeparators: 'simple',
      }),
      expect.objectContaining({
        source: expect.objectContaining({ kind: 'patch', path: 'b' }),
        showFileHeaders: true,
        stickyFileHeaders: true,
        hunkSeparators: 'simple',
      }),
    ]);
  });
});
