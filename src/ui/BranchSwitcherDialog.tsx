import { GitBranch } from 'lucide-react';

import type { BranchSummary, RepoSnapshot } from '../domain/workspace';
import { useI18n, type I18nValue } from '../i18n/i18n';
import { SwitcherDialog, type SwitcherDialogItem } from './SwitcherDialog';

export interface BranchSwitcherDialogProps {
  repo: RepoSnapshot;
  branches: readonly BranchSummary[];
  loading?: boolean;
  busy?: boolean;
  error?: string;
  onDismiss: () => void;
  onCheckout: (branchName: string) => void;
}

function checkoutDisabledReason(
  repo: RepoSnapshot,
  busy: boolean,
  t: I18nValue['t'],
  message: I18nValue['message'],
): string | undefined {
  if (repo.operation.kind !== 'none') {
    return t('finishOperationBeforeSwitchingBranch', {
      operation: message(repo.operation.label),
    });
  }
  if (repo.changes.length) return t('commitOrDiscardBeforeSwitchingBranch');
  if (busy) return t('waitBeforeSwitchingBranch');
  return undefined;
}

export function BranchSwitcherDialog({
  repo,
  branches,
  loading = false,
  busy = false,
  error,
  onDismiss,
  onCheckout,
}: BranchSwitcherDialogProps) {
  const { t, message } = useI18n();
  const disabledReason = checkoutDisabledReason(repo, busy, t, message);
  const hint = error ?? disabledReason;
  const localBranches = branches.filter((branch) => !branch.remote);
  const currentBranchName = repo.branch.detached ? undefined : repo.branch.name;
  const selectableBranches =
    currentBranchName && !localBranches.some((branch) => branch.shortName === currentBranchName)
      ? [
          {
            fullName: `refs/heads/${currentBranchName}`,
            shortName: currentBranchName,
            oid: '',
            current: true,
            remote: false,
          },
          ...localBranches,
        ]
      : localBranches;
  const items: SwitcherDialogItem[] = selectableBranches.map((branch) => ({
    id: branch.fullName,
    label: branch.shortName,
    ...(branch.upstream ? { description: branch.upstream } : {}),
    searchText: `${branch.shortName}\n${branch.fullName}\n${branch.upstream ?? ''}`,
    icon: <GitBranch />,
    current: branch.current,
    disabled: !branch.current && Boolean(disabledReason),
  }));

  return (
    <SwitcherDialog
      title={t('switchBranch')}
      searchLabel={t('searchBranches')}
      items={items}
      loading={loading}
      emptyMessage={error ?? t('noBranchSearchResults')}
      {...(hint ? { hint } : {})}
      onDismiss={onDismiss}
      onSelect={(item) => {
        const branch = selectableBranches.find((candidate) => candidate.fullName === item.id);
        if (!branch) return;
        if (branch.current) {
          onDismiss();
          return;
        }
        onCheckout(branch.shortName);
      }}
    />
  );
}
