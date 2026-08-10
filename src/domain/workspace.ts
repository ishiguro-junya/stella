import type { LocalizedMessage } from '../i18n/i18n';

export type RepoId = string;
export type Generation = number;

export type WorkspaceView = 'changes' | 'history';
export type ActivityRange = '7d' | '30d' | '90d' | '180d' | '1y';
export type ChangeArea = 'conflicted' | 'staged' | 'unstaged' | 'untracked';
export type DiffStyle = 'unified' | 'split';

export interface BranchStatus {
  name: string | null;
  detached: boolean;
  oid?: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface ChangeEntry {
  path: string;
  previousPath?: string;
  area: ChangeArea;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary' | 'conflicted';
  additions?: number;
  deletions?: number;
  conflictKind?: string;
}

export interface DiffDocument {
  diffId: string;
  repoId: RepoId;
  path: string;
  area: ChangeArea;
  generation: Generation;
  patch: string;
  binary?: boolean;
  tooLarge?: boolean;
  truncated?: boolean;
}

export interface DiffSelection {
  diffId: string;
  path: string;
  generation: Generation;
  side: 'additions' | 'deletions';
  startLine: number;
  endLine: number;
}

export interface CommitSummary {
  oid: string;
  shortOid: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  parents: string[];
  refs: string[];
  lane: number;
}

export interface CommitDetails extends CommitSummary {
  body?: string;
  authorEmail?: string;
  committedAt?: string;
  diff?: DiffDocument;
}

export interface BranchSummary {
  fullName: string;
  shortName: string;
  oid: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
}

export type OperationState =
  | { kind: 'none' }
  | {
      kind:
        | 'merge'
        | 'rebase'
        | 'cherryPick'
        | 'revert'
        | 'unknown'
        | 'pendingStructuredCommit'
        | 'structuredAbortRecovery';
      label: LocalizedMessage;
      unresolvedCount: number;
      canContinue: boolean;
      canSkip: boolean;
      canAbort: boolean;
    };

export interface RepoSnapshot {
  repoId: RepoId;
  name: string;
  path: string;
  generation: Generation;
  eventSeq: number;
  branch: BranchStatus;
  operation: OperationState;
  changes: ChangeEntry[];
  history: CommitSummary[];
  selectedPath?: string;
  selectedCommitOid?: string;
}

export interface ActivityEntry {
  id: string;
  repoId: RepoId;
  repositoryName: string;
  action: LocalizedMessage;
  summary: LocalizedMessage;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  detailAvailability: 'currentSession' | 'summaryOnly';
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  cancellable?: boolean;
  eventSeq?: number;
}

export interface CommitActivityBucket {
  startUnixSeconds: number;
  endUnixSeconds: number;
  commitCount: number;
}

export interface CommitActivitySeries {
  repoId: RepoId;
  repoGeneration: Generation;
  historyRevision: string;
  timeBasis: 'committed';
  totals: {
    commits: number;
    activeDays: number;
    contributors: number;
    branches: number;
  };
  buckets: CommitActivityBucket[];
  coverage: { kind: 'complete' } | { kind: 'truncated'; scanLimit: number };
}

export interface WorkspaceSnapshot {
  repos: RepoSnapshot[];
  selectedRepoId?: RepoId;
  activities: ActivityEntry[];
}

export type ConflictOperation = 'merge' | 'rebase' | 'cherryPick' | 'revert';

export interface ConflictSide {
  oid: string;
  mode: string;
  text?: string;
}

export type ConflictKind =
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

export interface ConflictCapabilities {
  inAppEdit: boolean;
  performanceView: boolean;
  chooseCurrent: boolean;
  chooseIncoming: boolean;
  chooseBoth: boolean;
  delete: boolean;
  externalEditor: boolean;
}

export type ConflictBlockState = 'unresolved' | 'current' | 'incoming' | 'both' | 'manual';

export interface ConflictBlock {
  id: string;
  rangeUtf16: {
    from: number;
    to: number;
  };
  replacements: {
    current: string;
    incoming: string;
    both: string;
  };
  state: ConflictBlockState;
}

export interface ConflictDocument {
  sessionId: string;
  repoId: RepoId;
  path: string;
  operation: ConflictOperation;
  conflictGeneration: string;
  contentHash: string;
  documentRevision: string;
  labels: {
    current: LocalizedMessage;
    incoming: LocalizedMessage;
  };
  sides: {
    base: ConflictSide | null;
    current: ConflictSide | null;
    incoming: ConflictSide | null;
  };
  result: {
    text: string;
    lineEnding: 'lf' | 'crlf';
  };
  blocks: ConflictBlock[];
  kind: ConflictKind;
  capabilities: ConflictCapabilities;
  relatedPaths: string[];
}

export type ConflictChoice = 'current' | 'incoming' | 'both' | 'delete';
export type FileOperation = 'moveToTrash' | 'revealInFinder' | 'openInDefaultApp';

export interface ConventionalCommitInput {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
  body?: string;
  footer?: string;
}

export type WorkspaceAction =
  | { kind: 'stageFiles'; paths: string[] }
  | { kind: 'unstageFiles'; paths: string[] }
  | { kind: 'discardFile'; path: string; area: ChangeArea }
  | { kind: 'stageSelection'; selection: DiffSelection }
  | { kind: 'unstageSelection'; selection: DiffSelection }
  | { kind: 'discardSelection'; selection: DiffSelection }
  | { kind: 'commit'; input: ConventionalCommitInput }
  | { kind: 'fetch' }
  | { kind: 'pullFastForward' }
  | { kind: 'push' }
  | { kind: 'createBranch'; name: string; startOid: string }
  | { kind: 'checkoutBranch'; name: string }
  | { kind: 'merge'; sourceRef: string }
  | { kind: 'rebase'; ontoRef: string }
  | { kind: 'cherryPick'; oid: string; mainline?: number }
  | { kind: 'revert'; oid: string; mainline?: number }
  | { kind: 'reset'; oid: string; mode: 'soft' | 'mixed' | 'hard' }
  | { kind: 'continueOperation' }
  | { kind: 'skipOperation' }
  | { kind: 'abortOperation' }
  | {
      kind: 'conflictChoice';
      sessionId: string;
      path: string;
      blockId: string;
      choice: ConflictChoice;
      draftText: string;
      contentHash: string;
      documentRevision: string;
      baseDocumentRevision: string;
    }
  | {
      kind: 'saveConflict';
      sessionId: string;
      path: string;
      draftText: string;
      contentHash: string;
      documentRevision: string;
    }
  | {
      kind: 'markConflictResolved';
      sessionId: string;
      path: string;
      contentHash: string;
    }
  | {
      kind: 'materializeConflict';
      sessionId: string;
      choice: ConflictChoice;
    }
  | { kind: 'openExternal'; path: string }
  | { kind: 'fileAction'; path: string; operation: FileOperation };

export type AttachRequest =
  | { kind: 'open'; path: string }
  | { kind: 'openExisting'; path: string }
  | { kind: 'clone'; remoteUrl: string; destination: string };

export type WorkspaceQuery =
  | { kind: 'snapshot'; repoId: RepoId }
  | { kind: 'diff'; repoId: RepoId; path: string; area: ChangeArea }
  | { kind: 'history'; repoId: RepoId; limit: number; skip: number }
  | { kind: 'commitDetails'; repoId: RepoId; oid: string }
  | { kind: 'branches'; repoId: RepoId }
  | { kind: 'conflict'; repoId: RepoId; path: string }
  | { kind: 'activity'; repoId?: RepoId }
  | {
      kind: 'commitActivity';
      repoId: RepoId;
      bucketBoundariesUnixSeconds: number[];
    };

export type QueryResult =
  | { kind: 'snapshot'; snapshot: RepoSnapshot }
  | { kind: 'diff'; diff: DiffDocument }
  | { kind: 'history'; commits: CommitSummary[] }
  | { kind: 'commitDetails'; commit: CommitDetails }
  | { kind: 'branches'; branches: BranchSummary[] }
  | { kind: 'conflict'; document: ConflictDocument }
  | { kind: 'activity'; entries: ActivityEntry[] }
  | { kind: 'commitActivity'; series: CommitActivitySeries };

export interface ActionRequest {
  repoId: RepoId;
  action: WorkspaceAction;
  preview?: ActionPreview;
}

export interface ActionPreview {
  repoId: RepoId;
  title: LocalizedMessage;
  summary: LocalizedMessage;
  affectedPaths: string[];
  affectedCommits: string[];
  lostCommitOids: string[];
  resolvedTargets: Array<{ input: string; oid: string }>;
  destructive: boolean;
  remoteEffect?: LocalizedMessage;
  typedConfirmation?: string;
}

export interface ActionOutcome {
  repoId: RepoId;
  generation: Generation;
  summary: LocalizedMessage;
  activityId?: string;
  snapshot?: RepoSnapshot;
  conflictDocument?: ConflictDocument;
}

export interface CancelRequest {
  repoId: RepoId;
  activityId: string;
}

export type WorkspaceEvent =
  | { kind: 'snapshotChanged'; snapshot: RepoSnapshot }
  | { kind: 'activityChanged'; activity: ActivityEntry }
  | { kind: 'conflictChanged'; document: ConflictDocument }
  | { kind: 'repositoryRemoved'; repoId: RepoId }
  | {
      kind: 'notice';
      repoId?: RepoId;
      level: 'info' | 'warning' | 'error';
      message: LocalizedMessage;
    };

export function isConflictResolved(document: Pick<ConflictDocument, 'blocks'>): boolean {
  return document.blocks.every((block) => block.state !== 'unresolved');
}

export function selectedRepo(snapshot: WorkspaceSnapshot): RepoSnapshot | undefined {
  return (
    snapshot.repos.find((repo) => repo.repoId === snapshot.selectedRepoId) ?? snapshot.repos[0]
  );
}
