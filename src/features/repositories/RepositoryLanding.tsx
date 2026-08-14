import { Download, FolderGit2, FolderPlus, Link2, Trash2, Wrench } from 'lucide-react';

import { Button } from '../../ui/Button';
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
  const repositoryActions = (
    <div className="repository-landing-actions">
      <Button type="button" variant="primary" disabled={busy} onClick={onAddLocal}>
        <FolderPlus aria-hidden="true" focusable="false" />
        {t('addLocalRepository')}
      </Button>
      <Button type="button" disabled={busy} onClick={onClone}>
        <Download aria-hidden="true" focusable="false" />
        {t('cloneRepository')}
      </Button>
    </div>
  );

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
          {repositories.length ? repositoryActions : null}
        </header>

        {repositories.length ? (
          <ul className="registered-repositories" aria-label={t('repositoriesTitle')}>
            {repositories.map((repository) => {
              const localIssue = localAvailabilityLabel(repository.availability, t);
              const remoteIssue = remoteHealthLabel(repository, t);
              return (
                <li key={repository.path} className="registered-repository-item">
                  <Button
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
                  </Button>
                  <div className="registered-repository-actions">
                    {localIssue ? (
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => onRepair(repository.path)}
                      >
                        <Wrench aria-hidden="true" focusable="false" />
                        {t('repairRepositoryLocation')}
                      </Button>
                    ) : remoteIssue ? (
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => onManageRemotes(repository.path)}
                      >
                        <Link2 aria-hidden="true" focusable="false" />
                        {t('manageRemotes')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="dangerQuiet"
                      disabled={busy}
                      aria-label={t('forgetNamedRepository', { repository: repository.name })}
                      onClick={() => onForget(repository.path)}
                    >
                      <Trash2 aria-hidden="true" focusable="false" />
                      {t('deleteRepository')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <section className="repository-landing-empty" aria-labelledby="first-repository-title">
            <FolderGit2 aria-hidden="true" focusable="false" />
            <h2 id="first-repository-title">{t('firstRepositoryTitle')}</h2>
            <p>{t('firstRepositoryDescription')}</p>
            {repositoryActions}
          </section>
        )}
      </section>
    </main>
  );
}
