import {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { parseDiffFromFile, parsePatchFiles, registerCustomCSSVariableTheme } from '@pierre/diffs';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  CodeViewItem,
  CodeViewLineSelection,
  DiffLineEventBaseProps,
  FileDiffMetadata,
  LineEventBaseProps,
  SelectedLineRange,
} from '@pierre/diffs';
import { CodeView, FileDiff, PatchDiff, WorkerPoolContextProvider } from '@pierre/diffs/react';
// oxlint-disable-next-line import/default -- Viteの?worker queryがdefaultのWorker constructorを生成する。
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';

import type { DiffStyle } from '../../domain/workspace';
import {
  DEFAULT_EDITOR_WRAP_COLUMN,
  normalizeEditorWrapColumn,
} from '../../persistence/preferences';
import { useAppearance } from '../../theme/appearance';
import { useI18n } from '../../i18n/i18n';
import { FileStatusIcon, type FileStatus } from '../../ui/FileStatusIcon';

const STELLA_DIFF_THEME = 'stella-semantic';
const STELLA_DIFF_FILE_HEADER_HEIGHT = 32;
// Diffのslot内では共通buttonのmin-heightが優先される場合があるため、正方形の寸法は要素へ直接固定する。
const DIFF_FILE_COLLAPSE_TOGGLE_STYLE: CSSProperties = {
  alignSelf: 'center',
  aspectRatio: '1 / 1',
  boxSizing: 'border-box',
  flex: '0 0 22px',
  width: 22,
  minWidth: 22,
  maxWidth: 22,
  height: 22,
  minHeight: 22,
  maxHeight: 22,
  padding: 0,
};
const STELLA_DIFF_THEMES = {
  light: STELLA_DIFF_THEME,
  dark: STELLA_DIFF_THEME,
} as const;
const STELLA_DIFF_HIGHLIGHT_CSS = `
:host {
  --diffs-font-size: var(--code-font-size);
  --diffs-addition-color-override: var(--diff-addition-accent);
  --diffs-deletion-color-override: var(--diff-deletion-accent);
  --diffs-bg-addition-emphasis-override: var(--diff-addition-emphasis);
  --diffs-bg-deletion-emphasis-override: var(--diff-deletion-emphasis);
  --diffs-gap-block: 0px;
  --diffs-scrollbar-gutter-override: 0px;
  overscroll-behavior: none;
}

[data-code] {
  overscroll-behavior: none;
  -webkit-user-select: none;
  user-select: none;
}

[data-diffs-header='default'],
[data-diffs-header='custom'] {
  min-height: ${STELLA_DIFF_FILE_HEADER_HEIGHT}px;
  padding-inline: 8px 16px;
  border-top: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--diffs-bg-separator);
}

[data-diffs-header='custom'] > slot {
  display: block;
  width: 100%;
}

[data-change-icon] {
  display: none;
}

[data-line-type='change-addition'] {
  --diffs-computed-diff-line-bg: var(--diff-addition-surface);
}

[data-line-type='change-deletion'] {
  --diffs-computed-diff-line-bg: var(--diff-deletion-surface);
}

[data-line-type='change-addition']:where([data-gutter-buffer], [data-column-number]) {
  --diffs-computed-diff-line-bg: var(--diff-addition-gutter);
}

[data-line-type='change-deletion']:where([data-gutter-buffer], [data-column-number]) {
  --diffs-computed-diff-line-bg: var(--diff-deletion-gutter);
}

[data-line][data-selected-line] {
  --diffs-computed-selected-line-bg: var(--diff-selection-surface);
  --diffs-computed-editor-active-line-bg: var(--diff-selection-surface);
  --diffs-computed-hovered-line-bg: var(--diff-selection-surface);
  --diffs-line-bg: var(--diff-selection-surface);
}

[data-column-number][data-selected-line],
[data-gutter-buffer][data-selected-line] {
  --diffs-computed-selected-line-bg: var(--diff-selection-gutter);
  --diffs-computed-editor-active-line-bg: var(--diff-selection-gutter);
  --diffs-computed-hovered-line-bg: var(--diff-selection-gutter);
  --diffs-line-bg: var(--diff-selection-gutter);
}

[data-unmodified-lines] {
  display: none;
}

[data-separator][data-stella-hunk-control-row] [data-separator-wrapper] {
  display: flex;
  width: 100%;
  background-color: var(--diffs-bg-separator);
}

[data-separator][data-stella-hunk-control-row] [data-separator-content] {
  display: flex;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  justify-content: flex-end;
  overflow: visible;
  padding: 0 8px 0 12px;
}

[data-stella-hunk-controls] {
  display: flex;
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  font: 10px var(--diffs-header-font-family, var(--diffs-header-font-fallback));
}

[data-stella-hunk-label] {
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  color: color-mix(in srgb, var(--diffs-fg) 58%, var(--diffs-bg-separator));
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  position: relative;
  text-overflow: ellipsis;
  transform: translateX(calc(0px - var(--stella-hunk-left-offset, 0px)));
  white-space: nowrap;
  z-index: 4;
}

[data-stella-hunk-controls] button {
  appearance: none;
  min-height: 22px;
  margin: 0;
  padding: 1px 7px;
  border: 1px solid color-mix(in srgb, var(--diffs-fg) 24%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--diffs-bg-separator) 86%, var(--diffs-fg) 4%);
  color: var(--diffs-fg);
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}

[data-stella-hunk-controls] button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--diffs-bg-separator) 76%, var(--diffs-fg) 9%);
}

[data-stella-hunk-controls] button:focus-visible {
  outline: 2px solid var(--diffs-modified-base);
  outline-offset: 1px;
}

[data-stella-hunk-controls] button:disabled {
  cursor: default;
  opacity: 0.45;
}
`;

