import { Channel, invoke } from '@tauri-apps/api/core';

import type {
  ActionOutcome,
  ActionPreview,
  ActionRequest,
  ActivityEntry,
  AttachRequest,
  BranchStatus,
  ChangeArea,
  ChangeEntry,
  CommitSummary,
  CommitDetails,
  CommitActivitySeries,
  ConflictBlock,
  ConflictDocument,
  ConflictSide,
  CommitInput,
  DiffSelection,
  QueryResult,
  RepoSnapshot,
  WorkspaceAction,
  WorkspaceEvent,
  WorkspaceQuery,
} from '../domain/workspace';
import { profileDiffPatch } from '../domain/diffProfile';
import { assignHistoryLanes, HISTORY_PAGE_SIZE } from '../domain/historyLanes';
import {
  mergeActivityEntries,
  persistTerminalActivities,
  readPersistedActivities,
} from '../features/activity/activityPersistence';
import { isLocalizedMessage, type LocalizedMessage } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { WorkspaceAdapterError, type WorkspaceAdapter } from './workspaceAdapter';
import type {
  WireAction,
  WireActionOutcome,
  WireCommitSummary,
  WireCommitDetails,
  WireConflictBlock,
  WireConflictDocument,
  WireConflictEditResult,
  WireConflictSide,
  WireHistoryResult,
  WireOpenRequest,
  WirePatchSelection,
  WirePreviewOutcome,
  WireQuery,
  WireQueryOutcome,
  WireRepoSnapshot,
  WireStatusEntry,
  WireWorkspaceEvent,
  WireWorkspaceSession,
} from './wire';

type Subscriber = (event: WorkspaceEvent) => void;

interface AdapterState {
  readonly subscribers: Set<Subscriber>;
  readonly repos: Map<string, RepoSnapshot>;
  readonly wireHistories: Map<string, WireCommitSummary[]>;
  readonly histories: Map<string, CommitSummary[]>;
  readonly headOids: Map<string, string | null>;
  readonly conflicts: Map<string, ConflictDocument>;
  readonly activities: Map<string, ActivityEntry>;
  readonly activityTitles: Map<string, LocalizedMessage>;
  readonly activityRepositoryNames: Map<string, string>;
  readonly channels: Map<string, Channel<WireWorkspaceEvent>>;
  readonly previewBindings: WeakMap<ActionPreview, PreviewBinding>;
}

interface PreviewBinding {
  readonly repoId: string;
  readonly expectedGeneration: number;
  readonly confirmationToken?: string;
}

function repoName(root: string): string {
  return root.replace(/\/$/u, '').split('/').at(-1) || root;
}

function localized(id: MessageKey, args?: LocalizedMessage['args']): LocalizedMessage {
  return args ? { id, args } : { id };
}

function headOid(snapshot: WireRepoSnapshot): string | null {
  return snapshot.head.kind === 'unborn' ? null : snapshot.head.oid;
}

function isOlderSnapshot(
  current: RepoSnapshot,
  incoming: Pick<WireRepoSnapshot, 'repoGeneration' | 'eventSeq'>,
): boolean {
  return (
    incoming.repoGeneration < current.generation ||
    (incoming.repoGeneration === current.generation && incoming.eventSeq < current.eventSeq)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function normalizeWorkspaceError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (typeof cause === 'string')
    return new WorkspaceAdapterError('internal', 'The workspace operation failed.', {
      stderr: cause,
    });
  if (isRecord(cause)) {
    const code = typeof cause.code === 'string' ? cause.code : 'internal';
    const message =
      typeof cause.message === 'string' ? cause.message : 'The workspace operation failed.';
    return new WorkspaceAdapterError(
      code,
      message,
      stringRecord(cause.details),
      isLocalizedMessage(cause.localizedMessage) ? cause.localizedMessage : undefined,
    );
  }
  return new WorkspaceAdapterError('internal', 'The workspace operation failed.');
}

async function invokeWorkspace<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw normalizeWorkspaceError(cause);
  }
}

function statusKind(code: string): ChangeEntry['status'] {
  if (code.includes('A') || code === '?') return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R') || code.includes('C')) return 'renamed';
  return 'modified';
}

function statusEntry(entry: WireStatusEntry): ChangeEntry[] {
  const base = {
    path: entry.path,
    ...(entry.originalPath ? { previousPath: entry.originalPath } : {}),
  };
  if (entry.conflict) return [{ ...base, area: 'conflicted', status: 'conflicted' }];
  if (entry.untracked) return [{ ...base, area: 'untracked', status: 'added' }];

  const changes: ChangeEntry[] = [];
  if (entry.indexStatus !== '.' && entry.indexStatus !== ' ') {
    changes.push({ ...base, area: 'staged', status: statusKind(entry.indexStatus) });
  }
  if (entry.worktreeStatus !== '.' && entry.worktreeStatus !== ' ') {
    changes.push({ ...base, area: 'unstaged', status: statusKind(entry.worktreeStatus) });
  }
  return changes;
}

function mapHistory(history: Pick<WireHistoryResult, 'commits'>): CommitSummary[] {
  return assignHistoryLanes(history.commits).map((commit) => {
    return {
      oid: commit.oid,
      shortOid: commit.oid.slice(0, 7),
      subject: commit.subject,
      authorName: commit.author,
      authoredAt: commit.authoredAt,
      parents: [...commit.parents],
      refs: [...commit.refs],
      lane: commit.lane,
    };
  });
}

function cloneWireCommit(commit: WireCommitSummary): WireCommitSummary {
  return { ...commit, parents: [...commit.parents], refs: [...commit.refs] };
}

