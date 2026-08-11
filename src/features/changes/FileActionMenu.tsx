import { AppWindowMac, Copy, FolderOpen, Trash2, Undo2 } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import {
  RowActionMenu,
  type RowActionMenuItem,
  type RowActionMenuPoint,
} from '../../ui/RowActionMenu';

export type FileActionKind =
  | 'openInDefaultApp'
  | 'revealInFinder'
  | 'copyPath'
  | 'discardChanges'
  | 'moveToTrash';

export type FileActionMenuPoint = RowActionMenuPoint;

export interface FileActionMenuProps {
  path: string;
  selectedPaths: string[];
  open: boolean;
  disabled: boolean;
  openDisabled: boolean;
  discardDisabled: boolean;
  deleteDisabled: boolean;
  persistentTrigger?: boolean | undefined;
  contextPoint?: FileActionMenuPoint | undefined;
  onOpenChange: (open: boolean) => void;
  onTriggerOpen: () => void;
  onAction: (action: FileActionKind) => Promise<void>;
}

export function FileActionMenu({
  path,
  selectedPaths,
  open,
  disabled,
  openDisabled,
  discardDisabled,
  deleteDisabled,
  persistentTrigger = false,
  contextPoint,
  onOpenChange,
  onTriggerOpen,
  onAction,
}: FileActionMenuProps) {
  const { t } = useI18n();
  const items: RowActionMenuItem<FileActionKind>[] = [
    {
      action: 'openInDefaultApp',
      label: t('openInDefaultApp'),
      icon: <AppWindowMac aria-hidden="true" focusable="false" size={15} />,
      disabled: openDisabled,
    },
    {
      action: 'revealInFinder',
      label: t('showInFinder'),
      icon: <FolderOpen aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'copyPath',
      label: t('copyPath'),
      icon: <Copy aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'discardChanges',
      label: t('discardFilesEllipsis'),
      icon: <Undo2 aria-hidden="true" focusable="false" size={15} />,
      disabled: discardDisabled,
      danger: true,
      separatorBefore: true,
    },
    {
      action: 'moveToTrash',
      label: t('deleteFilesEllipsis'),
      icon: <Trash2 aria-hidden="true" focusable="false" size={15} />,
      disabled: deleteDisabled,
      danger: true,
    },
  ];

  return (
    <RowActionMenu
      triggerLabel={t(persistentTrigger ? 'moreActionsForSelectedFile' : 'moreActionsFor', {
        path,
      })}
      triggerTitle={t('moreActions')}
      menuLabel={
        selectedPaths.length === 1
          ? t('fileActionsFor', { path: selectedPaths[0] ?? path })
          : t('selectedFileActions', { count: selectedPaths.length })
      }
      items={items}
      open={open}
      disabled={disabled}
      contextPoint={contextPoint}
      triggerClassName={`file-action-trigger${persistentTrigger ? ' is-persistent' : ''}`}
      menuClassName="file-action-menu"
      onOpenChange={onOpenChange}
      onTriggerOpen={onTriggerOpen}
      getActionFocusTarget={(trigger) =>
        trigger.closest('.change-item')?.querySelector<HTMLButtonElement>('.change-row')
      }
      onAction={onAction}
    />
  );
}
