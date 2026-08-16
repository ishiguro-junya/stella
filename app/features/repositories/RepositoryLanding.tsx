/* oxlint-disable jsx-a11y/no-autofocus, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- リッチな一覧行に対してlistbox操作と初期フォーカスを提供する。 */
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, FolderGit2, FolderPlus, Link2, Search, Trash2 } from 'lucide-react';

import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { RowActionMenu, type RowActionMenuPoint } from '../../ui/RowActionMenu';
import { useI18n } from '../../i18n/i18n';
import { RepositoryLogo, type RepositoryListItem } from './RepositoryLogo';

export interface RepositoryLandingProps {
  repositories: readonly RepositoryListItem[];
  currentPath?: string | undefined;
  focusFirst?: boolean;
  busy: boolean;
  onAdd: () => void;
  onOpen: (path: string) => void;
  onRepair: (path: string) => void;
  onManageRemotes: (path: string) => void;
  onForget: (path: string) => void;
}

interface OpenRepositoryMenu {
  path: string;
  point?: RowActionMenuPoint;
}

function repositoryStatus(
  repository: RepositoryListItem,
  t: ReturnType<typeof useI18n>['t'],
): { label: string; tone: 'danger' | 'warning' } | undefined {
  if (repository.availability === 'missing')
    return { label: t('repositoryMissing'), tone: 'danger' };
  if (repository.availability === 'notRepository')
    return { label: t('repositoryNotRepository'), tone: 'danger' };
  if (repository.availability === 'inaccessible')
    return { label: t('repositoryInaccessible'), tone: 'danger' };
  const issue = repository.healthIssues?.find((candidate) => candidate.kind === 'remote');
  if (!issue || issue.kind !== 'remote') return undefined;
  if (issue.reason === 'authentication')
    return { label: t('repositoryNeedsAuthenticationCheck'), tone: 'warning' };
  if (issue.reason === 'network')
    return { label: t('repositoryNeedsNetworkCheck'), tone: 'warning' };
  return { label: t('repositoryNeedsRemoteCheck'), tone: 'warning' };
}

