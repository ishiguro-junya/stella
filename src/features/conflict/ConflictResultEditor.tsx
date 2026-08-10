import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';

import { useResolvedAppearance } from '../../theme/appearance';
import { useI18n } from '../../i18n/i18n';

export const STELLA_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  {
    tag: [tags.string, tags.character, tags.attributeValue, tags.regexp],
    color: 'var(--syntax-string)',
  },
  {
    tag: [tags.literal, tags.number, tags.bool, tags.null, tags.atom],
    color: 'var(--syntax-constant)',
  },
  { tag: [tags.keyword, tags.modifier, tags.self], color: 'var(--syntax-keyword)' },
  {
    tag: [tags.variableName, tags.propertyName, tags.attributeName],
    color: 'var(--syntax-parameter)',
  },
  {
    tag: [
      tags.definition(tags.variableName),
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.className,
      tags.typeName,
    ],
    color: 'var(--syntax-function)',
  },
  { tag: [tags.operator, tags.punctuation], color: 'var(--syntax-punctuation)' },
  { tag: [tags.link, tags.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--danger)', textDecoration: 'underline wavy' },
]);

export interface ConflictResultEditorProps {
  value: string;
  path: string;
  lineEnding: 'lf' | 'crlf';
  readOnly?: boolean;
  performanceMode?: boolean;
  selectedRange?: { from: number; to: number } | undefined;
  ariaLabel?: string;
  onChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onMarkResolved: () => void;
}

interface LatestCallbacks {
  onChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onMarkResolved: () => void;
}

export function ConflictResultEditor({
  value,
  path,
  lineEnding,
  readOnly = false,
  performanceMode = false,
  selectedRange,
  ariaLabel,
  onChange,
  onUndo,
  onRedo,
  onSave,
  onMarkResolved,
}: ConflictResultEditorProps) {
  const { t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t('conflictResultEditor');
  const resolvedAppearance = useResolvedAppearance();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingRef = useRef(false);
  const languageRef = useRef(new Compartment());
  const editableRef = useRef(new Compartment());
  const lineSeparatorRef = useRef(new Compartment());
  const themeRef = useRef(new Compartment());
  const callbacksRef = useRef<LatestCallbacks>({
    onChange,
    onUndo,
    onRedo,
    onSave,
    onMarkResolved,
  });
  const initialValueRef = useRef(value);
  const initialReadOnlyRef = useRef(readOnly);
  const initialLineEndingRef = useRef(lineEnding);
  const initialAppearanceRef = useRef(resolvedAppearance);

  callbacksRef.current = { onChange, onUndo, onRedo, onSave, onMarkResolved };
  initialValueRef.current = value;
  initialReadOnlyRef.current = readOnly;
  initialLineEndingRef.current = lineEnding;
  initialAppearanceRef.current = resolvedAppearance;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return () => undefined;

    const customKeys = keymap.of([
      {
        key: 'Mod-z',
        run: () => {
          callbacksRef.current.onUndo();
          return true;
        },
      },
      {
        key: 'Mod-Shift-z',
        run: () => {
          callbacksRef.current.onRedo();
          return true;
        },
      },
      {
        key: 'Mod-y',
        run: () => {
          callbacksRef.current.onRedo();
          return true;
        },
      },
      {
        key: 'Mod-s',
        run: () => {
          callbacksRef.current.onSave();
          return true;
        },
      },
      {
        key: 'Mod-Shift-Enter',
        run: () => {
          callbacksRef.current.onMarkResolved();
          return true;
        },
      },
      ...defaultKeymap,
      ...searchKeymap,
      ...foldKeymap,
      indentWithTab,
    ]);

    const standardExtensions = performanceMode
      ? []
      : [
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          highlightSelectionMatches(),
          syntaxHighlighting(STELLA_HIGHLIGHT_STYLE, { fallback: true }),
          rectangularSelection(),
          crosshairCursor(),
        ];

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorState.allowMultipleSelections.of(false),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': resolvedAriaLabel,
          'aria-multiline': 'true',
          role: 'textbox',
          spellcheck: 'false',
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            color: 'var(--code-text)',
            backgroundColor: 'var(--code-surface)',
          },
          '.cm-content': {
            caretColor: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
          },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
          '.cm-gutters': {
            color: 'var(--text-tertiary)',
            backgroundColor: 'var(--surface-raised)',
            borderRightColor: 'var(--border-subtle)',
          },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--selection-muted)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor: 'var(--selection-strong)',
          },
          '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
        }),
        languageRef.current.of([]),
        editableRef.current.of([
          EditorState.readOnly.of(initialReadOnlyRef.current),
          EditorView.editable.of(!initialReadOnlyRef.current),
        ]),
        lineSeparatorRef.current.of(
          EditorState.lineSeparator.of(initialLineEndingRef.current === 'crlf' ? '\r\n' : '\n'),
        ),
        themeRef.current.of(EditorView.darkTheme.of(initialAppearanceRef.current === 'dark')),
        customKeys,
        ...standardExtensions,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) {
            callbacksRef.current.onChange(update.state.sliceDoc());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [performanceMode, resolvedAriaLabel]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: editableRef.current.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      });
    }
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: lineSeparatorRef.current.reconfigure(
          EditorState.lineSeparator.of(lineEnding === 'crlf' ? '\r\n' : '\n'),
        ),
      });
    }
  }, [lineEnding]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: themeRef.current.reconfigure(
          EditorView.darkTheme.of(resolvedAppearance === 'dark'),
        ),
      });
    }
  }, [resolvedAppearance]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || performanceMode) return () => undefined;
    const description = LanguageDescription.matchFilename(languages, path);
    let cancelled = false;

    void description?.load().then((support) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current.dispatch({ effects: languageRef.current.reconfigure(support) });
    });

    return () => {
      cancelled = true;
    };
  }, [path, performanceMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.sliceDoc() === value) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectedRange) return;
    const from = Math.min(
      rawUtf16OffsetToEditorOffset(value, selectedRange.from),
      view.state.doc.length,
    );
    const to = Math.min(
      Math.max(rawUtf16OffsetToEditorOffset(value, selectedRange.to), from),
      view.state.doc.length,
    );
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
  }, [selectedRange, value]);

  return (
    <div ref={hostRef} className="conflict-result-editor" data-performance-mode={performanceMode} />
  );
}

export function rawUtf16OffsetToEditorOffset(value: string, rawOffset: number): number {
  const clamped = Math.min(Math.max(rawOffset, 0), value.length);
  const prefix = value.slice(0, clamped);
  const crlfCount = prefix.match(/\r\n/gu)?.length ?? 0;
  return clamped - crlfCount;
}