function diffHighlightCss(lineWrapping: boolean, wrapColumn: number): string {
  if (!lineWrapping) return STELLA_DIFF_HIGHLIGHT_CSS;
  const column = normalizeEditorWrapColumn(wrapColumn);
  return `${STELLA_DIFF_HIGHLIGHT_CSS}
[data-overflow='wrap'] [data-line] {
  padding-inline-end: max(1ch, calc(100% - ${column}ch - 1ch));
}
`;
}
let themeRegistered = false;

function registerStellaDiffTheme(): void {
  if (themeRegistered) return;
  registerCustomCSSVariableTheme(STELLA_DIFF_THEME, {
    foreground: 'var(--code-text)',
    background: 'var(--code-surface)',
    'token-constant': 'var(--syntax-constant)',
    'token-string': 'var(--syntax-string)',
    'token-comment': 'var(--syntax-comment)',
    'token-keyword': 'var(--syntax-keyword)',
    'token-parameter': 'var(--syntax-parameter)',
    'token-function': 'var(--syntax-function)',
    'token-string-expression': 'var(--syntax-string)',
    'token-punctuation': 'var(--syntax-punctuation)',
    'token-link': 'var(--accent)',
  });
  themeRegistered = true;
}

registerStellaDiffTheme();

export interface SurfaceSelection {
  side: 'additions' | 'deletions';
  startLine: number;
  endLine: number;
  itemId?: string;
}

export interface SurfaceHunkSelection {
  hunkIndex: number;
  itemId?: string;
}

export interface SurfaceHunkEditSelection extends SurfaceHunkSelection {
  startLine: number;
}

export interface HunkActionConfig {
  kind: 'stage' | 'unstage';
  editDisabled?: boolean;
  onEdit?: (selection: SurfaceHunkEditSelection) => void;
  disabled?: boolean;
  describedBy?: string;
  onAction?: (selection: SurfaceHunkSelection) => void;
  discardDisabled?: boolean;
  onDiscard?: (selection: SurfaceHunkSelection) => void;
}

export interface SurfaceContextPoint {
  x: number;
  y: number;
}

export interface DiffSurfaceHandle {
  getSelection: () => SurfaceSelection | null;
  clearSelection: () => void;
}

type PatchSource = {
  kind: 'patch';
  patch: string;
  path: string;
  cacheKey: string;
};

type CodeViewSource = {
  kind: 'codeView';
  patch: string;
  cacheKey: string;
};

type FileDiffSource = {
  kind: 'fileDiff';
  path: string;
  baseText: string;
  targetText: string;
  baseLabel?: string;
  targetLabel?: string;
  cacheKey: string;
};