function replaceHistoryCache(
  state: AdapterState,
  repoId: string,
  history: WireHistoryResult,
): CommitSummary[] {
  const wireHistory = history.commits.map(cloneWireCommit);
  const mapped = mapHistory({ commits: wireHistory });
  state.wireHistories.set(repoId, wireHistory);
  state.histories.set(repoId, mapped);
  return mapped;
}

function mergeHistoryPage(
  state: AdapterState,
  repoId: string,
  history: WireHistoryResult,
  skip: number,
  limit: number,
): CommitSummary[] {
  if (skip === 0) return replaceHistoryCache(state, repoId, history);

  const current = state.wireHistories.get(repoId) ?? [];
  if (skip > current.length) return mapHistory(history);

  const next = current.map(cloneWireCommit);
  next.splice(skip, history.commits.length, ...history.commits.map(cloneWireCommit));
  if (history.commits.length < limit) next.length = skip + history.commits.length;
  const mapped = mapHistory({ commits: next });
  state.wireHistories.set(repoId, next);
  state.histories.set(repoId, mapped);
  const cachedRepo = state.repos.get(repoId);
  if (cachedRepo) state.repos.set(repoId, { ...cachedRepo, history: mapped });
  return mapped.slice(skip, skip + history.commits.length);
}

function operationLabel(
  kind: Exclude<RepoSnapshot['operation'], { kind: 'none' }>['kind'],
): LocalizedMessage {
  switch (kind) {
    case 'merge':
      return localized('operationResolvingMerge');
    case 'rebase':
      return localized('operationResolvingRebase');
    case 'cherryPick':
      return localized('operationResolvingCherryPick');
    case 'revert':
      return localized('operationResolvingRevert');
    case 'unknown':
      return localized('operationExternalInProgress');
    case 'pendingStructuredCommit':
      return localized('operationAwaitingCommit');
    case 'structuredAbortRecovery':
      return localized('operationRecovering');
  }
  throw new Error('Unknown operation kind');
}

function isGitFlowOperation(
  value: string | null | undefined,
): value is 'finish' | 'update' | 'integrate' {
  return value === 'finish' || value === 'update' || value === 'integrate';
}

function mapRepoSnapshot(snapshot: WireRepoSnapshot, history: CommitSummary[]): RepoSnapshot {
  const changes = snapshot.entries.flatMap(statusEntry);
  const branchName = snapshot.head.kind === 'detached' ? null : snapshot.head.name;
  const branch: BranchStatus = {
    name: branchName,
    detached: snapshot.head.kind === 'detached',
    ...(snapshot.head.kind !== 'unborn' && snapshot.head.oid ? { oid: snapshot.head.oid } : {}),
    ...(snapshot.upstream ? { upstream: snapshot.upstream } : {}),
    ahead: snapshot.ahead,
    behind: snapshot.behind,
  };

  if (snapshot.operation.kind === 'none') {
    return {
      repoId: snapshot.repoId,
      name: repoName(snapshot.root),
      path: snapshot.root,
      generation: snapshot.repoGeneration,
      eventSeq: snapshot.eventSeq,
      branch,
      operation: { kind: 'none' },
      changes,
      ...(snapshot.additions != null ? { additions: snapshot.additions } : {}),
      ...(snapshot.deletions != null ? { deletions: snapshot.deletions } : {}),
      history,
    };
  }

  const kind = snapshot.operation.kind;
  const unresolvedCount = changes.filter((entry) => entry.area === 'conflicted').length;
  const gitFlowOperation = isGitFlowOperation(snapshot.gitFlowOperation)
    ? snapshot.gitFlowOperation
    : undefined;
  return {
    repoId: snapshot.repoId,
    name: repoName(snapshot.root),
    path: snapshot.root,
    generation: snapshot.repoGeneration,
    eventSeq: snapshot.eventSeq,
    branch,
    operation: {
      kind,
      label: gitFlowOperation
        ? { id: 'operationGitFlowInProgress', args: { operation: gitFlowOperation } }
        : operationLabel(kind),
      ...(gitFlowOperation ? { gitFlowOperation } : {}),
      unresolvedCount,
      canContinue:
        unresolvedCount === 0 &&
        (Boolean(gitFlowOperation) ||
          kind === 'rebase' ||
          kind === 'cherryPick' ||
          kind === 'revert'),
      canSkip:
        !gitFlowOperation && (kind === 'rebase' || kind === 'cherryPick' || kind === 'revert'),
      canAbort: kind !== 'unknown',
    },
    changes,
    ...(snapshot.additions != null ? { additions: snapshot.additions } : {}),
    ...(snapshot.deletions != null ? { deletions: snapshot.deletions } : {}),
    history,
  };
}

function mapConflictSide(side: WireConflictSide | null): ConflictSide | null {
  if (!side) return null;
  return {
    oid: side.oid,
    mode: side.mode,
    ...(side.text === null ? {} : { text: side.text }),
  };
}

function mapConflictBlock(block: WireConflictBlock): ConflictBlock {
  return {
    id: block.id,
    rangeUtf16: { ...block.rangeUtf16 },
    replacements: { ...block.replacements },
    state: block.state,
  };
}

async function sha256Utf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function mapConflictDocument(document: WireConflictDocument): Promise<ConflictDocument> {
  return {
    sessionId: document.sessionId,
    repoId: document.repoId,
    path: document.path,
    operation: document.operation,
    conflictGeneration: document.conflictGeneration,
    contentHash: document.contentHash,
    documentRevision: await sha256Utf8(document.result.text),
    labels: { ...document.labels },
    sides: {
      base: mapConflictSide(document.sides.base),
      current: mapConflictSide(document.sides.current),
      incoming: mapConflictSide(document.sides.incoming),
    },
    result: { ...document.result },
    blocks: document.blocks.map(mapConflictBlock),
    kind: document.kind,
    capabilities: { ...document.capabilities },
    relatedPaths: [...document.relatedPaths],
  };
}

