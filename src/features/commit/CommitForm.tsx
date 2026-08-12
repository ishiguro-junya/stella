import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import {
  DEFAULT_COMMIT_TYPES,
  hasCommitErrors,
  validateCommitInput,
  validatePlainCommitMessage,
  type CommitFieldErrors,
} from '../../domain/commit';
import type { CommitInput, ConventionalCommitInput } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import {
  readPreferences,
  updatePreferences,
  type CommitDraft,
} from '../../persistence/preferences';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';

export interface CommitFormProps {
  disabled?: boolean;
  disabledReason?: string | undefined;
  hideDisabledReason?: boolean;
  busy?: boolean;
  draftKey?: string;
  headerActions?: ReactNode;
  showHeading?: boolean;
  labelledBy?: string | undefined;
  useConventionalCommits?: boolean | undefined;
  onAttentionRequired?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onCommitted?: (() => void) | undefined;
  onError?: ShowWorkspaceError | undefined;
  onCommit: (input: CommitInput) => Promise<void>;
}

const EMPTY_INPUT: ConventionalCommitInput = {
  type: 'feat',
  scope: '',
  breaking: false,
  description: '',
  body: '',
  footer: '',
};

type CommitField = Extract<keyof CommitFieldErrors, 'description' | 'type' | 'scope'>;

const COMMIT_FIELD_ORDER: readonly CommitField[] = ['description', 'type', 'scope'];

const ERROR_IDS: Record<CommitField, string> = {
  description: 'commit-description-error',
  type: 'commit-type-error',
  scope: 'commit-scope-error',
};

function editableCommitInput(draft?: ConventionalCommitInput): ConventionalCommitInput {
  return {
    type: draft?.type ?? 'feat',
    scope: draft?.scope ?? '',
    breaking: draft?.breaking ?? false,
    description: draft?.description ?? '',
    body: '',
    footer: '',
  };
}

function editableCommitDraft(draft?: CommitDraft): CommitDraft {
  return {
    plainMessage: draft?.plainMessage ?? '',
    conventional: editableCommitInput(draft?.conventional),
  };
}

