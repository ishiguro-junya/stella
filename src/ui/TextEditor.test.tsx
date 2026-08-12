import { fireEvent, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { TextEditor } from './TextEditor';

describe('TextEditor', () => {
  it('binds Command-S without changing the document', () => {
    const onSave = vi.fn<() => void>();
    const onChange = vi.fn<(value: string) => void>();
    const { container } = render(
      <TextEditor
        value="const value = 1;\n"
        path="src/app.ts"
        lineEnding="lf"
        ariaLabel="Edit src/app.ts"
        onChange={onChange}
        onSave={onSave}
      />,
    );
    const content = container.querySelector('.cm-content');
    if (!(content instanceof HTMLElement)) throw new Error('CodeMirror editor was not rendered.');

    fireEvent.keyDown(content, { key: 's', code: 'KeyS', ctrlKey: true });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the line-number and fold-control gutters compact and aligned', () => {
    const { container } = render(
      <TextEditor
        value={'function example() {\n  return true;\n}\n'}
        path="src/app.ts"
        lineEnding="lf"
        ariaLabel="Edit src/app.ts"
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    );
    const lineNumber = container.querySelector('.cm-lineNumbers .cm-gutterElement');
    const foldGutter = container.querySelector('.cm-foldGutter');
    if (!(lineNumber instanceof HTMLElement) || !(foldGutter instanceof HTMLElement)) {
      throw new Error('CodeMirror gutters were not rendered.');
    }

    const foldMarker = container.querySelector('.cm-foldGutter .text-editor-fold-marker');
    if (!(foldMarker instanceof HTMLElement)) {
      throw new Error('CodeMirror fold marker was not rendered.');
    }
    const foldMarkerChevron = foldMarker.querySelector('polyline');

    expect(getComputedStyle(lineNumber).paddingRight).toBe('4px');
    expect(getComputedStyle(foldGutter).width).toBe('18px');
    expect(foldMarker).toHaveClass('is-closed');
    expect(foldMarkerChevron).toHaveAttribute('points', '4 2 8 6 4 10');
  });

  it('starts at the beginning of the file', () => {
    const { container } = render(
      <TextEditor
        value={'line\n'.repeat(200)}
        path="notes.txt"
        lineEnding="lf"
        ariaLabel="Edit notes.txt"
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    );
    const scroller = container.querySelector('.cm-scroller');
    if (!(scroller instanceof HTMLElement))
      throw new Error('CodeMirror scroller was not rendered.');

    expect(scroller.scrollTop).toBe(0);
    expect(scroller.scrollLeft).toBe(0);
    expect(container.querySelector('.cm-content')).not.toHaveFocus();
  });

  it('opens the requested line above center and focused in the initial state', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `line-${index + 1}`);
    const value = lines.join('\n');
    const targetOffset = `${lines.slice(0, 79).join('\n')}\n`.length;
    const scrollIntoView = vi.spyOn(EditorView, 'scrollIntoView');
    const { container } = render(
      <TextEditor
        value={value}
        path="notes.txt"
        lineEnding="lf"
        initialScrollLine={80}
        ariaLabel="Edit notes.txt"
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(container.querySelector('.cm-activeLine')).toHaveTextContent('line-80');
    expect(scrollIntoView).toHaveBeenCalledWith(targetOffset, { y: 'start', yMargin: 0 });
    expect(container.querySelector('.cm-content')).toHaveFocus();
  });

  it('defaults to no wrapping and reconfigures the wrap length without recreating the editor', () => {
    const props = {
      value: 'x'.repeat(200),
      path: 'notes.txt',
      lineEnding: 'lf' as const,
      ariaLabel: 'Edit notes.txt',
      onChange: () => undefined,
      onSave: () => undefined,
    };
    const { container, rerender } = render(<TextEditor {...props} />);
    const editor = container.querySelector('.cm-editor');
    const content = container.querySelector('.cm-content');
    const host = container.querySelector('.text-editor');
    if (!(editor instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      throw new Error('CodeMirror editor was not rendered.');
    }

    expect(content).not.toHaveClass('cm-lineWrapping');
    expect(host).toHaveAttribute('data-line-wrapping', 'false');
    expect(host).toHaveAttribute('data-wrap-column', '120');

    rerender(<TextEditor {...props} lineWrapping wrapColumn={96} />);

    expect(container.querySelector('.cm-editor')).toBe(editor);
    expect(content).toHaveClass('cm-lineWrapping');
    const widthAt96 = Number.parseFloat(getComputedStyle(content).maxWidth);
    expect(widthAt96).toBeGreaterThan(0);
    expect(host).toHaveAttribute('data-line-wrapping', 'true');
    expect(host).toHaveAttribute('data-wrap-column', '96');

    rerender(<TextEditor {...props} lineWrapping wrapColumn={120} />);
    expect(Number.parseFloat(getComputedStyle(content).maxWidth)).toBeGreaterThan(widthAt96);
  });
});
