import { FolderOpen } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import { Dialog } from '../../ui/Dialog';

export type RepositorySource = 'url' | 'path';

export interface AddRepositoryDialogProps {
  source: RepositorySource;
  url: string;
  path: string;
  name: string;
  error?: string;
  busy: boolean;
  onSourceChange: (source: RepositorySource) => void;
  onUrlChange: (url: string) => void;
  onPathChange: (path: string) => void;
  onNameChange: (name: string) => void;
  onChooseLocal: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
}

export function AddRepositoryDialog({
  source,
  url,
  path,
  name,
  error,
  busy,
  onSourceChange,
  onUrlChange,
  onPathChange,
  onNameChange,
  onChooseLocal,
  onDismiss,
  onSubmit,
}: AddRepositoryDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog
      labelledBy="add-repository-title"
      className="form-dialog add-repository-dialog"
      onDismiss={onDismiss}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h2 id="add-repository-title">{t('addRepository')}</h2>
      <div className="dialog-form add-repository-form">
        <div
          className="segmented add-repository-source"
          role="tablist"
          aria-label={t('repositorySource')}
        >
          {(['url', 'path'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={source === candidate}
              onClick={() => onSourceChange(candidate)}
            >
              {t(candidate === 'url' ? 'repositoryUrlTab' : 'repositoryPathTab')}
            </button>
          ))}
        </div>

        <div className="dialog-form-field">
          <label htmlFor="repository-location">
            {t(source === 'url' ? 'repositoryUrl' : 'repositoryPath')}
          </label>
          <span className="repository-location-control">
            <input
              id="repository-location"
              value={source === 'url' ? url : path}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'repository-location-error' : undefined}
              autoComplete="off"
              data-dialog-initial-focus
              onChange={(event) =>
                source === 'url'
                  ? onUrlChange(event.target.value)
                  : onPathChange(event.target.value)
              }
            />
            {source === 'path' ? (
              <button
                type="button"
                className="repository-path-picker"
                aria-label={t('chooseRepositoryDirectory')}
                title={t('chooseRepositoryDirectory')}
                disabled={busy}
                onClick={onChooseLocal}
              >
                <FolderOpen aria-hidden="true" focusable="false" />
              </button>
            ) : null}
          </span>
          {error ? (
            <small
              id="repository-location-error"
              className="field-error dialog-form-error"
              role="alert"
            >
              {error}
            </small>
          ) : null}
        </div>

        <label className="dialog-form-field" htmlFor="repository-display-name">
          <span>{t('repositoryDisplayName')}</span>
          <input
            id="repository-display-name"
            value={name}
            autoComplete="off"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>

        <div className="dialog-form-actions button-row end">
          <button type="button" onClick={onDismiss}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !(source === 'url' ? url : path).trim()}
          >
            {t('add')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
