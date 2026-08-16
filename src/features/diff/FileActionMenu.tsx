import {
  AppWindowMac,
  Copy,
  FolderOpen,
  FilePenLine,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react';

import { useI18n } from '../../i18n/i18n';
import {
  RowActionMenu,
  type RowActionMenuItem,
  type RowActionMenuPoint,
} from '../../ui/RowActionMenu';

export type FileActionKind =
  | 'editFile'
  | 'renameFile'
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
  editing?: boolean | undefined;
  editDisabled?: boolean | undefined;
  renameDisabled?: boolean | undefined;
  openDisabled: boolean;
  revealDisabled: boolean;
  discardDisabled: boolean;
  deleteDisabled: boolean;
  imagePreview?:
    | {
        pressed: boolean;
        disabled?: boolean | undefined;
        onPressedChange: (pressed: boolean) => void;
      }
    | undefined;
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
  editing = false,
  editDisabled = false,
  renameDisabled = false,
  openDisabled,
  revealDisabled,
  discardDisabled,
  deleteDisabled,
  imagePreview,
  persistentTrigger = false,
  contextPoint,
  onOpenChange,
  onTriggerOpen,
  onAction,
}: FileActionMenuProps) {
  const { t } = useI18n();
  const items: RowActionMenuItem<FileActionKind | 'imagePreview'>[] = [
    {
      action: 'editFile',
      label: t(editing ? 'actionStopEditingFile' : 'actionEditFile'),
      icon: <Pencil aria-hidden="true" focusable="false" size={15} />,
      disabled: !editing && editDisabled,
    },
    {
      action: 'renameFile',
      label: t('actionRenameFile'),
      icon: <FilePenLine aria-hidden="true" focusable="false" size={15} />,
      disabled: renameDisabled,
    },
    ...(imagePreview
      ? [
          {
            action: 'imagePreview' as const,
            label: t(imagePreview.pressed ? 'actionStopPreviewingImage' : 'actionPreviewImage'),
            icon: <ImageIcon aria-hidden="true" focusable="false" size={15} />,
            checked: imagePreview.pressed,
            disabled: imagePreview.disabled && !imagePreview.pressed,
          },
        ]
      : []),
    {
      action: 'openInDefaultApp',
      label: t('openInDefaultApp'),
      icon: <AppWindowMac aria-hidden="true" focusable="false" size={15} />,
      disabled: openDisabled,
      separatorBefore: true,
    },
    {
      action: 'revealInFinder',
      label: t('showInFinder'),
      icon: <FolderOpen aria-hidden="true" focusable="false" size={15} />,
      disabled: revealDisabled,
    },
    {
      action: 'copyPath',
      label: t('copyPath'),
      icon: <Copy aria-hidden="true" focusable="false" size={15} />,
    },
    {
      action: 'discardChanges',
      label: t('actionDiscardChanges'),
      icon: <Undo2 aria-hidden="true" focusable="false" size={15} />,
      disabled: discardDisabled,
      danger: true,
      separatorBefore: true,
    },
    {
      action: 'moveToTrash',
      label: t('actionDeleteFile'),
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
      onAction={(action) =>
        action === 'imagePreview'
          ? imagePreview?.onPressedChange(!imagePreview.pressed)
          : onAction(action)
      }
    />
  );
}
