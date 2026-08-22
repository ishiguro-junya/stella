import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CodeViewLineSelection, SelectedLineRange } from '@pierre/diffs';
import { StrictMode, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockCodeViewProps {
  items?: MockCodeViewItem[];
  options?: MockPatchDiffOptions;
  onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
  renderCustomHeader?: (item: MockCodeViewItem) => ReactNode;
  renderAnnotation?: (annotation: MockAnnotation, item: MockCodeViewItem) => ReactNode;
}

interface MockAnnotation {
  side: 'additions' | 'deletions';
  lineNumber: number;
  metadata: {
    hunkIndex: number;
    itemId?: string;
    displayStart: number;
    displayEnd: number;
  };
}

interface MockCodeViewItem {
  id: string;
  type: 'diff';
  fileDiff: {
    name: string;
    type: 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted';
    hunks?: Array<{
      collapsedBefore?: number;
      deletionStart: number;
      deletionCount: number;
      additionStart: number;
      additionCount: number;
      deletionLines: number;
      additionLines: number;
    }>;
  };
  annotations?: MockAnnotation[];
  collapsed?: boolean;
  version?: number;
}

interface MockPatchDiffOptions {
  overflow?: 'scroll' | 'wrap';
  disableFileHeader?: boolean;
  hunkSeparators?: 'simple' | 'line-info-basic';
  collapsed?: boolean;
  onLineSelectionChange?: (range: SelectedLineRange | null) => void;
  onLineClick?: (props: {
    annotationSide: 'additions' | 'deletions';
    event: PointerEvent;
    lineNumber: number;
    lineType: 'change-addition' | 'change-deletion' | 'context' | 'context-expanded';
    numberColumn: boolean;
  }) => void;
  onPostRender?: (
    node: HTMLElement,
    instance: { fileDiff?: MockCodeViewItem['fileDiff'] },
    phase: 'mount' | 'update' | 'unmount',
  ) => void;
  unsafeCSS?: string;
}

interface MockPatchDiffProps {
  options: MockPatchDiffOptions;
  selectedLines?: SelectedLineRange | null;
  lineAnnotations?: MockAnnotation[];
  renderAnnotation?: (annotation: MockAnnotation) => ReactNode;
  renderCustomHeader?: (fileDiff: MockCodeViewItem['fileDiff']) => ReactNode;
}

interface MockFileDiffProps extends MockPatchDiffProps {
  fileDiff: MockCodeViewItem['fileDiff'];
}

const { codeViewPropsMock, fileDiffPropsMock, parsePatchFilesMock, patchDiffPropsMock } =
  vi.hoisted(() => ({
    codeViewPropsMock: vi.fn<(props: MockCodeViewProps) => void>(),
    fileDiffPropsMock: vi.fn<(props: MockFileDiffProps) => void>(),
    parsePatchFilesMock: vi.fn<(patch: string, cacheKey: string) => unknown[]>(),
    patchDiffPropsMock: vi.fn<(props: MockPatchDiffProps) => void>(),
  }));

vi.mock('@pierre/diffs', () => ({
  registerCustomCSSVariableTheme: vi.fn<() => void>(),
  parseDiffFromFile: vi.fn<() => unknown>(),
  parsePatchFiles: parsePatchFilesMock,
}));
vi.mock('@pierre/diffs/react', () => ({
  __esModule: true,
  CodeView: (props: MockCodeViewProps) => {
    codeViewPropsMock(props);
    return <div>CodeView</div>;
  },
  FileDiff: (props: MockFileDiffProps) => {
    fileDiffPropsMock(props);
    patchDiffPropsMock(props);
    return <div>FileDiff</div>;
  },
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

import { DiffSurface, type SurfaceHunkSelection, type SurfaceSelection } from './DiffSurface';
import { I18nProvider } from '../../i18n/i18n';
import { resources } from '../../i18n/messages';
import { AppearanceProvider } from '../../theme/appearance';

const PATCH = `diff --git a/example.txt b/example.txt
--- a/example.txt
+++ b/example.txt
@@ -1,2 +1,2 @@
-old
+new
 context
`;

let mountedI18n: ReturnType<typeof useTranslation>['i18n'] | undefined;

function CaptureI18n() {
  mountedI18n = useTranslation().i18n;
  return null;
}

beforeEach(() => {
  codeViewPropsMock.mockReset();
  fileDiffPropsMock.mockReset();
  parsePatchFilesMock.mockReset();
  patchDiffPropsMock.mockReset();
  parsePatchFilesMock.mockReturnValue([
    { files: [{ name: 'example.txt', type: 'change', hunks: [] }] },
  ]);
});

function createDiffHost(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('diffs-container');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <pre>
      <code data-code data-unified>
        <div data-gutter style="grid-row: span 2">
          <div data-separator="line-info-basic">
            <div data-separator-wrapper>
              <div data-separator-content><span data-unmodified-lines>4 unmodified lines</span></div>
            </div>
          </div>
          <div data-column-number data-line-index="0,0">1</div>
        </div>
        <div data-content style="grid-row: span 2">
          <div data-separator="line-info-basic">
            <div data-separator-wrapper>
              <div data-separator-content><span data-unmodified-lines>4 unmodified lines</span></div>
            </div>
          </div>
          <span data-line data-line-index="0,0">changed</span>
        </div>
      </code>
    </pre>
  `;
  return { host, root };
}

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

describe('DiffSurface patch sources', () => {
  it('uses the source cache key when parsing a single-file patch for FileDiff', () => {
    const fileDiff = { name: 'example.txt', type: 'change' as const, hunks: [] };
    parsePatchFilesMock.mockReturnValue([{ files: [fileDiff] }]);

    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'commit-b:example.txt',
        }}
      />,
    );

    expect(parsePatchFilesMock).toHaveBeenCalledWith(PATCH, 'commit-b:example.txt');
    expect(fileDiffPropsMock).toHaveBeenCalledWith(expect.objectContaining({ fileDiff }));
    expect(screen.getByText('FileDiff')).toBeInTheDocument();
  });

  it.each([
    ['empty', []],
    [
      'multiple',
      [
        {
          files: [
            { name: 'first.txt', type: 'change', hunks: [] },
            { name: 'second.txt', type: 'change', hunks: [] },
          ],
        },
      ],
    ],
  ])('falls back safely when a patch has %s displayable file diffs', (_kind, parsedPatches) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    parsePatchFilesMock.mockReturnValue(parsedPatches);

    render(
      <DiffSurface
        source={{ kind: 'patch', patch: PATCH, path: 'example.txt', cacheKey: 'revision-1' }}
      />,
    );

    expect(
      screen.getByText('The formatted diff could not be loaded. Showing plain text instead.'),
    ).toBeInTheDocument();
    expect(fileDiffPropsMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('DiffSurface line selection', () => {
  it('shows plus/minus indicators and matches the editor line geometry', () => {
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
        overflow: 'scroll',
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
        layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
        stickyHeader: false,
        stickyHeaders: false,
        unsafeCSS: expect.stringContaining(
          "[data-diffs-header='default'],\n[data-diffs-header='custom'] {\n  min-height: 32px;\n  padding-inline: 8px 16px;\n  border-top: 1px solid var(--border-strong);\n  border-bottom: 1px solid var(--border-subtle);\n  background-color: var(--diffs-bg-separator);",
        ),
      }),
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '--diffs-scrollbar-gutter-override: 0px;',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '--diffs-bg-separator-override: var(--diff-file-header-surface);',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '--diffs-font-family: var(--font-mono);',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '--diffs-header-font-family: var(--font-ui);',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '--diffs-line-height: var(--code-line-height);',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '--diffs-min-number-column-width: 10px;',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      "[data-indicators='classic'] [data-line] {\n  padding-inline: 2px;\n  padding-inline-start: 6px;\n}",
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      "[data-indicators='classic'] [data-column-number][data-line-type='change-addition']::before {\n  content: '+';",
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).not.toContain(
      'overscroll-behavior',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '[data-line][data-selected-line] {\n  --diffs-computed-selected-line-bg: var(--diff-selection-surface);',
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      '[data-unmodified-lines] {\n  display: none;\n}',
    );
  });

  it('applies the shared wrapping preference and wrap column', () => {
    const source = {
      kind: 'patch' as const,
      patch: PATCH,
      path: 'example.txt',
      cacheKey: 'revision-1',
    };
    const { rerender } = render(<DiffSurface source={source} />);

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ overflow: 'scroll' }),
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).not.toContain(
      "[data-overflow='wrap'] [data-line]",
    );

    rerender(<DiffSurface source={source} lineWrapping wrapColumn={96} />);

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ overflow: 'wrap' }),
    );
    expect(patchDiffPropsMock.mock.lastCall?.[0].options.unsafeCSS).toContain(
      "[data-overflow='wrap'] [data-line] {\n  padding-inline-end: max(1ch, calc(100% - 96ch - 1ch));",
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

  it('collapses a single-file diff from its toggle', () => {
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        showFileHeaders
      />,
    );

    const renderCustomHeader = patchDiffPropsMock.mock.lastCall?.[0].renderCustomHeader;
    expect(renderCustomHeader).toBeTypeOf('function');
    render(renderCustomHeader?.({ name: 'example.txt', type: 'change', hunks: [] }));

    const toggle = screen.getByRole('button', { name: 'Collapse example.txt diff' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.style.width).toBe('22px');
    expect(toggle.style.height).toBe('22px');
    expect(toggle.style.minHeight).toBe('22px');
    expect(toggle.style.maxHeight).toBe('22px');
    expect(toggle.style.alignSelf).toBe('center');
    expect(toggle?.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
    expect(toggle?.querySelector('path')).toHaveAttribute('d', 'm6 9 6 6 6-6');
    fireEvent.click(toggle);

    expect(patchDiffPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ collapsed: true }),
    );
    const rerenderCustomHeader = patchDiffPropsMock.mock.lastCall?.[0].renderCustomHeader;
    const { getByRole } = render(
      rerenderCustomHeader?.({ name: 'example.txt', type: 'change', hunks: [] }),
    );
    expect(getByRole('button', { name: 'Expand example.txt diff' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('renders the full path with one text style in file headers', () => {
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'src/features/example.txt',
          cacheKey: 'revision-1',
        }}
        showFileHeaders
      />,
    );

    const renderCustomHeader = patchDiffPropsMock.mock.lastCall?.[0].renderCustomHeader;
    const { container } = render(
      renderCustomHeader?.({ name: 'src/features/example.txt', type: 'change', hunks: [] }),
    );
    expect(container.querySelector('.file-path-prefix')).not.toBeInTheDocument();
    expect(
      container.querySelector('.diff-file-custom-header-title > span:last-child'),
    ).toHaveTextContent('src/features/example.txt');
  });

  it('renders the shared file status icon in CodeView file headers', () => {
    parsePatchFilesMock.mockReturnValue([{ files: [{ name: 'new.txt', type: 'new', hunks: [] }] }]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        showFileHeaders
        stickyFileHeaders
      />,
    );

    const renderCustomHeader = codeViewPropsMock.mock.lastCall?.[0].renderCustomHeader;
    expect(renderCustomHeader).toBeTypeOf('function');
    expect(codeViewPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ stickyHeader: true, stickyHeaders: true }),
    );
    const { container } = render(
      renderCustomHeader?.({
        id: 'revision-1:0:0',
        type: 'diff',
        fileDiff: { name: 'new.txt', type: 'new', hunks: [] },
      }),
    );
    expect(container.querySelector('.file-status.added')).toBeInTheDocument();
  });

  it('keeps visible CodeView file headers non-sticky by default', () => {
    parsePatchFilesMock.mockReturnValue([
      { files: [{ name: 'example.txt', type: 'change', hunks: [] }] },
    ]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        showFileHeaders
      />,
    );

    expect(codeViewPropsMock.mock.lastCall?.[0].options).toEqual(
      expect.objectContaining({ stickyHeader: false, stickyHeaders: false }),
    );
  });

  it('increments the CodeView item version when its toggle collapses the file', () => {
    parsePatchFilesMock.mockReturnValue([
      {
        files: [
          { name: 'first.txt', type: 'change', hunks: [] },
          { name: 'second.txt', type: 'change', hunks: [] },
        ],
      },
    ]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        showFileHeaders
      />,
    );

    const renderCustomHeader = codeViewPropsMock.mock.lastCall?.[0].renderCustomHeader;
    expect(renderCustomHeader).toBeTypeOf('function');
    render(
      renderCustomHeader?.({
        id: 'revision-1:0:0',
        type: 'diff',
        fileDiff: { name: 'first.txt', type: 'change', hunks: [] },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse first.txt diff' }));

    expect(codeViewPropsMock.mock.lastCall?.[0].items).toEqual([
      expect.objectContaining({ id: 'revision-1:0:0', collapsed: true, version: 2 }),
      expect.objectContaining({ id: 'revision-1:0:1', collapsed: false, version: 1 }),
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
      patchActionable: true,
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

  it('restores an initial selection when the Diff is shown again', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    const initialSelection: SurfaceSelection = {
      side: 'additions',
      startLine: 3,
      endLine: 3,
      patchActionable: false,
    };
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        selectable
        initialSelection={initialSelection}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(patchDiffPropsMock.mock.lastCall?.[0].selectedLines).toEqual({
      start: 3,
      end: 3,
      side: 'additions',
      endSide: 'additions',
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(initialSelection);
  });

  it('selects a changed row when its content is left-clicked', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    render(
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
    const onLineClick = patchDiffPropsMock.mock.lastCall?.[0].options.onLineClick;
    act(() => {
      if (!onLineClick) return;
      Reflect.apply(onLineClick, undefined, [
        {
          annotationSide: 'additions',
          event: new Event('click'),
          lineNumber: 2,
          lineType: 'change-addition',
          numberColumn: false,
        },
      ]);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      side: 'additions',
      startLine: 2,
      endLine: 2,
      patchActionable: true,
    });
    expect(patchDiffPropsMock.mock.lastCall?.[0].selectedLines).toEqual({
      start: 2,
      end: 2,
      side: 'additions',
      endSide: 'additions',
    });
  });

  it('selects an unchanged context row for editing without enabling patch actions', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    render(
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
    const onLineClick = patchDiffPropsMock.mock.lastCall?.[0].options.onLineClick;
    act(() => {
      if (!onLineClick) return;
      Reflect.apply(onLineClick, undefined, [
        {
          annotationSide: 'additions',
          event: new Event('click'),
          lineNumber: 3,
          lineType: 'context',
          numberColumn: false,
        },
      ]);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      side: 'additions',
      startLine: 3,
      endLine: 3,
      patchActionable: false,
    });
    expect(patchDiffPropsMock.mock.lastCall?.[0].selectedLines).toEqual({
      start: 3,
      end: 3,
      side: 'additions',
      endSide: 'additions',
    });
  });

  it('selects a row when its line number is clicked', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    render(
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
    const onLineClick = patchDiffPropsMock.mock.lastCall?.[0].options.onLineClick;
    act(() => {
      if (!onLineClick) return;
      Reflect.apply(onLineClick, undefined, [
        {
          annotationSide: 'additions',
          event: new Event('click'),
          lineNumber: 3,
          lineType: 'context',
          numberColumn: true,
        },
      ]);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      side: 'additions',
      startLine: 3,
      endLine: 3,
      patchActionable: false,
    });
  });

  it('extends a changed-row selection from its anchor with Shift-click', () => {
    const onSelectionChange = vi.fn<(selection: SurfaceSelection | null) => void>();
    render(
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
    const clickLine = (lineNumber: number, shiftKey = false): void => {
      const onLineClick = patchDiffPropsMock.mock.lastCall?.[0].options.onLineClick;
      if (!onLineClick) return;
      Reflect.apply(onLineClick, undefined, [
        {
          annotationSide: 'additions',
          event: new MouseEvent('click', { shiftKey }),
          lineNumber,
          lineType: 'change-addition',
          numberColumn: false,
        },
      ]);
    };

    act(() => clickLine(2));
    act(() => clickLine(5, true));

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      side: 'additions',
      startLine: 2,
      endLine: 5,
      patchActionable: true,
    });
    expect(patchDiffPropsMock.mock.lastCall?.[0].selectedLines).toEqual({
      start: 2,
      end: 5,
      side: 'additions',
      endSide: 'additions',
    });
  });

  it('returns selected line contents through the context menu without DOM text selection', () => {
    const onSelectionContextMenu =
      vi.fn<(selection: SurfaceSelection, point: { x: number; y: number }, text: string) => void>();
    const { container } = render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        selectable
        onSelectionContextMenu={onSelectionContextMenu}
      />,
    );
    const onLineClick = patchDiffPropsMock.mock.lastCall?.[0].options.onLineClick;
    act(() => {
      if (!onLineClick) return;
      Reflect.apply(onLineClick, undefined, [
        {
          annotationSide: 'additions',
          event: new MouseEvent('click'),
          lineNumber: 2,
          lineType: 'change-addition',
          numberColumn: false,
        },
      ]);
    });
    const host = document.createElement('diffs-container');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <span data-line data-selected-line>second line</span>
      <span data-line data-selected-line>third line</span>
    `;
    container.querySelector('.diff-surface')?.append(host);
    const selectedLine = root.querySelector<HTMLElement>('[data-line]')!;

    act(() => {
      selectedLine.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    });

    expect(onSelectionContextMenu).toHaveBeenCalledWith(
      { side: 'additions', startLine: 2, endLine: 2, patchActionable: true },
      { x: 20, y: 30 },
      'second line\nthird line',
    );
  });

  it('returns selected line contents from Command-C', () => {
    const onSelectionCopy = vi.fn<(text: string) => void>();
    const { container } = render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        selectable
        onSelectionCopy={onSelectionCopy}
      />,
    );
    const host = document.createElement('diffs-container');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <span data-line data-selected-line>second line</span>
      <span data-line data-selected-line>third line</span>
    `;
    container.querySelector('.diff-surface')?.append(host);
    const selectedLine = root.querySelector<HTMLElement>('[data-line]')!;
    const onLineClick = patchDiffPropsMock.mock.lastCall?.[0].options.onLineClick;
    selectedLine.addEventListener('click', (event) => {
      if (!onLineClick) return;
      Reflect.apply(onLineClick, undefined, [
        {
          annotationSide: 'additions',
          event,
          lineNumber: 2,
          lineType: 'change-addition',
          numberColumn: false,
        },
      ]);
    });

    act(() => {
      selectedLine.click();
    });
    act(() => {
      (root.activeElement ?? document.activeElement)?.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          composed: true,
          key: 'c',
          metaKey: true,
        }),
      );
    });

    expect(onSelectionCopy).toHaveBeenCalledWith('second line\nthird line');
  });

  it('advertises Command-C only when selected lines can be copied', () => {
    const { rerender } = render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        selectable
        onSelectionCopy={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Diff')).toHaveAttribute('aria-keyshortcuts', 'Meta+C');

    rerender(
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

    expect(screen.getByLabelText('Diff')).not.toHaveAttribute('aria-keyshortcuts');
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
      patchActionable: true,
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

  it('renders only bordered Hunk action buttons in the separator', () => {
    const onAction = vi.fn<(selection: SurfaceHunkSelection) => void>();
    const onEdit = vi.fn<(selection: SurfaceHunkSelection) => void>();
    const onDiscard = vi.fn<(selection: SurfaceHunkSelection) => void>();
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        hunkAction={{ kind: 'stage', onEdit, onAction, onDiscard }}
      />,
    );

    const props = patchDiffPropsMock.mock.lastCall?.[0];
    const { host, root } = createDiffHost();
    vi.spyOn(
      root.querySelector<HTMLElement>('[data-code]')!,
      'getBoundingClientRect',
    ).mockReturnValue(new DOMRect(10));
    vi.spyOn(
      root.querySelector<HTMLElement>('[data-content]')!,
      'getBoundingClientRect',
    ).mockReturnValue(new DOMRect(90));
    props?.options.onPostRender?.(
      host,
      {
        fileDiff: {
          name: 'example.txt',
          type: 'change',
          hunks: [
            {
              collapsedBefore: 4,
              deletionStart: 1,
              deletionCount: 2,
              additionStart: 1,
              additionCount: 2,
              deletionLines: 1,
              additionLines: 1,
            },
          ],
        },
      },
      'mount',
    );
    const edit = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit hunk 1, lines 1–2"]',
    );
    const stage = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Stage hunk 1, lines 1–2"]',
    );
    const discard = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Discard hunk 1, lines 1–2"]',
    );
    expect(edit?.textContent).toBe('Edit Hunk');
    expect(stage?.textContent).toBe('Stage Hunk');
    expect(discard?.textContent).toBe('Discard Hunk');
    const controls = root.querySelector<HTMLElement>('[data-stella-hunk-controls]');
    expect(controls).not.toBeNull();
    expect(controls?.querySelector('[data-stella-hunk-label]')).toHaveTextContent(
      'Hunk 1 Lines 1–2',
    );
    expect(controls?.querySelector('[data-stella-hunk-actions]')).toContainElement(edit);
    expect(controls?.querySelector('[data-stella-hunk-actions]')).toContainElement(stage);
    expect(controls?.querySelector('[data-stella-hunk-actions]')).toContainElement(discard);
    expect(controls?.closest('[data-content]')).toBeNull();
    expect(controls?.closest('[data-gutter]')).not.toBeNull();
    expect(controls?.querySelector('[data-stella-hunk-toggle]')).toBeNull();
    fireEvent.click(edit!);
    fireEvent.click(stage!);
    fireEvent.click(discard!);

    expect(onEdit).toHaveBeenCalledWith({ hunkIndex: 0, startLine: 1 });
    expect(onAction).toHaveBeenCalledWith({ hunkIndex: 0 });
    expect(onDiscard).toHaveBeenCalledWith({ hunkIndex: 0 });
    expect(props?.options.unsafeCSS).toContain(
      '[data-stella-hunk-controls] button,\n[data-stella-hunk-actions-host] button {\n  appearance: none;',
    );
    expect(props?.options.unsafeCSS).toContain(
      '[data-stella-hunk-label] {\n  min-width: 0;\n  margin-right: auto;\n  overflow: hidden;',
    );
    expect(props?.options.unsafeCSS).toContain(
      '[data-separator][data-stella-hunk-control-row] [data-separator-wrapper] {\n  display: flex;\n  width: 100cqi;',
    );
    expect(props?.options.unsafeCSS).toContain(
      '[data-diff],\n[data-file],\n[data-code] {\n  container-type: inline-size;\n}',
    );
    expect(props?.options.unsafeCSS).toContain(
      "[data-diff-type='split'][data-overflow='wrap']\n  [data-separator][data-stella-hunk-control-row]\n  [data-separator-wrapper] {\n  width: 50cqi;",
    );
    expect(props?.options.unsafeCSS).toContain('[data-stella-hunk-actions] {\n  display: flex;');
    expect(props?.options.unsafeCSS).not.toContain(
      '[data-stella-hunk-actions] {\n  position: sticky;',
    );
    expect(props?.options.unsafeCSS).not.toContain(
      "[data-overflow='scroll'] [data-separator][data-stella-hunk-control-row] [data-separator-content]",
    );
    expect(props?.options.unsafeCSS).not.toContain('transform: translateX(');
    expect(props?.options.unsafeCSS).toContain('padding: 0 12px;');
    expect(props?.options.unsafeCSS).toContain('--diffs-font-size: var(--code-font-size);');
    expect(props?.options.unsafeCSS).toContain('font-size: 0.6875rem;');
    expect(props?.options.unsafeCSS).not.toContain('[data-stella-hunk-toggle]');
  });

  it('uses the worktree-side start line when editing a deletion-only Hunk', () => {
    const onEdit = vi.fn<(selection: SurfaceHunkSelection & { startLine: number }) => void>();
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        hunkAction={{ kind: 'stage', onEdit }}
      />,
    );

    const props = patchDiffPropsMock.mock.lastCall?.[0];
    const { host, root } = createDiffHost();
    props?.options.onPostRender?.(
      host,
      {
        fileDiff: {
          name: 'example.txt',
          type: 'change',
          hunks: [
            {
              collapsedBefore: 8,
              deletionStart: 12,
              deletionCount: 3,
              additionStart: 10,
              additionCount: 0,
              deletionLines: 3,
              additionLines: 0,
            },
          ],
        },
      },
      'mount',
    );
    fireEvent.click(root.querySelector<HTMLButtonElement>('button[aria-label^="Edit hunk"]')!);

    expect(onEdit).toHaveBeenCalledWith({ hunkIndex: 0, startLine: 10 });
  });

  it('keeps the Hunk label and discard action when the Stage action is hidden', () => {
    const onDiscard = vi.fn<(selection: SurfaceHunkSelection) => void>();
    render(
      <DiffSurface
        source={{
          kind: 'patch',
          patch: PATCH,
          path: 'example.txt',
          cacheKey: 'revision-1',
        }}
        hunkAction={{ kind: 'stage', onDiscard }}
      />,
    );

    const props = patchDiffPropsMock.mock.lastCall?.[0];
    const { host, root } = createDiffHost();
    props?.options.onPostRender?.(
      host,
      {
        fileDiff: {
          name: 'example.txt',
          type: 'change',
          hunks: [
            {
              collapsedBefore: 4,
              deletionStart: 1,
              deletionCount: 2,
              additionStart: 1,
              additionCount: 2,
              deletionLines: 1,
              additionLines: 1,
            },
          ],
        },
      },
      'mount',
    );

    expect(root.querySelector('button[aria-label^="Stage hunk"]')).toBeNull();
    expect(root.querySelector('[data-stella-hunk-label]')).toHaveTextContent('Hunk 1 Lines 1–2');
    const discard = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Discard hunk 1, lines 1–2"]',
    );
    expect(discard).toHaveTextContent('Discard Hunk');
    fireEvent.click(discard!);
    expect(onDiscard).toHaveBeenCalledWith({ hunkIndex: 0 });
  });

  it('retranslates mounted Hunk controls when the interface language changes', () => {
    const hunkAction = {
      kind: 'stage' as const,
      onEdit: vi.fn<() => void>(),
      onAction: vi.fn<() => void>(),
      onDiscard: vi.fn<() => void>(),
    };
    const source = {
      kind: 'patch' as const,
      patch: PATCH,
      path: 'example.txt',
      cacheKey: 'revision-1',
    };
    const { rerender } = render(
      <StrictMode>
        <I18nProvider language="en">
          <DiffSurface source={source} hunkAction={hunkAction} />
        </I18nProvider>
      </StrictMode>,
    );
    const props = patchDiffPropsMock.mock.lastCall?.[0];
    const { host, root } = createDiffHost();
    props?.options.onPostRender?.(
      host,
      {
        fileDiff: {
          name: 'example.txt',
          type: 'change',
          hunks: [
            {
              collapsedBefore: 4,
              deletionStart: 1,
              deletionCount: 2,
              additionStart: 1,
              additionCount: 2,
              deletionLines: 1,
              additionLines: 1,
            },
          ],
        },
      },
      'mount',
    );
    expect(root.querySelector('[data-stella-hunk-controls]')).toHaveTextContent(
      'Hunk 1 Lines 1–2Edit HunkStage HunkDiscard Hunk',
    );

    rerender(
      <StrictMode>
        <I18nProvider language="ja">
          <DiffSurface source={source} hunkAction={hunkAction} />
        </I18nProvider>
      </StrictMode>,
    );

    expect(root.querySelector('[data-stella-hunk-controls]')).toHaveTextContent(
      'ハンク1 行1–2ハンクを編集ハンクをステージハンクを破棄',
    );
  });

  it('retranslates mounted Hunk controls when HMR updates the catalog in the same language', () => {
    const hunkAction = {
      kind: 'stage' as const,
      onEdit: vi.fn<() => void>(),
      onAction: vi.fn<() => void>(),
      onDiscard: vi.fn<() => void>(),
    };
    const source = {
      kind: 'patch' as const,
      patch: PATCH,
      path: 'example.txt',
      cacheKey: 'revision-1',
    };
    render(
      <I18nProvider language="ja">
        <CaptureI18n />
        <DiffSurface source={source} hunkAction={hunkAction} />
      </I18nProvider>,
    );
    const props = patchDiffPropsMock.mock.lastCall?.[0];
    const { host, root } = createDiffHost();
    props?.options.onPostRender?.(
      host,
      {
        fileDiff: {
          name: 'example.txt',
          type: 'change',
          hunks: [
            {
              collapsedBefore: 4,
              deletionStart: 1,
              deletionCount: 2,
              additionStart: 1,
              additionCount: 2,
              deletionLines: 1,
              additionLines: 1,
            },
          ],
        },
      },
      'mount',
    );
    if (!mountedI18n) throw new Error('The test i18n instance is missing.');

    try {
      act(() => {
        mountedI18n?.addResource('ja', 'translation', 'editHunk', 'HMR後のハンクを編集');
      });

      expect(root.querySelector('[data-stella-hunk-controls]')).toHaveTextContent(
        'HMR後のハンクを編集',
      );
    } finally {
      act(() => {
        mountedI18n?.addResource(
          'ja',
          'translation',
          'editHunk',
          resources.ja.translation.editHunk,
        );
      });
    }
  });

  it('renders a CodeView Hunk action with the owning item id', () => {
    const onAction = vi.fn<(selection: SurfaceHunkSelection) => void>();
    const fileDiff = {
      name: 'example.txt',
      type: 'change' as const,
      hunks: [
        {
          collapsedBefore: 4,
          deletionStart: 4,
          deletionCount: 2,
          additionStart: 4,
          additionCount: 3,
          deletionLines: 1,
          additionLines: 2,
        },
      ],
    };
    parsePatchFilesMock.mockReturnValue([
      {
        files: [fileDiff],
      },
    ]);
    render(
      <DiffSurface
        source={{ kind: 'codeView', patch: PATCH, cacheKey: 'revision-1' }}
        performanceMode
        hunkAction={{ kind: 'unstage', onAction }}
      />,
    );

    const props = codeViewPropsMock.mock.lastCall?.[0];
    const { host, root } = createDiffHost();
    props?.options?.onPostRender?.(host, { fileDiff }, 'mount');
    const unstage = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Unstage hunk 1, lines 4–6"]',
    );
    fireEvent.click(unstage!);

    expect(onAction).toHaveBeenCalledWith({
      hunkIndex: 0,
      itemId: 'revision-1:0:0',
    });
  });
});
