/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通ダイアログがフォームへ`role="dialog"`を渡してフォーカスを管理する。 */
import { useRef, type KeyboardEvent } from 'react';

import { Button } from '../../ui/Button';
import { DirectoryInput } from '../../ui/DirectoryInput';
import { Input } from '../../ui/Input';
import { useI18n } from '../../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { isRepositoryDirectoryName } from '../../domain/repositoryLocation';

export type RepositorySource = 'url' | 'path';

export interface AddRepositoryDialogProps {
  source: RepositorySource;
  url: string;
  cloneParentPath: string;
  localPath: string;
  remoteName: string;
  localName: string;
  error?: string;
  errorField?: 'url' | 'path' | 'name';
  busy: boolean;
  onSourceChange: (source: RepositorySource) => void;
  onUrlChange: (url: string) => void;
  onCloneParentPathChange: (path: string) => void;
  onLocalPathChange: (path: string) => void;
  onRemoteNameChange: (name: string) => void;
  onLocalNameChange: (name: string) => void;
  onChoosePath: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
}

export function AddRepositoryDialog({
  source,
  url,
  cloneParentPath,
  localPath,
  remoteName,
  localName,
  error,
  errorField,
  busy,
  onSourceChange,
  onUrlChange,
  onCloneParentPathChange,
  onLocalPathChange,
  onRemoteNameChange,
  onLocalNameChange,
  onChoosePath,
  onDismiss,
  onSubmit,
}: AddRepositoryDialogProps) {
  const { t } = useI18n();
  const tabRefs = useRef<Record<RepositorySource, HTMLButtonElement | null>>({
    url: null,
    path: null,
  });
  const selectSource = (next: RepositorySource, focus = false): void => {
    onSourceChange(next);
    if (focus) tabRefs.current[next]?.focus();
  };
  const handleTabKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: RepositorySource,
  ): void => {
    let next: RepositorySource | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      next = current === 'url' ? 'path' : 'url';
    else if (event.key === 'Home') next = 'url';
    else if (event.key === 'End') next = 'path';
    if (!next) return;
    event.preventDefault();
    selectSource(next, true);
  };
  const activeName = source === 'url' ? remoteName : localName;
  const nameInputId = source === 'url' ? 'repository-remote-name' : 'repository-local-name';
  const nameField = (
    <label className="dialog-form-field" htmlFor={nameInputId}>
      <span>{t('repositoryDisplayName')}</span>
      <Input
        id={nameInputId}
        value={activeName}
        aria-invalid={Boolean(error && errorField === 'name') || undefined}
        aria-describedby={error && errorField === 'name' ? 'repository-name-error' : undefined}
        autoComplete="off"
        onChange={(event) =>
          source === 'url'
            ? onRemoteNameChange(event.target.value)
            : onLocalNameChange(event.target.value)
        }
      />
      {error && errorField === 'name' ? (
        <small id="repository-name-error" className="field-error dialog-form-error" role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );

  return (
    <Dialog
      labelledBy="add-repository-title"
      role="dialog"
      dismissible={!busy}
      onDismiss={onDismiss}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader titleId="add-repository-title" title={t('addLocalRepository')} />
      <DialogBody className="dialog-form add-repository-form">
        <div
          className="segmented repository-dialog-tabs"
          role="tablist"
          aria-label={t('repositorySource')}
        >
          {(['url', 'path'] as const).map((candidate) => (
            <Button
              key={candidate}
              ref={(element) => {
                tabRefs.current[candidate] = element;
              }}
              type="button"
              role="tab"
              aria-controls={`add-repository-${candidate}-panel`}
              aria-selected={source === candidate}
              tabIndex={source === candidate ? 0 : -1}
              onClick={() => selectSource(candidate, true)}
              onKeyDown={(event) => handleTabKey(event, candidate)}
            >
              {t(candidate === 'url' ? 'remote' : 'local')}
            </Button>
          ))}
        </div>
        {source === 'url' ? (
          <div id="add-repository-url-panel" role="tabpanel" className="repository-dialog-panel">
            <label className="dialog-form-field" htmlFor="repository-url">
              <span>{t('repositoryUrl')}</span>
              <Input
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
              <DirectoryInput
                id="repository-clone-parent"
                value={cloneParentPath}
                aria-invalid={Boolean(error && errorField === 'path') || undefined}
                aria-describedby={
                  error && errorField === 'path' ? 'repository-clone-parent-error' : undefined
                }
                autoComplete="off"
                pickerLabel={t('chooseRepositoryDirectory')}
                pickerDisabled={busy}
                onChange={(event) => onCloneParentPathChange(event.target.value)}
                onPick={onChoosePath}
              />
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
            {nameField}
          </div>
        ) : (
          <div id="add-repository-path-panel" role="tabpanel" className="repository-dialog-panel">
            <div className="dialog-form-field">
              <label htmlFor="repository-location">{t('repositoryPath')}</label>
              <DirectoryInput
                id="repository-location"
                value={localPath}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? 'repository-location-error' : undefined}
                autoComplete="off"
                data-dialog-initial-focus
                pickerLabel={t('chooseRepositoryDirectory')}
                pickerDisabled={busy}
                onChange={(event) => onLocalPathChange(event.target.value)}
                onPick={onChoosePath}
              />
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
            {nameField}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={onDismiss}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          aria-label={t('addLocalRepository')}
          disabled={
            busy ||
            (source === 'url'
              ? !url.trim() || !cloneParentPath.trim() || !isRepositoryDirectoryName(remoteName)
              : !localPath.trim())
          }
        >
          {t('add')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
