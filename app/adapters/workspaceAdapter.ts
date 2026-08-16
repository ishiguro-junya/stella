import type {
  ActionOutcome,
  ActionPreview,
  ActionRequest,
  AttachRequest,
  CancelRequest,
  QueryResult,
  WorkspaceEvent,
  WorkspaceQuery,
  WorkspaceSnapshot,
} from '../domain/workspace';
import type { LocalizedMessage } from '../i18n/i18n';

export interface WorkspaceAdapter {
  attach: (request: AttachRequest) => Promise<WorkspaceSnapshot>;
  query: (request: WorkspaceQuery, options?: WorkspaceQueryOptions) => Promise<QueryResult>;
  preview: (request: ActionRequest) => Promise<ActionPreview>;
  execute: (request: ActionRequest) => Promise<ActionOutcome>;
  cancel: (request: CancelRequest) => Promise<void>;
  detach?: (repoId: string) => Promise<void>;
  deleteRepository?: (path: string) => Promise<void>;
  subscribe: (onEvent: (event: WorkspaceEvent) => void) => Promise<() => void>;
}

export interface WorkspaceQueryOptions {
  signal?: AbortSignal;
}

export class WorkspaceAdapterError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, string>>;
  readonly localizedMessage?: LocalizedMessage;

  constructor(
    code: string,
    message: string,
    details: Readonly<Record<string, string>> = {},
    localizedMessage?: LocalizedMessage,
  ) {
    super(message);
    this.name = 'WorkspaceAdapterError';
    this.code = code;
    this.details = details;
    if (localizedMessage) this.localizedMessage = localizedMessage;
  }
}

export function isPullDivergenceError(cause: unknown): boolean {
  return cause instanceof WorkspaceAdapterError && cause.code === 'pullDiverged';
}
