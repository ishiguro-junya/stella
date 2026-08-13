import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HISTORY_PAGE_SIZE } from '../domain/historyLanes';
import { ACTIVITY_STORAGE_KEY } from '../features/activity/activityPersistence';
import { createTauriWorkspaceAdapter } from './tauriWorkspaceAdapter';
import type {
  WireCommitSummary,
  WireConflictDocument,
  WireOperationState,
  WireRepoSnapshot,
} from './wire';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: class MockChannel<Message> {
    readonly listener: ((message: Message) => void) | undefined;

    constructor(listener?: (message: Message) => void) {
      this.listener = listener;
    }
  },
}));

function snapshot(
  operation: WireOperationState = { kind: 'none' },
  entries: WireRepoSnapshot['entries'] = [],
): WireRepoSnapshot {
  return {
    repoId: 'repo-1',
    root: '/tmp/stella',
    head: { kind: 'branch', name: 'main', oid: 'head-1' },
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    entries,
    operation,
    repoGeneration: 1,
    eventSeq: 1,
  };
}

function conflict(sessionId: string, contentHash: string): WireConflictDocument {
  return {
    sessionId,
    repoId: 'repo-1',
    path: 'src/app.ts',
    operation: 'merge',
    conflictGeneration: `generation-${sessionId}`,
    contentHash,
    labels: {
      current: { id: 'conflictCurrentBranch' },
      incoming: { id: 'conflictMergedBranch' },
    },
    sides: {
      base: { oid: 'base', mode: '100644', text: 'base\n' },
      current: { oid: 'current', mode: '100644', text: 'current\n' },
      incoming: { oid: 'incoming', mode: '100644', text: 'incoming\n' },
    },
    result: { text: 'result\n', lineEnding: 'lf' },
    blocks: [
      {
        id: 'block-1',
        rangeUtf16: { from: 0, to: 6 },
        replacements: { current: 'current', incoming: 'incoming', both: 'current\nincoming' },
        state: 'current',
      },
    ],
    kind: 'text',
    capabilities: {
      inAppEdit: true,
      performanceView: false,
      chooseCurrent: true,
      chooseIncoming: true,
      chooseBoth: true,
      delete: false,
      externalEditor: true,
    },
    relatedPaths: ['src/app.ts'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requestedQueryKind(args: unknown): string | undefined {
  if (!isRecord(args) || !isRecord(args.request) || !isRecord(args.request.query)) return undefined;
  return typeof args.request.query.kind === 'string' ? args.request.query.kind : undefined;
}

function requestedHistoryPage(args: unknown): { limit: number; skip: number } | undefined {
  if (!isRecord(args) || !isRecord(args.request) || !isRecord(args.request.query)) return undefined;
  const { limit, skip } = args.request.query;
  return typeof limit === 'number' && typeof skip === 'number' ? { limit, skip } : undefined;
}

function requestedHistorySearch(args: unknown): string | undefined {
  if (!isRecord(args) || !isRecord(args.request) || !isRecord(args.request.query)) return undefined;
  return typeof args.request.query.search === 'string' ? args.request.query.search : undefined;
}

function wireCommit(oid: string, parents: string[] = []): WireCommitSummary {
  return {
    oid,
    parents,
    refs: [],
    author: 'Stella',
    authoredAt: '2026-08-08T00:00:00Z',
    subject: oid,
  };
}

function baseInvoke(currentSnapshot = snapshot()) {
  return async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'workspace_attach') return { repoId: 'repo-1', snapshot: currentSnapshot };
    if (command === 'workspace_query' && requestedQueryKind(args) === 'history') {
      return { kind: 'history', data: { commits: [], repoGeneration: 1 } };
    }
    if (command === 'workspace_query' && requestedQueryKind(args) === 'status') {
      return { kind: 'status', data: currentSnapshot };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('tauriWorkspaceAdapter', () => {
  it('queries repository availability without attaching a session', async () => {
    invokeMock.mockResolvedValue({
      kind: 'repositoryAvailability',
      data: { path: '/moved/repo', availability: 'missing' },
    });
    const adapter = createTauriWorkspaceAdapter();

    await expect(
      adapter.query({ kind: 'repositoryAvailability', path: '/moved/repo' }),
    ).resolves.toEqual({
      kind: 'repositoryAvailability',
      path: '/moved/repo',
      availability: 'missing',
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_query', {
      request: {
        repoId: '',
        query: { kind: 'repositoryAvailability', path: '/moved/repo' },
      },
    });
  });

  it('maps all remote URLs and disconnects the repository session', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_query' && requestedQueryKind(args) === 'remotes') {
        return {
          kind: 'remotes',
          data: {
            remotes: [
              {
                name: 'origin',
                fetchUrls: ['https://example.test/repo.git', 'https://mirror.test/repo.git'],
                pushUrls: ['ssh://example.test/repo.git'],
              },
            ],
            repoGeneration: 1,
          },
        };
      }
      if (command === 'workspace_detach') return undefined;
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'openExisting', path: '/tmp/stella' });

    await expect(adapter.query({ kind: 'remotes', repoId: 'repo-1' })).resolves.toEqual({
      kind: 'remotes',
      remotes: [
        {
          name: 'origin',
          fetchUrls: ['https://example.test/repo.git', 'https://mirror.test/repo.git'],
          pushUrls: ['ssh://example.test/repo.git'],
        },
      ],
      generation: 1,
    });
    await adapter.detach?.('repo-1');
    expect(invokeMock).toHaveBeenCalledWith('workspace_detach', { request: { repoId: 'repo-1' } });
  });

  it('maps a registered repository selection to the typed OpenExisting request', async () => {
    invokeMock.mockImplementation(baseInvoke());
    const adapter = createTauriWorkspaceAdapter();

    await adapter.attach({ kind: 'openExisting', path: '/tmp/stella' });

    const attachCall = invokeMock.mock.calls.find(([command]) => command === 'workspace_attach');
    expect(attachCall?.[1]?.request).toEqual({ kind: 'openExisting', path: '/tmp/stella' });
  });

  it('maps the changed-line summary without adding counts to each file row', async () => {
    const current = snapshot({ kind: 'none' }, [
      {
        path: 'src/app.ts',
        originalPath: null,
        indexStatus: 'M',
        worktreeStatus: 'M',
        conflict: false,
        untracked: false,
        submodule: 'N...',
      },
    ]);
    invokeMock.mockImplementation(baseInvoke({ ...current, additions: 13, deletions: 5 }));
    const adapter = createTauriWorkspaceAdapter();

    const attached = await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    expect(attached.repos[0]).toEqual(expect.objectContaining({ additions: 13, deletions: 5 }));
    expect(attached.repos[0]?.changes).toEqual([
      expect.not.objectContaining({ additions: expect.any(Number) }),
      expect.not.objectContaining({ additions: expect.any(Number) }),
    ]);
  });

  it('binds Clone progress to a generated operation id and keeps it in Activity', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_attach') {
        if (!isRecord(args) || !isRecord(args.request) || !isRecord(args.onEvent))
          throw new Error('Expected clone attach args');
        const operationId = args.request.operationId;
        if (typeof operationId !== 'string' || typeof args.onEvent.listener !== 'function')
          throw new Error('Expected clone operation id and event channel');
        args.onEvent.listener({
          repoId: 'clone:/tmp/stella',
          eventSeq: 1,
          repoGeneration: 0,
          operationId,
          phase: 'started',
          summary: { id: 'backendCloneStarted' },
        });
        args.onEvent.listener({
          repoId: 'clone:/tmp/stella',
          eventSeq: 2,
          repoGeneration: 0,
          operationId,
          phase: 'completed',
          summary: { id: 'backendCloneCompleted' },
          details: { attachedRepoId: 'repo-1' },
        });
        return { repoId: 'repo-1', snapshot: snapshot() };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({
      kind: 'clone',
      remoteUrl: 'https://example.com/repository.git',
      destination: '/tmp/stella',
    });

    const attachCall = invokeMock.mock.calls.find(([command]) => command === 'workspace_attach');
    const request = attachCall?.[1]?.request;
    expect(request).toEqual(
      expect.objectContaining({
        kind: 'clone',
        remote: 'https://example.com/repository.git',
        destination: '/tmp/stella',
        operationId: expect.any(String),
      }),
    );
    const result = await adapter.query({ kind: 'activity' });
    if (result.kind !== 'activity') throw new Error('Expected activity result');
    expect(result.entries).toEqual([
      expect.objectContaining({
        repoId: 'repo-1',
        repositoryName: 'stella',
        action: { id: 'actionCloneRepository' },
        status: 'succeeded',
        summary: { id: 'backendCloneCompleted' },
        detailAvailability: 'currentSession',
      }),
    ]);
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toContain('"repositoryName":"stella"');
  });

  it('hydrates persisted terminal summaries without raw current-session details', async () => {
    const finishedAt = new Date().toISOString();
    localStorage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'persisted-operation',
          repoId: 'repo-1',
          repositoryName: 'stella',
          action: { id: 'actionPush' },
          summary: { id: 'backendPushCompleted' },
          status: 'succeeded',
          startedAt: finishedAt,
          finishedAt,
        },
      ]),
    );

    const adapter = createTauriWorkspaceAdapter();
    const result = await adapter.query({ kind: 'activity' });

    expect(result).toEqual({
      kind: 'activity',
      entries: [
        {
          id: 'persisted-operation',
          repoId: 'repo-1',
          repositoryName: 'stella',
          action: { id: 'actionPush' },
          summary: { id: 'backendPushCompleted' },
          status: 'succeeded',
          startedAt: finishedAt,
          finishedAt,
          detailAvailability: 'summaryOnly',
        },
      ],
    });
  });

  it('maps the exact commit activity contract and generates a cancellable wire operation id', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_query' && requestedQueryKind(args) === 'commitActivity') {
        return {
          kind: 'commitActivity',
          data: {
            repoGeneration: 7,
            historyRevision: 'history-7',
            timeBasis: 'committed',
            totals: { commits: 9, activeDays: 4, contributors: 2, branches: 3 },
            buckets: [
              {
                startUnixSeconds: 100,
                endUnixSeconds: 200,
                commitCount: 4,
                contributorCount: 2,
                branchCount: 1,
              },
              {
                startUnixSeconds: 200,
                endUnixSeconds: 300,
                commitCount: 5,
                contributorCount: 1,
                branchCount: 2,
              },
            ],
            coverage: { kind: 'truncated', scanLimit: 100_000 },
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const adapter = createTauriWorkspaceAdapter();

    const result = await adapter.query({
      kind: 'commitActivity',
      repoId: 'repo-1',
      bucketBoundariesUnixSeconds: [100, 200, 300],
    });

    expect(result).toEqual({
      kind: 'commitActivity',
      series: {
        repoId: 'repo-1',
        repoGeneration: 7,
        historyRevision: 'history-7',
        timeBasis: 'committed',
        totals: { commits: 9, activeDays: 4, contributors: 2, branches: 3 },
        buckets: [
          {
            startUnixSeconds: 100,
            endUnixSeconds: 200,
            commitCount: 4,
            contributorCount: 2,
            branchCount: 1,
          },
          {
            startUnixSeconds: 200,
            endUnixSeconds: 300,
            commitCount: 5,
            contributorCount: 1,
            branchCount: 2,
          },
        ],
        coverage: { kind: 'truncated', scanLimit: 100_000 },
      },
    });
    const queryCall = invokeMock.mock.calls.find(
      ([command, args]) =>
        command === 'workspace_query' && requestedQueryKind(args) === 'commitActivity',
    );
    expect(queryCall?.[1]).toEqual({
      request: {
        repoId: 'repo-1',
        query: {
          kind: 'commitActivity',
          operationId: expect.any(String),
          bucketBoundariesUnixSeconds: [100, 200, 300],
        },
      },
    });
  });

  it('cancels an in-flight commit activity query with the same wire operation id', async () => {
    let rejectQuery: ((cause: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === 'workspace_query' && requestedQueryKind(args) === 'commitActivity') {
        return new Promise((_, reject) => {
          rejectQuery = reject;
        });
      }
      if (command === 'workspace_cancel') {
        rejectQuery?.({ code: 'cancelled', message: 'Commit activity query cancelled.' });
        return Promise.resolve({ accepted: true });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const controller = new AbortController();
    const adapter = createTauriWorkspaceAdapter();
    const query = adapter.query(
      {
        kind: 'commitActivity',
        repoId: 'repo-1',
        bucketBoundariesUnixSeconds: [100, 200],
      },
      { signal: controller.signal },
    );
    const queryCall = invokeMock.mock.calls.find(
      ([command, args]) =>
        command === 'workspace_query' && requestedQueryKind(args) === 'commitActivity',
    );
    const queryRequest = queryCall?.[1]?.request;
    if (!isRecord(queryRequest) || !isRecord(queryRequest.query))
      throw new Error('Expected commit activity query request');
    const operationId = queryRequest.query.operationId;
    if (typeof operationId !== 'string') throw new Error('Expected operation id');

    controller.abort();

    await expect(query).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeMock).toHaveBeenCalledWith('workspace_cancel', {
      request: { operationId },
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'workspace_cancel'),
    ).toHaveLength(1);
  });

  it('rejects immediately when cancellation is not accepted while the query remains pending', async () => {
    invokeMock.mockImplementation((command, args) => {
      if (command === 'workspace_query' && requestedQueryKind(args) === 'commitActivity') {
        return new Promise(() => undefined);
      }
      if (command === 'workspace_cancel') return Promise.resolve({ accepted: false });
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const controller = new AbortController();
    const adapter = createTauriWorkspaceAdapter();
    const query = adapter.query(
      {
        kind: 'commitActivity',
        repoId: 'repo-1',
        bucketBoundariesUnixSeconds: [100, 200],
      },
      { signal: controller.signal },
    );
    const queryCall = invokeMock.mock.calls.find(
      ([command, args]) =>
        command === 'workspace_query' && requestedQueryKind(args) === 'commitActivity',
    );
    const queryRequest = queryCall?.[1]?.request;
    if (!isRecord(queryRequest) || !isRecord(queryRequest.query))
      throw new Error('Expected commit activity query request');
    const operationId = queryRequest.query.operationId;
    if (typeof operationId !== 'string') throw new Error('Expected operation id');

    controller.abort();

    await expect(query).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeMock).toHaveBeenCalledWith('workspace_cancel', {
      request: { operationId },
    });
  });

  it('does not start a commit activity query when its signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createTauriWorkspaceAdapter();

    await expect(
      adapter.query(
        {
          kind: 'commitActivity',
          repoId: 'repo-1',
          bucketBoundariesUnixSeconds: [100, 200],
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('polls status without reloading history while HEAD is unchanged', async () => {
    invokeMock.mockImplementation(baseInvoke());
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    await adapter.query({ kind: 'snapshot', repoId: 'repo-1' });
    await adapter.query({ kind: 'snapshot', repoId: 'repo-1' });

    const historyCalls = invokeMock.mock.calls.filter(
      ([command, args]) => command === 'workspace_query' && requestedQueryKind(args) === 'history',
    );
    expect(historyCalls).toHaveLength(1);
  });

  it('reloads History when repository generation detects an external ref change', async () => {
    const attachedSnapshot = snapshot();
    const refreshedSnapshot = { ...attachedSnapshot, repoGeneration: 2 };
    let statusQueries = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_attach') return { repoId: 'repo-1', snapshot: attachedSnapshot };
      if (command === 'workspace_query' && requestedQueryKind(args) === 'history') {
        return {
          kind: 'history',
          data: { commits: [], repoGeneration: statusQueries === 0 ? 1 : 2 },
        };
      }
      if (command === 'workspace_query' && requestedQueryKind(args) === 'status') {
        statusQueries += 1;
        return { kind: 'status', data: refreshedSnapshot };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    await adapter.query({ kind: 'snapshot', repoId: 'repo-1' });

    const historyCalls = invokeMock.mock.calls.filter(
      ([command, args]) => command === 'workspace_query' && requestedQueryKind(args) === 'history',
    );
    expect(historyCalls).toHaveLength(2);
  });

  it('preserves a truncated Diff result for the UI safety boundary', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      const common = baseInvoke();
      if (command === 'workspace_query' && requestedQueryKind(args) === 'diff') {
        return {
          kind: 'diff',
          data: {
            patch: 'diff --git a/large.ts b/large.ts\n',
            diffRevision: 'truncated-revision',
            repoGeneration: 1,
            truncated: true,
          },
        };
      }
      return common(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    const result = await adapter.query({
      kind: 'diff',
      repoId: 'repo-1',
      path: 'large.ts',
      area: 'unstaged',
    });

    expect(result).toEqual({
      kind: 'diff',
      diff: expect.objectContaining({
        diffId: 'truncated-revision',
        truncated: true,
        tooLarge: true,
      }),
    });
  });

  it('passes merge options and merge commit mainline selection through preview requests', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_preview') {
        return {
          confirmationToken: 'confirmation',
          expiresAtUnixMs: 1,
          summary: { id: 'previewAbort' },
          destructive: true,
          affectedPaths: [],
          affectedCommits: [],
          remoteEffect: null,
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    await adapter.preview({
      repoId: 'repo-1',
      action: { kind: 'merge', sourceRef: 'origin/topic', commitImmediately: true },
    });
    await adapter.preview({
      repoId: 'repo-1',
      action: { kind: 'cherryPick', oid: 'merge-oid', mainline: 2 },
    });
    await adapter.preview({
      repoId: 'repo-1',
      action: { kind: 'revert', oid: 'merge-oid', mainline: 1 },
    });

    expect(invokeMock).toHaveBeenCalledWith('workspace_preview', {
      request: {
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: { kind: 'merge', source: 'origin/topic', commitImmediately: true },
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_preview', {
      request: {
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: { kind: 'cherryPick', commit: 'merge-oid', mainline: 2 },
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_preview', {
      request: {
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: { kind: 'revert', commit: 'merge-oid', mainline: 1 },
      },
    });
  });

  it('maps plain and Conventional Commit inputs to tagged wire actions', async () => {
    let generation = 1;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_execute') {
        generation += 1;
        return {
          operationId: `commit-${generation}`,
          summary: { id: 'backendCommitCreated' },
          repoGeneration: generation,
          eventSeq: generation,
          snapshot: { ...snapshot(), repoGeneration: generation, eventSeq: generation },
          command: {
            argv: ['git', 'commit'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'commit',
        input: { format: 'plain', message: 'ordinary message' },
        includeAllChanges: false,
      },
    });
    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'commit',
        input: {
          format: 'conventional',
          type: 'feat',
          scope: 'ui',
          breaking: false,
          description: 'structured message',
          footer: 'Refs: #123',
        },
        includeAllChanges: true,
      },
    });

    const actions = invokeMock.mock.calls
      .filter(([command]) => command === 'workspace_execute')
      .map(([, args]) => args?.request)
      .filter(isRecord)
      .map((request) => request.action);
    expect(actions).toEqual([
      {
        kind: 'commit',
        input: { format: 'plain', message: 'ordinary message' },
        includeAllChanges: false,
      },
      {
        kind: 'commit',
        input: {
          format: 'conventional',
          type: 'feat',
          scope: 'ui',
          breaking: false,
          description: 'structured message',
          body: null,
          footers: [{ token: 'Refs', value: '#123' }],
        },
        includeAllChanges: true,
      },
    ]);
  });

  it('maps explicit Pull and Push targets and Push options to wire actions', async () => {
    let generation = 1;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_execute') {
        generation += 1;
        return {
          operationId: `remote-${generation}`,
          summary: { id: 'backendPushCompleted' },
          repoGeneration: generation,
          eventSeq: generation,
          snapshot: { ...snapshot(), repoGeneration: generation, eventSeq: generation },
          command: {
            argv: ['git'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    await adapter.execute({
      repoId: 'repo-1',
      action: { kind: 'pull', remote: 'backup', remoteBranch: 'develop' },
    });
    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'push',
        remote: 'backup',
        remoteBranch: 'release',
        forceWithLease: true,
        pushTags: true,
      },
    });

    const actions = invokeMock.mock.calls
      .filter(([command]) => command === 'workspace_execute')
      .map(([, args]) => args?.request)
      .filter(isRecord)
      .map((request) => request.action);
    expect(actions).toEqual([
      { kind: 'pull', remote: 'backup', remoteBranch: 'develop' },
      {
        kind: 'push',
        remote: 'backup',
        localBranch: 'main',
        remoteBranch: 'release',
        setUpstream: false,
        forceWithLease: true,
        pushTags: true,
      },
    ]);
  });

  it('sets the selected Push target as upstream only when none exists', async () => {
    const untracked = { ...snapshot(), upstream: null };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_execute') {
        return {
          operationId: 'initial-push',
          summary: { id: 'backendPushCompleted' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: { ...untracked, upstream: 'backup/topic', repoGeneration: 2, eventSeq: 2 },
          command: {
            argv: ['git', 'push'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke(untracked)(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'push',
        remote: 'backup',
        remoteBranch: 'topic',
        forceWithLease: false,
        pushTags: false,
      },
    });

    expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
      request: expect.objectContaining({
        action: expect.objectContaining({ setUpstream: true }),
      }),
    });
  });

  it('keeps preview generation and confirmation tokens inside the adapter boundary', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_preview') {
        return {
          confirmationToken: 'private-confirmation',
          expiresAtUnixMs: 1,
          summary: { id: 'previewDeleteFiles', args: { count: 1 } },
          destructive: true,
          affectedPaths: ['src/app.ts'],
          affectedCommits: [],
          remoteEffect: null,
        };
      }
      if (command === 'workspace_execute') {
        return {
          operationId: 'file-action-1',
          summary: { id: 'backendFilesDeleted', args: { count: 1 } },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: { ...snapshot(), repoGeneration: 2, eventSeq: 2 },
          command: {
            argv: ['app:file-action'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    const action = {
      kind: 'fileAction' as const,
      paths: ['src/app.ts'],
      operation: 'moveToTrash' as const,
    };

    const preview = await adapter.preview({ repoId: 'repo-1', action });

    expect(preview).not.toHaveProperty('generation');
    expect(preview).not.toHaveProperty('confirmationToken');
    await adapter.execute({ repoId: 'repo-1', action, preview });
    expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
      request: expect.objectContaining({
        repoId: 'repo-1',
        expectedGeneration: 1,
        confirmationToken: 'private-confirmation',
      }),
    });
  });

  it('maps multi-file Stage and Unstage to one wire mutation each', async () => {
    let operation = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_execute') {
        operation += 1;
        return {
          operationId: `operation-${operation}`,
          summary: { id: 'backendChangesStaged' },
          repoGeneration: operation + 1,
          eventSeq: operation + 1,
          snapshot: { ...snapshot(), repoGeneration: operation + 1, eventSeq: operation + 1 },
          command: {
            argv: ['git', 'index-update'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    await adapter.execute({
      repoId: 'repo-1',
      action: { kind: 'stageFiles', paths: ['src/one.ts', 'src/two.ts'] },
    });
    await adapter.execute({
      repoId: 'repo-1',
      action: { kind: 'unstageFiles', paths: ['src/one.ts', 'src/two.ts'] },
    });

    const actions = invokeMock.mock.calls
      .filter(([command]) => command === 'workspace_execute')
      .map(([, args]) => args?.request)
      .filter(isRecord)
      .map((request) => request.action);
    expect(actions).toEqual([
      { kind: 'stage', paths: ['src/one.ts', 'src/two.ts'], selection: null },
      { kind: 'unstage', paths: ['src/one.ts', 'src/two.ts'], selection: null },
    ]);
  });

  it('maps line and hunk selections to the tagged wire representation', async () => {
    let operation = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_execute') {
        operation += 1;
        return {
          operationId: `selection-${operation}`,
          summary: { id: 'backendChangesStaged' },
          repoGeneration: operation + 1,
          eventSeq: operation + 1,
          snapshot: { ...snapshot(), repoGeneration: operation + 1, eventSeq: operation + 1 },
          command: {
            argv: ['git', 'apply'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'stageSelection',
        selection: {
          kind: 'lines',
          diffId: 'revision-1',
          path: 'src/app.ts',
          generation: 1,
          side: 'additions',
          startLine: 3,
          endLine: 4,
        },
      },
    });
    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'unstageSelection',
        selection: {
          kind: 'hunk',
          diffId: 'revision-2',
          path: 'src/app.ts',
          generation: 2,
          hunkIndex: 1,
        },
      },
    });
    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'discardSelection',
        selection: {
          kind: 'hunk',
          diffId: 'revision-3',
          path: 'src/app.ts',
          generation: 3,
          hunkIndex: 0,
        },
      },
    });

    const actions = invokeMock.mock.calls
      .filter(([command]) => command === 'workspace_execute')
      .map(([, args]) => args?.request)
      .filter(isRecord)
      .map((request) => request.action);
    expect(actions).toEqual([
      {
        kind: 'stage',
        paths: [],
        selection: {
          kind: 'lines',
          path: 'src/app.ts',
          diffRevision: 'revision-1',
          side: 'additions',
          startLine: 3,
          endLine: 4,
        },
      },
      {
        kind: 'unstage',
        paths: [],
        selection: {
          kind: 'hunk',
          path: 'src/app.ts',
          diffRevision: 'revision-2',
          hunkIndex: 1,
        },
      },
      {
        kind: 'discard',
        paths: [],
        target: 'unstaged',
        selection: {
          kind: 'hunk',
          path: 'src/app.ts',
          diffRevision: 'revision-3',
          hunkIndex: 0,
        },
      },
    ]);
  });

  it.each(['moveToTrash', 'revealInFinder', 'openInDefaultApp'] as const)(
    'maps the typed %s file operation without exposing process arguments',
    async (operation) => {
      invokeMock.mockImplementation(async (command, args) => {
        if (command === 'workspace_execute') {
          return {
            operationId: 'file-action-1',
            summary: { id: 'backendOperationInProgress' },
            repoGeneration: 1,
            eventSeq: 2,
            snapshot: { ...snapshot(), eventSeq: 2 },
            command: {
              argv: ['app:file-action'],
              exitCode: 0,
              stdout: '',
              stderr: '',
              cancelled: false,
            },
          };
        }
        return baseInvoke()(command, args);
      });
      const adapter = createTauriWorkspaceAdapter();
      await adapter.attach({ kind: 'open', path: '/tmp/stella' });

      await adapter.execute({
        repoId: 'repo-1',
        action: { kind: 'fileAction', paths: ['src/app.ts'], operation },
      });

      expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
        request: expect.objectContaining({
          repoId: 'repo-1',
          expectedGeneration: 1,
          action: { kind: 'fileAction', paths: ['src/app.ts'], operation },
        }),
      });
    },
  );

  it('maps FileContents and SaveFile without changing the explicit hash contract', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_query' && requestedQueryKind(args) === 'fileContents') {
        return {
          kind: 'fileContents',
          data: {
            repoId: 'repo-1',
            path: 'src/app.ts',
            text: 'const value = 1;\r\n',
            lineEnding: 'crlf',
            hasUtf8Bom: true,
            contentHash: 'hash-1',
            repoGeneration: 1,
          },
        };
      }
      if (command === 'workspace_execute') {
        return {
          operationId: 'save-file-1',
          summary: { id: 'backendFileSaved' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: { ...snapshot(), repoGeneration: 2, eventSeq: 2 },
          command: {
            argv: ['app:file-save'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    const result = await adapter.query({
      kind: 'fileContents',
      repoId: 'repo-1',
      path: 'src/app.ts',
    });
    expect(result).toEqual({
      kind: 'fileContents',
      document: {
        repoId: 'repo-1',
        path: 'src/app.ts',
        text: 'const value = 1;\r\n',
        lineEnding: 'crlf',
        hasUtf8Bom: true,
        contentHash: 'hash-1',
        generation: 1,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_query', {
      request: {
        repoId: 'repo-1',
        query: { kind: 'fileContents', path: 'src/app.ts' },
      },
    });

    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'saveFile',
        path: 'src/app.ts',
        text: 'const value = 2;\r\n',
        expectedContentHash: 'hash-1',
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
      request: expect.objectContaining({
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: {
          kind: 'saveFile',
          path: 'src/app.ts',
          text: 'const value = 2;\r\n',
          expectedContentHash: 'hash-1',
        },
      }),
    });
  });

  it('exposes typed History pages and preserves graph lanes across the page boundary', async () => {
    const firstPage = [wireCommit('tip-a', ['base']), wireCommit('tip-b', ['base'])];
    const secondPage = [wireCommit('base')];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_attach') return { repoId: 'repo-1', snapshot: snapshot() };
      if (command === 'workspace_query' && requestedQueryKind(args) === 'history') {
        const page = requestedHistoryPage(args);
        return {
          kind: 'history',
          data: {
            commits: page?.skip === 0 ? firstPage : secondPage,
            repoGeneration: 1,
          },
        };
      }
      if (command === 'workspace_query' && requestedQueryKind(args) === 'status')
        return { kind: 'status', data: snapshot() };
      throw new Error(`Unexpected command: ${command}`);
    });
    const adapter = createTauriWorkspaceAdapter();
    const attached = await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    expect(attached.repos[0]?.history.map((commit) => commit.lane)).toEqual([0, 1]);

    const result = await adapter.query({
      kind: 'history',
      repoId: 'repo-1',
      limit: 2,
      skip: 2,
    });
    expect(result).toEqual({
      kind: 'history',
      commits: [expect.objectContaining({ oid: 'base', lane: 0 })],
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_query', {
      request: { repoId: 'repo-1', query: { kind: 'history', limit: 2, skip: 2 } },
    });

    const refreshed = await adapter.query({ kind: 'snapshot', repoId: 'repo-1' });
    if (refreshed.kind !== 'snapshot') throw new Error('Expected snapshot');
    expect(refreshed.snapshot.history.map((commit) => commit.lane)).toEqual([0, 1, 0]);
    expect(invokeMock).toHaveBeenCalledWith('workspace_query', {
      request: {
        repoId: 'repo-1',
        query: { kind: 'history', limit: HISTORY_PAGE_SIZE, skip: 0 },
      },
    });
  });

  it('passes History search to Tauri without replacing the unfiltered cache', async () => {
    const initial = wireCommit('local-head');
    const searchMatch = {
      ...wireCommit('remote-match'),
      refs: ['refs/remotes/origin/feature'],
    };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_attach') return { repoId: 'repo-1', snapshot: snapshot() };
      if (command === 'workspace_query' && requestedQueryKind(args) === 'history') {
        return {
          kind: 'history',
          data: {
            commits: requestedHistorySearch(args) ? [searchMatch] : [initial],
            repoGeneration: 1,
          },
        };
      }
      if (command === 'workspace_query' && requestedQueryKind(args) === 'status') {
        return { kind: 'status', data: snapshot() };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    const result = await adapter.query({
      kind: 'history',
      repoId: 'repo-1',
      limit: HISTORY_PAGE_SIZE,
      skip: 0,
      search: 'origin/feature',
    });
    expect(result).toEqual({
      kind: 'history',
      commits: [expect.objectContaining({ oid: 'remote-match' })],
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_query', {
      request: {
        repoId: 'repo-1',
        query: {
          kind: 'history',
          limit: HISTORY_PAGE_SIZE,
          skip: 0,
          search: 'origin/feature',
        },
      },
    });

    const refreshed = await adapter.query({ kind: 'snapshot', repoId: 'repo-1' });
    if (refreshed.kind !== 'snapshot') throw new Error('Expected snapshot');
    expect(refreshed.snapshot.history.map((commit) => commit.oid)).toEqual(['local-head']);
  });

  it('keeps HEAD oid and failed Git output in the frontend domain', async () => {
    invokeMock.mockImplementation(baseInvoke());
    const adapter = createTauriWorkspaceAdapter();
    const attached = await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    expect(attached.repos[0]?.branch.oid).toBe('head-1');

    const attachCall = invokeMock.mock.calls.find(([command]) => command === 'workspace_attach');
    const args = attachCall?.[1];
    if (!isRecord(args) || !isRecord(args.onEvent) || typeof args.onEvent.listener !== 'function')
      throw new Error('Expected workspace event channel');
    args.onEvent.listener({
      repoId: 'repo-1',
      eventSeq: 5,
      repoGeneration: 2,
      operationId: 'operation-1',
      phase: 'failed',
      summary: { id: 'errorGitFailed' },
      details: {
        stderr: 'policy denied',
        exitCode: '1',
        argv: '["git","push","https://user:secret@example.com/repository.git"]',
      },
    });
    args.onEvent.listener({
      repoId: 'repo-1',
      eventSeq: 4,
      repoGeneration: 2,
      operationId: 'operation-1',
      phase: 'started',
      summary: { id: 'backendOperationInProgress' },
    });

    const result = await adapter.query({ kind: 'activity', repoId: 'repo-1' });
    if (result.kind !== 'activity') throw new Error('Expected activity result');
    expect(result.entries[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        summary: { id: 'errorGitFailed' },
        stderr: 'policy denied',
        exitCode: 1,
        command: 'git push https://***:***@example.com/repository.git',
        eventSeq: 5,
      }),
    );
  });

  it('preserves a raw Tauri argument error returned as a string', async () => {
    invokeMock.mockRejectedValueOnce(
      'invalid args `request` for command `workspace_attach`: missing field `initial_branch`',
    );
    const adapter = createTauriWorkspaceAdapter();

    await expect(adapter.attach({ kind: 'open', path: '/tmp/stella' })).rejects.toMatchObject({
      message: 'The workspace operation failed.',
      details: {
        stderr:
          'invalid args `request` for command `workspace_attach`: missing field `initial_branch`',
      },
    });
  });

  it('keeps a backend message id beside its diagnostic fallback and Git output', async () => {
    invokeMock.mockRejectedValueOnce({
      code: 'gitFailed',
      message: 'Git operation failed',
      localizedMessage: { id: 'errorGitFailed', args: { remote: 'origin' } },
      details: { stderr: 'fatal: rejected', exitCode: '1' },
    });
    const adapter = createTauriWorkspaceAdapter();

    await expect(adapter.attach({ kind: 'open', path: '/tmp/stella' })).rejects.toMatchObject({
      message: 'Git operation failed',
      localizedMessage: { id: 'errorGitFailed', args: { remote: 'origin' } },
      details: { stderr: 'fatal: rejected', exitCode: '1' },
    });
  });

  it('ignores malformed argv details without losing a previous activity command', async () => {
    invokeMock.mockImplementation(baseInvoke());
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });

    const attachCall = invokeMock.mock.calls.find(([command]) => command === 'workspace_attach');
    const args = attachCall?.[1];
    if (!isRecord(args) || !isRecord(args.onEvent) || typeof args.onEvent.listener !== 'function')
      throw new Error('Expected workspace event channel');
    args.onEvent.listener({
      repoId: 'repo-1',
      eventSeq: 5,
      repoGeneration: 2,
      operationId: 'operation-1',
      phase: 'failed',
      summary: { id: 'errorGitFailed' },
      details: { argv: '{broken' },
    });

    const result = await adapter.query({ kind: 'activity', repoId: 'repo-1' });
    if (result.kind !== 'activity') throw new Error('Expected activity result');
    expect(result.entries[0]?.command).toBeUndefined();
  });

  it('refreshes History after Fetch even when HEAD is unchanged', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_execute')
        return {
          operationId: 'fetch-1',
          summary: { id: 'backendFetchCompleted' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: snapshot(),
          command: {
            argv: ['git', 'fetch'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    await adapter.execute({ repoId: 'repo-1', action: { kind: 'fetch', remote: 'backup' } });
    expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
      request: expect.objectContaining({ action: { kind: 'fetch', remote: 'backup' } }),
    });
    const historyCalls = invokeMock.mock.calls.filter(
      ([command, args]) => command === 'workspace_query' && requestedQueryKind(args) === 'history',
    );
    expect(historyCalls).toHaveLength(2);
    const activityResult = await adapter.query({ kind: 'activity' });
    if (activityResult.kind !== 'activity') throw new Error('Expected activity result');
    expect(activityResult.entries[0]?.action).toEqual({ id: 'actionFetch' });
  });

  it('creates and checks out a branch through the typed action', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_preview')
        return {
          confirmationToken: 'branch-preview',
          expiresAtUnixMs: 1,
          summary: { id: 'actionCreateBranch' },
          destructive: false,
          affectedPaths: [],
          affectedCommits: ['head-1'],
          resolvedTargets: [{ input: 'head-1', oid: 'head-1' }],
          lostCommitOids: [],
          remoteEffect: null,
        };
      if (command === 'workspace_execute')
        return {
          operationId: 'branch-1',
          summary: { id: 'backendBranchCreated' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: { ...snapshot(), repoGeneration: 2, eventSeq: 2 },
          command: {
            argv: ['git', 'switch', '-c', 'feature/new-flow', 'head-1'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    const action = {
      kind: 'createBranch' as const,
      name: 'feature/new-flow',
      startOid: 'head-1',
      checkout: true,
    };
    const preview = await adapter.preview({ repoId: 'repo-1', action });

    await adapter.execute({ repoId: 'repo-1', action, preview });

    expect(invokeMock).toHaveBeenCalledWith('workspace_preview', {
      request: {
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: {
          kind: 'createBranch',
          name: 'feature/new-flow',
          startPoint: 'head-1',
          checkout: true,
        },
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
      request: expect.objectContaining({
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: {
          kind: 'createBranch',
          name: 'feature/new-flow',
          startPoint: 'head-1',
          checkout: true,
        },
        confirmationToken: 'branch-preview',
      }),
    });
  });

  it('creates a Tag through the typed action and refreshes History refs', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'workspace_preview')
        return {
          confirmationToken: 'tag-preview',
          expiresAtUnixMs: 1,
          summary: { id: 'actionCreateTag' },
          destructive: false,
          affectedPaths: [],
          affectedCommits: ['head-1'],
          resolvedTargets: [{ input: 'head-1', oid: 'head-1' }],
          lostCommitOids: [],
          remoteEffect: null,
        };
      if (command === 'workspace_execute')
        return {
          operationId: 'tag-1',
          summary: { id: 'backendTagCreated' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: { ...snapshot(), repoGeneration: 2, eventSeq: 2 },
          command: {
            argv: ['git', 'tag', '--no-sign', '--', 'v1.0.0', 'head-1'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      return baseInvoke()(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    const action = { kind: 'createTag' as const, name: 'v1.0.0', targetOid: 'head-1' };
    const preview = await adapter.preview({ repoId: 'repo-1', action });

    await adapter.execute({ repoId: 'repo-1', action, preview });

    expect(invokeMock).toHaveBeenCalledWith('workspace_preview', {
      request: {
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: { kind: 'createTag', name: 'v1.0.0', target: 'head-1' },
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_execute', {
      request: expect.objectContaining({
        repoId: 'repo-1',
        expectedGeneration: 1,
        action: { kind: 'createTag', name: 'v1.0.0', target: 'head-1' },
        confirmationToken: 'tag-preview',
      }),
    });
    const historyCalls = invokeMock.mock.calls.filter(
      ([command, args]) => command === 'workspace_query' && requestedQueryKind(args) === 'history',
    );
    expect(historyCalls).toHaveLength(2);
    const activityResult = await adapter.query({ kind: 'activity' });
    if (activityResult.kind !== 'activity') throw new Error('Expected activity result');
    expect(activityResult.entries[0]?.action).toEqual({ id: 'actionCreateTag' });
  });

  it('preserves the started time from progress events and uses a human action title', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-09T03:00:00.000Z'));
      invokeMock.mockImplementation(async (command, args) => {
        if (command === 'workspace_execute') {
          if (!isRecord(args) || !isRecord(args.request))
            throw new Error('Expected execute request');
          const operationId = args.request.operationId;
          if (typeof operationId !== 'string') throw new Error('Expected operation id');
          const attachCall = invokeMock.mock.calls.find(
            ([candidate]) => candidate === 'workspace_attach',
          );
          const attachArgs = attachCall?.[1];
          if (
            !isRecord(attachArgs) ||
            !isRecord(attachArgs.onEvent) ||
            typeof attachArgs.onEvent.listener !== 'function'
          )
            throw new Error('Expected workspace event channel');
          attachArgs.onEvent.listener({
            repoId: 'repo-1',
            eventSeq: 2,
            repoGeneration: 1,
            operationId,
            phase: 'started',
            summary: { id: 'backendOperationInProgress' },
          });
          vi.setSystemTime(new Date('2026-08-09T03:02:00.000Z'));
          return {
            operationId,
            summary: { id: 'backendChangesStaged' },
            repoGeneration: 1,
            eventSeq: 3,
            snapshot: snapshot(),
            command: {
              argv: ['git', 'add', '--', 'README.md'],
              exitCode: 0,
              stdout: '',
              stderr: '',
              cancelled: false,
            },
          };
        }
        return baseInvoke()(command, args);
      });
      const adapter = createTauriWorkspaceAdapter();
      await adapter.attach({ kind: 'open', path: '/tmp/stella' });

      await adapter.execute({
        repoId: 'repo-1',
        action: { kind: 'stageFiles', paths: ['README.md'] },
      });

      const result = await adapter.query({ kind: 'activity', repoId: 'repo-1' });
      if (result.kind !== 'activity') throw new Error('Expected activity result');
      expect(result.entries[0]).toMatchObject({
        repositoryName: 'stella',
        action: { id: 'actionStageFiles' },
        status: 'succeeded',
        startedAt: '2026-08-09T03:00:00.000Z',
        finishedAt: '2026-08-09T03:02:00.000Z',
        detailAvailability: 'currentSession',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [{ kind: 'merge', incomingOid: null }, false, false, true],
    [{ kind: 'rebase' }, true, true, true],
    [{ kind: 'cherryPick', sourceOid: null }, true, true, true],
    [{ kind: 'revert', sourceOid: null }, true, true, true],
    [{ kind: 'unknown', marker: 'MERGE_HEAD' }, false, false, false],
    [
      { kind: 'pendingStructuredCommit', operation: 'cherryPick', sourceOid: 'a', preHeadOid: 'b' },
      false,
      false,
      true,
    ],
    [
      { kind: 'structuredAbortRecovery', operation: 'revert', sourceOid: 'a', preHeadOid: 'b' },
      false,
      false,
      true,
    ],
  ] satisfies Array<[WireOperationState, boolean, boolean, boolean]>)(
    'maps operation controls for $0',
    async (operation, canContinue, canSkip, canAbort) => {
      invokeMock.mockImplementation(baseInvoke(snapshot(operation)));
      const adapter = createTauriWorkspaceAdapter();
      const workspace = await adapter.attach({ kind: 'open', path: '/tmp/stella' });
      const mapped = workspace.repos[0]?.operation;
      expect(mapped?.kind).toBe(operation.kind);
      if (!mapped || mapped.kind === 'none') throw new Error('Expected active operation');
      expect(mapped.canContinue).toBe(canContinue);
      expect(mapped.canSkip).toBe(canSkip);
      expect(mapped.canAbort).toBe(canAbort);
    },
  );

  it('restores Git Flow conflict recovery controls from the native state marker', async () => {
    invokeMock.mockImplementation(
      baseInvoke({
        ...snapshot({ kind: 'merge', incomingOid: null }),
        gitFlowOperation: 'finish',
      }),
    );
    const adapter = createTauriWorkspaceAdapter();
    const workspace = await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    const operation = workspace.repos[0]?.operation;

    expect(operation).toMatchObject({
      kind: 'merge',
      gitFlowOperation: 'finish',
      label: { id: 'operationGitFlowInProgress', args: { operation: 'finish' } },
      canContinue: true,
      canSkip: false,
      canAbort: true,
    });
  });

  it('replaces an old same-path conflict session before Mark resolved', async () => {
    let conflictQueries = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const common = baseInvoke();
      if (command === 'workspace_query' && requestedQueryKind(args) === 'conflict') {
        conflictQueries += 1;
        return {
          kind: 'conflict',
          data: conflictQueries === 1 ? conflict('old', 'hash-old') : conflict('new', 'hash-new'),
        };
      }
      if (command === 'workspace_execute') {
        return {
          operationId: 'operation-1',
          summary: { id: 'backendConflictResolved' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: snapshot(),
          command: { argv: ['git', 'add'], exitCode: 0, stdout: '', stderr: '', cancelled: false },
        };
      }
      return common(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    await adapter.query({ kind: 'conflict', repoId: 'repo-1', path: 'src/app.ts' });
    const refreshed = await adapter.query({
      kind: 'conflict',
      repoId: 'repo-1',
      path: 'src/app.ts',
    });
    if (refreshed.kind !== 'conflict') throw new Error('Expected conflict');
    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'markConflictResolved',
        sessionId: refreshed.document.sessionId,
        path: refreshed.document.path,
        contentHash: refreshed.document.contentHash,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'workspace_execute',
      expect.objectContaining({
        request: expect.objectContaining({
          action: expect.objectContaining({ sessionId: 'new', contentHash: 'hash-new' }),
        }),
      }),
    );
  });

  it('passes the manual edit base revision through the conflict Choice wire contract', async () => {
    invokeMock.mockImplementation(async (command, args) => {
      const common = baseInvoke();
      if (command === 'workspace_query' && requestedQueryKind(args) === 'conflict') {
        return { kind: 'conflict', data: conflict('session', 'hash') };
      }
      if (command === 'workspace_execute') {
        return {
          operationId: 'operation-1',
          summary: { id: 'backendConflictChoiceApplied' },
          repoGeneration: 2,
          eventSeq: 2,
          snapshot: snapshot(),
          command: {
            argv: ['git', 'choice'],
            exitCode: 0,
            stdout: '',
            stderr: '',
            cancelled: false,
          },
        };
      }
      return common(command, args);
    });
    const adapter = createTauriWorkspaceAdapter();
    await adapter.attach({ kind: 'open', path: '/tmp/stella' });
    const queried = await adapter.query({
      kind: 'conflict',
      repoId: 'repo-1',
      path: 'src/app.ts',
    });
    if (queried.kind !== 'conflict') throw new Error('Expected conflict');

    await adapter.execute({
      repoId: 'repo-1',
      action: {
        kind: 'conflictChoice',
        sessionId: queried.document.sessionId,
        path: queried.document.path,
        blockId: 'block-1',
        choice: 'incoming',
        draftText: 'manual draft\n',
        contentHash: queried.document.contentHash,
        documentRevision: queried.document.documentRevision,
        baseDocumentRevision: 'base-revision',
      },
    });

    expect(invokeMock).toHaveBeenCalledWith(
      'workspace_execute',
      expect.objectContaining({
        request: expect.objectContaining({
          action: expect.objectContaining({
            kind: 'conflictChoice',
            baseDocumentRevision: 'base-revision',
          }),
        }),
      }),
    );
  });
});
