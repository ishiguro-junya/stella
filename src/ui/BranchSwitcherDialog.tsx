/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogのfocus管理を維持したままブランチ作成をdialogとして公開する。 */
import { GitBranch, GitBranchPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { BranchSummary, RepoSnapshot } from '../domain/workspace';
import { useI18n, type I18nValue } from '../i18n/i18n';
import { Dialog } from './Dialog';
import { SwitcherDialog, type SwitcherDialogItem } from './SwitcherDialog';

export interface BranchSwitcherDialogProps {
  repo: RepoSnapshot;
  branches: readonly BranchSummary[];
  loading?: boolean;
  busy?: boolean;
  error?: string;
  onDismiss: () => void;
  onCheckout: (branchName: string) => void;
  onCreate: (branchName: string, startOid: string) => void;
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
  onCreate,
}: BranchSwitcherDialogProps) {
  const { t, message } = useI18n();
  const [creating, setCreating] = useState(false);
  const [branchName, setBranchName] = useState('');
  const disabledReason = checkoutDisabledReason(repo, busy, t, message);
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
  const startOid = repo.branch.oid ?? selectableBranches.find((branch) => branch.current)?.oid;
  const createDisabledReason = startOid ? disabledReason : t('createBranchRequiresCommit');
  const hint =
    error ?? disabledReason ?? (!loading && !startOid ? createDisabledReason : undefined);
  const items: SwitcherDialogItem[] = selectableBranches.map((branch) => ({
    id: branch.fullName,
    label: branch.shortName,
    ...(branch.upstream ? { description: branch.upstream } : {}),
    searchText: `${branch.shortName}\n${branch.fullName}\n${branch.upstream ?? ''}`,
    icon: <GitBranch />,
    current: branch.current,
    disabled: !branch.current && Boolean(disabledReason),
  }));

  if (creating) {
    const submit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const name = branchName.trim();
      if (!name || !startOid || disabledReason) return;
      onCreate(name, startOid);
    };

    return (
      <Dialog
        labelledBy="create-branch-title"
        describedBy="create-branch-description"
        onDismiss={() => setCreating(false)}
        onSubmit={submit}
        role="dialog"
      >
        <h2 id="create-branch-title">{t('createBranch')}</h2>
        <p id="create-branch-description">{t('createAndCheckoutBranchDescription')}</p>
        <label>
          <span>{t('branchName')}</span>
          <input
            data-dialog-initial-focus
            value={branchName}
            aria-label={t('branchName')}
            placeholder={t('branchNamePlaceholder')}
            disabled={Boolean(disabledReason)}
            onChange={(event) => setBranchName(event.currentTarget.value)}
          />
        </label>
        <div className="button-row end">
          <button type="button" onClick={() => setCreating(false)}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!branchName.trim() || Boolean(disabledReason)}
          >
            {t('reviewImpact')}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <SwitcherDialog
      title={t('switchBranch')}
      searchLabel={t('searchBranches')}
      items={items}
      loading={loading}
      emptyMessage={error ?? t('noBranchSearchResults')}
      {...(hint ? { hint } : {})}
      footer={
        <button
          type="button"
          disabled={loading || Boolean(error) || Boolean(createDisabledReason)}
          title={createDisabledReason}
          onClick={() => setCreating(true)}
        >
          <GitBranchPlus aria-hidden="true" focusable="false" />
          {t('createBranch')}
        </button>
      }
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
