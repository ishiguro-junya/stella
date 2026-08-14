import { Download, FolderGit2, FolderPlus, Link2, Trash2, Wrench } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import { RepositoryLogo, type RepositoryListItem } from './RepositoryLogo';

export interface RepositoryLandingProps {
  repositories: readonly RepositoryListItem[];
  busy: boolean;
  onAddLocal: () => void;
  onClone: () => void;
  onOpen: (path: string) => void;
  onRepair: (path: string) => void;
  onManageRemotes: (path: string) => void;
  onForget: (path: string) => void;
}

function localAvailabilityLabel(
  availability: RepositoryListItem['availability'],
  t: ReturnType<typeof useI18n>['t'],
): string | undefined {
  if (!availability || availability === 'available') return undefined;
  if (availability === 'missing') return t('repositoryMissing');
  if (availability === 'notRepository') return t('repositoryNotRepository');
  return t('repositoryInaccessible');
}

function remoteHealthLabel(
  repository: RepositoryListItem,
  t: ReturnType<typeof useI18n>['t'],
): string | undefined {
  const issue = repository.healthIssues?.find((candidate) => candidate.kind === 'remote');
  if (!issue || issue.kind !== 'remote') return undefined;
  if (issue.reason === 'authentication') return t('repositoryNeedsAuthenticationCheck');
  if (issue.reason === 'network') return t('repositoryNeedsNetworkCheck');
  return t('repositoryNeedsRemoteCheck');
}

export function RepositoryLanding({
  repositories,
  busy,
  onAddLocal,
  onClone,
  onOpen,
  onRepair,
  onManageRemotes,
  onForget,
}: RepositoryLandingProps) {
  const { t } = useI18n();

  return (
    <main className="repository-landing">
      <section className="repository-landing-card" aria-labelledby="repositories-title">
        <header className="repository-landing-header">
          <div>
            <h1 id="repositories-title" tabIndex={-1}>
              {t('repositoriesTitle')}
            </h1>
            <p>{t('repositoriesDescription')}</p>
          </div>
          <div className="repository-landing-actions">
            <button type="button" className="primary" disabled={busy} onClick={onAddLocal}>
              <FolderPlus aria-hidden="true" focusable="false" />
              {t('addLocalRepository')}
            </button>
            <button type="button" disabled={busy} onClick={onClone}>
              <Download aria-hidden="true" focusable="false" />
              {t('cloneRepository')}
            </button>
          </div>
        </header>

        {repositories.length ? (
          <ul className="registered-repositories" aria-label={t('repositoriesTitle')}>
            {repositories.map((repository) => {
              const localIssue = localAvailabilityLabel(repository.availability, t);
              const remoteIssue = remoteHealthLabel(repository, t);
              return (
                <li key={repository.path} className="registered-repository-item">
                  <button
                    type="button"
                    className="registered-repository-row"
                    disabled={busy}
                    onClick={() =>
                      localIssue ? onRepair(repository.path) : onOpen(repository.path)
                    }
                  >
                    <RepositoryLogo logoUrl={repository.logoUrl} />
                    <span>
                      <strong>{repository.name}</strong>
                      <small>{repository.path}</small>
                      {localIssue || remoteIssue ? (
                        <small className="repository-health-label">
                          {localIssue ?? remoteIssue}
                        </small>
                      ) : null}
                    </span>
                  </button>
                  <div className="registered-repository-actions">
                    {localIssue ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRepair(repository.path)}
                      >
                        <Wrench aria-hidden="true" focusable="false" />
                        {t('repairRepositoryLocation')}
                      </button>
                    ) : remoteIssue ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onManageRemotes(repository.path)}
                      >
                        <Link2 aria-hidden="true" focusable="false" />
                        {t('manageRemotes')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="danger-quiet"
                      disabled={busy}
                      aria-label={t('forgetNamedRepository', { repository: repository.name })}
                      onClick={() => onForget(repository.path)}
                    >
                      <Trash2 aria-hidden="true" focusable="false" />
                      {t('deleteRepository')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="repository-landing-empty">
            <FolderGit2 aria-hidden="true" focusable="false" />
            <p>{t('noRegisteredRepositories')}</p>
          </div>
        )}
      </section>
    </main>
  );
}