export interface DiffSurfaceProps {
  source: PatchSource | CodeViewSource | FileDiffSource;
  diffStyle?: DiffStyle;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  selectable?: boolean;
  performanceMode?: boolean;
  showFileHeaders?: boolean;
  stickyFileHeaders?: boolean;
  collapsed?: boolean;
  hunkSeparators?: 'simple' | 'line-info-basic';
  hunkAction?: HunkActionConfig;
  ariaLabel?: string;
  onSelectionChange?: (selection: SurfaceSelection | null) => void;
  onSelectionContextMenu?: (
    selection: SurfaceSelection,
    point: SurfaceContextPoint,
    text: string,
  ) => void;
}

interface DiffWorkerPoolProviderProps {
  children: ReactNode;
}

export function DiffWorkerPoolProvider({ children }: DiffWorkerPoolProviderProps): ReactNode {
  const canUseWorkers = typeof Worker !== 'undefined';
  const poolOptions = useMemo(
    () => ({
      workerFactory: () => new DiffsWorker(),
      poolSize: Math.min(
        4,
        typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2,
      ),
    }),
    [],
  );

  if (!canUseWorkers) return children;

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={{
        theme: STELLA_DIFF_THEMES,
        lineDiffType: 'word-alt',
        tokenizeMaxLineLength: 2_000,
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}

interface DiffErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface DiffErrorBoundaryState {
  failed: boolean;
}

class DiffErrorBoundary extends Component<DiffErrorBoundaryProps, DiffErrorBoundaryState> {
  override state: DiffErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DiffErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('DiffSurface render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function toSurfaceSelection(
  range: SelectedLineRange | null,
  itemId?: string,
): SurfaceSelection | null {
  if (!range?.side) return null;
  return {
    ...(itemId ? { itemId } : {}),
    side: range.side,
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  };
}

function selectedLineTextFromContextEvent(event: MouseEvent): string {
  const row = event
    .composedPath()
    .find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement &&
        (item.hasAttribute('data-line') || item.hasAttribute('data-column-number')),
    );
  const root = row?.getRootNode();
  if (!(root instanceof ShadowRoot)) return '';
  return [...root.querySelectorAll<HTMLElement>('[data-line][data-selected-line]')]
    .map((line) => line.textContent ?? '')
    .join('\n');
}

function fileStatusForDiffType(type: FileDiffMetadata['type']): FileStatus {
  switch (type) {
    case 'new':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'renamed';
    case 'change':
      return 'modified';
  }
  return type satisfies never;
}

interface HunkControlLabels {
  discard: string;
  discardAria: (number: number, start: number, end: number) => string;
  edit: string;
  editAria: (number: number, start: number, end: number) => string;
  range: (number: number, start: number, end: number) => string;
  stage: string;
  stageAria: (number: number, start: number, end: number) => string;
  unstage: string;
  unstageAria: (number: number, start: number, end: number) => string;
}

interface HunkControlsState {
  action: HunkActionConfig | undefined;
  labels: HunkControlLabels;
}

interface DiffPostRenderInstance {
  fileDiff?: FileDiffMetadata | undefined;
}

type SurfaceLineClickProps = (
  | Omit<DiffLineEventBaseProps, 'event'>
  | Omit<LineEventBaseProps, 'event'>
) & { event: Event };

interface CodeViewLineClickContext {
  type: string;
  item: { id: string };
}

interface SurfaceSelectionAnchor {
  itemId?: string;
  lineNumber: number;
  side: NonNullable<SelectedLineRange['side']>;
}

function isDiffPostRenderInstance(instance: unknown): instance is DiffPostRenderInstance {
  return typeof instance === 'object' && instance !== null && 'fileDiff' in instance;
}

function directDiffColumns(code: HTMLElement): HTMLElement[] {
  return [...code.children].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      (element.hasAttribute('data-gutter') || element.hasAttribute('data-content')),
  );
}

function hunkDisplayRange(hunk: FileDiffMetadata['hunks'][number]): [number, number] {
  const useAdditionSide = hunk.additionCount > 0;
  const start = useAdditionSide ? hunk.additionStart : hunk.deletionStart;
  const count = useAdditionSide ? hunk.additionCount : hunk.deletionCount;
  return [start, start + Math.max(1, count) - 1];
}

function stopHunkControlPropagation(event: Event): void {
  event.stopPropagation();
}

function appendHunkControls(
  separator: HTMLElement,
  hunk: FileDiffMetadata['hunks'][number],
  selection: SurfaceHunkSelection,
  controlsState: MutableRefObject<HunkControlsState>,
  leftOffset: number,
): void {
  const content = separator.querySelector<HTMLElement>('[data-separator-content]');
  const wrapper = separator.querySelector<HTMLElement>('[data-separator-wrapper]');
  if (!content || !wrapper) return;
  separator.dataset.stellaHunkControlRow = '';
  wrapper.dataset.stellaHunkToolbar = '';
  const controls = document.createElement('div');
  controls.dataset.stellaHunkControls = '';
  controls.style.setProperty('--stella-hunk-left-offset', `${leftOffset}px`);
  const hunkNumber = selection.hunkIndex + 1;

  const [start, end] = hunkDisplayRange(hunk);
  const rangeLabel = document.createElement('span');
  rangeLabel.dataset.stellaHunkLabel = '';
  rangeLabel.textContent = controlsState.current.labels.range(hunkNumber, start, end);
  controls.append(rangeLabel);
  const addActionButton = (
    label: string,
    ariaLabel: string,
    disabled: boolean | undefined,
    onAction: (() => void) | undefined,
  ): void => {
    if (!onAction) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.ariaLabel = ariaLabel;
    button.disabled = disabled === true;
    const describedBy = controlsState.current.action?.describedBy;
    if (describedBy) button.setAttribute('aria-describedby', describedBy);
    button.addEventListener('pointerdown', stopHunkControlPropagation);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onAction();
    });
    controls.append(button);
  };

  const config = controlsState.current.action;
  if (config) {
    const stage = config.kind === 'stage';
    addActionButton(
      controlsState.current.labels.edit,
      controlsState.current.labels.editAria(hunkNumber, start, end),
      config.editDisabled,
      config.onEdit
        ? () => config.onEdit?.({ ...selection, startLine: hunk.additionStart })
        : undefined,
    );
    addActionButton(
      stage ? controlsState.current.labels.stage : controlsState.current.labels.unstage,
      stage
        ? controlsState.current.labels.stageAria(hunkNumber, start, end)
        : controlsState.current.labels.unstageAria(hunkNumber, start, end),
      config.disabled,
      config.onAction ? () => config.onAction?.(selection) : undefined,
    );
    if (stage) {
      addActionButton(
        controlsState.current.labels.discard,
        controlsState.current.labels.discardAria(hunkNumber, start, end),
        config.discardDisabled,
        config.onDiscard ? () => config.onDiscard?.(selection) : undefined,
      );
    }
  }
  content.append(controls);
}