function cacheConflict(conflicts: Map<string, ConflictDocument>, document: ConflictDocument): void {
  for (const [sessionId, existing] of conflicts) {
    if (
      existing.repoId === document.repoId &&
      existing.path === document.path &&
      sessionId !== document.sessionId
    ) {
      conflicts.delete(sessionId);
    }
  }
  conflicts.set(document.sessionId, document);
}

function clearRepoConflicts(conflicts: Map<string, ConflictDocument>, repoId: string): void {
  for (const [sessionId, conflict] of conflicts) {
    if (conflict.repoId === repoId) conflicts.delete(sessionId);
  }
}

function updateConflictFromEdit(
  base: ConflictDocument,
  edit: WireConflictEditResult,
): ConflictDocument {
  return {
    ...base,
    documentRevision: edit.documentRevision,
    result: { ...base.result, text: edit.text },
    blocks: edit.blocks.map(mapConflictBlock),
  };
}

function mapCommitDetails(details: WireCommitDetails, repoId: string): CommitDetails {
  const profile = profileDiffPatch(details.patch, details.truncated);
  return {
    oid: details.oid,
    shortOid: details.oid.slice(0, 7),
    subject: details.subject,
    body: details.body,
    authorName: details.author,
    authorEmail: details.authorEmail,
    authoredAt: details.authoredAt,
    parents: [...details.parents],
    refs: [...details.refs],
    lane: 0,
    diff: {
      diffId: details.diffRevision,
      repoId,
      path: details.oid,
      area: 'staged',
      generation: details.repoGeneration,
      patch: details.patch,
      binary: profile.binary,
      tooLarge: profile.performanceMode,
      truncated: details.truncated,
    },
  };
}

function parseFooter(value: string | undefined): Array<{ token: string; value: string }> {
  if (!value?.trim()) return [];
  return value.split(/\n(?=[A-Za-z][A-Za-z -]*:)/u).map((entry) => {
    const match = /^([^:]+):\s*([\s\S]+)$/u.exec(entry.trim());
    if (!match?.[1] || !match[2]) throw new Error('Footer must use the `Token: value` format.');
    return { token: match[1].trim(), value: match[2].trim() };
  });
}

function commitInput(input: CommitInput) {
  if (input.format === 'plain') return input;
  return {
    format: input.format,
    type: input.type,
    scope: input.scope ?? null,
    breaking: input.breaking,
    description: input.description,
    body: input.body ?? null,
    footers: parseFooter(input.footer),
  };
}

function upstreamParts(repo: RepoSnapshot): { remote: string; remoteBranch: string } {
  if (!repo.branch.upstream) return { remote: 'origin', remoteBranch: repo.branch.name ?? 'HEAD' };
  const slash = repo.branch.upstream.indexOf('/');
  return slash < 0
    ? { remote: repo.branch.upstream, remoteBranch: repo.branch.name ?? 'HEAD' }
    : {
        remote: repo.branch.upstream.slice(0, slash),
        remoteBranch: repo.branch.upstream.slice(slash + 1),
      };
}

function mapPatchSelection(selection: DiffSelection): WirePatchSelection;
function mapPatchSelection(selection: DiffSelection): WirePatchSelection {
  const identity = {
    path: selection.path,
    diffRevision: selection.diffId,
  };
  return selection.kind === 'lines'
    ? {
        kind: 'lines',
        ...identity,
        side: selection.side,
        startLine: selection.startLine,
        endLine: selection.endLine,
      }
    : {
        kind: 'hunk',
        ...identity,
        hunkIndex: selection.hunkIndex,
      };
}

