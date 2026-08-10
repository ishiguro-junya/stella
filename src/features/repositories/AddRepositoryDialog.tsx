import { FolderOpen } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import { Dialog } from '../../ui/Dialog';

export interface AddRepositoryDialogProps {
  location: string;
  error?: string;
  busy: boolean;
  onLocationChange: (location: string) => void;
  onChooseLocal: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
}

export function AddRepositoryDialog({
  location,
  error,
  busy,
  onLocationChange,
  onChooseLocal,
  onDismiss,
  onSubmit,
}: AddRepositoryDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog
      labelledBy="add-repository-title"
      describedBy="add-repository-description"
      onDismiss={onDismiss}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className="eyebrow">{t('repository')}</p>
      <h2 id="add-repository-title">{t('addRepository')}</h2>
      <p id="add-repository-description">{t('addRepositoryDescription')}</p>

      <label>
        <span>{t('repositoryLocation')}</span>
        <input
          value={location}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? 'repository-location-error' : undefined}
          autoComplete="off"
          data-dialog-initial-focus
          placeholder={t('repositoryLocationPlaceholder')}
          onChange={(event) => onLocationChange(event.target.value)}
        />
      </label>
      {error ? (
        <p id="repository-location-error" className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="button" className="full" disabled={busy} onClick={onChooseLocal}>
        <FolderOpen aria-hidden="true" focusable="false" />
        {t('chooseRepositoryInFinder')}
      </button>

      <div className="button-row end">
        <button type="button" onClick={onDismiss}>
          {t('cancel')}
        </button>
        <button type="submit" className="primary" disabled={busy || !location.trim()}>
          {t('add')}
        </button>
      </div>
    </Dialog>
  );
}
