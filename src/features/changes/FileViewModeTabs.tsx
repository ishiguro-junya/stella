import { Lock, Pencil } from 'lucide-react';

import { Button } from '../../ui/Button';
import { useI18n } from '../../i18n/i18n';

export type FileViewMode = 'display' | 'edit';

export interface FileViewModeTabsProps {
  mode: FileViewMode;
  displayDisabled?: boolean | undefined;
  editDisabled?: boolean | undefined;
  onDisplay: () => void;
  onEdit: () => void;
}

export function FileViewModeTabs({
  mode,
  displayDisabled = false,
  editDisabled = false,
  onDisplay,
  onEdit,
}: FileViewModeTabsProps) {
  const { t } = useI18n();

  return (
    <div className="segmented file-view-mode-tabs" role="tablist" aria-label={t('fileViewMode')}>
      <Button
        type="button"
        role="tab"
        aria-selected={mode === 'display'}
        aria-label={t('displayFile')}
        title={t('displayFile')}
        disabled={displayDisabled}
        onClick={onDisplay}
      >
        <Lock aria-hidden="true" focusable="false" size={14} />
      </Button>
      <Button
        type="button"
        role="tab"
        aria-selected={mode === 'edit'}
        aria-label={t('editFile')}
        title={t('editFile')}
        disabled={editDisabled}
        onClick={onEdit}
      >
        <Pencil aria-hidden="true" focusable="false" size={14} />
      </Button>
    </div>
  );
}
