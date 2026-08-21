import { useId, useLayoutEffect, useRef } from 'react';

import type { LocalizedMessage } from '../i18n/i18n';
import { useI18n } from '../i18n/i18n';
import { Button } from './Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './Dialog';
import type { WorkspaceErrorContent } from './WorkspaceErrorDetails';
import { WorkspaceErrorDetails } from './WorkspaceErrorDetails';

export interface OperationProgressDialogProps {
  action: LocalizedMessage;
  repositoryName: string;
  summary: LocalizedMessage;
  status: 'running' | 'cancelling' | 'failed';
  error?: WorkspaceErrorContent;
  cancelError?: WorkspaceErrorContent;
  canCancel: boolean;
  onCancel: () => void;
  onDismiss: () => void;
}

export function OperationProgressDialog({
  action,
  repositoryName,
  summary,
  status,
  error,
  cancelError,
  canCancel,
  onCancel,
  onDismiss,
}: OperationProgressDialogProps) {
  const { message, t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const title = message(action);
  const failed = status === 'failed';
  const role = 'dialog' as const;
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (failed) closeRef.current?.focus();
  }, [failed]);

  return (
    <Dialog
      labelledBy={titleId}
      describedBy={descriptionId}
      className="operation-progress-sheet"
      role={role}
      dismissible={failed}
      onDismiss={onDismiss}
    >
      <DialogHeader titleId={titleId} title={title} />
      <DialogBody id={descriptionId} className="operation-progress-dialog">
        <strong className="operation-progress-repository">{repositoryName}</strong>
        {failed ? (
          error ? (
            <div role="alert">
              <WorkspaceErrorDetails error={error} />
            </div>
          ) : null
        ) : (
          <>
            <progress className="sr-only" aria-label={title} />
            <div className="operation-progress-track" aria-hidden="true">
              <span className="operation-progress-segment" />
            </div>
            <p className="operation-progress-summary" aria-live="polite">
              {message(summary)}
            </p>
            {cancelError ? (
              <div role="alert">
                <WorkspaceErrorDetails error={cancelError} />
              </div>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {failed ? (
          <Button
            ref={closeRef}
            type="button"
            variant="primary"
            data-dialog-initial-focus
            onClick={onDismiss}
          >
            {t('close')}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!canCancel || status === 'cancelling'}
            aria-busy={status === 'cancelling'}
            onClick={onCancel}
          >
            {status === 'cancelling' ? t('cancelling') : t('cancel')}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
