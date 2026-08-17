import { FileDiff, Pencil } from 'lucide-react';

import { ToggleButton } from '../../ui/ToggleButton';
import { useI18n } from '../../i18n/i18n';

type FileViewMode = 'display' | 'edit';

export interface FileViewModeToggleProps {
  mode: FileViewMode;
  displayDisabled?: boolean | undefined;
  editDisabled?: boolean | undefined;
  onDisplay: () => void;
  onEdit: () => void;
}

export function FileViewModeToggle({
  mode,
  displayDisabled = false,
  editDisabled = false,
  onDisplay,
  onEdit,
}: FileViewModeToggleProps) {
  const { t } = useI18n();
  const editing = mode === 'edit';

  return (
    <ToggleButton
      className="file-view-mode-toggle"
      aria-label={t('fileEditToggle')}
      tooltip={t('fileEditToggle')}
      pressed={editing}
      offIcon={FileDiff}
      onIcon={Pencil}
      disabled={editing ? displayDisabled : editDisabled}
      onPressedChange={(pressed) => (pressed ? onEdit() : onDisplay())}
    />
  );
}
