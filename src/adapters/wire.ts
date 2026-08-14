import type { Channel } from '@tauri-apps/api/core';
import type { LocalizedMessage } from '../i18n/i18n';

export type WireOpenRequest =
  | { kind: 'open'; path: string }
  | { kind: 'openExisting'; path: string }
  | { kind: 'clone'; remote: string; destination: string; operationId: string };

export interface WireWorkspaceSession {
  repoId: string;
  snapshot: WireRepoSnapshot;
}

export interface WireAttachArgs {
  request: WireOpenRequest;
  onEvent: Channel<WireWorkspaceEvent>;
}

export interface WireQueryRequest {
  repoId: string;
  query: WireQuery;
}

export type WireQuery =
  | { kind: 'repositoryAvailability'; path: string }
  | { kind: 'status' }
  | { kind: 'diff'; target: WireDiffTarget; paths: string[] }
  | { kind: 'history'; limit: number; skip: number; search?: string }
  | { kind: 'branches' }
  | { kind: 'gitFlowOverview' }
  | { kind: 'commitDetails'; oid: string }
  | { kind: 'conflict'; path: string }
  | { kind: 'fileContents'; path: string }
  | { kind: 'remotes' }
  | {
      kind: 'commitActivity';
      operationId: string;
      bucketBoundariesUnixSeconds: number[];
    };

export type WireDiffTarget = 'unstaged' | 'staged' | 'head';

export type WireQueryOutcome =
  | {
      kind: 'repositoryAvailability';
      data: {
        path: string;
        availability: 'available' | 'missing' | 'notRepository' | 'inaccessible';
      };
    }
  | { kind: 'status'; data: WireRepoSnapshot }
  | { kind: 'diff'; data: WireDiffResult }
  | { kind: 'history'; data: WireHistoryResult }
  | { kind: 'branches'; data: WireBranchResult }
  | { kind: 'gitFlowOverview'; data: WireGitFlowOverview }
  | { kind: 'commitDetails'; data: WireCommitDetails }
  | { kind: 'conflict'; data: WireConflictDocument }
  | { kind: 'fileContents'; data: WireFileDocument }
  | { kind: 'remotes'; data: WireRemoteResult }
  | { kind: 'commitActivity'; data: WireCommitActivitySeries };

export interface WirePreviewRequest {
  repoId: string;
  expectedGeneration: number;
  action: WireAction;
}

export interface WirePreviewOutcome {
  confirmationToken: string | null;
  expiresAtUnixMs: number | null;
  summary: LocalizedMessage;
  destructive: boolean;
  affectedPaths: string[];
  affectedCommits: string[];
  remoteEffect: LocalizedMessage | null;
  resolvedTargets?: Array<{ input: string; oid: string }>;
  impactDigest?: string;
  lostCommitOids?: string[];
}

export interface WireExecuteRequest {
  operationId: string;
  repoId: string;
  expectedGeneration: number;
  action: WireAction;
  confirmationToken: string | null;
}

export interface WireCancelRequest {
  operationId: string;
}

export interface WireActionOutcome {
  operationId: string;
  summary: LocalizedMessage;
  repoGeneration: number;
  eventSeq: number;
  snapshot: WireRepoSnapshot;
  command: WireCommandActivity;
  conflictEdit?: WireConflictEditResult;
  conflictDocument?: WireConflictDocument;
}

interface WireSelectionBase {
  path: string;
  diffRevision: string;
}

export interface WireLineSelection extends WireSelectionBase {
  kind: 'lines';
  side: 'additions' | 'deletions';
  startLine: number;
  endLine: number;
}

export interface WireHunkSelection extends WireSelectionBase {
  kind: 'hunk';
  hunkIndex: number;
}

export type WirePatchSelection = WireLineSelection | WireHunkSelection;

