import { Download, FolderGit2, FolderPlus, Link2, Trash2 } from 'lucide-react';

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
  onForget: (path: string) => void;
  onAddLocal: () => void;
  onClone: () => void;
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
  operationLabel: string | undefined,
): SwitcherDialogItem['status'] {
  if (repo.operation.kind !== 'none') {
    return { label: operationLabel ?? '', tone: 'danger' };
  }
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
  onForget,
  onAddLocal,
  onClone,
}: RepositorySwitcherDialogProps) {
  const { t, message } = useI18n();
  const openPaths = new Set(repos.map((repo) => repo.path));
  const currentRepo = repos.find((repo) => repo.repoId === selectedRepoId);
  const orderedRepos = currentRepo
    ? [currentRepo, ...repos.filter((repo) => repo.repoId !== selectedRepoId)]
    : repos;
  const items: SwitcherDialogItem[] = [
    ...orderedRepos.map((repo) => {
      const registration = registeredRepositories.find((candidate) => candidate.path === repo.path);
      const displayName = registration?.name ?? repo.name;
      const status = repositoryStatus(
        repo,
        repo.operation.kind === 'none' ? undefined : message(repo.operation.label),
      );
      const changedFileCount = new Set(repo.changes.map((change) => change.path)).size;
      const healthStatus = registration ? registeredStatus(registration, t) : undefined;
      const finalStatus = healthStatus ?? status;
      const item: SwitcherDialogItem = {
        id: `open:${repo.repoId}`,
        label: displayName,
        description: repo.path,
        searchText: `${displayName}\n${repo.path}`,
        icon: <RepositoryLogo logoUrl={registration?.logoUrl} />,
        current: repo.repoId === selectedRepoId,
        actions: [
          {
            action: 'select',
            label: t('switchRepository'),
            icon: <FolderGit2 aria-hidden="true" focusable="false" />,
            disabled: repo.repoId === selectedRepoId,
          },
          {
            action: 'remotes',
            label: t('manageRemotes'),
            icon: <Link2 aria-hidden="true" focusable="false" />,
            disabled: busy,
          },
          {
            action: 'forget',
            label: t('deleteRepository'),
            icon: <Trash2 aria-hidden="true" focusable="false" />,
            disabled: busy || repo.operation.kind !== 'none',
            danger: true,
            separatorBefore: true,
          },
        ],
      };
      if (finalStatus) item.status = finalStatus;
      if (changedFileCount) {
        item.badge = {
          count: changedFileCount,
          label: `${t('uncommittedChanges')}, ${t('uncommittedFileCount', {
            count: changedFileCount,
          })}`,
        };
      }
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
          actions: [
            {
              action: 'select',
              label: t('switchRepository'),
              icon: <FolderGit2 aria-hidden="true" focusable="false" />,
              disabled: busy,
            },
            {
              action: 'remotes',
              label: t('manageRemotes'),
              icon: <Link2 aria-hidden="true" focusable="false" />,
              disabled: busy,
            },
            {
              action: 'forget',
              label: t('deleteRepository'),
              icon: <Trash2 aria-hidden="true" focusable="false" />,
              disabled: busy,
              danger: true,
              separatorBefore: true,
            },
          ],
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
      onAction={(item, action) => {
        const open = repos.find((repo) => item.id === `open:${repo.repoId}`);
        const registered = registeredRepositories.find(
          (repository) => item.id === `registered:${repository.path}`,
        );
        if (action === 'select') {
          if (open) onSelectOpen(open.repoId);
          else if (registered) onSelectRegistered(registered.path);
          return;
        }
        const path = open?.path ?? registered?.path;
        if (!path) return;
        if (action === 'remotes') onManageRemotes(path);
        else if (action === 'forget') onForget(path);
      }}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onAddLocal}>
            <FolderPlus aria-hidden="true" focusable="false" />
            <span>{t('addLocalRepository')}</span>
          </button>
          <button type="button" disabled={busy} onClick={onClone}>
            <Download aria-hidden="true" focusable="false" />
            <span>{t('cloneRepository')}</span>
          </button>
        </>
      }
    />
  );
}
