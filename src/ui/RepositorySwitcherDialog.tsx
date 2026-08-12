import { FolderPlus, Link2 } from 'lucide-react';

import type { RepoSnapshot } from '../domain/workspace';
import { RepositoryLogo, type RepositoryListItem } from '../features/repositories/RepositoryLogo';
import { useI18n } from '../i18n/i18n';
import { SwitcherDialog, type SwitcherDialogItem } from './SwitcherDialog';

export interface RepositorySwitcherDialogProps {
  repos: readonly RepoSnapshot[];
  registeredRepositories: readonly RepositoryListItem[];
  selectedRepoId?: string;
  busy?: boolean;
  onDismiss: () => void;
  onSelectOpen: (repoId: string) => void;
  onSelectRegistered: (path: string) => void;
  onManageRemotes: (path: string) => void;
  onAdd: () => void;
}

function registeredStatus(
  repository: RepositoryListItem,
  t: ReturnType<typeof useI18n>['t'],
): SwitcherDialogItem['status'] {
  if (repository.availability === 'missing')
    return { label: t('repositoryMissing'), tone: 'danger' };
  if (repository.availability === 'notRepository')
    return { label: t('repositoryNotRepository'), tone: 'danger' };
  if (repository.availability === 'inaccessible')
    return { label: t('repositoryInaccessible'), tone: 'danger' };
  const remote = repository.healthIssues?.find((issue) => issue.kind === 'remote');
  if (!remote || remote.kind !== 'remote') return undefined;
  if (remote.reason === 'authentication')
    return { label: t('repositoryNeedsAuthenticationCheck'), tone: 'warning' };
  if (remote.reason === 'network')
    return { label: t('repositoryNeedsNetworkCheck'), tone: 'warning' };
  return { label: t('repositoryNeedsRemoteCheck'), tone: 'warning' };
}

function repositoryStatus(
  repo: RepoSnapshot,
  modifiedLabel: string,
  operationLabel: string | undefined,
): SwitcherDialogItem['status'] {
  if (repo.operation.kind !== 'none') {
    return { label: operationLabel ?? '', tone: 'danger' };
  }
  if (repo.changes.length) return { label: modifiedLabel, tone: 'warning' };
  return undefined;
}

export function RepositorySwitcherDialog({
  repos,
  registeredRepositories,
  selectedRepoId,
  busy = false,
  onDismiss,
  onSelectOpen,
  onSelectRegistered,
  onManageRemotes,
  onAdd,
}: RepositorySwitcherDialogProps) {
  const { t, message } = useI18n();
  const openPaths = new Set(repos.map((repo) => repo.path));
  const items: SwitcherDialogItem[] = [
    ...repos.map((repo) => {
      const registration = registeredRepositories.find((candidate) => candidate.path === repo.path);
      const displayName = registration?.name ?? repo.name;
      const branch = repo.branch.detached ? t('detachedHead') : repo.branch.name;
      const status = repositoryStatus(
        repo,
        t('modified'),
        repo.operation.kind === 'none' ? undefined : message(repo.operation.label),
      );
      const healthStatus = registration ? registeredStatus(registration, t) : undefined;
      const finalStatus = healthStatus ?? status;
      const item: SwitcherDialogItem = {
        id: `open:${repo.repoId}`,
        label: displayName,
        description: branch ? `${repo.path} · ${branch}` : repo.path,
        searchText: `${displayName}\n${repo.path}\n${branch ?? ''}`,
        icon: <RepositoryLogo logoUrl={registration?.logoUrl} />,
        current: repo.repoId === selectedRepoId,
      };
      if (finalStatus) item.status = finalStatus;
      return item;
    }),
    ...registeredRepositories
      .filter((repository) => !openPaths.has(repository.path))
      .map((repository) => {
        const status = registeredStatus(repository, t);
        const item: SwitcherDialogItem = {
          id: `registered:${repository.path}`,
          label: repository.name,
          description: repository.path,
          searchText: `${repository.name}\n${repository.path}`,
          icon: <RepositoryLogo logoUrl={repository.logoUrl} />,
          disabled: busy,
        };
        if (status) item.status = status;
        return item;
      }),
  ];

  return (
    <SwitcherDialog
      title={t('switchRepository')}
      searchLabel={t('searchRepositories')}
      items={items}
      emptyMessage={t('noRepositorySearchResults')}
      onDismiss={onDismiss}
      onSelect={(item) => {
        const open = repos.find((repo) => item.id === `open:${repo.repoId}`);
        if (open) {
          onSelectOpen(open.repoId);
          return;
        }
        const registered = registeredRepositories.find(
          (repository) => item.id === `registered:${repository.path}`,
        );
        if (registered) onSelectRegistered(registered.path);
      }}
      footer={
        <>
          {selectedRepoId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const selected = repos.find((repo) => repo.repoId === selectedRepoId);
                if (selected) onManageRemotes(selected.path);
              }}
            >
              <Link2 aria-hidden="true" focusable="false" />
              <span>{t('manageRemotes')}</span>
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={onAdd}>
            <FolderPlus aria-hidden="true" focusable="false" />
            <span>{t('addRepositoryEllipsis')}</span>
          </button>
        </>
      }
    />
  );
}
