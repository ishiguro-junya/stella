import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  RotateCcw,
  Tag,
  Undo2,
} from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import {
  RowActionMenu,
  type RowActionMenuItem,
  type RowActionMenuPoint,
} from '../../ui/RowActionMenu';

export type HistoryActionKind =
  | 'createBranch'
  | 'createTag'
  | 'merge'
  | 'rebase'
  | 'cherryPick'
  | 'revert'
  | 'reset';

export interface HistoryActionTarget {
  oid: string;
  shortOid: string;
  subject: string;
  parents: readonly string[];
}

export interface HistoryActionMenuProps {
  target: HistoryActionTarget;
  open: boolean;
  disabled: boolean;
  persistentTrigger?: boolean | undefined;
  contextPoint?: RowActionMenuPoint | undefined;
  onOpenChange: (open: boolean) => void;
  onTriggerOpen: () => void;
  onAction: (action: HistoryActionKind) => void;
}

export function HistoryActionMenu({
  target,
  open,
  disabled,
  persistentTrigger = false,
  contextPoint,
  onOpenChange,
  onTriggerOpen,
  onAction,
}: HistoryActionMenuProps) {
  const { t } = useI18n();
  const items: RowActionMenuItem<HistoryActionKind>[] = [
    {
      action: 'createBranch',
      label: t('createBranchMenu'),
      icon: <GitBranch aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'createTag',
      label: t('createTagMenu'),
      icon: <Tag aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'merge',
      label: t('mergeMenu'),
      icon: <GitMerge aria-hidden="true" focusable="false" size={15} />,
      separatorBefore: true,
    },
    {
      action: 'rebase',
      label: t('rebaseMenu'),
      icon: <GitPullRequest aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'cherryPick',
      label: t('cherryPickMenu'),
      icon: <GitCommitHorizontal aria-hidden="true" focusable="false" size={15} />,
      separatorBefore: true,
    },
    {
      action: 'revert',
      label: t('revertMenu'),
      icon: <Undo2 aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'reset',
      label: t('resetMenu'),
      icon: <RotateCcw aria-hidden="true" focusable="false" size={15} />,
      danger: true,
      separatorBefore: true,
    },
  ];

  return (
    <RowActionMenu
      triggerLabel={t(persistentTrigger ? 'moreActionsForSelectedCommit' : 'moreActionsForCommit', {
        oid: target.shortOid,
      })}
      triggerTitle={t('moreActions')}
      menuLabel={t('commitActionsFor', {
        subject: target.subject,
        oid: target.shortOid,
      })}
      items={items}
      open={open}
      disabled={disabled}
      contextPoint={contextPoint}
      triggerClassName={`history-action-trigger${persistentTrigger ? ' is-persistent' : ''}`}
      menuClassName="history-action-menu"
      onOpenChange={onOpenChange}
      onTriggerOpen={onTriggerOpen}
      getActionFocusTarget={(trigger) =>
        trigger.closest('.history-commit-item')?.querySelector<HTMLButtonElement>('.commit-row')
      }
      onAction={onAction}
    />
  );
}
