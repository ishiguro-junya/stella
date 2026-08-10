import { FolderGit2, FolderPlus } from 'lucide-react';

import type { RepoSnapshot } from '../domain/workspace';
import { useI18n } from '../i18n/i18n';
import { SwitcherDialog, type SwitcherDialogItem } from './SwitcherDialog';

export interface RepositorySwitcherDialogProps {
  repos: readonly RepoSnapshot[];
  registeredPaths: readonly string[];
  selectedRepoId?: string;
  busy?: boolean;
  onDismiss: () => void;
  onSelectOpen: (repoId: string) => void;
  onSelectRegistered: (path: string) => void;
  onAdd: () => void;
}

function repositoryName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.at(-1) ?? path;
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
  registeredPaths,
  selectedRepoId,
  busy = false,
  onDismiss,
  onSelectOpen,
  onSelectRegistered,
  onAdd,
}: RepositorySwitcherDialogProps) {
  const { t, message } = useI18n();
  const openPaths = new Set(repos.map((repo) => repo.path));
  const items: SwitcherDialogItem[] = [
    ...repos.map((repo) => {
      const branch = repo.branch.detached ? t('detachedHead') : repo.branch.name;
      const status = repositoryStatus(
        repo,
        t('modified'),
        repo.operation.kind === 'none' ? undefined : message(repo.operation.label),
      );
      return {
        id: `open:${repo.repoId}`,
        label: repo.name,
        description: branch ? `${repo.path} · ${branch}` : repo.path,
        searchText: `${repo.name}\n${repo.path}\n${branch ?? ''}`,
        icon: <FolderGit2 />,
        current: repo.repoId === selectedRepoId,
        ...(status ? { status } : {}),
      };
    }),
    ...registeredPaths
      .filter((path) => !openPaths.has(path))
      .map((path) => ({
        id: `registered:${path}`,
        label: repositoryName(path),
        description: path,
        searchText: `${repositoryName(path)}\n${path}`,
        icon: <FolderGit2 />,
        disabled: busy,
      })),
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
        const registered = registeredPaths.find((path) => item.id === `registered:${path}`);
        if (registered) onSelectRegistered(registered);
      }}
      footer={
        <button type="button" disabled={busy} onClick={onAdd}>
          <FolderPlus aria-hidden="true" focusable="false" />
          <span>{t('addRepositoryEllipsis')}</span>
        </button>
      }
    />
  );
}