export type WireAction =
  | { kind: 'stage'; paths: string[]; selection: WirePatchSelection | null }
  | { kind: 'unstage'; paths: string[]; selection: WirePatchSelection | null }
  | {
      kind: 'discard';
      paths: string[];
      target: 'unstaged' | 'untracked';
      selection: WirePatchSelection | null;
    }
  | { kind: 'commit'; input: WireCommitInput; includeAllChanges: boolean }
  | { kind: 'fetch'; remote: string }
  | { kind: 'pull'; remote: string; remoteBranch: string }
  | {
      kind: 'push';
      remote: string;
      localBranch: string;
      remoteBranch: string;
      setUpstream: boolean;
      forceWithLease: boolean;
      pushTags: boolean;
    }
  | {
      kind: 'setRemoteUrl';
      remote: string;
      urlKind: 'fetch' | 'push';
      expectedUrl: string;
      newUrl: string;
    }
  | { kind: 'createBranch'; name: string; startPoint: string; checkout: boolean }
  | { kind: 'deleteBranch'; name: string }
  | { kind: 'createTag'; name: string; target: string }
  | { kind: 'gitFlow'; request: WireGitFlowRequest }
  | { kind: 'checkout'; branch: string }
  | { kind: 'merge'; source: string; commitImmediately: boolean }
  | { kind: 'rebase'; onto: string }
  | { kind: 'cherryPick'; commit: string; mainline: number | null }
  | { kind: 'revert'; commit: string; mainline: number | null }
  | { kind: 'reset'; commit: string; mode: 'soft' | 'mixed' | 'hard' }
  | { kind: 'continue' }
  | { kind: 'skip' }
  | { kind: 'abort' }
  | {
      kind: 'conflictSave';
      sessionId: string;
      conflictGeneration: string;
      contentHash: string;
      result: string;
    }
  | {
      kind: 'conflictChoice';
      sessionId: string;
      conflictGeneration: string;
      contentHash: string;
      documentRevision: string;
      baseDocumentRevision: string;
      blockId: string;
      draftText: string;
      choice: 'current' | 'incoming' | 'both' | 'delete';
    }
  | {
      kind: 'conflictMarkResolved';
      sessionId: string;
      conflictGeneration: string;
      contentHash: string;
      resultKind: 'file' | 'delete';
    }
  | {
      kind: 'conflictMaterialize';
      sessionId: string;
      conflictGeneration: string;
      choice: 'current' | 'incoming' | 'both' | 'delete';
    }
  | {
      kind: 'conflictOpenExternal';
      sessionId: string;
      conflictGeneration: string;
      editor: { kind: 'systemDefault' };
    }
  | { kind: 'saveFile'; path: string; text: string; expectedContentHash: string }
  | {
      kind: 'fileAction';
      paths: string[];
      operation: 'moveToTrash' | 'revealInFinder' | 'openInDefaultApp';
    };

export type WireCommitInput =
  | { format: 'plain'; message: string }
  | {
      format: 'conventional';
      type: string;
      scope: string | null;
      breaking: boolean;
      description: string;
      body: string | null;
      footers: Array<{ token: string; value: string }>;
    };

export interface WireRepoSnapshot {
  repoId: string;
  root: string;
  head:
    | { kind: 'branch'; name: string; oid: string | null }
    | { kind: 'detached'; oid: string }
    | { kind: 'unborn'; name: string };
  upstream: string | null;
  ahead: number;
  behind: number;
  additions?: number | null;
  deletions?: number | null;
  entries: WireStatusEntry[];
  operation: WireOperationState;
  gitFlowOperation?: string | null;
  repoGeneration: number;
  eventSeq: number;
}

export interface WireRemoteResult {
  remotes: Array<{ name: string; fetchUrls: string[]; pushUrls: string[] }>;
  repoGeneration: number;
}

export interface WireStatusEntry {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  conflict: boolean;
  untracked: boolean;
  submodule: string;
}

export interface WireFileDocument {
  repoId: string;
  path: string;
  text: string;
  lineEnding: 'lf' | 'crlf';
  hasUtf8Bom: boolean;
  contentHash: string;
  repoGeneration: number;
}

export type WireOperationState =
  | { kind: 'none' }
  | { kind: 'merge'; incomingOid: string | null }
  | { kind: 'rebase' }
  | { kind: 'cherryPick'; sourceOid: string | null }
  | { kind: 'revert'; sourceOid: string | null }
  | { kind: 'unknown'; marker: string }
  | {
      kind: 'pendingStructuredCommit';
      operation: 'cherryPick' | 'revert';
      sourceOid: string;
      preHeadOid: string;
    }
  | {
      kind: 'structuredAbortRecovery';
      operation: 'cherryPick' | 'revert';
      sourceOid: string;
      preHeadOid: string;
    };

export interface WireDiffResult {
  patch: string;
  diffRevision: string;
  repoGeneration: number;
  truncated: boolean;
}

