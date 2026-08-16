/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 設定画面は共通ダイアログのフォーカストラップを使い、警告ダイアログとは役割を分ける。 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from './Button';
import { DirectoryInput } from './DirectoryInput';
import { Input } from './Input';
import { LoadingIndicator } from './LoadingIndicator';
import { isAbsoluteLocalPath } from '../domain/repositoryLocation';
import type { RemoteDefinition } from '../domain/workspace';
import { useI18n } from '../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './Dialog';

export interface RemoteUrlChange {
  remote: string;
  urlKind: 'fetch' | 'push';
  expectedUrl: string;
  newUrl: string;
}

export interface RemoteAddition {
  remote: 'origin';
  url: string;
}

export interface RepositoryInformationChange {
  name: string;
  path: string;
  remoteUrlChanges: readonly RemoteUrlChange[];
  remoteAddition?: RemoteAddition;
}

export interface RemoteManagerDialogProps {
  repositoryName: string;
  repositoryPath: string;
  remotes: readonly RemoteDefinition[];
  loading: boolean;
  busy: boolean;
  error?: string;
  onDismiss: () => void;
  onReload: () => void;
  onChoosePath: () => Promise<string | null>;
  onSave: (change: RepositoryInformationChange) => void;
}

function entryKey(change: Omit<RemoteUrlChange, 'newUrl'>): string {
  return `${change.urlKind}:${change.remote}:${change.expectedUrl}`;
}

