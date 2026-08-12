import { useI18n } from '../../i18n/i18n';
import {
  TextEditor,
  rawUtf16OffsetToEditorOffset,
  STELLA_HIGHLIGHT_STYLE,
} from '../../ui/TextEditor';

export { rawUtf16OffsetToEditorOffset, STELLA_HIGHLIGHT_STYLE };

export interface ConflictResultEditorProps {
  value: string;
  path: string;
  lineEnding: 'lf' | 'crlf';
  readOnly?: boolean;
  performanceMode?: boolean;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  selectedRange?: { from: number; to: number } | undefined;
  ariaLabel?: string;
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
  lineWrapping = false,
  wrapColumn,
  selectedRange,
  ariaLabel,
  onChange,
  onUndo,
  onRedo,
  onSave,
  onMarkResolved,
}: ConflictResultEditorProps) {
  const { t } = useI18n();
  return (
    <TextEditor
      value={value}
      path={path}
      lineEnding={lineEnding}
      readOnly={readOnly}
      performanceMode={performanceMode}
      lineWrapping={lineWrapping}
      wrapColumn={wrapColumn}
      selectedRange={selectedRange}
      ariaLabel={ariaLabel ?? t('conflictResultEditor')}
      className="conflict-result-editor"
      onChange={onChange}
      onUndo={onUndo}
      onRedo={onRedo}
      onSave={onSave}
      onSecondaryAction={onMarkResolved}
    />
  );
}
