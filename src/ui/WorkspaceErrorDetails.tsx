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
  const error = cause instanceof Error ? cause : new Error(fallback);
  if (!(error instanceof WorkspaceAdapterError)) return { message: error.message };
  return {
    message: error.message,
    ...(error.localizedMessage ? { localizedMessage: error.localizedMessage } : {}),
    ...(error.details.stderr ? { stderr: error.details.stderr } : {}),
    ...(error.details.stdout ? { stdout: error.details.stdout } : {}),
    ...(error.details.exitCode ? { exitCode: error.details.exitCode } : {}),
  };
}

export function WorkspaceErrorDetails({ error }: { error: WorkspaceErrorContent }) {
  const { t, message } = useI18n();
  const hasOutput = Boolean(error.stderr || error.stdout || error.exitCode);
  return (
    <>
      <span>{error.localizedMessage ? message(error.localizedMessage) : error.message}</span>
      {hasOutput ? (
        <details className="notice-output">
          <summary>{t('showGitOutput')}</summary>
          {error.exitCode ? <p>{t('exitCode', { code: error.exitCode })}</p> : null}
          {error.stderr ? <pre aria-label="stderr">{error.stderr}</pre> : null}
          {error.stdout ? <pre aria-label="stdout">{error.stdout}</pre> : null}
        </details>
      ) : null}
    </>
  );
}
