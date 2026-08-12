import { useEffect, useLayoutEffect, useRef } from 'react';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
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

import { DEFAULT_EDITOR_WRAP_COLUMN, normalizeEditorWrapColumn } from '../persistence/preferences';
import { useResolvedAppearance } from '../theme/appearance';

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

export interface TextEditorProps {
  value: string;
  path: string;
  lineEnding: 'lf' | 'crlf';
  readOnly?: boolean;
  performanceMode?: boolean;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  initialScrollLine?: number | undefined;
  selectedRange?: { from: number; to: number } | undefined;
  ariaLabel: string;
  className?: string | undefined;
  onChange: (value: string) => void;
  onSave: () => void;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  onSecondaryAction?: (() => void) | undefined;
}

interface LatestCallbacks {
  onChange: (value: string) => void;
  onSave: () => void;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  onSecondaryAction?: (() => void) | undefined;
}

const INITIAL_SCROLL_TOP_RATIO = 0.25;

function resolveInitialScrollViewportHeight(host: HTMLElement): number {
  let element: HTMLElement | null = host;
  while (element) {
    if (element.clientHeight > 0) return element.clientHeight;
    element = element.parentElement;
  }
  return 0;
}

export function TextEditor({
  value,
  path,
  lineEnding,
  readOnly = false,
  performanceMode = false,
  lineWrapping = false,
  wrapColumn = DEFAULT_EDITOR_WRAP_COLUMN,
  initialScrollLine,
  selectedRange,
  ariaLabel,
  className,
  onChange,
  onSave,
  onUndo,
  onRedo,
  onSecondaryAction,
}: TextEditorProps) {
  const resolvedAppearance = useResolvedAppearance();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingRef = useRef(false);
  const languageRef = useRef(new Compartment());
  const editableRef = useRef(new Compartment());
  const lineSeparatorRef = useRef(new Compartment());
  const lineWrappingRef = useRef(new Compartment());
  const themeRef = useRef(new Compartment());
  const callbacksRef = useRef<LatestCallbacks>({
    onChange,
    onSave,
    onUndo,
    onRedo,
    onSecondaryAction,
  });
  const initialValueRef = useRef(value);
  const initialReadOnlyRef = useRef(readOnly);
  const initialLineEndingRef = useRef(lineEnding);
  const initialLineWrappingRef = useRef(lineWrapping);
  const initialWrapColumnRef = useRef(normalizeEditorWrapColumn(wrapColumn));
  const initialScrollLineRef = useRef(initialScrollLine);
  const initialAppearanceRef = useRef(resolvedAppearance);
  const externalUndo = Boolean(onUndo);
  const externalRedo = Boolean(onRedo);
  const externalHistory = externalUndo || externalRedo;
  const secondaryActionEnabled = Boolean(onSecondaryAction);

  callbacksRef.current = { onChange, onSave, onUndo, onRedo, onSecondaryAction };
  initialValueRef.current = value;
  initialReadOnlyRef.current = readOnly;
  initialLineEndingRef.current = lineEnding;
  initialLineWrappingRef.current = lineWrapping;
  initialWrapColumnRef.current = normalizeEditorWrapColumn(wrapColumn);
  initialScrollLineRef.current = initialScrollLine;
  initialAppearanceRef.current = resolvedAppearance;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return () => undefined;

    const customKeys = keymap.of([
      ...(externalUndo
        ? [
            {
              key: 'Mod-z',
              run: () => {
                callbacksRef.current.onUndo?.();
                return true;
              },
            },
          ]
        : []),
      ...(externalRedo
        ? [
            {
              key: 'Mod-Shift-z',
              run: () => {
                callbacksRef.current.onRedo?.();
                return true;
              },
            },
            {
              key: 'Mod-y',
              run: () => {
                callbacksRef.current.onRedo?.();
                return true;
              },
            },
          ]
        : []),
      {
        key: 'Mod-s',
        run: () => {
          callbacksRef.current.onSave();
          return true;
        },
      },
      ...(secondaryActionEnabled
        ? [
            {
              key: 'Mod-Shift-Enter',
              run: () => {
                callbacksRef.current.onSecondaryAction?.();
                return true;
              },
            },
          ]
        : []),
      ...defaultKeymap,
      ...(!externalHistory ? historyKeymap : []),
      ...searchKeymap,
      ...foldKeymap,
      indentWithTab,
    ]);

    const standardExtensions = performanceMode
      ? []
      : [
          foldGutter({ markerDOM: createFoldMarker }),
          indentOnInput(),
          bracketMatching(),
          highlightSelectionMatches(),
          syntaxHighlighting(STELLA_HIGHLIGHT_STYLE, { fallback: true }),
          rectangularSelection(),
          crosshairCursor(),
        ];

    const baseState = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        ...(!externalHistory ? [history()] : []),
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorState.allowMultipleSelections.of(false),
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          'aria-keyshortcuts': 'Meta+S',
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
            fontSize: 'var(--code-font-size)',
          },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
          '.cm-gutters': {
            color: 'var(--text-tertiary)',
            backgroundColor: 'var(--surface-raised)',
            borderRightColor: 'var(--border-subtle)',
          },
          '.cm-lineNumbers .cm-gutterElement': { paddingRight: '4px' },
          '.cm-foldGutter': { width: '18px' },
          '.cm-foldGutter .cm-gutterElement': {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            padding: '0',
            lineHeight: '1',
          },
          '.cm-foldGutter .text-editor-fold-marker': {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '12px',
            height: '12px',
          },
          '.cm-foldGutter .text-editor-fold-marker > svg': {
            display: 'block',
            width: '12px',
            height: '12px',
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
        lineWrappingRef.current.of(
          createLineWrappingExtensions(
            initialLineWrappingRef.current,
            initialWrapColumnRef.current,
          ),
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

    const requestedScrollLine = initialScrollLineRef.current;
    const scrollRequested =
      typeof requestedScrollLine === 'number' && Number.isFinite(requestedScrollLine);
    const scrollLine = scrollRequested
      ? Math.min(Math.max(Math.trunc(requestedScrollLine), 1), baseState.doc.lines)
      : 1;
    const scrollPosition = baseState.doc.line(scrollLine).from;
    // Flex layoutの初回計測でEditor自身が0pxでも、初回描画前の位置決めを維持する。
    const scrollTopMargin = resolveInitialScrollViewportHeight(host) * INITIAL_SCROLL_TOP_RATIO;
    const state = scrollRequested
      ? baseState.update({
          selection: { anchor: scrollPosition },
          annotations: Transaction.addToHistory.of(false),
        }).state
      : baseState;
    const view = new EditorView({
      state,
      parent: host,
      ...(scrollRequested
        ? {
            scrollTo: EditorView.scrollIntoView(scrollPosition, {
              y: 'start',
              yMargin: scrollTopMargin,
            }),
          }
        : {}),
    });
    if (!scrollRequested) view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
    if (scrollRequested) view.focus();
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [
    ariaLabel,
    externalHistory,
    externalRedo,
    externalUndo,
    performanceMode,
    secondaryActionEnabled,
  ]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineSeparatorRef.current.reconfigure(
        EditorState.lineSeparator.of(lineEnding === 'crlf' ? '\r\n' : '\n'),
      ),
    });
  }, [lineEnding]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineWrappingRef.current.reconfigure(
        createLineWrappingExtensions(lineWrapping, normalizeEditorWrapColumn(wrapColumn)),
      ),
    });
  }, [lineWrapping, wrapColumn]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeRef.current.reconfigure(EditorView.darkTheme.of(resolvedAppearance === 'dark')),
    });
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
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
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
    <div
      ref={hostRef}
      className={`text-editor${className ? ` ${className}` : ''}`}
      data-performance-mode={performanceMode}
      data-line-wrapping={lineWrapping}
      data-wrap-column={normalizeEditorWrapColumn(wrapColumn)}
    />
  );
}

function createLineWrappingExtensions(enabled: boolean, column: number) {
  return enabled
    ? [
        EditorView.lineWrapping,
        EditorView.theme({
          '.cm-lineWrapping': { maxWidth: `calc(${column}ch + 8px)` },
        }),
      ]
    : [];
}

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement('span');
  marker.className = `text-editor-fold-marker ${open ? 'is-open' : 'is-closed'}`;
  marker.title = open ? 'Fold line' : 'Unfold line';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  chevron.setAttribute('points', open ? '2 4 6 8 10 4' : '4 2 8 6 4 10');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-width', '1.5');
  chevron.setAttribute('stroke-linecap', 'round');
  chevron.setAttribute('stroke-linejoin', 'round');
  svg.append(chevron);
  marker.append(svg);
  return marker;
}

export function rawUtf16OffsetToEditorOffset(value: string, rawOffset: number): number {
  const clamped = Math.min(Math.max(rawOffset, 0), value.length);
  const prefix = value.slice(0, clamped);
  const crlfCount = prefix.match(/\r\n/gu)?.length ?? 0;
  return clamped - crlfCount;
}
