/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogのfocus管理を維持したまま非破壊操作をdialogとして公開する。 */
import { useEffect, useState, type FormEvent } from 'react';

import type { WorkspaceAction } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { Dialog } from '../../ui/Dialog';
import { SelectControl } from '../../ui/SelectControl';
import type { HistoryActionKind, HistoryActionTarget } from './HistoryActionMenu';

export interface HistoryActionDialogRequest {
  kind: HistoryActionKind;
  target: HistoryActionTarget;
}

export interface HistoryActionDialogProps {
  request: HistoryActionDialogRequest;
  disabled: boolean;
  disabledReason?: string | undefined;
  onDismiss: () => void;
  onAction: (action: WorkspaceAction) => Promise<void>;
}

const ACTION_TITLE_KEY = {
  createBranch: 'createBranch',
  createTag: 'createTag',
  merge: 'merge',
  rebase: 'rebase',
  cherryPick: 'cherryPick',
  revert: 'revert',
  reset: 'reset',
} as const;

export function HistoryActionDialog({
  request,
  disabled,
  disabledReason,
  onDismiss,
  onAction,
}: HistoryActionDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [sourceRef, setSourceRef] = useState(request.target.oid);
  const [mainline, setMainline] = useState(1);
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const [submitting, setSubmitting] = useState(false);
  const needsMainline = request.target.parents.length > 1;
  const dialogTitle = t(ACTION_TITLE_KEY[request.kind]);
  const fieldDisabled = disabled || submitting;

  useEffect(() => {
    if (disabled && !submitting) onDismiss();
  }, [disabled, onDismiss, submitting]);

  const actionFromForm = (): WorkspaceAction | undefined => {
    switch (request.kind) {
      case 'createBranch':
        return name.trim()
          ? { kind: 'createBranch', name: name.trim(), startOid: request.target.oid }
          : undefined;
      case 'createTag':
        return name.trim()
          ? { kind: 'createTag', name: name.trim(), targetOid: request.target.oid }
          : undefined;
      case 'merge':
        return sourceRef.trim() ? { kind: 'merge', sourceRef: sourceRef.trim() } : undefined;
      case 'rebase':
        return sourceRef.trim() ? { kind: 'rebase', ontoRef: sourceRef.trim() } : undefined;
      case 'cherryPick':
        return {
          kind: 'cherryPick',
          oid: request.target.oid,
          ...(needsMainline ? { mainline } : {}),
        };
      case 'revert':
        return {
          kind: 'revert',
          oid: request.target.oid,
          ...(needsMainline ? { mainline } : {}),
        };
      case 'reset':
        return { kind: 'reset', oid: request.target.oid, mode: resetMode };
    }
    return undefined;
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const action = actionFromForm();
    if (!action || fieldDisabled) return;
    setSubmitting(true);
    try {
      await onAction(action);
      onDismiss();
    } catch {
      // 共有エラーDialogがpreview失敗を示すため、再試行用に入力内容を保持する。
      setSubmitting(false);
    }
  };

  const actionReady =
    request.kind === 'createBranch' || request.kind === 'createTag'
      ? Boolean(name.trim())
      : request.kind === 'merge' || request.kind === 'rebase'
        ? Boolean(sourceRef.trim())
        : true;
  const titleId = `history-${request.kind}-title`;

  return (
    <Dialog
      labelledBy={titleId}
      onDismiss={onDismiss}
      onSubmit={(event) => void submit(event)}
      role="dialog"
    >
      <h2 id={titleId}>{dialogTitle}</h2>
      <div className="history-action-target" aria-label={t('targetCommit')}>
        <span>{t('targetCommit')}</span>
        <strong>{request.target.subject}</strong>
        <code>{request.target.shortOid}</code>
      </div>
      {disabledReason ? (
        <p id="history-action-disabled-reason" className="remote-action-hint">
          {disabledReason}
        </p>
      ) : null}

      {request.kind === 'createBranch' ? (
        <label>
          <span>{t('branchName')}</span>
          <input
            data-dialog-initial-focus
            value={name}
            aria-label={t('branchName')}
            disabled={fieldDisabled}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
      ) : null}
      {request.kind === 'createTag' ? (
        <label>
          <span>{t('tagName')}</span>
          <input
            data-dialog-initial-focus
            value={name}
            aria-label={t('tagName')}
            aria-describedby="create-tag-help"
            disabled={fieldDisabled}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <small id="create-tag-help">{t('localTagHelp')}</small>
        </label>
      ) : null}
      {request.kind === 'merge' || request.kind === 'rebase' ? (
        <label>
          <span>{t('sourceRef')}</span>
          <input
            data-dialog-initial-focus
            value={sourceRef}
            aria-label={t('sourceRef')}
            disabled={fieldDisabled}
            onChange={(event) => setSourceRef(event.currentTarget.value)}
          />
        </label>
      ) : null}
      {(request.kind === 'cherryPick' || request.kind === 'revert') && needsMainline ? (
        <label>
          <span>{t('mainlineParent')}</span>
          <SelectControl
            data-dialog-initial-focus
            aria-label={t('mainlineParent')}
            aria-describedby="merge-mainline-help"
            value={mainline}
            disabled={fieldDisabled}
            onChange={(event) => setMainline(Number(event.currentTarget.value))}
          >
            {request.target.parents.map((parent, index) => (
              <option key={parent} value={index + 1}>
                {t('parentNumber', { number: index + 1 })} · {parent.slice(0, 7)}
              </option>
            ))}
          </SelectControl>
          <small id="merge-mainline-help">{t('mainlineHelp')}</small>
        </label>
      ) : null}
      {request.kind === 'reset' ? (
        <label>
          <span>{t('resetMode')}</span>
          <SelectControl
            data-dialog-initial-focus
            aria-label={t('resetMode')}
            value={resetMode}
            disabled={fieldDisabled}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'soft' || value === 'mixed' || value === 'hard') setResetMode(value);
            }}
          >
            <option value="soft">{t('soft')}</option>
            <option value="mixed">{t('mixed')}</option>
            <option value="hard">{t('hard')}</option>
          </SelectControl>
        </label>
      ) : null}

      <div className="button-row end">
        <button type="button" disabled={submitting} onClick={onDismiss}>
          {t('cancel')}
        </button>
        <button
          type="submit"
          className={request.kind === 'reset' && resetMode === 'hard' ? 'danger' : 'primary'}
          data-dialog-initial-focus={
            request.kind === 'cherryPick' || request.kind === 'revert' ? true : undefined
          }
          disabled={!actionReady || fieldDisabled}
          aria-describedby={disabledReason ? 'history-action-disabled-reason' : undefined}
        >
          {t('reviewImpact')}
        </button>
      </div>
    </Dialog>
  );
}