export interface WireHistoryResult {
  commits: WireCommitSummary[];
  repoGeneration: number;
}

export interface WireCommitSummary {
  oid: string;
  parents: string[];
  refs: string[];
  author: string;
  authoredAt: string;
  subject: string;
}

export interface WireCommitDetails extends WireCommitSummary {
  authorEmail: string;
  body: string;
  patch: string;
  truncated: boolean;
  diffRevision: string;
  repoGeneration: number;
}

export interface WireBranchResult {
  branches: Array<{
    fullName: string;
    shortName: string;
    oid: string;
    current: boolean;
    remote: boolean;
    upstream: string | null;
  }>;
  repoGeneration: number;
}

export interface WireGitFlowOverview {
  initialized: boolean;
  available: boolean;
  raw: unknown;
  output: string;
  repoGeneration: number;
}

export interface WireGitFlowRequest {
  command:
    | 'init'
    | 'start'
    | 'list'
    | 'checkout'
    | 'update'
    | 'publish'
    | 'track'
    | 'rename'
    | 'delete'
    | 'finish'
    | 'integrate'
    | 'configList'
    | 'configAddBase'
    | 'configAddTopic'
    | 'configEditBase'
    | 'configEditTopic'
    | 'configRenameBase'
    | 'configRenameTopic'
    | 'configDeleteBase'
    | 'configDeleteTopic'
    | 'configStatus'
    | 'configSync'
    | 'continue'
    | 'abort';
  topicType?: string;
  name?: string;
  secondaryName?: string;
  parent?: string;
  base?: string;
  preset?: 'classic' | 'github' | 'gitlab' | 'custom';
  shared?: boolean;
  fetch?: boolean;
  remote?: boolean;
  tagName?: string;
  tagMessage?: string;
  sign?: boolean;
  signingKey?: string;
  keep?: boolean;
  push?: boolean;
  strategy?: 'merge' | 'rebase' | 'squash';
  prefix?: string;
  startingPoint?: string;
  autoUpdate?: boolean;
  tag?: boolean;
}

export interface WireCommitActivitySeries {
  repoGeneration: number;
  historyRevision: string;
  timeBasis: 'committed';
  totals: {
    commits: number;
    activeDays: number;
    contributors: number;
    branches: number;
  };
  buckets: Array<{
    startUnixSeconds: number;
    endUnixSeconds: number;
    commitCount: number;
    contributorCount: number;
    branchCount: number;
  }>;
  coverage: { kind: 'complete' } | { kind: 'truncated'; scanLimit: number };
}

export interface WireCommandActivity {
  argv: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
}

export interface WireWorkspaceEvent {
  repoId: string;
  eventSeq: number;
  repoGeneration: number;
  operationId: string | null;
  phase: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
  summary: LocalizedMessage;
  details?: Record<string, string>;
}

export interface WireConflictDocument {
  sessionId: string;
  repoId: string;
  path: string;
  operation: 'merge' | 'rebase' | 'cherryPick' | 'revert';
  conflictGeneration: string;
  contentHash: string;
  labels: { current: LocalizedMessage; incoming: LocalizedMessage };
  sides: {
    base: WireConflictSide | null;
    current: WireConflictSide | null;
    incoming: WireConflictSide | null;
  };
  result: { text: string; lineEnding: 'lf' | 'crlf' };
  blocks: WireConflictBlock[];
  kind:
    | 'text'
    | 'addAdd'
    | 'modifyDelete'
    | 'binary'
    | 'nonUtf8'
    | 'nul'
    | 'oversize'
    | 'renameRename'
    | 'symlink'
    | 'submodule'
    | 'directoryFile';
  capabilities: {
    inAppEdit: boolean;
    performanceView: boolean;
    chooseCurrent: boolean;
    chooseIncoming: boolean;
    chooseBoth: boolean;
    delete: boolean;
    externalEditor: boolean;
  };
  relatedPaths: string[];
}

export interface WireConflictSide {
  oid: string;
  mode: string;
  text: string | null;
}

export interface WireConflictBlock {
  id: string;
  rangeUtf16: { from: number; to: number };
  replacements: { current: string; incoming: string; both: string };
  state: 'unresolved' | 'current' | 'incoming' | 'both' | 'manual';
}

export interface WireConflictEditResult {
  text: string;
  blocks: WireConflictBlock[];
  documentRevision: string;
}