export function RepositoryLanding({
  repositories,
  currentPath,
  focusFirst = true,
  busy,
  onAdd,
  onOpen,
  onRepair,
  onManageRemotes,
  onForget,
}: RepositoryLandingProps) {
  const { t } = useI18n();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [openMenu, setOpenMenu] = useState<OpenRepositoryMenu>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRepositories = normalizedQuery
    ? repositories.filter((repository) =>
        `${repository.name} ${repository.path}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : repositories;
  const effectiveSelectedPath =
    filteredRepositories.find((repository) => repository.path === selectedPath)?.path ??
    filteredRepositories.find((repository) => repository.path === currentPath)?.path ??
    filteredRepositories[0]?.path;
  const repositoryActions = (
    <div className="repository-landing-actions">
      <Button
        type="button"
        variant="primary"
        aria-label={t('addLocalRepository')}
        disabled={busy}
        onClick={onAdd}
      >
        <FolderPlus aria-hidden="true" focusable="false" />
        {t('add')}
      </Button>
    </div>
  );

  return (
    <main className="repository-landing">
      <section
        id="repositories-title"
        className={`repository-landing-card${repositories.length ? ' has-repositories' : ''}`}
        aria-label={t('repositoriesTitle')}
        tabIndex={-1}
      >
        {repositories.length ? (
          <header className="repository-landing-header">
            <div
              className="repository-landing-summary"
              aria-label={t('repositoryCount', { count: filteredRepositories.length })}
            >
              <FolderGit2 aria-hidden="true" focusable="false" />
              <span>{t('repositoryCount', { count: filteredRepositories.length })}</span>
            </div>
            <div className="repository-landing-controls">
              <label className="repository-landing-search">
                <Search aria-hidden="true" focusable="false" />
                <span className="sr-only">{t('searchRepositories')}</span>
                <Input
                  type="search"
                  autoComplete="off"
                  placeholder={t('searchRepositories')}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setOpenMenu(undefined);
                    setSelectedPath(undefined);
                  }}
                />
              </label>
              {repositoryActions}
            </div>
          </header>
        ) : null}

        {filteredRepositories.length ? (
          <ul
            className="registered-repositories"
            role="listbox"
            aria-label={t('repositoriesTitle')}
            onPointerMove={(event) =>
              event.currentTarget.classList.remove('is-keyboard-navigating')
            }
          >
            {filteredRepositories.map((repository, index) => {
              const status = repositoryStatus(repository, t);
              const repairRequired =
                Boolean(repository.availability) && repository.availability !== 'available';
              const select = (): void => {
                if (repairRequired) onRepair(repository.path);
                else if (currentPath !== repository.path) onOpen(repository.path);
              };
              const focusAt = (nextIndex: number): void => {
                const next = filteredRepositories[nextIndex];
                if (!next) return;
                setSelectedPath(next.path);
                optionRefs.current.get(next.path)?.focus();
              };
              const focusAndSelect = (): void => {
                setSelectedPath(repository.path);
                optionRefs.current.get(repository.path)?.focus();
              };
              const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
                if (
                  event.key === 'ArrowDown' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'Home' ||
                  event.key === 'End'
                ) {
                  event.currentTarget
                    .closest('.registered-repositories')
                    ?.classList.add('is-keyboard-navigating');
                }
                switch (event.key) {
                  case 'ArrowDown':
                    event.preventDefault();
                    focusAt(Math.min(index + 1, filteredRepositories.length - 1));
                    break;
                  case 'ArrowUp':
                    event.preventDefault();
                    focusAt(Math.max(index - 1, 0));
                    break;
                  case 'Home':
                    event.preventDefault();
                    focusAt(0);
                    break;
                  case 'End':
                    event.preventDefault();
                    focusAt(filteredRepositories.length - 1);
                    break;
                  case 'Enter':
                    event.preventDefault();
                    select();
                    break;
                }
              };
              const openContextMenu = (event: MouseEvent<HTMLLIElement>): void => {
                event.preventDefault();
                focusAndSelect();
                setOpenMenu({
                  path: repository.path,
                  point: { x: event.clientX, y: event.clientY },
                });
              };
              return (
                <li
                  key={repository.path}
                  role="presentation"
                  className={`switcher-option-row has-actions${effectiveSelectedPath === repository.path ? ' is-selected' : ''}${busy ? ' is-disabled' : ''}`}
                  onContextMenu={openContextMenu}
                >
                  <Button
                    ref={(node) => {
                      if (node) optionRefs.current.set(repository.path, node);
                      else optionRefs.current.delete(repository.path);
                    }}
                    type="button"
                    role="option"
                    aria-selected={effectiveSelectedPath === repository.path}
                    aria-current={currentPath === repository.path ? 'true' : undefined}
                    className="switcher-option"
                    disabled={busy}
                    autoFocus={focusFirst && effectiveSelectedPath === repository.path}
                    onClick={focusAndSelect}
                    onDoubleClick={select}
                    onKeyDown={handleKeyDown}
                  >
                    <span className="switcher-check" aria-hidden="true">
                      {currentPath === repository.path ? <Check /> : null}
                    </span>
                    <span className="switcher-option-icon" aria-hidden="true">
                      <RepositoryLogo logoUrl={repository.logoUrl} />
                    </span>
                    <span className="switcher-option-copy">
                      <strong>{repository.name}</strong>
                      <small>{repository.path}</small>
                    </span>
                    {status ? (
                      <span className="switcher-status">
                        <span className={`switcher-status-dot ${status.tone}`} aria-hidden="true" />
                        <small>{status.label}</small>
                      </span>
                    ) : null}
                  </Button>
                  <RowActionMenu
                    triggerLabel={t('moreActionsFor', { path: repository.name })}
                    triggerTitle={t('moreActions')}
                    menuLabel={t('fileActionsFor', { path: repository.name })}
                    items={[
                      {
                        action: 'select',
                        label: t('switchRepository'),
                        icon: <FolderGit2 aria-hidden="true" focusable="false" />,
                        disabled: busy || (currentPath === repository.path && !repairRequired),
                      },
                      {
                        action: 'remotes',
                        label: t('manageRemotes'),
                        icon: <Link2 aria-hidden="true" focusable="false" />,
                        disabled: busy,
                      },
                      {
                        action: 'forget',
                        label: t('forgetRepositoryTitle'),
                        icon: <Trash2 aria-hidden="true" focusable="false" />,
                        disabled: busy,
                        danger: true,
                        separatorBefore: true,
                      },
                    ]}
                    open={openMenu?.path === repository.path}
                    disabled={false}
                    contextPoint={openMenu?.path === repository.path ? openMenu.point : undefined}
                    triggerClassName="switcher-action-trigger is-persistent"
                    onOpenChange={(open) =>
                      setOpenMenu(open ? { path: repository.path } : undefined)
                    }
                    onTriggerOpen={focusAndSelect}
                    getActionFocusTarget={() => optionRefs.current.get(repository.path)}
                    getCloseFocusTarget={() => optionRefs.current.get(repository.path)}
                    onAction={(action) => {
                      if (action === 'select') select();
                      else if (action === 'remotes') onManageRemotes(repository.path);
                      else onForget(repository.path);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : repositories.length ? (
          <p className="repository-landing-no-results">{t('noRepositorySearchResults')}</p>
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
