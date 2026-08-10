import type { ConflictDocument, RepoSnapshot } from '../domain/workspace';

export function conflictDocument(overrides: Partial<ConflictDocument> = {}): ConflictDocument {
  return {
    sessionId: 'session-1',
    repoId: 'repo-1',
    path: 'src/app.ts',
    operation: 'merge',
    conflictGeneration: 'generation-1',
    contentHash: 'hash-1',
    documentRevision: 'revision-1',
    labels: {
      current: { id: 'conflictCurrentBranch' },
      incoming: { id: 'conflictMergedBranch' },
    },
    sides: {
      base: { oid: 'base', mode: '100644', text: 'const n = 0;\n' },
      current: { oid: 'current', mode: '100644', text: 'const n = 1;\n' },
      incoming: { oid: 'incoming', mode: '100644', text: 'const n = 2;\n' },
    },
    result: { text: 'const n = 1;\n', lineEnding: 'lf' },
    blocks: [
      {
        id: 'block-1',
        rangeUtf16: { from: 0, to: 12 },
        replacements: {
          current: 'const n = 1;',
          incoming: 'const n = 2;',
          both: 'const n = 1;\nconst n = 2;',
        },
        state: 'unresolved',
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
    ...overrides,
  };
}

export function repoSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    repoId: 'repo-1',
    name: 'stella',
    path: '/tmp/stella',
    generation: 1,
    eventSeq: 1,
    branch: { name: 'main', detached: false, upstream: 'origin/main', ahead: 0, behind: 0 },
    operation: { kind: 'none' },
    changes: [],
    history: [],
    ...overrides,
  };
}