async function mapAction(
  action: WorkspaceAction,
  repo: RepoSnapshot,
  conflicts: Map<string, ConflictDocument>,
): Promise<WireAction> {
  const upstream = upstreamParts(repo);
  switch (action.kind) {
    case 'stageFiles':
      return { kind: 'stage', paths: action.paths, selection: null };
    case 'unstageFiles':
      return { kind: 'unstage', paths: action.paths, selection: null };
    case 'discardFiles':
      return {
        kind: 'discard',
        paths: action.paths,
        target: 'unstaged',
        selection: null,
      };
    case 'stageSelection':
      return {
        kind: 'stage',
        paths: [],
        selection: mapPatchSelection(action.selection),
      };
    case 'unstageSelection':
      return {
        kind: 'unstage',
        paths: [],
        selection: mapPatchSelection(action.selection),
      };
    case 'discardSelection':
      return {
        kind: 'discard',
        paths: [],
        target: 'unstaged',
        selection: mapPatchSelection(action.selection),
      };
    case 'commit':
      return {
        kind: 'commit',
        input: commitInput(action.input),
        includeAllChanges: action.includeAllChanges,
      };
    case 'fetch':
      return { kind: 'fetch', remote: action.remote ?? upstream.remote };
    case 'pull':
      return { kind: 'pull', remote: action.remote, remoteBranch: action.remoteBranch };
    case 'push':
      return {
        kind: 'push',
        remote: action.remote,
        localBranch: repo.branch.name ?? 'HEAD',
        remoteBranch: action.remoteBranch,
        setUpstream: !repo.branch.upstream,
        forceWithLease: action.forceWithLease,
        pushTags: action.pushTags,
      };
    case 'setRemoteUrl':
      return {
        kind: 'setRemoteUrl',
        remote: action.remote,
        urlKind: action.urlKind,
        expectedUrl: action.expectedUrl,
        newUrl: action.newUrl,
      };
    case 'createBranch':
      return {
        kind: 'createBranch',
        name: action.name,
        startPoint: action.startOid,
        checkout: action.checkout ?? false,
      };
    case 'deleteBranch':
      return { kind: 'deleteBranch', name: action.name };
    case 'createTag':
      return { kind: 'createTag', name: action.name, target: action.targetOid };
    case 'gitFlow':
      return { kind: 'gitFlow', request: { ...action.request } };
    case 'checkoutBranch':
      return { kind: 'checkout', branch: action.name };
    case 'merge':
      return {
        kind: 'merge',
        source: action.sourceRef,
        commitImmediately: action.commitImmediately,
      };
    case 'rebase':
      return { kind: 'rebase', onto: action.ontoRef };
    case 'cherryPick':
      return { kind: 'cherryPick', commit: action.oid, mainline: action.mainline ?? null };
    case 'revert':
      return { kind: 'revert', commit: action.oid, mainline: action.mainline ?? null };
    case 'reset':
      return { kind: 'reset', commit: action.oid, mode: action.mode };
    case 'continueOperation':
      return { kind: 'continue' };
    case 'skipOperation':
      return { kind: 'skip' };
    case 'abortOperation':
      return { kind: 'abort' };
    case 'conflictChoice': {
      const conflict = conflicts.get(action.sessionId);
      if (!conflict) throw new Error('Conflict session not found.');
      return {
        kind: 'conflictChoice',
        sessionId: action.sessionId,
        conflictGeneration: conflict.conflictGeneration,
        contentHash: action.contentHash,
        documentRevision: await sha256Utf8(action.draftText),
        baseDocumentRevision: action.baseDocumentRevision,
        blockId: action.blockId,
        draftText: action.draftText,
        choice: action.choice,
      };
    }
    case 'saveConflict': {
      const conflict = conflicts.get(action.sessionId);
      if (!conflict) throw new Error('Conflict session not found.');
      return {
        kind: 'conflictSave',
        sessionId: action.sessionId,
        conflictGeneration: conflict.conflictGeneration,
        contentHash: action.contentHash,
        result: action.draftText,
      };
    }
    case 'markConflictResolved': {
      const conflict = conflicts.get(action.sessionId);
      if (!conflict) throw new Error('Conflict session not found.');
      return {
        kind: 'conflictMarkResolved',
        sessionId: action.sessionId,
        conflictGeneration: conflict.conflictGeneration,
        contentHash: action.contentHash,
        resultKind: 'file',
      };
    }
    case 'materializeConflict': {
      const conflict = conflicts.get(action.sessionId);
      if (!conflict) throw new Error('Conflict session not found.');
      return {
        kind: 'conflictMaterialize',
        sessionId: action.sessionId,
        conflictGeneration: conflict.conflictGeneration,
        choice: action.choice,
      };
    }
    case 'openExternal': {
      const conflict = [...conflicts.values()].find(
        (candidate) => candidate.repoId === repo.repoId && candidate.path === action.path,
      );
      if (!conflict) throw new Error('Conflict session not found.');
      return {
        kind: 'conflictOpenExternal',
        sessionId: conflict.sessionId,
        conflictGeneration: conflict.conflictGeneration,
        editor: { kind: 'systemDefault' },
      };
    }
    case 'saveFile':
      return {
        kind: 'saveFile',
        path: action.path,
        text: action.text,
        expectedContentHash: action.expectedContentHash,
      };
    case 'fileAction':
      return { kind: 'fileAction', paths: action.paths, operation: action.operation };
  }
  const exhaustiveAction: never = action;
  throw new Error(`Unknown workspace action: ${String(exhaustiveAction)}`);
}

function mapOpenRequest(request: AttachRequest): WireOpenRequest {
  switch (request.kind) {
    case 'open':
      return { kind: 'open', path: request.path };
    case 'openExisting':
      return { kind: 'openExisting', path: request.path };
    case 'clone':
      return {
        kind: 'clone',
        remote: request.remoteUrl,
        destination: request.destination,
        operationId: crypto.randomUUID(),
      };
  }
  throw new Error('Unknown open request');
}

function queryTarget(area: ChangeArea): 'staged' | 'unstaged' {
  return area === 'staged' ? 'staged' : 'unstaged';
}

function redactArg(argument: string): string {
  try {
    const url = new URL(argument);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
      return url.toString();
    }
  } catch {
    // argvの各要素は通常URLではない。
  }
  return argument;
}

function commandFromEventDetails(details: Record<string, string> | undefined): string | undefined {
  if (!details?.argv) return undefined;
  try {
    const parsed: unknown = JSON.parse(details.argv);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((arg) => typeof arg === 'string')
    )
      return undefined;
    return parsed.map(redactArg).join(' ');
  } catch {
    return undefined;
  }
}

