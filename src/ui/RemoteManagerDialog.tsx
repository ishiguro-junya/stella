/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 設定画面は共通Dialogのfocus trapを使い、警告Dialogとはroleを分ける。 */
import { Download, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { RemoteDefinition, RepositoryHealthIssue } from '../domain/workspace';
import { useI18n } from '../i18n/i18n';
import { Dialog } from './Dialog';

interface RemoteUrlEdit {
  remote: string;
  urlKind: 'fetch' | 'push';
  expectedUrl: string;
  newUrl: string;
}

export interface RemoteManagerDialogProps {
  remotes: readonly RemoteDefinition[];
  healthIssues: readonly RepositoryHealthIssue[];
  loading: boolean;
  busy: boolean;
  error?: string;
  onDismiss: () => void;
  onReload: () => void;
  onFetch: (remote: string) => void;
  onChangeUrl: (edit: Omit<RemoteUrlEdit, 'newUrl'> & { newUrl: string }) => void;
}

export function RemoteManagerDialog({
  remotes,
  healthIssues,
  loading,
  busy,
  error,
  onDismiss,
  onReload,
  onFetch,
  onChangeUrl,
}: RemoteManagerDialogProps) {
  const { t } = useI18n();
  const [edit, setEdit] = useState<RemoteUrlEdit>();
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (edit) editInputRef.current?.focus();
  }, [edit]);

  return (
    <Dialog
      labelledBy="remote-manager-title"
      describedBy="remote-manager-description"
      className="remote-manager-sheet"
      role="dialog"
      onDismiss={onDismiss}
    >
      <header className="remote-manager-header">
        <div>
          <h2 id="remote-manager-title">{t('manageRemotes')}</h2>
          <p id="remote-manager-description">{t('manageRemotesDescription')}</p>
        </div>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={onDismiss}>
          <X aria-hidden="true" focusable="false" />
        </button>
      </header>

      {loading ? <output>{t('loading')}</output> : null}
      {error ? (
        <div className="remote-manager-error">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={onReload}>
            {t('retry')}
          </button>
        </div>
      ) : null}
      {!loading && !error && !remotes.length ? <p>{t('noRemotes')}</p> : null}

      <div className="remote-manager-list">
        {remotes.map((remote) => {
          const issue = healthIssues.find(
            (candidate) => candidate.kind === 'remote' && candidate.remote === remote.name,
          );
          return (
            <section key={remote.name} className="remote-definition">
              <header>
                <div>
                  <h3>{remote.name}</h3>
                  {issue ? (
                    <small className="repository-health-label">
                      {issue.reason === 'authentication'
                        ? t('repositoryNeedsAuthenticationCheck')
                        : issue.reason === 'network'
                          ? t('repositoryNeedsNetworkCheck')
                          : t('repositoryNeedsRemoteCheck')}
                    </small>
                  ) : null}
                </div>
                <button type="button" disabled={busy} onClick={() => onFetch(remote.name)}>
                  <Download aria-hidden="true" focusable="false" />
                  {t('fetchRemote')}
                </button>
              </header>
              {(
                [
                  ['fetch', t('fetchUrls'), remote.fetchUrls],
                  ['push', t('pushUrls'), remote.pushUrls],
                ] as const
              ).map(([urlKind, label, urls]) => (
                <div key={urlKind} className="remote-url-group">
                  <h4>{label}</h4>
                  {urls.map((url) => {
                    const editing =
                      edit?.remote === remote.name &&
                      edit.urlKind === urlKind &&
                      edit.expectedUrl === url;
                    return (
                      <div key={`${urlKind}:${url}`} className="remote-url-row">
                        {editing ? (
                          <label>
                            <span className="sr-only">{t('newRemoteUrl')}</span>
                            <input
                              ref={editInputRef}
                              data-dialog-initial-focus
                              value={edit.newUrl}
                              onChange={(event) =>
                                setEdit((current) =>
                                  current ? { ...current, newUrl: event.target.value } : current,
                                )
                              }
                            />
                          </label>
                        ) : (
                          <code>{url}</code>
                        )}
                        {editing ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setEdit(undefined)}
                            >
                              {t('cancel')}
                            </button>
                            <button
                              type="button"
                              className="primary"
                              disabled={busy || !edit.newUrl.trim() || edit.newUrl === url}
                              onClick={() => {
                                onChangeUrl({
                                  remote: remote.name,
                                  urlKind,
                                  expectedUrl: url,
                                  newUrl: edit.newUrl.trim(),
                                });
                              }}
                            >
                              {t('reviewRemoteUrlChange')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={t('changeRemoteUrl', { remote: remote.name })}
                            onClick={() =>
                              setEdit({
                                remote: remote.name,
                                urlKind,
                                expectedUrl: url,
                                newUrl: url,
                              })
                            }
                          >
                            <Pencil aria-hidden="true" focusable="false" />
                            {t('change')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
