import { WorkspaceAdapterError } from '../adapters/workspaceAdapter';
import { useI18n, type LocalizedMessage } from '../i18n/i18n';

export interface WorkspaceErrorContent {
  message: string;
  localizedMessage?: LocalizedMessage;
  stderr?: string;
  stdout?: string;
  exitCode?: string;
}

export function describeWorkspaceError(cause: unknown, fallback: string): WorkspaceErrorContent {
  if (!(cause instanceof WorkspaceAdapterError)) return { message: fallback };
  return {
    message: fallback,
    ...(cause.localizedMessage ? { localizedMessage: cause.localizedMessage } : {}),
    ...(cause.details.stderr ? { stderr: cause.details.stderr } : {}),
    ...(cause.details.stdout ? { stdout: cause.details.stdout } : {}),
    ...(cause.details.exitCode ? { exitCode: cause.details.exitCode } : {}),
  };
}

export function WorkspaceErrorDetails({ error }: { error: WorkspaceErrorContent }) {
  const { t, message } = useI18n();
  const hasOutput = Boolean(error.stderr || error.stdout || error.exitCode);
  return (
    <div className="workspace-error-details">
      <span className="workspace-error-message">
        {error.localizedMessage ? message(error.localizedMessage) : error.message}
      </span>
      {hasOutput ? (
        <div className="notice-output">
          {error.exitCode ? (
            <p className="notice-output-exit-code">{t('exitCode', { code: error.exitCode })}</p>
          ) : null}
          {error.stderr || error.stdout ? (
            <div className="notice-output-streams">
              {error.stderr ? <pre aria-label="stderr">{error.stderr}</pre> : null}
              {error.stdout ? <pre aria-label="stdout">{error.stdout}</pre> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