function actionTitle(action: WorkspaceAction): LocalizedMessage {
  switch (action.kind) {
    case 'stageFiles':
      return localized('actionStageFiles');
    case 'unstageFiles':
      return localized('actionUnstageFiles');
    case 'discardFiles':
      return localized('actionDiscardChanges');
    case 'stageSelection':
      return localized(
        action.selection.kind === 'hunk' ? 'actionStageHunk' : 'actionStageSelectedLines',
      );
    case 'unstageSelection':
      return localized(
        action.selection.kind === 'hunk' ? 'actionUnstageHunk' : 'actionUnstageSelectedLines',
      );
    case 'discardSelection':
      return localized(
        action.selection.kind === 'hunk' ? 'actionDiscardHunk' : 'actionDiscardSelectedLines',
      );
    case 'commit':
      return localized('actionCommit');
    case 'fetch':
      return localized('actionFetch');
    case 'setRemoteUrl':
      return localized('actionSetRemoteUrl');
    case 'pull':
      return localized('actionPull');
    case 'push':
      return localized('actionPush');
    case 'createBranch':
      return localized('actionCreateBranch');
    case 'deleteBranch':
      return localized('actionDeleteBranch');
    case 'createTag':
      return localized('actionCreateTag');
    case 'gitFlow':
      return localized('actionGitFlow');
    case 'checkoutBranch':
      return localized('actionCheckoutBranch');
    case 'merge':
      return localized('actionMergeBranch');
    case 'rebase':
      return localized('actionRebaseBranch');
    case 'cherryPick':
      return localized('actionCherryPickCommit');
    case 'revert':
      return localized('actionRevertCommit');
    case 'reset':
      return localized('actionResetToCommit');
    case 'continueOperation':
      return localized('actionContinueOperation');
    case 'skipOperation':
      return localized('actionSkipOperation');
    case 'abortOperation':
      return localized('actionAbortOperation');
    case 'conflictChoice':
      return localized('actionResolveConflictBlock');
    case 'saveConflict':
      return localized('actionSaveConflictResult');
    case 'markConflictResolved':
      return localized('actionMarkConflictResolved');
    case 'materializeConflict':
      return localized('actionApplyConflictSide');
    case 'openExternal':
      return localized('actionOpenConflictExternally');
    case 'saveFile':
      return localized('actionSaveFile');
    case 'fileAction':
      switch (action.operation) {
        case 'moveToTrash':
          return localized('actionMoveFileToTrash');
        case 'revealInFinder':
          return localized('actionShowInFinder');
        case 'openInDefaultApp':
          return localized('actionOpenInDefaultApp');
      }
  }
  throw new Error('Unknown workspace action');
}

