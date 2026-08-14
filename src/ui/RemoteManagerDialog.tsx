/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 設定画面は共通Dialogのfocus trapを使い、警告Dialogとはroleを分ける。 */
import { useEffect, useMemo, useState } from 'react';

import type { RemoteDefinition } from '../domain/workspace';
import { useI18n } from '../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './Dialog';

export interface RemoteUrlChange {
  remote: string;
  urlKind: 'fetch' | 'push';
  expectedUrl: string;
  newUrl: string;
}

export interface RemoteManagerDialogProps {
  remotes: readonly RemoteDefinition[];
  loading: boolean;
  busy: boolean;
  error?: string;
  onDismiss: () => void;
  onReload: () => void;
  onSave: (changes: readonly RemoteUrlChange[]) => void;
}

function entryKey(change: Omit<RemoteUrlChange, 'newUrl'>): string {
  return `${change.urlKind}:${change.remote}:${change.expectedUrl}`;
}

export function RemoteManagerDialog({
  remotes,
  loading,
  busy,
  error,
  onDismiss,
  onReload,
  onSave,
}: RemoteManagerDialogProps) {
  const { t } = useI18n();
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
  const [values, setValues] = useState<Record<string, string>>({});

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
      <DialogBody aria-busy={loading}>
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
          {groups.map(({ urlKind, label, entries: groupEntries }) =>
            groupEntries.length ? (
              <section key={urlKind} className="remote-url-group">
                <h3>{label}</h3>
                {groupEntries.map((entry, index) => {
                  const key = entryKey(entry);
                  return (
                    <label key={key} className="remote-url-field">
                      <span className="sr-only">{label}</span>
                      <input
                        data-dialog-initial-focus={urlKind === 'fetch' && index === 0}
                        value={values[key] ?? entry.expectedUrl}
                        disabled={busy}
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
      </DialogBody>
      <DialogFooter>
        <button type="button" disabled={busy} onClick={onDismiss}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || loading || Boolean(error) || hasEmptyUrl || changes.length === 0}
          onClick={() => onSave(changes)}
        >
          {t('save')}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
