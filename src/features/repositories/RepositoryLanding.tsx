import { FolderGit2, FolderPlus } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';

export interface RepositoryLandingProps {
  paths: readonly string[];
  busy: boolean;
  onAdd: () => void;
  onOpen: (path: string) => void;
}

function repositoryName(path: string): string {
  return path.split('/').findLast((candidate) => candidate.length > 0) ?? path;
}

export function RepositoryLanding({ paths, busy, onAdd, onOpen }: RepositoryLandingProps) {
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

        {paths.length ? (
          <ul className="registered-repositories" aria-label={t('repositoriesTitle')}>
            {paths.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="registered-repository-row"
                  disabled={busy}
                  onClick={() => onOpen(path)}
                >
                  <FolderGit2 aria-hidden="true" focusable="false" />
                  <span>
                    <strong>{repositoryName(path)}</strong>
                    <small>{path}</small>
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
