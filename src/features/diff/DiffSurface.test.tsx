import { act, render, screen } from '@testing-library/react';
import type { CodeViewLineSelection, SelectedLineRange } from '@pierre/diffs';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockCodeViewProps {
  onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
}

interface MockPatchDiffOptions {
  onLineSelectionChange?: (range: SelectedLineRange | null) => void;
}

const { codeViewPropsMock, parsePatchFilesMock, patchDiffOptionsMock } = vi.hoisted(() => ({
  codeViewPropsMock: vi.fn<(props: MockCodeViewProps) => void>(),
  parsePatchFilesMock: vi.fn<(patch: string, cacheKey: string) => unknown[]>(),
  patchDiffOptionsMock: vi.fn<(options: MockPatchDiffOptions) => void>(),
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
  PatchDiff: ({ options }: { options: MockPatchDiffOptions }) => {
    patchDiffOptionsMock(options);
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
  patchDiffOptionsMock.mockReset();
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

    expect(patchDiffOptionsMock).toHaveBeenLastCalledWith(
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
    expect(patchDiffOptionsMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        itemMetrics: { spacing: 0, paddingTop: 0, paddingBottom: 0 },
        layout: { paddingTop: 0, paddingBottom: 0, gap: 8 },
        unsafeCSS: expect.stringContaining('--diffs-gap-block: 0px;'),
      }),
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
    expect(patchDiffOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ themeType: 'light' }),
    );

    rerender(
      <AppearanceProvider appearance="dark">
        <DiffSurface source={source} />
      </AppearanceProvider>,
    );
    expect(patchDiffOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ themeType: 'dark' }),
    );
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
    const onLineSelectionChange = patchDiffOptionsMock.mock.lastCall?.[0].onLineSelectionChange;
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

    expect(patchDiffOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enableLineSelection: true, controlledSelection: true }),
    );
    expect(screen.queryByText('Select lines')).not.toBeInTheDocument();
  });
});
