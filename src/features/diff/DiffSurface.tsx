import {
  Component,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { parseDiffFromFile, parsePatchFiles, registerCustomCSSVariableTheme } from '@pierre/diffs';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  CodeViewItem,
  CodeViewLineSelection,
  FileDiffMetadata,
  SelectedLineRange,
} from '@pierre/diffs';
import { CodeView, FileDiff, PatchDiff, WorkerPoolContextProvider } from '@pierre/diffs/react';
// oxlint-disable-next-line import/default -- Viteの?worker queryがdefaultのWorker constructorを生成する。
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';

import type { DiffStyle } from '../../domain/workspace';
import { useAppearance } from '../../theme/appearance';
import { useI18n } from '../../i18n/i18n';
import { FileStatusIcon, type FileStatus } from '../../ui/FileStatusIcon';

const STELLA_DIFF_THEME = 'stella-semantic';
const STELLA_DIFF_FILE_HEADER_HEIGHT = 32;
const STELLA_DIFF_THEMES = {
  light: STELLA_DIFF_THEME,
  dark: STELLA_DIFF_THEME,
} as const;
const STELLA_DIFF_HIGHLIGHT_CSS = `
:host {
  --diffs-addition-color-override: var(--diff-addition-accent);
  --diffs-deletion-color-override: var(--diff-deletion-accent);
  --diffs-bg-addition-emphasis-override: var(--diff-addition-emphasis);
  --diffs-bg-deletion-emphasis-override: var(--diff-deletion-emphasis);
  --diffs-gap-block: 0px;
  overscroll-behavior: none;
}

[data-code] {
  overscroll-behavior: none;
}

[data-diffs-header='default'] {
  min-height: ${STELLA_DIFF_FILE_HEADER_HEIGHT}px;
  padding-inline: 8px 16px;
  border-block: 1px solid var(--border-subtle);
  background-color: var(--surface-raised);
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
`;
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
  selectable?: boolean;
  performanceMode?: boolean;
  showFileHeaders?: boolean;
  collapsibleFileHeaders?: boolean;
  collapsed?: boolean;
  hunkSeparators?: 'simple' | 'line-info-basic';
  ariaLabel?: string;
  onSelectionChange?: (selection: SurfaceSelection | null) => void;
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