export function CommitForm({
  disabled = false,
  disabledReason,
  hideDisabledReason = false,
  busy = false,
  draftKey,
  headerActions,
  showHeading = true,
  labelledBy,
  useConventionalCommits = false,
  onAttentionRequired,
  onCancel,
  onCommitted,
  onError,
  onCommit,
}: CommitFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CommitDraft>(() =>
    editableCommitDraft(draftKey ? readPreferences().commitDrafts[draftKey] : undefined),
  );
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<CommitField, boolean>>>({});
  const [focusRequest, setFocusRequest] = useState<{
    field: CommitField;
    sequence: number;
  }>();
  const [error, setError] = useState<WorkspaceErrorContent>();
  const formRef = useRef<HTMLFormElement>(null);
  const focusSequence = useRef(0);
  const errors = useMemo(
    () =>
      useConventionalCommits
        ? validateCommitInput(draft.conventional)
        : validatePlainCommitMessage(draft.plainMessage),
    [draft, useConventionalCommits],
  );
  const formLabelledBy = labelledBy ?? (showHeading ? 'commit-title' : undefined);

  const showsError = (field: CommitField): boolean =>
    Boolean(errors[field]) && (submitted || Boolean(touched[field]));

  useEffect(() => {
    if (!draftKey) return;
    updatePreferences((current) => ({
      ...current,
      commitDrafts: { ...current.commitDrafts, [draftKey]: draft },
    }));
  }, [draft, draftKey]);

  useEffect(() => {
    setSubmitted(false);
    setTouched({});
    setError(undefined);
  }, [useConventionalCommits]);

  useEffect(() => {
    if (!focusRequest) return;
    formRef.current
      ?.querySelector<HTMLElement>(`[data-commit-field="${focusRequest.field}"]`)
      ?.focus();
  }, [focusRequest]);

  const update = <Key extends CommitField | 'breaking'>(
    key: Key,
    value: ConventionalCommitInput[Key],
  ): void => {
    setDraft((current) => ({
      ...current,
      conventional: { ...current.conventional, [key]: value },
    }));
    if (key !== 'breaking') {
      setTouched((current) => ({ ...current, [key]: true }));
    }
    setError(undefined);
  };

  const updatePlainMessage = (value: string): void => {
    setDraft((current) => ({ ...current, plainMessage: value }));
    setTouched((current) => ({ ...current, description: true }));
    setError(undefined);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (disabled || busy) return;
    setSubmitted(true);
    if (hasCommitErrors(errors)) {
      onAttentionRequired?.();
      const fieldOrder = useConventionalCommits ? COMMIT_FIELD_ORDER : (['description'] as const);
      const firstInvalidField = fieldOrder.find((field) => Boolean(errors[field]));
      if (firstInvalidField) {
        focusSequence.current += 1;
        setFocusRequest({ field: firstInvalidField, sequence: focusSequence.current });
      }
      return;
    }
    setError(undefined);
    try {
      const normalized: CommitInput = useConventionalCommits
        ? {
            format: 'conventional',
            type: draft.conventional.type.trim(),
            breaking: draft.conventional.breaking,
            description: draft.conventional.description.trim(),
            ...(draft.conventional.scope?.trim() ? { scope: draft.conventional.scope.trim() } : {}),
          }
        : { format: 'plain', message: draft.plainMessage.trim() };
      await onCommit(normalized);
      const clearedDraft: CommitDraft = useConventionalCommits
        ? { ...draft, conventional: { ...EMPTY_INPUT } }
        : { ...draft, plainMessage: '' };
      if (draftKey) {
        updatePreferences((current) => ({
          ...current,
          commitDrafts: { ...current.commitDrafts, [draftKey]: clearedDraft },
        }));
      }
      setDraft(clearedDraft);
      setSubmitted(false);
      setTouched({});
      onCommitted?.();
    } catch (cause) {
      onAttentionRequired?.();
      if (isWorkspaceErrorHandled(cause)) return;
      if (onError) {
        onError(t('commitFailed'), cause, t('commitFailedDescription'));
        return;
      }
      setError(describeWorkspaceError(cause, t('commitFailedDescription')));
    }
  };

  return (
    <form
      ref={formRef}
      className="commit-form dialog-form"
      aria-label={formLabelledBy ? undefined : t('commit')}
      aria-labelledby={formLabelledBy}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {showHeading || headerActions ? (
        <div className={`pane-toolbar${showHeading ? '' : ' actions-only'}`}>
          {showHeading ? <h2 id="commit-title">{t('commit')}</h2> : null}
          {headerActions}
        </div>
      ) : null}

      <label className="dialog-form-field">
        <span>{t('description')}</span>
        <input
          data-commit-field="description"
          data-dialog-initial-focus
          autoComplete="off"
          value={useConventionalCommits ? draft.conventional.description : draft.plainMessage}
          aria-invalid={showsError('description')}
          aria-describedby={showsError('description') ? ERROR_IDS.description : undefined}
          onChange={(event) =>
            useConventionalCommits
              ? update('description', event.target.value)
              : updatePlainMessage(event.target.value)
          }
        />
        <small
          id={ERROR_IDS.description}
          className={`field-error commit-field-error${showsError('description') ? '' : ' is-placeholder'}`}
          aria-hidden={!showsError('description')}
        >
          {showsError('description') && errors.description ? t(errors.description) : null}
        </small>
      </label>

      {useConventionalCommits ? (
        <div className="commit-meta-grid">
          <label className="dialog-form-field">
            <span>{t('type')}</span>
            <input
              data-commit-field="type"
              list="commit-types"
              value={draft.conventional.type}
              aria-invalid={showsError('type')}
              aria-describedby={showsError('type') ? ERROR_IDS.type : undefined}
              onChange={(event) => update('type', event.target.value)}
            />
            <datalist id="commit-types">
              {DEFAULT_COMMIT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </datalist>
            <small
              id={ERROR_IDS.type}
              className={`field-error commit-field-error${showsError('type') ? '' : ' is-placeholder'}`}
              aria-hidden={!showsError('type')}
            >
              {showsError('type') && errors.type ? t(errors.type) : null}
            </small>
          </label>

          <label className="dialog-form-field">
            <span>{t('scope')}</span>
            <input
              data-commit-field="scope"
              value={draft.conventional.scope ?? ''}
              aria-invalid={showsError('scope')}
              aria-describedby={showsError('scope') ? ERROR_IDS.scope : undefined}
              onChange={(event) => update('scope', event.target.value)}
            />
            <small
              id={ERROR_IDS.scope}
              className={`field-error commit-field-error${showsError('scope') ? '' : ' is-placeholder'}`}
              aria-hidden={!showsError('scope')}
            >
              {showsError('scope') && errors.scope ? t(errors.scope) : null}
            </small>
          </label>
        </div>
      ) : null}

      {useConventionalCommits ? (
        <label className="checkbox-field commit-breaking">
          <input
            type="checkbox"
            checked={draft.conventional.breaking}
            onChange={(event) => update('breaking', event.target.checked)}
          />
          <span>{t('breakingChange')}</span>
        </label>
      ) : null}

      {error ? (
        <div className="inline-alert error" role="alert">
          <WorkspaceErrorDetails error={error} />
        </div>
      ) : null}
      {disabled && disabledReason ? (
        <output
          id="commit-disabled-reason"
          className={`commit-disabled-reason${hideDisabledReason ? ' sr-only' : ''}`}
        >
          {disabledReason}
        </output>
      ) : null}

      <div className="commit-submit dialog-form-actions button-row end">
        {onCancel ? (
          <button type="button" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </button>
        ) : null}
        <button
          type="submit"
          className={`primary${onCancel ? '' : ' full'}`}
          title={disabledReason}
          aria-describedby={disabled && disabledReason ? 'commit-disabled-reason' : undefined}
          disabled={disabled || busy}
        >
          {busy ? t('committing') : t('commit')}
        </button>
      </div>
    </form>
  );
}
