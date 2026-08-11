import { FolderGit2, FolderPlus } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import { RepositoryLogo, type RepositoryListItem } from './RepositoryLogo';

export interface RepositoryLandingProps {
  repositories: readonly RepositoryListItem[];
  busy: boolean;
  onAdd: () => void;
  onOpen: (path: string) => void;
}

export function RepositoryLanding({ repositories, busy, onAdd, onOpen }: RepositoryLandingProps) {
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
          <button type="button" className="primary" disabled={busy} onClick={onAdd}>
            <FolderPlus aria-hidden="true" focusable="false" />
            {t('addRepository')}
          </button>
        </header>

        {repositories.length ? (
          <ul className="registered-repositories" aria-label={t('repositoriesTitle')}>
            {repositories.map((repository) => (
              <li key={repository.path}>
                <button
                  type="button"
                  className="registered-repository-row"
                  disabled={busy}
                  onClick={() => onOpen(repository.path)}
                >
                  <RepositoryLogo logoUrl={repository.logoUrl} />
                  <span>
                    <strong>{repository.name}</strong>
                    <small>{repository.path}</small>
                  </span>
                </button>
              </li>
            ))}
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
