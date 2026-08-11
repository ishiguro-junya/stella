import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CodeViewLineSelection, SelectedLineRange } from '@pierre/diffs';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockCodeViewProps {
  items?: MockCodeViewItem[];
  onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
  renderHeaderPrefix?: (item: MockCodeViewItem) => ReactNode;
}

interface MockCodeViewItem {
  id: string;
  type: 'diff';
  fileDiff: {
    name: string;
    type: 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted';
  };
  collapsed?: boolean;
}

interface MockPatchDiffOptions {
  disableFileHeader?: boolean;
  hunkSeparators?: 'simple' | 'line-info-basic';
  collapsed?: boolean;
  onLineSelectionChange?: (range: SelectedLineRange | null) => void;
  unsafeCSS?: string;
}

interface MockPatchDiffProps {
  options: MockPatchDiffOptions;
  renderHeaderPrefix?: (fileDiff: MockCodeViewItem['fileDiff']) => ReactNode;
}

const { codeViewPropsMock, parsePatchFilesMock, patchDiffPropsMock } = vi.hoisted(() => ({
  codeViewPropsMock: vi.fn<(props: MockCodeViewProps) => void>(),
  parsePatchFilesMock: vi.fn<(patch: string, cacheKey: string) => unknown[]>(),
  patchDiffPropsMock: vi.fn<(props: MockPatchDiffProps) => void>(),
}));