export function RemoteManagerDialog({
  repositoryName: initialName,
  repositoryPath: initialPath,
  remotes,
  loading,
  busy,
  error,
  onDismiss,
  onReload,
  onChoosePath,
  onSave,
}: RemoteManagerDialogProps) {
  const { t } = useI18n();
  const tabRefs = useRef<Record<'remote' | 'local', HTMLButtonElement | null>>({
    remote: null,
    local: null,
  });
  const [selectedTab, setSelectedTab] = useState<'remote' | 'local'>('remote');
  const groups = useMemo(
    () =>
      (
        [
          ['fetch', t('fetchUrls')],
          ['push', t('pushUrls')],
        ] as const
      ).map(([urlKind, label]) => ({
        urlKind,
        label,
        entries: remotes.flatMap((remote) =>
          remote[`${urlKind}Urls`].map((expectedUrl) => ({
            remote: remote.name,
            urlKind,
            expectedUrl,
          })),
        ),
      })),
    [remotes, t],
  );
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const [repositoryName, setRepositoryName] = useState(initialName);
  const [repositoryPath, setRepositoryPath] = useState(initialPath);
  const [values, setValues] = useState<Record<string, string>>({});
  const [newRemoteUrl, setNewRemoteUrl] = useState('');

  useEffect(() => {
    setValues(Object.fromEntries(entries.map((entry) => [entryKey(entry), entry.expectedUrl])));
  }, [entries]);

  const changes: RemoteUrlChange[] = entries.flatMap((entry) => {
    const newUrl = (values[entryKey(entry)] ?? entry.expectedUrl).trim();
    return newUrl !== entry.expectedUrl ? [{ ...entry, newUrl }] : [];
  });
  const hasEmptyUrl = entries.some(
    (entry) => !(values[entryKey(entry)] ?? entry.expectedUrl).trim(),
  );
  const name = repositoryName.trim();
  const path = repositoryPath.trim().replace(/\/+$/u, '') || '/';
  const remoteUrl = newRemoteUrl.trim();
  const remoteAddition: RemoteAddition | undefined =
    !remotes.length && remoteUrl ? { remote: 'origin', url: remoteUrl } : undefined;
  const repositoryDetailsChanged = name !== initialName || path !== initialPath;
  const hasChanges = repositoryDetailsChanged || changes.length > 0 || Boolean(remoteAddition);
  const selectTab = (next: 'remote' | 'local', focus = false): void => {
    setSelectedTab(next);
    if (focus) tabRefs.current[next]?.focus();
  };
  const handleTabKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: 'remote' | 'local',
  ): void => {
    let next: 'remote' | 'local' | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      next = current === 'remote' ? 'local' : 'remote';
    else if (event.key === 'Home') next = 'remote';
    else if (event.key === 'End') next = 'local';
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  };

  return (
    <Dialog
      labelledBy="remote-manager-title"
      describedBy="remote-manager-description"
      role="dialog"
      dismissible={!busy}
      onDismiss={onDismiss}
    >
      <DialogHeader
        titleId="remote-manager-title"
        title={t('manageRemotes')}
        descriptionId="remote-manager-description"
        description={t('manageRemotesDescription')}
      />
      <DialogBody className="remote-manager-body dialog-form" aria-busy={loading}>
        {loading ? <LoadingIndicator className="remote-manager-loading" /> : null}
        <div
          className="segmented repository-dialog-tabs"
          role="tablist"
          aria-label={t('repositoryInformationType')}
        >
          {(['remote', 'local'] as const).map((tab) => (
            <Button
              key={tab}
              ref={(element) => {
                tabRefs.current[tab] = element;
              }}
              type="button"
              role="tab"
              aria-controls={`repository-information-${tab}-panel`}
              aria-selected={selectedTab === tab}
              tabIndex={selectedTab === tab ? 0 : -1}
              onClick={() => selectTab(tab, true)}
              onKeyDown={(event) => handleTabKey(event, tab)}
            >
              {t(tab)}
            </Button>
          ))}
        </div>
        {selectedTab === 'remote' ? (
          <div
            id="repository-information-remote-panel"
            role="tabpanel"
            className="remote-manager-list repository-dialog-panel"
          >
            {error ? (
              <div className="remote-manager-error">
                <p>{error}</p>
                <Button type="button" disabled={busy} onClick={onReload}>
                  {t('retry')}
                </Button>
              </div>
            ) : null}
            {!loading && !error && !remotes.length ? (
              <label className="dialog-form-field" htmlFor="repository-origin-url">
                <span>{t('repositoryUrl')}</span>
                <Input
                  id="repository-origin-url"
                  value={newRemoteUrl}
                  disabled={busy}
                  autoComplete="off"
                  data-dialog-initial-focus
                  onChange={(event) => setNewRemoteUrl(event.target.value)}
                />
              </label>
            ) : null}
            {groups.map(({ urlKind, label, entries: groupEntries }) =>
              groupEntries.length ? (
                <section key={urlKind} className="remote-url-group">
                  <h3>{label}</h3>
                  {groupEntries.map((entry, index) => {
                    const key = entryKey(entry);
                    return (
                      <label key={key} className="remote-url-field">
                        <span className="sr-only">{label}</span>
                        <Input
                          value={values[key] ?? entry.expectedUrl}
                          disabled={busy}
                          data-dialog-initial-focus={urlKind === 'fetch' && index === 0}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, [key]: event.target.value }))
                          }
                        />
                      </label>
                    );
                  })}
                </section>
              ) : null,
            )}
          </div>
        ) : (
          <div
            id="repository-information-local-panel"
            role="tabpanel"
            className="remote-manager-list repository-dialog-panel"
          >
            <label className="dialog-form-field" htmlFor="repository-information-name">
              <span>{t('repositoryDisplayName')}</span>
              <Input
                id="repository-information-name"
                value={repositoryName}
                disabled={busy}
                autoComplete="off"
                onChange={(event) => setRepositoryName(event.target.value)}
              />
            </label>
            <div className="dialog-form-field">
              <label htmlFor="repository-information-path">{t('repositoryPath')}</label>
              <DirectoryInput
                id="repository-information-path"
                value={repositoryPath}
                disabled={busy}
                autoComplete="off"
                pickerLabel={t('chooseRepositoryDirectory')}
                pickerDisabled={busy}
                onChange={(event) => setRepositoryPath(event.target.value)}
                onPick={() => {
                  void onChoosePath().then((selectedPath) => {
                    if (selectedPath) setRepositoryPath(selectedPath);
                  });
                }}
              />
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" disabled={busy} onClick={onDismiss}>
          {t('cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={
            busy ||
            loading ||
            (Boolean(error) && !repositoryDetailsChanged) ||
            !name ||
            !isAbsoluteLocalPath(path) ||
            hasEmptyUrl ||
            !hasChanges
          }
          onClick={() =>
            onSave({
              name,
              path,
              remoteUrlChanges: changes,
              ...(remoteAddition ? { remoteAddition } : {}),
            })
          }
        >
          {t('save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