export const DiffSurface = forwardRef<DiffSurfaceHandle, DiffSurfaceProps>(function DiffSurface(
  {
    source,
    diffStyle = 'unified',
    lineWrapping = false,
    wrapColumn = DEFAULT_EDITOR_WRAP_COLUMN,
    selectable = false,
    performanceMode = false,
    showFileHeaders = false,
    stickyFileHeaders = false,
    collapsed,
    hunkSeparators = 'line-info-basic',
    hunkAction,
    ariaLabel,
    onSelectionChange,
    onSelectionContextMenu,
  },
  ref,
) {
  const { t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t('diff');
  const appearance = useAppearance();
  const hasHunkAction = hunkAction !== undefined;
  const [selection, setSelection] = useState<SelectedLineRange | null>(null);
  const [codeViewSelection, setCodeViewSelection] = useState<CodeViewLineSelection | null>(null);
  const selectionAnchorRef = useRef<SurfaceSelectionAnchor | null>(null);
  const [singleFileCollapsed, setSingleFileCollapsed] = useState(false);
  const [collapsedCodeViewItems, setCollapsedCodeViewItems] = useState<Set<string>>(
    () => new Set(),
  );
  const itemIdByFileDiffRef = useRef(new WeakMap<FileDiffMetadata, string>());
  const renderedHunkHostsRef = useRef(new Map<HTMLElement, FileDiffMetadata>());
  const hunkControlLabels: HunkControlLabels = {
    discard: t('discardHunk'),
    discardAria: (number, start, end) => t('discardHunkAria', { number, start, end }),
    edit: t('editHunk'),
    editAria: (number, start, end) => t('editHunkAria', { number, start, end }),
    range: (number, start, end) => t('hunkRangeLabel', { number, start, end }),
    stage: t('stageHunk'),
    stageAria: (number, start, end) => t('stageHunkAria', { number, start, end }),
    unstage: t('unstageHunk'),
    unstageAria: (number, start, end) => t('unstageHunkAria', { number, start, end }),
  };
  const hunkControlLabelsRevision = [
    hunkControlLabels.discard,
    hunkControlLabels.discardAria(1, 2, 3),
    hunkControlLabels.edit,
    hunkControlLabels.editAria(1, 2, 3),
    hunkControlLabels.range(1, 2, 3),
    hunkControlLabels.stage,
    hunkControlLabels.stageAria(1, 2, 3),
    hunkControlLabels.unstage,
    hunkControlLabels.unstageAria(1, 2, 3),
  ].join('\0');
  const hunkControlsRef = useRef<HunkControlsState>({
    action: hunkAction,
    labels: hunkControlLabels,
  });
  hunkControlsRef.current = {
    action: hunkAction,
    labels: hunkControlLabels,
  };
  const previousSourceKeyRef = useRef(source.cacheKey);
  useEffect(() => {
    if (previousSourceKeyRef.current === source.cacheKey) return;
    previousSourceKeyRef.current = source.cacheKey;
    setSelection(null);
    setCodeViewSelection(null);
    selectionAnchorRef.current = null;
    setSingleFileCollapsed(false);
    setCollapsedCodeViewItems(new Set());
    onSelectionChange?.(null);
  }, [onSelectionChange, source.cacheKey]);
  const canUseWorkers = typeof Worker !== 'undefined';
  const disableWorkerPool = !canUseWorkers || hasHunkAction;
  const effectiveSingleFileCollapsed =
    collapsed ?? (previousSourceKeyRef.current === source.cacheKey ? singleFileCollapsed : false);
  const renderCollapseToggle = (path: string, isCollapsed: boolean, onToggle: () => void) => (
    <button
      type="button"
      className="diff-file-collapse-toggle"
      style={DIFF_FILE_COLLAPSE_TOGGLE_STYLE}
      aria-expanded={!isCollapsed}
      aria-label={t(isCollapsed ? 'expandFileDiff' : 'collapseFileDiff', { path })}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {isCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
    </button>
  );
  const renderFileHeader = (fileDiff: FileDiffMetadata) => {
    const additions = fileDiff.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
    const deletions = fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
    return (
      <div className="diff-file-custom-header">
        <div className="diff-file-custom-header-title">
          {renderCollapseToggle(fileDiff.name, effectiveSingleFileCollapsed, () => {
            setSingleFileCollapsed((current) => !current);
          })}
          <FileStatusIcon status={fileStatusForDiffType(fileDiff.type)} />
          <span>{fileDiff.name}</span>
        </div>
        <div className="diff-file-custom-header-counts" aria-hidden="true">
          {deletions > 0 || additions === 0 ? (
            <span className="deletions">-{deletions}</span>
          ) : null}
          {additions > 0 || deletions === 0 ? (
            <span className="additions">+{additions}</span>
          ) : null}
        </div>
      </div>
    );
  };
  const renderCodeViewHeader = (item: CodeViewItem) => {
    const path = item.type === 'diff' ? item.fileDiff.name : item.file.name;
    const isCollapsed = collapsed === true || collapsedCodeViewItems.has(item.id);
    const additions =
      item.type === 'diff'
        ? item.fileDiff.hunks.reduce((total, hunk) => total + hunk.additionLines, 0)
        : undefined;
    const deletions =
      item.type === 'diff'
        ? item.fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0)
        : undefined;
    return (
      <div className="diff-file-custom-header">
        <div className="diff-file-custom-header-title">
          {renderCollapseToggle(path, isCollapsed, () => {
            setCollapsedCodeViewItems((current) => {
              const next = new Set(current);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
          })}
          <FileStatusIcon
            status={item.type === 'diff' ? fileStatusForDiffType(item.fileDiff.type) : 'modified'}
          />
          <span>{path}</span>
        </div>
        {additions !== undefined && deletions !== undefined ? (
          <div className="diff-file-custom-header-counts" aria-hidden="true">
            {deletions > 0 || additions === 0 ? (
              <span className="deletions">-{deletions}</span>
            ) : null}
            {additions > 0 || deletions === 0 ? (
              <span className="additions">+{additions}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };
  const enhanceHunkSeparators = useCallback(
    (node: HTMLElement, instance: unknown, phase: 'mount' | 'update' | 'unmount') => {
      if (phase === 'unmount') {
        renderedHunkHostsRef.current.delete(node);
        return;
      }
      const fileDiff = isDiffPostRenderInstance(instance) ? instance.fileDiff : undefined;
      const root = node.shadowRoot;
      if (!root || !fileDiff || !hunkControlsRef.current.action || fileDiff.hunks.length === 0)
        return;
      renderedHunkHostsRef.current.set(node, fileDiff);

      node
        .querySelectorAll<HTMLElement>('[data-stella-hunk-controls]')
        .forEach((item) => item.remove());
      root
        .querySelectorAll<HTMLElement>('[data-stella-hunk-controls]')
        .forEach((item) => item.remove());

      const itemId = itemIdByFileDiffRef.current.get(fileDiff);
      if (itemId) node.dataset.stellaItemId = itemId;
      else delete node.dataset.stellaItemId;
      const preferredCode =
        root.querySelector<HTMLElement>('[data-unified]') ??
        root.querySelector<HTMLElement>('[data-additions]') ??
        root.querySelector<HTMLElement>('[data-deletions]');
      const contentColumn = preferredCode
        ? directDiffColumns(preferredCode).find((column) => column.hasAttribute('data-content'))
        : undefined;
      if (!preferredCode || !contentColumn) return;
      const leftOffset = Math.max(
        0,
        contentColumn.getBoundingClientRect().left - preferredCode.getBoundingClientRect().left,
      );
      const separators = [...contentColumn.children].filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.hasAttribute('data-separator') &&
          !element.hasAttribute('data-separator-last'),
      );

      fileDiff.hunks.forEach((hunk, hunkIndex) => {
        const separator = separators[hunkIndex];
        if (!separator) return;
        const hunkSelection: SurfaceHunkSelection = {
          hunkIndex,
          ...(itemId ? { itemId } : {}),
        };
        appendHunkControls(separator, hunk, hunkSelection, hunkControlsRef, leftOffset);
      });
    },
    [],
  );
  // Shadow DOMの文言はReactの再描画対象外なので、言語変更とHMRの翻訳更新時に再注入する。
  useEffect(() => {
    for (const [node, fileDiff] of renderedHunkHostsRef.current) {
      enhanceHunkSeparators(node, { fileDiff }, 'update');
    }
  }, [enhanceHunkSeparators, hunkControlLabelsRevision]);
  const selectClickedLine = useCallback(
    (props: SurfaceLineClickProps, context?: CodeViewLineClickContext): void => {
      if (
        !selectable ||
        props.numberColumn ||
        !('annotationSide' in props) ||
        !props.lineType.startsWith('change-')
      )
        return;
      const itemId =
        context?.item.id ??
        props.event
          .composedPath()
          .find(
            (item): item is HTMLElement =>
              item instanceof HTMLElement && item.dataset.stellaItemId !== undefined,
          )?.dataset.stellaItemId;
      const anchor = selectionAnchorRef.current;
      const extendsFromAnchor =
        props.event instanceof MouseEvent &&
        props.event.shiftKey &&
        anchor?.side === props.annotationSide &&
        anchor.itemId === itemId;
      const range: SelectedLineRange = {
        start: extendsFromAnchor ? Math.min(anchor.lineNumber, props.lineNumber) : props.lineNumber,
        end: extendsFromAnchor ? Math.max(anchor.lineNumber, props.lineNumber) : props.lineNumber,
        side: props.annotationSide,
        endSide: props.annotationSide,
      };
      if (!extendsFromAnchor) {
        selectionAnchorRef.current = {
          ...(itemId ? { itemId } : {}),
          lineNumber: props.lineNumber,
          side: props.annotationSide,
        };
      }
      if (source.kind === 'codeView') {
        if (!itemId) return;
        setCodeViewSelection({ id: itemId, range });
      } else {
        setSelection(range);
      }
      onSelectionChange?.(toSurfaceSelection(range, itemId));
    },
    [onSelectionChange, selectable, source.kind],
  );
  const options = useMemo(
    () => ({
      theme: STELLA_DIFF_THEMES,
      themeType: appearance,
      diffStyle: performanceMode ? ('unified' as const) : diffStyle,
      diffIndicators: 'none' as const,
      collapsed: effectiveSingleFileCollapsed,
      disableFileHeader: !showFileHeaders,
      stickyHeader: showFileHeaders && stickyFileHeaders,
      stickyHeaders: showFileHeaders && stickyFileHeaders,
      hunkSeparators,
      overflow: lineWrapping ? ('wrap' as const) : ('scroll' as const),
      layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
      itemMetrics: {
        diffHeaderHeight: STELLA_DIFF_FILE_HEADER_HEIGHT,
        spacing: 0,
        paddingTop: 0,
        paddingBottom: 0,
      },
      unsafeCSS: diffHighlightCss(lineWrapping, wrapColumn),
      enableLineSelection: selectable,
      controlledSelection: selectable,
      lineHoverHighlight: selectable ? ('line' as const) : ('disabled' as const),
      onLineClick: selectClickedLine,
      ...(hasHunkAction ? { onPostRender: enhanceHunkSeparators } : {}),
      tokenizeMaxLineLength: performanceMode ? 0 : 2_000,
      lineDiffType: performanceMode ? ('none' as const) : ('word-alt' as const),
      onLineSelectionChange: (range: SelectedLineRange | null) => {
        setSelection(range);
        selectionAnchorRef.current = range?.side
          ? { lineNumber: range.start, side: range.side }
          : null;
        onSelectionChange?.(toSurfaceSelection(range));
      },
    }),
    [
      appearance,
      diffStyle,
      effectiveSingleFileCollapsed,
      enhanceHunkSeparators,
      hasHunkAction,
      hunkSeparators,
      lineWrapping,
      onSelectionChange,
      performanceMode,
      selectable,
      selectClickedLine,
      showFileHeaders,
      stickyFileHeaders,
      wrapColumn,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      getSelection: () =>
        codeViewSelection
          ? toSurfaceSelection(codeViewSelection.range, codeViewSelection.id)
          : toSurfaceSelection(selection),
      clearSelection: () => {
        setSelection(null);
        setCodeViewSelection(null);
        selectionAnchorRef.current = null;
        onSelectionChange?.(null);
      },
    }),
    [codeViewSelection, onSelectionChange, selection],
  );

  const plainText = source.kind === 'fileDiff' ? source.targetText : source.patch;
  const normalizedWrapColumn = normalizeEditorWrapColumn(wrapColumn);
  const fallback = (
    <output className="diff-fallback">
      <p>{t('diffFallback')}</p>
      <pre
        style={{
          maxWidth: lineWrapping ? `${normalizedWrapColumn}ch` : 'none',
          overflowWrap: lineWrapping ? 'anywhere' : 'normal',
          whiteSpace: lineWrapping ? 'pre-wrap' : 'pre',
        }}
      >
        {plainText}
      </pre>
    </output>
  );

  const parsed = useMemo(() => {
    try {
      if (source.kind === 'fileDiff') {
        return {
          ok: true as const,
          fileDiff: parseDiffFromFile(
            {
              name: source.baseLabel ?? source.path,
              contents: source.baseText,
              cacheKey: `${source.cacheKey}:base`,
            },
            {
              name: source.targetLabel ?? source.path,
              contents: source.targetText,
              cacheKey: `${source.cacheKey}:target`,
            },
          ),
          codeViewItems: [],
        };
      }
      if (source.kind === 'codeView') {
        const codeViewItems = parsePatchFiles(source.patch, source.cacheKey).flatMap(
          (patch, patchIndex) =>
            patch.files.map((parsedFile, fileIndex) => ({
              id: `${source.cacheKey}:${patchIndex}:${fileIndex}`,
              type: 'diff' as const,
              fileDiff: parsedFile,
              version: 1,
            })),
        );
        if (source.patch.trim() && !codeViewItems.length) {
          throw new Error('No displayable file diff was found in the patch.');
        }
        return {
          ok: true as const,
          fileDiff: undefined,
          codeViewItems,
        };
      }
      return { ok: true as const, fileDiff: undefined, codeViewItems: [] };
    } catch (error) {
      console.error('DiffSurface parse failed', error);
      return { ok: false as const, fileDiff: undefined, codeViewItems: [] };
    }
  }, [source]);

  const codeViewItems = useMemo(
    () =>
      parsed.codeViewItems.map((item) => {
        const itemCollapsed = collapsed === true || collapsedCodeViewItems.has(item.id);
        return {
          ...item,
          // CodeViewはversionが同じitemの更新を無視するため、折りたたみ変更をrevisionへ含める。
          version: itemCollapsed ? 2 : 1,
          collapsed: itemCollapsed,
        };
      }),
    [collapsed, collapsedCodeViewItems, parsed.codeViewItems],
  );
  itemIdByFileDiffRef.current = new WeakMap(
    codeViewItems.flatMap((item) =>
      item.type === 'diff' ? [[item.fileDiff, item.id] as const] : [],
    ),
  );

  const diff = !parsed.ok ? (
    fallback
  ) : source.kind === 'patch' ? (
    <PatchDiff
      patch={source.patch}
      options={options}
      {...(showFileHeaders ? { renderCustomHeader: renderFileHeader } : {})}
      selectedLines={selection}
      disableWorkerPool={disableWorkerPool}
    />
  ) : source.kind === 'codeView' ? (
    <CodeView
      items={codeViewItems}
      options={options}
      {...(showFileHeaders ? { renderCustomHeader: renderCodeViewHeader } : {})}
      selectedLines={codeViewSelection}
      onSelectedLinesChange={(next) => {
        setCodeViewSelection(next);
        selectionAnchorRef.current = next?.range.side
          ? { itemId: next.id, lineNumber: next.range.start, side: next.range.side }
          : null;
        onSelectionChange?.(toSurfaceSelection(next?.range ?? null, next?.id));
      }}
      disableWorkerPool={disableWorkerPool}
    />
  ) : parsed.fileDiff ? (
    <FileDiff
      fileDiff={parsed.fileDiff}
      options={options}
      {...(showFileHeaders ? { renderCustomHeader: renderFileHeader } : {})}
      selectedLines={selection}
      disableWorkerPool={disableWorkerPool}
    />
  ) : (
    fallback
  );

  const activeSelection = codeViewSelection
    ? toSurfaceSelection(codeViewSelection.range, codeViewSelection.id)
    : toSurfaceSelection(selection);
  const surfaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !activeSelection || !onSelectionContextMenu) return undefined;
    const handleContextMenu = (event: MouseEvent): void => {
      const clickedLine = event
        .composedPath()
        .some(
          (item) =>
            item instanceof HTMLElement &&
            (item.hasAttribute('data-line') || item.hasAttribute('data-column-number')),
        );
      if (!clickedLine) return;
      event.preventDefault();
      onSelectionContextMenu(
        activeSelection,
        { x: event.clientX, y: event.clientY },
        selectedLineTextFromContextEvent(event),
      );
    };
    surface.addEventListener('contextmenu', handleContextMenu);
    return () => surface.removeEventListener('contextmenu', handleContextMenu);
  }, [activeSelection, onSelectionContextMenu]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const preventDragTextSelection = (event: Event): void => event.preventDefault();
    surface.addEventListener('selectstart', preventDragTextSelection);
    return () => surface.removeEventListener('selectstart', preventDragTextSelection);
  }, []);

  return (
    <section
      ref={surfaceRef}
      className="diff-surface"
      data-line-wrapping={lineWrapping}
      data-wrap-column={normalizedWrapColumn}
      aria-label={resolvedAriaLabel}
      hidden={collapsed === true}
    >
      <DiffErrorBoundary key={source.cacheKey} fallback={fallback}>
        {diff}
      </DiffErrorBoundary>
    </section>
  );
});