function actionMayChangeHistoryRefs(action: WireAction): boolean {
  return (
    action.kind === 'fetch' ||
    action.kind === 'pull' ||
    action.kind === 'push' ||
    action.kind === 'createBranch' ||
    action.kind === 'deleteBranch' ||
    action.kind === 'createTag' ||
    action.kind === 'checkout' ||
    action.kind === 'gitFlow'
  );
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

export function createTauriWorkspaceAdapter(): WorkspaceAdapter {
  const persistedActivities = readPersistedActivities();
  const state: AdapterState = {
    subscribers: new Set(),
    repos: new Map(),
    wireHistories: new Map(),
    histories: new Map(),
    headOids: new Map(),
    conflicts: new Map(),
    activities: new Map(persistedActivities.map((entry) => [entry.id, entry])),
    activityTitles: new Map(),
    activityRepositoryNames: new Map(),
    channels: new Map(),
    previewBindings: new WeakMap(),
  };

  const emit = (event: WorkspaceEvent): void => {
    for (const subscriber of state.subscribers) subscriber(event);
  };

  const activityEntries = (repoId?: string): ActivityEntry[] => {
    const entries = [...state.activities.values()].filter(
      (entry) => !repoId || entry.repoId === repoId,
    );
    return mergeActivityEntries(
      entries.filter((entry) => entry.detailAvailability === 'summaryOnly'),
      entries.filter((entry) => entry.detailAvailability === 'currentSession'),
    );
  };

  const queryWire = (repoId: string, query: WireQuery): Promise<WireQueryOutcome> =>
    invokeWorkspace<WireQueryOutcome>('workspace_query', { request: { repoId, query } });

  const refresh = async (repoId: string, forceHistory = false): Promise<RepoSnapshot> => {
    const status = await queryWire(repoId, { kind: 'status' });
    if (status.kind !== 'status') throw new Error('Invalid workspace status response.');
    const current = state.repos.get(repoId);
    if (current && isOlderSnapshot(current, status.data)) return current;
    const nextHeadOid = headOid(status.data);
    const repositoryGenerationChanged =
      current !== undefined && current.generation !== status.data.repoGeneration;
    let mappedHistory = state.histories.get(repoId);
    if (
      forceHistory ||
      repositoryGenerationChanged ||
      !mappedHistory ||
      state.headOids.get(repoId) !== nextHeadOid
    ) {
      const history = await queryWire(repoId, {
        kind: 'history',
        limit: HISTORY_PAGE_SIZE,
        skip: 0,
      });
      if (history.kind !== 'history') throw new Error('Invalid workspace history response.');
      mappedHistory = replaceHistoryCache(state, repoId, history.data);
    }
    state.headOids.set(repoId, nextHeadOid);
    const repo = mapRepoSnapshot(status.data, mappedHistory);
    if (repo.operation.kind === 'none') clearRepoConflicts(state.conflicts, repoId);
    state.repos.set(repoId, repo);
    return repo;
  };

  const onWireEvent = (event: WireWorkspaceEvent): void => {
    const id = event.operationId ?? `${event.repoId}:${event.eventSeq}`;
    const activityRepoId = event.details?.attachedRepoId || event.repoId;
    const previous = state.activities.get(id);
    if (previous?.eventSeq !== undefined && event.eventSeq < previous.eventSeq) return;
    const status =
      event.phase === 'started' || event.phase === 'progress'
        ? 'running'
        : event.phase === 'completed'
          ? 'succeeded'
          : event.phase === 'cancelled'
            ? 'cancelled'
            : 'failed';
    const eventCommand = commandFromEventDetails(event.details);
    const activity: ActivityEntry = {
      id,
      repoId: activityRepoId,
      repositoryName:
        previous?.repositoryName ??
        state.activityRepositoryNames.get(id) ??
        state.repos.get(activityRepoId)?.name ??
        repoName(activityRepoId),
      action: previous?.action ?? state.activityTitles.get(id) ?? localized('actionGitOperation'),
      summary: event.summary,
      status,
      eventSeq: event.eventSeq,
      startedAt: previous?.startedAt ?? new Date().toISOString(),
      detailAvailability: 'currentSession',
      ...(status === 'running' ? { cancellable: true } : { finishedAt: new Date().toISOString() }),
      ...(eventCommand
        ? { command: eventCommand }
        : previous?.command
          ? { command: previous.command }
          : {}),
      ...(previous?.stdout ? { stdout: previous.stdout } : {}),
      ...(previous?.stderr ? { stderr: previous.stderr } : {}),
      ...(previous?.exitCode !== undefined ? { exitCode: previous.exitCode } : {}),
      ...(event.details?.stdout ? { stdout: event.details.stdout } : {}),
      ...(event.details?.stderr ? { stderr: event.details.stderr } : {}),
      ...(event.details?.exitCode && Number.isFinite(Number(event.details.exitCode))
        ? { exitCode: Number(event.details.exitCode) }
        : {}),
    };
    state.activities.set(id, activity);
    if (status !== 'running') persistTerminalActivities([...state.activities.values()]);
    emit({ kind: 'activityChanged', activity });
    if (status !== 'running') {
      state.activityTitles.delete(id);
      state.activityRepositoryNames.delete(id);
      void refresh(activityRepoId, true)
        .then((snapshot) => emit({ kind: 'snapshotChanged', snapshot }))
        .catch(() => undefined);
    }
  };

  return {
    async attach(request) {
      const channel = new Channel<WireWorkspaceEvent>(onWireEvent);
      const wireRequest = mapOpenRequest(request);
      if (wireRequest.kind === 'clone') {
        state.activityTitles.set(wireRequest.operationId, localized('actionCloneRepository'));
        state.activityRepositoryNames.set(
          wireRequest.operationId,
          repoName(wireRequest.destination),
        );
      }
      let session: WireWorkspaceSession;
      try {
        session = await invokeWorkspace<WireWorkspaceSession>('workspace_attach', {
          request: wireRequest,
          onEvent: channel,
        });
      } catch (cause) {
        if (wireRequest.kind === 'clone') {
          state.activityTitles.delete(wireRequest.operationId);
          state.activityRepositoryNames.delete(wireRequest.operationId);
        }
        throw cause;
      }
      state.channels.set(session.repoId, channel);
      const historyOutcome = await queryWire(session.repoId, {
        kind: 'history',
        limit: HISTORY_PAGE_SIZE,
        skip: 0,
      });
      const history =
        historyOutcome.kind === 'history'
          ? replaceHistoryCache(state, session.repoId, historyOutcome.data)
          : [];
      state.headOids.set(session.repoId, headOid(session.snapshot));
      const repo = mapRepoSnapshot(session.snapshot, history);
      state.repos.set(repo.repoId, repo);
      if (wireRequest.kind === 'clone') {
        state.activityTitles.delete(wireRequest.operationId);
        state.activityRepositoryNames.delete(wireRequest.operationId);
      }
      return {
        repos: [repo],
        selectedRepoId: repo.repoId,
        activities: activityEntries(),
      };
    },

    async query(request: WorkspaceQuery, options): Promise<QueryResult> {
      throwIfAborted(options?.signal);
      switch (request.kind) {
        case 'repositoryAvailability': {
          const outcome = await queryWire('', {
            kind: 'repositoryAvailability',
            path: request.path,
          });
          if (outcome.kind !== 'repositoryAvailability')
            throw new Error('Invalid repository availability response.');
          return {
            kind: 'repositoryAvailability',
            path: outcome.data.path,
            availability: outcome.data.availability,
          };
        }
        case 'snapshot': {
          const snapshot = await refresh(request.repoId);
          return { kind: 'snapshot', snapshot };
        }
        case 'diff': {
          const outcome = await queryWire(request.repoId, {
            kind: 'diff',
            target: queryTarget(request.area),
            paths: [request.path],
          });
          if (outcome.kind !== 'diff') throw new Error('Invalid diff response.');
          const profile = profileDiffPatch(outcome.data.patch, outcome.data.truncated);
          return {
            kind: 'diff',
            diff: {
              diffId: outcome.data.diffRevision,
              repoId: request.repoId,
              path: request.path,
              area: request.area,
              generation: outcome.data.repoGeneration,
              patch: outcome.data.patch,
              binary: profile.binary,
              tooLarge: profile.performanceMode,
              truncated: outcome.data.truncated,
            },
          };
        }
        case 'commitDetails': {
          const outcome = await queryWire(request.repoId, {
            kind: 'commitDetails',
            oid: request.oid,
          });
          if (outcome.kind !== 'commitDetails') throw new Error('Invalid commit details response.');
          return { kind: 'commitDetails', commit: mapCommitDetails(outcome.data, request.repoId) };
        }
        case 'history': {
          const search = request.search?.trim();
          const outcome = await queryWire(request.repoId, {
            kind: 'history',
            limit: request.limit,
            skip: request.skip,
            ...(search ? { search } : {}),
          });
          if (outcome.kind !== 'history') throw new Error('Invalid history response.');
          return {
            kind: 'history',
            commits: search
              ? mapHistory(outcome.data)
              : mergeHistoryPage(state, request.repoId, outcome.data, request.skip, request.limit),
          };
        }
        case 'branches': {
          const outcome = await queryWire(request.repoId, { kind: 'branches' });
          if (outcome.kind !== 'branches') throw new Error('Invalid branch list response.');
          return {
            kind: 'branches',
            branches: outcome.data.branches.map((branch) =>
              branch.upstream
                ? {
                    fullName: branch.fullName,
                    shortName: branch.shortName,
                    oid: branch.oid,
                    current: branch.current,
                    remote: branch.remote,
                    upstream: branch.upstream,
                  }
                : {
                    fullName: branch.fullName,
                    shortName: branch.shortName,
                    oid: branch.oid,
                    current: branch.current,
                    remote: branch.remote,
                  },
            ),
          };
        }
        case 'gitFlowOverview': {
          const outcome = await queryWire(request.repoId, { kind: 'gitFlowOverview' });
          if (outcome.kind !== 'gitFlowOverview')
            throw new Error('Invalid Git Flow overview response.');
          return { kind: 'gitFlowOverview', overview: { ...outcome.data } };
        }
        case 'conflict': {
          const outcome = await queryWire(request.repoId, { kind: 'conflict', path: request.path });
          if (outcome.kind !== 'conflict') throw new Error('Invalid conflict response.');
          const conflict = await mapConflictDocument(outcome.data);
          cacheConflict(state.conflicts, conflict);
          return { kind: 'conflict', document: conflict };
        }
        case 'fileContents': {
          const outcome = await queryWire(request.repoId, {
            kind: 'fileContents',
            path: request.path,
          });
          if (outcome.kind !== 'fileContents') throw new Error('Invalid file contents response.');
          return {
            kind: 'fileContents',
            document: {
              repoId: outcome.data.repoId,
              path: outcome.data.path,
              text: outcome.data.text,
              lineEnding: outcome.data.lineEnding,
              hasUtf8Bom: outcome.data.hasUtf8Bom,
              contentHash: outcome.data.contentHash,
              generation: outcome.data.repoGeneration,
            },
          };
        }
        case 'remotes': {
          const outcome = await queryWire(request.repoId, { kind: 'remotes' });
          if (outcome.kind !== 'remotes') throw new Error('Invalid remote list response.');
          return {
            kind: 'remotes',
            remotes: outcome.data.remotes.map((remote) => ({
              name: remote.name,
              fetchUrls: [...remote.fetchUrls],
              pushUrls: [...remote.pushUrls],
            })),
            generation: outcome.data.repoGeneration,
          };
        }
        case 'activity':
          return {
            kind: 'activity',
            entries: activityEntries(request.repoId),
          };
        case 'commitActivity': {
          const operationId = crypto.randomUUID();
          const signal = options?.signal;
          let cancellationRequested = false;
          let rejectForAbort: ((reason: unknown) => void) | undefined;
          const aborted = new Promise<never>((_, reject) => {
            rejectForAbort = reject;
          });
          const cancel = (): void => {
            if (!signal || cancellationRequested) return;
            cancellationRequested = true;
            rejectForAbort?.(abortReason(signal));
            void invokeWorkspace('workspace_cancel', { request: { operationId } }).catch(
              () => undefined,
            );
          };
          signal?.addEventListener('abort', cancel, { once: true });
          try {
            if (signal?.aborted) cancel();
            throwIfAborted(signal);
            const query = queryWire(request.repoId, {
              kind: 'commitActivity',
              operationId,
              bucketBoundariesUnixSeconds: [...request.bucketBoundariesUnixSeconds],
            });
            const outcome = signal ? await Promise.race([query, aborted]) : await query;
            throwIfAborted(signal);
            if (outcome.kind !== 'commitActivity')
              throw new Error('Invalid commit activity response.');
            const series: CommitActivitySeries = {
              repoId: request.repoId,
              repoGeneration: outcome.data.repoGeneration,
              historyRevision: outcome.data.historyRevision,
              timeBasis: outcome.data.timeBasis,
              totals: { ...outcome.data.totals },
              buckets: outcome.data.buckets.map((bucket) => ({ ...bucket })),
              coverage:
                outcome.data.coverage.kind === 'complete'
                  ? { kind: 'complete' }
                  : {
                      kind: 'truncated',
                      scanLimit: outcome.data.coverage.scanLimit,
                    },
            };
            return { kind: 'commitActivity', series };
          } catch (cause) {
            if (signal?.aborted) throw abortReason(signal);
            throw cause;
          } finally {
            signal?.removeEventListener('abort', cancel);
          }
        }
      }
      throw new Error('Unknown workspace query');
    },

    async preview(request: ActionRequest): Promise<ActionPreview> {
      const repo = state.repos.get(request.repoId);
      if (!repo) throw new Error('Repository session not found.');
      const action = await mapAction(request.action, repo, state.conflicts);
      const outcome = await invokeWorkspace<WirePreviewOutcome>('workspace_preview', {
        request: { repoId: request.repoId, expectedGeneration: repo.generation, action },
      });
      const preview: ActionPreview = {
        repoId: request.repoId,
        title: actionTitle(request.action),
        summary: outcome.summary,
        affectedPaths: outcome.affectedPaths,
        affectedCommits: outcome.affectedCommits,
        lostCommitOids: outcome.lostCommitOids ?? [],
        resolvedTargets: outcome.resolvedTargets ?? [],
        destructive: outcome.destructive,
        ...(outcome.remoteEffect ? { remoteEffect: outcome.remoteEffect } : {}),
        ...(request.action.kind === 'reset' && request.action.mode === 'hard' && repo.branch.name
          ? { typedConfirmation: repo.branch.name }
          : {}),
      };
      state.previewBindings.set(preview, {
        repoId: request.repoId,
        expectedGeneration: repo.generation,
        ...(outcome.confirmationToken ? { confirmationToken: outcome.confirmationToken } : {}),
      });
      return preview;
    },

    async execute(request: ActionRequest): Promise<ActionOutcome> {
      const repo = state.repos.get(request.repoId);
      if (!repo) throw new Error('Repository session not found.');
      const previewBinding = request.preview
        ? state.previewBindings.get(request.preview)
        : undefined;
      if (request.preview && (!previewBinding || previewBinding.repoId !== request.repoId)) {
        throw new WorkspaceAdapterError(
          'previewMismatch',
          'The action preview does not belong to this repository session.',
        );
      }
      const action = await mapAction(request.action, repo, state.conflicts);
      const operationId = crypto.randomUUID();
      state.activityTitles.set(operationId, actionTitle(request.action));
      state.activityRepositoryNames.set(operationId, repo.name);
      let outcome: WireActionOutcome;
      try {
        outcome = await invokeWorkspace<WireActionOutcome>('workspace_execute', {
          request: {
            operationId,
            repoId: request.repoId,
            expectedGeneration: previewBinding?.expectedGeneration ?? repo.generation,
            action,
            confirmationToken: previewBinding?.confirmationToken ?? null,
          },
        });
      } catch (cause) {
        state.activityTitles.delete(operationId);
        state.activityRepositoryNames.delete(operationId);
        throw cause;
      }
      const nextHeadOid = headOid(outcome.snapshot);
      let history = state.histories.get(request.repoId) ?? [];
      if (
        state.headOids.get(request.repoId) !== nextHeadOid ||
        actionMayChangeHistoryRefs(action)
      ) {
        const historyOutcome = await queryWire(request.repoId, {
          kind: 'history',
          limit: HISTORY_PAGE_SIZE,
          skip: 0,
        });
        if (historyOutcome.kind === 'history') {
          history = replaceHistoryCache(state, request.repoId, historyOutcome.data);
        }
      }
      state.headOids.set(request.repoId, nextHeadOid);
      const candidateRepo = mapRepoSnapshot(outcome.snapshot, history);
      const currentRepo = state.repos.get(request.repoId);
      const mappedRepo =
        currentRepo && isOlderSnapshot(currentRepo, outcome.snapshot) ? currentRepo : candidateRepo;
      if (mappedRepo.operation.kind === 'none') clearRepoConflicts(state.conflicts, request.repoId);
      state.repos.set(request.repoId, mappedRepo);
      const previousActivity = state.activities.get(outcome.operationId);
      const finishedAt = new Date().toISOString();
      const activity: ActivityEntry = {
        id: outcome.operationId,
        repoId: request.repoId,
        repositoryName: previousActivity?.repositoryName ?? repo.name,
        action: previousActivity?.action ?? actionTitle(request.action),
        summary: outcome.summary,
        status: outcome.command.cancelled
          ? 'cancelled'
          : outcome.command.exitCode === 0
            ? 'succeeded'
            : 'failed',
        startedAt: previousActivity?.startedAt ?? finishedAt,
        finishedAt: previousActivity?.finishedAt ?? finishedAt,
        detailAvailability: 'currentSession',
        eventSeq: outcome.eventSeq,
        command: outcome.command.argv.map(redactArg).join(' '),
        ...(outcome.command.exitCode === null ? {} : { exitCode: outcome.command.exitCode }),
        stdout: outcome.command.stdout,
        stderr: outcome.command.stderr,
      };
      state.activities.set(activity.id, activity);
      state.activityTitles.delete(operationId);
      state.activityRepositoryNames.delete(operationId);
      persistTerminalActivities([...state.activities.values()]);
      emit({ kind: 'activityChanged', activity });

      let conflictDocument = outcome.conflictDocument
        ? await mapConflictDocument(outcome.conflictDocument)
        : undefined;
      const sessionId = 'sessionId' in request.action ? request.action.sessionId : undefined;
      if (sessionId && conflictDocument) {
        state.conflicts.delete(sessionId);
        cacheConflict(state.conflicts, conflictDocument);
      }
      if (!conflictDocument && sessionId && outcome.conflictEdit) {
        const base = state.conflicts.get(sessionId);
        if (base) {
          conflictDocument = updateConflictFromEdit(base, outcome.conflictEdit);
          cacheConflict(state.conflicts, conflictDocument);
        }
      }
      if (request.action.kind === 'markConflictResolved')
        state.conflicts.delete(request.action.sessionId);

      return {
        repoId: request.repoId,
        generation: outcome.repoGeneration,
        summary: outcome.summary,
        activityId: outcome.operationId,
        snapshot: mappedRepo,
        ...(conflictDocument ? { conflictDocument } : {}),
      };
    },

    async cancel(request) {
      await invokeWorkspace('workspace_cancel', { request: { operationId: request.activityId } });
    },

    async detach(repoId) {
      await invokeWorkspace<void>('workspace_detach', { request: { repoId } });
      state.repos.delete(repoId);
      state.wireHistories.delete(repoId);
      state.histories.delete(repoId);
      state.headOids.delete(repoId);
      clearRepoConflicts(state.conflicts, repoId);
      state.channels.delete(repoId);
      emit({ kind: 'repositoryRemoved', repoId });
    },

    async deleteRepository(path) {
      await invokeWorkspace<void>('workspace_delete_repository', { path });
    },

    async subscribe(onEvent) {
      state.subscribers.add(onEvent);
      return () => state.subscribers.delete(onEvent);
    },
  };
}
