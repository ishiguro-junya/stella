import { Button } from './Button';
import { useI18n } from '../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './Dialog';
import type { WorkspaceErrorContent } from './WorkspaceErrorDetails';
import { WorkspaceErrorDetails } from './WorkspaceErrorDetails';

export type ShowWorkspaceError = (title: string, cause: unknown, fallback: string) => void;

const handledWorkspaceErrors = new WeakSet<object>();

export function markWorkspaceErrorHandled(cause: unknown, fallback: string): Error {
  const error = cause instanceof Error ? cause : new Error(fallback);
  handledWorkspaceErrors.add(error);
  return error;
}

export function isWorkspaceErrorHandled(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && handledWorkspaceErrors.has(cause);
}

export interface WorkspaceErrorDialogProps {
  title: string;
  error: WorkspaceErrorContent;
  onDismiss: () => void;
}

export function WorkspaceErrorDialog({ title, error, onDismiss }: WorkspaceErrorDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      labelledBy="runtime-error-title"
      describedBy="runtime-error-description"
      role="alertdialog"
      onDismiss={onDismiss}
    >
      <DialogHeader titleId="runtime-error-title" title={title} />
      <DialogBody id="runtime-error-description">
        <WorkspaceErrorDetails error={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="primary" data-dialog-initial-focus onClick={onDismiss}>
          {t('close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