export const DiffSurface = forwardRef<DiffSurfaceHandle, DiffSurfaceProps>(function DiffSurface(
  {
    source,
    diffStyle = 'unified',
    selectable = false,
    performanceMode = false,
    showFileHeaders = false,
    collapsibleFileHeaders = false,
    collapsed,
    hunkSeparators = 'line-info-basic',
    ariaLabel,
    onSelectionChange,
  },
  ref,
) {
  const { t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t('diff');
  const appearance = useAppearance();
  const [selection, setSelection] = useState<SelectedLineRange | null>(null);
  const [codeViewSelection, setCodeViewSelection] = useState<CodeViewLineSelection | null>(null);
  const [singleFileCollapsed, setSingleFileCollapsed] = useState(false);
  const [collapsedCodeViewItems, setCollapsedCodeViewItems] = useState<Set<string>>(
    () => new Set(),
  );
  const previousSourceKeyRef = useRef(source.cacheKey);
  useEffect(() => {
    if (previousSourceKeyRef.current === source.cacheKey) return;
    previousSourceKeyRef.current = source.cacheKey;
    setSelection(null);
    setCodeViewSelection(null);
    setSingleFileCollapsed(false);
    setCollapsedCodeViewItems(new Set());
    onSelectionChange?.(null);
  }, [onSelectionChange, source.cacheKey]);
  const canUseWorkers = typeof Worker !== 'undefined';
  const effectiveSingleFileCollapsed =
    collapsed ?? (previousSourceKeyRef.current === source.cacheKey ? singleFileCollapsed : false);
  const renderCollapseToggle = (path: string, isCollapsed: boolean, onToggle: () => void) => (
    <button
      type="button"
      className="diff-file-collapse-toggle"
      aria-expanded={!isCollapsed}
      aria-label={t(isCollapsed ? 'expandFileDiff' : 'collapseFileDiff', { path })}
      onClick={onToggle}
    >
      {isCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
    </button>
  );
  const renderFileHeaderPrefix = (fileDiff: FileDiffMetadata) => (
    <span className="diff-file-header-prefix">
      {collapsibleFileHeaders
        ? renderCollapseToggle(fileDiff.name, effectiveSingleFileCollapsed, () => {
            setSingleFileCollapsed((current) => !current);
          })
        : null}
      <FileStatusIcon status={fileStatusForDiffType(fileDiff.type)} />
    </span>
  );
  const renderCodeViewHeaderPrefix = (item: CodeViewItem) => {
    const path = item.type === 'diff' ? item.fileDiff.name : item.file.name;
    const isCollapsed = collapsed === true || collapsedCodeViewItems.has(item.id);
    return (
      <span className="diff-file-header-prefix">
        {collapsibleFileHeaders
          ? renderCollapseToggle(path, isCollapsed, () => {
              setCollapsedCodeViewItems((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            })
          : null}
        <FileStatusIcon
          status={item.type === 'diff' ? fileStatusForDiffType(item.fileDiff.type) : 'modified'}
        />
      </span>
    );
  };
  const options = useMemo(
    () => ({
      theme: STELLA_DIFF_THEMES,
      themeType: appearance,
      diffStyle: performanceMode ? ('unified' as const) : diffStyle,
      diffIndicators: 'classic' as const,
      collapsed: effectiveSingleFileCollapsed,
      disableFileHeader: !showFileHeaders,
      hunkSeparators,
      overflow: 'wrap' as const,
      layout: { paddingTop: 0, paddingBottom: 0, gap: 8 },
      itemMetrics: {
        diffHeaderHeight: STELLA_DIFF_FILE_HEADER_HEIGHT,
        spacing: 0,
        paddingTop: 0,
        paddingBottom: 0,
      },
      unsafeCSS: STELLA_DIFF_HIGHLIGHT_CSS,
      enableLineSelection: selectable,
      controlledSelection: selectable,
      tokenizeMaxLineLength: performanceMode ? 0 : 2_000,
      lineDiffType: performanceMode ? ('none' as const) : ('word-alt' as const),
      onLineSelectionChange: (range: SelectedLineRange | null) => {
        setSelection(range);
        onSelectionChange?.(toSurfaceSelection(range));
      },
    }),
    [
      appearance,
      diffStyle,
      effectiveSingleFileCollapsed,
      hunkSeparators,
      onSelectionChange,
      performanceMode,
      selectable,
      showFileHeaders,
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
        onSelectionChange?.(null);
      },
    }),
    [codeViewSelection, onSelectionChange, selection],
  );

  const plainText = source.kind === 'fileDiff' ? source.targetText : source.patch;
  const fallback = (
    <output className="diff-fallback">
      <p>{t('diffFallback')}</p>
      <pre>{plainText}</pre>
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
      parsed.codeViewItems.map((item) => ({
        ...item,
        collapsed: collapsed === true || collapsedCodeViewItems.has(item.id),
      })),
    [collapsed, collapsedCodeViewItems, parsed.codeViewItems],
  );

  const diff = !parsed.ok ? (
    fallback
  ) : source.kind === 'patch' ? (
    <PatchDiff
      patch={source.patch}
      options={options}
      {...(showFileHeaders ? { renderHeaderPrefix: renderFileHeaderPrefix } : {})}
      selectedLines={selection}
      disableWorkerPool={!canUseWorkers}
    />
  ) : source.kind === 'codeView' ? (
    <CodeView
      items={codeViewItems}
      options={options}
      {...(showFileHeaders ? { renderHeaderPrefix: renderCodeViewHeaderPrefix } : {})}
      selectedLines={codeViewSelection}
      onSelectedLinesChange={(next) => {
        setCodeViewSelection(next);
        onSelectionChange?.(toSurfaceSelection(next?.range ?? null, next?.id));
      }}
      disableWorkerPool={!canUseWorkers}
    />
  ) : parsed.fileDiff ? (
    <FileDiff
      fileDiff={parsed.fileDiff}
      options={options}
      {...(showFileHeaders ? { renderHeaderPrefix: renderFileHeaderPrefix } : {})}
      selectedLines={selection}
      disableWorkerPool={!canUseWorkers}
    />
  ) : (
    fallback
  );

  return (
    <section className="diff-surface" aria-label={resolvedAriaLabel} hidden={collapsed === true}>
      <DiffErrorBoundary key={source.cacheKey} fallback={fallback}>
        {diff}
      </DiffErrorBoundary>
    </section>
  );
});
