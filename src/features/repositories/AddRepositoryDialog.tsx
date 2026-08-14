/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogがformへmodal roleを渡してfocusを管理する。 */
import { FolderOpen } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';

export type RepositorySource = 'url' | 'path';

export interface AddRepositoryDialogProps {
  source: RepositorySource;
  url: string;
  cloneParentPath: string;
  localPath: string;
  name: string;
  error?: string;
  errorField?: 'url' | 'path';
  busy: boolean;
  onUrlChange: (url: string) => void;
  onCloneParentPathChange: (path: string) => void;
  onLocalPathChange: (path: string) => void;
  onNameChange: (name: string) => void;
  onChoosePath: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
}

export function AddRepositoryDialog({
  source,
  url,
  cloneParentPath,
  localPath,
  name,
  error,
  errorField,
  busy,
  onUrlChange,
  onCloneParentPathChange,
  onLocalPathChange,
  onNameChange,
  onChoosePath,
  onDismiss,
  onSubmit,
}: AddRepositoryDialogProps) {
  const { t } = useI18n();
  const titleId = source === 'url' ? 'clone-repository-title' : 'add-local-repository-title';

  return (
    <Dialog
      labelledBy={titleId}
      role="dialog"
      dismissible={!busy}
      onDismiss={onDismiss}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader
        titleId={titleId}
        title={t(source === 'url' ? 'cloneRepository' : 'addLocalRepository')}
      />
      <DialogBody className="dialog-form add-repository-form">
        {source === 'url' ? (
          <>
            <label className="dialog-form-field" htmlFor="repository-url">
              <span>{t('repositoryUrl')}</span>
              <input
                id="repository-url"
                value={url}
                aria-invalid={Boolean(error && errorField === 'url') || undefined}
                aria-describedby={
                  error && errorField === 'url' ? 'repository-url-error' : undefined
                }
                autoComplete="off"
                data-dialog-initial-focus
                onChange={(event) => onUrlChange(event.target.value)}
              />
              {error && errorField === 'url' ? (
                <small
                  id="repository-url-error"
                  className="field-error dialog-form-error"
                  role="alert"
                >
                  {error}
                </small>
              ) : null}
            </label>
            <div className="dialog-form-field">
              <label htmlFor="repository-clone-parent">{t('repositoryPath')}</label>
              <span className="repository-location-control">
                <input
                  id="repository-clone-parent"
                  value={cloneParentPath}
                  aria-invalid={Boolean(error && errorField === 'path') || undefined}
                  aria-describedby={
                    error && errorField === 'path' ? 'repository-clone-parent-error' : undefined
                  }
                  autoComplete="off"
                  onChange={(event) => onCloneParentPathChange(event.target.value)}
                />
                <button
                  type="button"
                  className="repository-path-picker"
                  aria-label={t('chooseRepositoryDirectory')}
                  title={t('chooseRepositoryDirectory')}
                  disabled={busy}
                  onClick={onChoosePath}
                >
                  <FolderOpen aria-hidden="true" focusable="false" />
                </button>
              </span>
              {error && errorField === 'path' ? (
                <small
                  id="repository-clone-parent-error"
                  className="field-error dialog-form-error"
                  role="alert"
                >
                  {error}
                </small>
              ) : null}
            </div>
          </>
        ) : (
          <div className="dialog-form-field">
            <label htmlFor="repository-location">{t('repositoryPath')}</label>
            <span className="repository-location-control">
              <input
                id="repository-location"
                value={localPath}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? 'repository-location-error' : undefined}
                autoComplete="off"
                data-dialog-initial-focus
                onChange={(event) => onLocalPathChange(event.target.value)}
              />
              <button
                type="button"
                className="repository-path-picker"
                aria-label={t('chooseRepositoryDirectory')}
                title={t('chooseRepositoryDirectory')}
                disabled={busy}
                onClick={onChoosePath}
              >
                <FolderOpen aria-hidden="true" focusable="false" />
              </button>
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
        )}

        <label className="dialog-form-field" htmlFor="repository-display-name">
          <span>{t('repositoryDisplayName')}</span>
          <input
            id="repository-display-name"
            value={name}
            autoComplete="off"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
      </DialogBody>
      <DialogFooter>
        <button type="button" onClick={onDismiss}>
          {t('cancel')}
        </button>
        <button
          type="submit"
          className="primary"
          disabled={
            busy || (source === 'url' ? !url.trim() || !cloneParentPath.trim() : !localPath.trim())
          }
        >
          {t(source === 'url' ? 'cloneRepository' : 'add')}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
