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
// oxlint-disable-next-line import/default -- Viteの`?worker`クエリーが既定エクスポートとしてWorkerコンストラクターを生成する。
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';

import type { DiffStyle } from '../../domain/workspace';
import { Button } from '../../ui/Button';
import {
  DEFAULT_EDITOR_WRAP_COLUMN,
  normalizeEditorWrapColumn,
} from '../../persistence/preferences';
import { useAppearance } from '../../theme/appearance';
import { useI18n } from '../../i18n/i18n';
import { FileStatusIcon, type FileStatus } from '../../ui/FileStatusIcon';

const STELLA_DIFF_THEME = 'stella-semantic';
const STELLA_DIFF_FILE_HEADER_HEIGHT = 32;
// 差分のスロット内では共通ボタンの最小の高さが優先される場合があるため、正方形の寸法は要素へ直接固定する。
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

function FilePathLabel({ path }: { path: string }) {
  return <span>{path}</span>;
}

export function DiffFileHeader({
  path,
  status,
  collapsed,
  onToggle,
  toggleDisabled = false,
  additions,
  deletions,
  trailing,
}: {
  path: string;
  status: FileStatus;
  collapsed: boolean;
  onToggle: () => void;
  toggleDisabled?: boolean;
  additions?: number;
  deletions?: number;
  trailing?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="diff-file-custom-header">
      <div className="diff-file-custom-header-title">
        <Button
          type="button"
          className="diff-file-collapse-toggle"
          style={DIFF_FILE_COLLAPSE_TOGGLE_STYLE}
          aria-expanded={!collapsed}
          disabled={toggleDisabled}
          aria-label={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', { path })}
          tooltip={t(collapsed ? 'expandFileDiff' : 'collapseFileDiff', { path })}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
        <FileStatusIcon status={status} />
        <FilePathLabel path={path} />
      </div>
      {trailing ??
        (additions !== undefined && deletions !== undefined ? (
          <div className="diff-file-custom-header-counts" aria-hidden="true">
            {deletions > 0 || additions === 0 ? (
              <span className="deletions">-{deletions}</span>
            ) : null}
            {additions > 0 || deletions === 0 ? (
              <span className="additions">+{additions}</span>
            ) : null}
          </div>
        ) : null)}
    </div>
  );
}

const STELLA_DIFF_HIGHLIGHT_CSS = `
:host {
  --diffs-font-family: var(--font-mono);
  --diffs-header-font-family: var(--font-ui);
  --diffs-font-size: var(--code-font-size);
  --diffs-line-height: var(--code-line-height);
  --diffs-min-number-column-width: 10px;
  --diffs-bg-separator-override: var(--diff-file-header-surface);
  --diffs-fg-number-override: var(--text-tertiary);
  --diffs-bg-context-gutter-override: var(--surface-raised);
  --diffs-gap-style: 1px solid var(--border-subtle);
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

[data-gutter-buffer],
[data-column-number] {
  padding-left: 5px;
  padding-right: 4px;
}

[data-indicators='classic'] [data-line] {
  padding-inline: 2px;
  padding-inline-start: 24px;
}

[data-indicators='classic']
  [data-line-type]:where([data-line-type='change-addition'], [data-line-type='change-deletion'])::before {
  left: 0;
  width: 18px;
  text-align: center;
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
  font: 0.625rem var(--diffs-header-font-family, var(--diffs-header-font-fallback));
}

[data-stella-hunk-actions] {
  position: sticky;
  right: 0;
  z-index: 5;
  display: flex;
  flex: none;
  gap: 5px;
  padding-left: 5px;
  background-color: var(--diffs-bg-separator);
}

[data-stella-hunk-label] {
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  color: color-mix(in srgb, var(--diffs-fg) 58%, var(--diffs-bg-separator));
  font-size: 0.6875rem;
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
  patchActionable: boolean;
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
  initialSelection?: SurfaceSelection | undefined;
  onSelectionChange?: (selection: SurfaceSelection | null) => void;
  onSelectionContextMenu?: (
    selection: SurfaceSelection,
    point: SurfaceContextPoint,
    text: string,
  ) => void;
  onSelectionCopy?: (text: string) => void;
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
  patchActionable = true,
): SurfaceSelection | null {
  if (!range?.side) return null;
  return {
    ...(itemId ? { itemId } : {}),
    side: range.side,
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
    patchActionable,
  };
}

function toSelectedLineRange(selection: SurfaceSelection | undefined): SelectedLineRange | null {
  if (!selection) return null;
  return {
    start: selection.startLine,
    end: selection.endLine,
    side: selection.side,
    endSide: selection.side,
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
  return selectedLineTextFromRoot(root);
}

function selectedLineTextFromRoot(root: ParentNode): string {
  return [...root.querySelectorAll<HTMLElement>('[data-line][data-selected-line]')]
    .map((line) => line.textContent ?? '')
    .join('\n');
}

function selectedLineTextFromSurface(surface: HTMLElement): string {
  return [...surface.querySelectorAll('diffs-container')]
    .map((host) => host.shadowRoot)
    .filter((root): root is ShadowRoot => root !== null)
    .map(selectedLineTextFromRoot)
    .filter(Boolean)
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
  patchActionable: boolean;
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
  const actions = document.createElement('div');
  actions.dataset.stellaHunkActions = '';
  controls.append(actions);
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
    actions.append(button);
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
    initialSelection,
    onSelectionChange,
    onSelectionContextMenu,
    onSelectionCopy,
  },
  ref,
) {
  const { t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t('diff');
  const appearance = useAppearance();
  const hasHunkAction = hunkAction !== undefined;
  const initialSelectedLines = toSelectedLineRange(initialSelection);
  const [selection, setSelection] = useState<SelectedLineRange | null>(() =>
    source.kind === 'codeView' ? null : initialSelectedLines,
  );
  const [codeViewSelection, setCodeViewSelection] = useState<CodeViewLineSelection | null>(() =>
    source.kind === 'codeView' && initialSelectedLines && initialSelection?.itemId
      ? { id: initialSelection.itemId, range: initialSelectedLines }
      : null,
  );
  const [selectionPatchActionable, setSelectionPatchActionable] = useState(
    initialSelection?.patchActionable ?? true,
  );
  const selectionAnchorRef = useRef<SurfaceSelectionAnchor | null>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const initialSelectionRef = useRef(initialSelection);
  const onSelectionChangeRef = useRef(onSelectionChange);
  initialSelectionRef.current = initialSelection;
  onSelectionChangeRef.current = onSelectionChange;
  const initialSelectionSignature = initialSelection
    ? `${initialSelection.itemId ?? ''}:${initialSelection.side}:${initialSelection.startLine}:${initialSelection.endLine}:${initialSelection.patchActionable}`
    : '';
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
    const sourceChanged = previousSourceKeyRef.current !== source.cacheKey;
    const restored = initialSelectionRef.current;
    if (!sourceChanged && !restored) return;
    previousSourceKeyRef.current = source.cacheKey;
    const restoredRange = toSelectedLineRange(restored);
    setSelection(source.kind === 'codeView' ? null : restoredRange);
    setCodeViewSelection(
      source.kind === 'codeView' && restoredRange && restored?.itemId
        ? { id: restored.itemId, range: restoredRange }
        : null,
    );
    setSelectionPatchActionable(restored?.patchActionable ?? true);
    selectionAnchorRef.current = restored
      ? {
          ...(restored.itemId ? { itemId: restored.itemId } : {}),
          lineNumber: restored.startLine,
          side: restored.side,
          patchActionable: restored.patchActionable,
        }
      : null;
    if (sourceChanged) {
      setSingleFileCollapsed(false);
      setCollapsedCodeViewItems(new Set());
    }
    onSelectionChangeRef.current?.(restored ?? null);
  }, [initialSelectionSignature, source.cacheKey, source.kind]);

  useEffect(() => {
    if (!initialSelectionRef.current) return undefined;
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    let frame = 0;
    const observedRoots = new Set<ShadowRoot>();
    const focusSelection = (): void => {
      const selectedLine = [...(surfaceRef.current?.querySelectorAll('diffs-container') ?? [])]
        .map((host) => host.shadowRoot)
        .filter((root): root is ShadowRoot => root !== null)
        .map((root) =>
          root.querySelector<HTMLElement>('[data-content] [data-line][data-selected-line]'),
        )
        .find((line): line is HTMLElement => line !== null);
      if (!selectedLine) return;
      if (!selectedLine.hasAttribute('tabindex')) selectedLine.tabIndex = -1;
      selectedLine.focus({ preventScroll: true });
      selectedLine.scrollIntoView?.({ block: 'center' });
    };
    let observer: MutationObserver;
    const observeRoots = (): void => {
      for (const host of surface.querySelectorAll('diffs-container')) {
        const root = host.shadowRoot;
        if (!root || observedRoots.has(root)) continue;
        observedRoots.add(root);
        observer.observe(root, { attributes: true, childList: true, subtree: true });
      }
    };
    observer = new MutationObserver(() => {
      observeRoots();
      focusSelection();
    });
    observer.observe(surface, { childList: true, subtree: true });
    observeRoots();
    focusSelection();
    frame = requestAnimationFrame(() => {
      observeRoots();
      focusSelection();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [initialSelectionSignature, source.cacheKey]);
  const canUseWorkers = typeof Worker !== 'undefined';
  const disableWorkerPool = !canUseWorkers || hasHunkAction;
  const effectiveSingleFileCollapsed =
    collapsed ?? (previousSourceKeyRef.current === source.cacheKey ? singleFileCollapsed : false);
  const renderFileHeader = (fileDiff: FileDiffMetadata) => {
    const additions = fileDiff.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
    const deletions = fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
    return (
      <DiffFileHeader
        path={fileDiff.name}
        status={fileStatusForDiffType(fileDiff.type)}
        collapsed={effectiveSingleFileCollapsed}
        onToggle={() => setSingleFileCollapsed((current) => !current)}
        additions={additions}
        deletions={deletions}
      />
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
      <DiffFileHeader
        path={path}
        status={item.type === 'diff' ? fileStatusForDiffType(item.fileDiff.type) : 'modified'}
        collapsed={isCollapsed}
        onToggle={() => {
          setCollapsedCodeViewItems((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
        }}
        {...(additions !== undefined && deletions !== undefined ? { additions, deletions } : {})}
      />
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
  // Shadow DOMの文言はReactの再描画対象外なので、言語変更とHMRによる翻訳更新時に再注入する。
  useEffect(() => {
    for (const [node, fileDiff] of renderedHunkHostsRef.current) {
      enhanceHunkSeparators(node, { fileDiff }, 'update');
    }
  }, [enhanceHunkSeparators, hunkControlLabelsRevision]);
  const selectClickedLine = useCallback(
    (props: SurfaceLineClickProps, context?: CodeViewLineClickContext): void => {
      if (!selectable || !('annotationSide' in props)) return;
      const linePatchActionable = props.lineType.startsWith('change-');
      const eventPath = props.event.composedPath();
      surfaceRef.current?.focus({ preventScroll: true });
      const itemId =
        context?.item.id ??
        eventPath.find(
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
      const patchActionable = linePatchActionable && (!extendsFromAnchor || anchor.patchActionable);
      if (!extendsFromAnchor) {
        selectionAnchorRef.current = {
          ...(itemId ? { itemId } : {}),
          lineNumber: props.lineNumber,
          side: props.annotationSide,
          patchActionable: linePatchActionable,
        };
      }
      if (source.kind === 'codeView') {
        if (!itemId) return;
        setCodeViewSelection({ id: itemId, range });
      } else {
        setSelection(range);
      }
      setSelectionPatchActionable(patchActionable);
      onSelectionChange?.(toSurfaceSelection(range, itemId, patchActionable));
    },
    [onSelectionChange, selectable, source.kind],
  );
  const options = useMemo(
    () => ({
      theme: STELLA_DIFF_THEMES,
      themeType: appearance,
      diffStyle: performanceMode ? ('unified' as const) : diffStyle,
      diffIndicators: 'classic' as const,
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
        if (range) surfaceRef.current?.focus({ preventScroll: true });
        setSelection(range);
        setSelectionPatchActionable(true);
        selectionAnchorRef.current = range?.side
          ? { lineNumber: range.start, side: range.side, patchActionable: true }
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
          ? toSurfaceSelection(
              codeViewSelection.range,
              codeViewSelection.id,
              selectionPatchActionable,
            )
          : toSurfaceSelection(selection, undefined, selectionPatchActionable),
      clearSelection: () => {
        setSelection(null);
        setCodeViewSelection(null);
        setSelectionPatchActionable(true);
        selectionAnchorRef.current = null;
        onSelectionChange?.(null);
      },
    }),
    [codeViewSelection, onSelectionChange, selection, selectionPatchActionable],
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
          // `CodeView`はバージョンが同じ項目の更新を無視するため、折りたたみ変更をリビジョンへ含める。
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
        if (next) surfaceRef.current?.focus({ preventScroll: true });
        setCodeViewSelection(next);
        setSelectionPatchActionable(true);
        selectionAnchorRef.current = next?.range.side
          ? {
              itemId: next.id,
              lineNumber: next.range.start,
              side: next.range.side,
              patchActionable: true,
            }
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
    ? toSurfaceSelection(codeViewSelection.range, codeViewSelection.id, selectionPatchActionable)
    : toSurfaceSelection(selection, undefined, selectionPatchActionable);
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
    if (!surface || !activeSelection || !onSelectionCopy) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') return;
      const text = selectedLineTextFromSurface(surface);
      if (!text) return;
      event.preventDefault();
      onSelectionCopy(text);
    };
    surface.addEventListener('keydown', handleKeyDown);
    return () => surface.removeEventListener('keydown', handleKeyDown);
  }, [activeSelection, onSelectionCopy]);

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
      tabIndex={-1}
      hidden={collapsed === true}
    >
      <DiffErrorBoundary key={source.cacheKey} fallback={fallback}>
        {diff}
      </DiffErrorBoundary>
    </section>
  );
});
