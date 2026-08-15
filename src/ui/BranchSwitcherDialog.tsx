/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogのfocus管理を維持したままブランチ作成をdialogとして公開する。 */
import { GitBranch, GitBranchPlus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from './Button';
import { Input } from './Input';
import type { BranchSummary, RepoSnapshot } from '../domain/workspace';
import { useI18n, type I18nValue } from '../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './Dialog';
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
  onDelete: (branchName: string) => void;
}

const BASE_BRANCH_NAMES = [
  'main',
  'master',
  'trunk',
  'production',
  'prod',
  'staging',
  'stage',
  'develop',
  'development',
  'integration',
  'release',
] as const;

function orderBranches(
  branches: readonly BranchSummary[],
  currentBranchName: string | undefined,
): BranchSummary[] {
  const localBranches = branches.filter((branch) => !branch.remote);
  const currentBranch = currentBranchName
    ? (localBranches.find((branch) => branch.shortName === currentBranchName) ?? {
        fullName: `refs/heads/${currentBranchName}`,
        shortName: currentBranchName,
        oid: '',
        current: true,
        remote: false,
      })
    : undefined;
  const remaining = localBranches.filter(
    (branch) => !currentBranchName || branch.shortName !== currentBranchName,
  );
  const baseBranches = BASE_BRANCH_NAMES.flatMap((name) =>
    remaining.filter((branch) => branch.shortName === name),
  );
  const baseBranchNames = new Set<string>(BASE_BRANCH_NAMES);
  const otherBranches = remaining.filter((branch) => !baseBranchNames.has(branch.shortName));
  return currentBranch
    ? [{ ...currentBranch, current: true }, ...baseBranches, ...otherBranches]
    : [...baseBranches, ...otherBranches];
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
  onDelete,
}: BranchSwitcherDialogProps) {
  const { t, message } = useI18n();
  const [creating, setCreating] = useState(false);
  const [branchName, setBranchName] = useState('');
  const disabledReason = checkoutDisabledReason(repo, busy, t, message);
  const currentBranchName = repo.branch.detached ? undefined : (repo.branch.name ?? undefined);
  const selectableBranches = orderBranches(branches, currentBranchName);
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
    actions: [
      {
        action: 'select',
        label: t('switchBranch'),
        icon: <GitBranch aria-hidden="true" focusable="false" />,
        disabled: branch.current || Boolean(disabledReason),
      },
      {
        action: 'delete',
        label: t('deleteBranch'),
        icon: <Trash2 aria-hidden="true" focusable="false" />,
        disabled: branch.current || Boolean(disabledReason),
        danger: true,
        separatorBefore: true,
      },
    ],
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
        dismissible={!busy}
        onDismiss={() => setCreating(false)}
        onSubmit={submit}
        role="dialog"
      >
        <DialogHeader
          titleId="create-branch-title"
          title={t('createBranch')}
          descriptionId="create-branch-description"
          description={t('createAndCheckoutBranchDescription')}
        />
        <DialogBody>
          <label>
            <span>{t('branchName')}</span>
            <Input
              data-dialog-initial-focus
              value={branchName}
              aria-label={t('branchName')}
              disabled={Boolean(disabledReason)}
              onChange={(event) => setBranchName(event.currentTarget.value)}
            />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={() => setCreating(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!branchName.trim() || Boolean(disabledReason)}
          >
            {t('reviewImpact')}
          </Button>
        </DialogFooter>
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
        <Button
          type="button"
          disabled={loading || Boolean(error) || Boolean(createDisabledReason)}
          tooltip={createDisabledReason}
          onClick={() => setCreating(true)}
        >
          <GitBranchPlus aria-hidden="true" focusable="false" />
          {t('createBranch')}
        </Button>
      }
      onDismiss={onDismiss}
      onSelect={(item) => {
        const branch = selectableBranches.find((candidate) => candidate.fullName === item.id);
        if (branch && !branch.current) onCheckout(branch.shortName);
      }}
      onAction={(item, action) => {
        const branch = selectableBranches.find((candidate) => candidate.fullName === item.id);
        if (!branch || branch.current) return;
        if (action === 'select') onCheckout(branch.shortName);
        if (action === 'delete') onDelete(branch.shortName);
      }}
    />
  );
}
