import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import {
  DEFAULT_COMMIT_TYPES,
  hasCommitErrors,
  validateCommitInput,
  type CommitFieldErrors,
} from '../../domain/commit';
import type { ConventionalCommitInput } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { readPreferences, updatePreferences } from '../../persistence/preferences';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';

export interface CommitFormProps {
  disabled?: boolean;
  disabledReason?: string | undefined;
  busy?: boolean;
  draftKey?: string;
  headerActions?: ReactNode;
  showHeading?: boolean;
  labelledBy?: string | undefined;
  onAttentionRequired?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onCommitted?: (() => void) | undefined;
  onError?: ShowWorkspaceError | undefined;
  onCommit: (input: ConventionalCommitInput) => Promise<void>;
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

export function CommitForm({
  disabled = false,
  disabledReason,
  busy = false,
  draftKey,
  headerActions,
  showHeading = true,
  labelledBy,
  onAttentionRequired,
  onCancel,
  onCommitted,
  onError,
  onCommit,
}: CommitFormProps) {
  const { t } = useI18n();
  const [input, setInput] = useState<ConventionalCommitInput>(() =>
    draftKey ? editableCommitInput(readPreferences().commitDrafts[draftKey]) : { ...EMPTY_INPUT },
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
  const errors = useMemo(() => validateCommitInput(input), [input]);
  const formLabelledBy = labelledBy ?? (showHeading ? 'commit-title' : undefined);

  const showsError = (field: CommitField): boolean =>
    Boolean(errors[field]) && (submitted || Boolean(touched[field]));

  useEffect(() => {
    if (!draftKey) return;
    updatePreferences((current) => ({
      ...current,
      commitDrafts: { ...current.commitDrafts, [draftKey]: input },
    }));
  }, [draftKey, input]);

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
    setInput((current) => ({ ...current, [key]: value }));
    if (key !== 'breaking') {
      setTouched((current) => ({ ...current, [key]: true }));
    }
    setError(undefined);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (disabled || busy) return;
    setSubmitted(true);
    if (hasCommitErrors(errors)) {
      onAttentionRequired?.();
      const firstInvalidField = COMMIT_FIELD_ORDER.find((field) => Boolean(errors[field]));
      if (firstInvalidField) {
        focusSequence.current += 1;
        setFocusRequest({ field: firstInvalidField, sequence: focusSequence.current });
      }
      return;
    }
    setError(undefined);
    try {
      const normalized: ConventionalCommitInput = {
        type: input.type.trim(),
        breaking: input.breaking,
        description: input.description.trim(),
        ...(input.scope?.trim() ? { scope: input.scope.trim() } : {}),
      };
      await onCommit(normalized);
      if (draftKey) {
        updatePreferences((current) => ({
          ...current,
          commitDrafts: { ...current.commitDrafts, [draftKey]: { ...EMPTY_INPUT } },
        }));
      }
      setInput({ ...EMPTY_INPUT });
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
      className="commit-form"
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

      <label>
        <span>{t('description')}</span>
        <input
          data-commit-field="description"
          data-dialog-initial-focus
          autoComplete="off"
          value={input.description}
          aria-invalid={showsError('description')}
          aria-describedby={showsError('description') ? ERROR_IDS.description : undefined}
          onChange={(event) => update('description', event.target.value)}
          placeholder={t('commitDescriptionPlaceholder')}
        />
        {showsError('description') ? (
          <small id={ERROR_IDS.description} className="field-error">
            {errors.description ? t(errors.description) : null}
          </small>
        ) : null}
      </label>

      <div className="commit-meta-grid">
        <label>
          <span>{t('type')}</span>
          <input
            data-commit-field="type"
            list="commit-types"
            value={input.type}
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
          {showsError('type') ? (
            <small id={ERROR_IDS.type} className="field-error">
              {errors.type ? t(errors.type) : null}
            </small>
          ) : null}
        </label>

        <label>
          <span>Scope</span>
          <input
            data-commit-field="scope"
            value={input.scope ?? ''}
            aria-invalid={showsError('scope')}
            aria-describedby={showsError('scope') ? ERROR_IDS.scope : undefined}
            onChange={(event) => update('scope', event.target.value)}
          />
          {showsError('scope') ? (
            <small id={ERROR_IDS.scope} className="field-error">
              {errors.scope ? t(errors.scope) : null}
            </small>
          ) : null}
        </label>
      </div>

      <label className="checkbox-field commit-breaking">
        <input
          type="checkbox"
          checked={input.breaking}
          onChange={(event) => update('breaking', event.target.checked)}
        />
        <span>{t('breakingChange')}</span>
      </label>

      {error ? (
        <div className="inline-alert error" role="alert">
          <WorkspaceErrorDetails error={error} />
        </div>
      ) : null}
      {disabled && disabledReason ? (
        <output id="commit-disabled-reason" className="commit-disabled-reason">
          {disabledReason}
        </output>
      ) : null}

      <div className="commit-submit button-row end">
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
