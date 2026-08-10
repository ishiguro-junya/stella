import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppearanceProvider } from '../../theme/appearance';
import {
  ConflictResultEditor,
  rawUtf16OffsetToEditorOffset,
  STELLA_HIGHLIGHT_STYLE,
} from './ConflictResultEditor';

describe('ConflictResultEditor CRLF boundary', () => {
  it('serializes editor content with CRLF', () => {
    const state = EditorState.create({
      doc: '日本語\r\n😀 next\r\n',
      extensions: [EditorState.lineSeparator.of('\r\n')],
    });
    expect(state.sliceDoc()).toBe('日本語\r\n😀 next\r\n');
  });

  it('converts raw UTF-16 CRLF offsets without shifting emoji', () => {
    const value = '日本語\r\n😀 next\r\nend';
    const rawStart = value.indexOf('😀');
    const rawEnd = value.indexOf('end');
    expect(rawUtf16OffsetToEditorOffset(value, rawStart)).toBe(rawStart - 1);
    expect(rawUtf16OffsetToEditorOffset(value, rawEnd)).toBe(rawEnd - 2);
  });

  it('keeps the current buffer when performance mode recreates EditorView', () => {
    const callbacks = {
      onChange: vi.fn<(value: string) => void>(),
      onUndo: vi.fn<() => void>(),
      onRedo: vi.fn<() => void>(),
      onSave: vi.fn<() => void>(),
      onMarkResolved: vi.fn<() => void>(),
    };
    const { container, rerender } = render(
      <ConflictResultEditor
        value={'base\r\n'}
        path="result.unknown"
        lineEnding="crlf"
        {...callbacks}
      />,
    );
    rerender(
      <ConflictResultEditor
        value={'local draft\r\n'}
        path="result.unknown"
        lineEnding="crlf"
        {...callbacks}
      />,
    );
    rerender(
      <ConflictResultEditor
        value={'local draft\r\n'}
        path="result.unknown"
        lineEnding="crlf"
        performanceMode
        {...callbacks}
      />,
    );

    expect(container.querySelector('.cm-content')).toHaveTextContent('local draft');
  });

  it('uses semantic syntax variables and reconfigures dark mode without recreating EditorView', () => {
    const callbacks = {
      onChange: vi.fn<(value: string) => void>(),
      onUndo: vi.fn<() => void>(),
      onRedo: vi.fn<() => void>(),
      onSave: vi.fn<() => void>(),
      onMarkResolved: vi.fn<() => void>(),
    };
    const colors = STELLA_HIGHLIGHT_STYLE.specs.flatMap((spec) =>
      typeof spec.color === 'string' ? [spec.color] : [],
    );
    expect(colors).toEqual(
      expect.arrayContaining([
        'var(--syntax-keyword)',
        'var(--syntax-string)',
        'var(--syntax-comment)',
        'var(--syntax-function)',
      ]),
    );

    const { container, rerender } = render(
      <AppearanceProvider appearance="light">
        <ConflictResultEditor
          value="const answer = 42;\n"
          path="result.ts"
          lineEnding="lf"
          {...callbacks}
        />
      </AppearanceProvider>,
    );
    const editor = container.querySelector('.cm-editor');
    if (!(editor instanceof HTMLElement)) throw new Error('CodeMirror editor was not rendered.');
    expect(EditorView.findFromDOM(editor)?.state.facet(EditorView.darkTheme)).toBe(false);

    rerender(
      <AppearanceProvider appearance="dark">
        <ConflictResultEditor
          value="const answer = 42;\n"
          path="result.ts"
          lineEnding="lf"
          {...callbacks}
        />
      </AppearanceProvider>,
    );
    expect(container.querySelector('.cm-editor')).toBe(editor);
    expect(EditorView.findFromDOM(editor)?.state.facet(EditorView.darkTheme)).toBe(true);
  });
});