vi.mock('@pierre/diffs', () => ({
  registerCustomCSSVariableTheme: vi.fn<() => void>(),
  parseDiffFromFile: vi.fn<() => unknown>(),
  parsePatchFiles: parsePatchFilesMock,
}));
vi.mock('@pierre/diffs/react', () => ({
  CodeView: (props: MockCodeViewProps) => {
    codeViewPropsMock(props);
    return <div>CodeView</div>;
  },
  FileDiff: () => <div>FileDiff</div>,
  PatchDiff: (props: MockPatchDiffProps) => {
    patchDiffPropsMock(props);
    return <div>PatchDiff</div>;
  },
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({
  default: class MockWorker {
    terminate(): void {}
  },
}));

import { DiffSurface, type SurfaceSelection } from './DiffSurface';
import { AppearanceProvider } from '../../theme/appearance';

const PATCH = `diff --git a/example.txt b/example.txt
--- a/example.txt
+++ b/example.txt
@@ -1,2 +1,2 @@
-old
+new
 context
`;

beforeEach(() => {
  codeViewPropsMock.mockReset();
  parsePatchFilesMock.mockReset();
  patchDiffPropsMock.mockReset();
});

describe('DiffSurface fallback', () => {
  it('falls back to plain text when a truncated CodeView patch cannot be parsed', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    parsePatchFilesMock.mockImplementation(() => {
      throw new Error('truncated patch');
    });
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: 'diff --git a/a', cacheKey: 'revision-1' }}
        performanceMode
      />,
    );

    expect(
      screen.getByText('The formatted diff could not be loaded. Showing plain text instead.'),
    ).toBeInTheDocument();
    expect(screen.getByText('diff --git a/a')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe('DiffSurface line selection', () => {
  it('uses classic plus and minus indicators so changes are not conveyed by color alone', () => {
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
      />,
    );

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({
        diffIndicators: 'classic',
        overflow: 'wrap',
        theme: { light: 'stella-semantic', dark: 'stella-semantic' },
        themeType: 'system',
        unsafeCSS: expect.stringContaining(
          "[data-line-type='change-addition'] {\n  --diffs-computed-diff-line-bg: var(--diff-addition-surface);",
        ),
      }),
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({
        itemMetrics: {
          diffHeaderHeight: 32,
          spacing: 0,
          paddingTop: 0,
          paddingBottom: 0,
        },
        layout: { paddingTop: 0, paddingBottom: 0, gap: 8 },
        unsafeCSS: expect.stringContaining(
          "[data-diffs-header='default'] {\n  min-height: 32px;\n  padding-inline: 8px 16px;\n  border-block: 1px solid var(--border-subtle);\n  background-color: var(--surface-raised);",
        ),
      }),
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '[data-code] {\n  overscroll-behavior: none;\n}',
    );
  });

  it('passes explicit appearance changes through to the Diffs shadow theme', () => {
    const source = {
      kind: 'patch' as const,
      patch: PATCH,
      path: 'example.txt',
      cacheKey: 'revision-1',
    };
    const { rerender } = render(
      <AppearanceProvider appearance="light">
        <DiffSurface source={source} />
      </AppearanceProvider>,
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ themeType: 'light' }),
    );

    rerender(
      <AppearanceProvider appearance="dark">
        <DiffSurface source={source} />
      </AppearanceProvider>,
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ themeType: 'dark' }),
    );
  });

  it('can show file headers with simple hunk separators', () => {
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        showFileHeaders
        hunkSeparators="simple"
      />,
    );

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ disableFileHeader: false, hunkSeparators: 'simple' }),
    );
  });

  it('hides externally collapsed diff content while its surrounding file header remains visible', () => {
    const { container } = render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        collapsed
      />,
    );

    expect(container.querySelector('.diff-surface')).toHaveAttribute('hidden');
    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ collapsed: true }),
    );
  });

  it('collapses a single file from the left edge of its file header', () => {
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        showFileHeaders
        collapsibleFileHeaders
      />,
    );

    const renderHeaderPrefix = patchDiffPropsMock.mock.lastCall?.[0].renderHeaderPrefix;
    expect(renderHeaderPrefix).toBeTypeOf('function');
    render(renderHeaderPrefix?.({ name: 'example.txt', type: 'change' }));

    const toggle = screen.getByRole('button', { name: 'Collapse example.txt diff' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ collapsed: true }),
    );
    const rerenderHeaderPrefix = patchDiffPropsMock.mock.lastCall?.[0].renderHeaderPrefix;
    const { getByRole } = render(rerenderHeaderPrefix?.({ name: 'example.txt', type: 'change' }));
    expect(getByRole('button', { name: 'Expand example.txt diff' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('renders the shared file status icon in CodeView file headers', () => {
    parsePatchFilesMock.mockReturnValue([{ files: [{ name: 'new.txt', type: 'new' }] }]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        showFileHeaders
      />,
    );

    const renderHeaderPrefix = codeViewPropsMock.mock.lastCall?.[0].renderHeaderPrefix;
    expect(renderHeaderPrefix).toBeTypeOf('function');
    const { container } = render(
      renderHeaderPrefix?.({
        id: 'revision-1:0:0',
        type: 'diff',
        fileDiff: { name: 'new.txt', type: 'new' },
      }),
    );
    expect(container.querySelector('.file-status.added')).toBeInTheDocument();
  });

  it('collapses CodeView files independently', () => {
    parsePatchFilesMock.mockReturnValue([
      {
        files: [
          { name: 'first.txt', type: 'change' },
          { name: 'second.txt', type: 'change' },
        ],
      },
    ]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        showFileHeaders
        collapsibleFileHeaders
      />,
    );

    const renderHeaderPrefix = codeViewPropsMock.mock.lastCall?.[0].renderHeaderPrefix;
    render(
      renderHeaderPrefix?.({
        id: 'revision-1:0:0',
        type: 'diff',
        fileDiff: { name: 'first.txt', type: 'change' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse first.txt diff' }));

    expect(codeViewPropsMock.mock.lastCall?.[0].items).toEqual([
      expect.objectContaining({ id: 'revision-1:0:0', collapsed: true }),
      expect.objectContaining({ id: 'revision-1:0:1', collapsed: false }),
    ]);
  });

  it('publishes a direct PatchDiff selection and clears it when the source changes', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    const { rerender } = render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        selectable
        onSelectionChange={onSelectionChange}
      />,
    );
    const onLineSelectionChange =
      patchDiffPropsMock.mock.lastCall?.[0].options.onLineSelectionChange;
    expect(onLineSelectionChange).toBeTypeOf('function');
    act(() =>
      onLineSelectionChange?.({
        start: 3,
        end: 1,
        side: 'additions',
        endSide: 'additions',
      }),
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      side: 'additions',
      startLine: 1,
      endLine: 3,
    });

    rerender(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-2',
        }}
        selectable
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps direct selection available for a single-file performance CodeView', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    parsePatchFilesMock.mockReturnValue([{ files: [{}] }]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        selectable
        performanceMode
        onSelectionChange={onSelectionChange}
      />,
    );
    const onSelectedLinesChange = codeViewPropsMock.mock.lastCall?.[0].onSelectedLinesChange;
    expect(onSelectedLinesChange).toBeTypeOf('function');
    act(() =>
      onSelectedLinesChange?.({
        id: 'revision-1:0:0',
        range: { start: 1, end: 1, side: 'additions', endSide: 'additions' },
      }),
    );

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      itemId: 'revision-1:0:0',
      side: 'additions',
      startLine: 1,
      endLine: 1,
    });
  });

  it('enables direct selection without rendering a separate line-number form', () => {
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        selectable
      />,
    );

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ enableLineSelection: true, controlledSelection: true }),
    );
    expect(screen.queryByText('Select lines')).not.toBeInTheDocument();
  });
});
