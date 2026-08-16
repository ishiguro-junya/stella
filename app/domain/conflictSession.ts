import type { ConflictBlock, ConflictDocument } from './workspace';

export interface ConflictSnapshot {
  resultText: string;
  blocks: ConflictBlock[];
  contentHash: string;
  baseDocumentRevision: string;
  serverDocumentRevision: string | null;
  revision: number;
}

export interface ConflictHistoryState {
  sessionId: string;
  conflictGeneration: string;
  past: ConflictSnapshot[];
  present: ConflictSnapshot;
  future: ConflictSnapshot[];
  savedKey: string;
  clock: number;
  lastEditAt: number | undefined;
  lastChange: 'reset' | 'edit' | 'choice' | 'undo' | 'redo' | 'save';
}

export interface ChoiceRequestStamp {
  requestId: number;
  sessionId: string;
  conflictGeneration: string;
  contentHash: string;
  documentRevision: number;
}

const MAX_HISTORY_ENTRIES = 100;
// このメモリ計算規則を`conflict.rs`と一致させる。
// UTF-16のコード単位あたり4バイトなら、JavaScriptとRustの文字列を実行環境間で多めに見積もれる。
export const CONFLICT_HISTORY_BYTE_BUDGET = 96 * 1024 * 1024;
const SNAPSHOT_OVERHEAD_BYTES = 128;
const BLOCK_SNAPSHOT_OVERHEAD_BYTES = 256;
const EDIT_COALESCE_MS = 650;

function cloneBlocks(blocks: ConflictBlock[]): ConflictBlock[] {
  return blocks.map((block) => ({
    ...block,
    rangeUtf16: { ...block.rangeUtf16 },
    replacements: { ...block.replacements },
  }));
}

function snapshotKey(snapshot: Pick<ConflictSnapshot, 'resultText' | 'blocks'>): string {
  const states = snapshot.blocks.map((block) => `${block.id}:${block.state}`).join('|');
  return `${snapshot.resultText}\u0000${states}`;
}

function documentSnapshot(document: ConflictDocument, revision: number): ConflictSnapshot {
  return {
    resultText: document.result.text,
    blocks: cloneBlocks(document.blocks),
    contentHash: document.contentHash,
    baseDocumentRevision: document.documentRevision,
    serverDocumentRevision: document.documentRevision,
    revision,
  };
}

export function conflictSnapshotChargedBytes(snapshot: ConflictSnapshot): number {
  return snapshot.blocks.reduce(
    (bytes, block) => bytes + BLOCK_SNAPSHOT_OVERHEAD_BYTES + block.id.length * 4,
    SNAPSHOT_OVERHEAD_BYTES + snapshot.resultText.length * 4,
  );
}

export function conflictHistoryChargedBytes(
  state: Pick<ConflictHistoryState, 'past' | 'present' | 'future'>,
): number {
  return [...state.past, state.present, ...state.future].reduce(
    (bytes, snapshot) => bytes + conflictSnapshotChargedBytes(snapshot),
    0,
  );
}

function boundHistory(
  past: ConflictSnapshot[],
  present: ConflictSnapshot,
  future: ConflictSnapshot[],
): { past: ConflictSnapshot[]; future: ConflictSnapshot[] } {
  const boundedPast = [...past];
  const boundedFuture = [...future];
  const timeline = [...boundedPast, present, ...boundedFuture];
  const latestAnchor = timeline.findLast((snapshot) => snapshot.serverDocumentRevision !== null);
  const currentBaseAnchor = timeline.findLast(
    (snapshot) => snapshot.serverDocumentRevision === present.baseDocumentRevision,
  );
  const pinnedAnchors = new Set(
    [latestAnchor, currentBaseAnchor].filter(
      (snapshot): snapshot is ConflictSnapshot => snapshot !== undefined,
    ),
  );
  const isPinnedAnchor = (snapshot: ConflictSnapshot): boolean => pinnedAnchors.has(snapshot);
  let chargedBytes = conflictHistoryChargedBytes({
    past: boundedPast,
    present,
    future: boundedFuture,
  });

  while (
    boundedPast.length + boundedFuture.length > MAX_HISTORY_ENTRIES ||
    chargedBytes > CONFLICT_HISTORY_BYTE_BUDGET
  ) {
    const oldestPast = boundedPast.findIndex((snapshot) => !isPinnedAnchor(snapshot));
    if (oldestPast >= 0) {
      const [removed] = boundedPast.splice(oldestPast, 1);
      if (removed) chargedBytes -= conflictSnapshotChargedBytes(removed);
      continue;
    }
    const farthestFuture = boundedFuture.findLastIndex((snapshot) => !isPinnedAnchor(snapshot));
    if (farthestFuture >= 0) {
      const [removed] = boundedFuture.splice(farthestFuture, 1);
      if (removed) chargedBytes -= conflictSnapshotChargedBytes(removed);
      continue;
    }
    if (
      currentBaseAnchor &&
      currentBaseAnchor !== latestAnchor &&
      currentBaseAnchor !== present &&
      pinnedAnchors.delete(currentBaseAnchor)
    ) {
      continue;
    }
    break;
  }

  return { past: boundedPast, future: boundedFuture };
}

export function createConflictHistory(document: ConflictDocument): ConflictHistoryState {
  const present = documentSnapshot(document, 0);
  return {
    sessionId: document.sessionId,
    conflictGeneration: document.conflictGeneration,
    past: [],
    present,
    future: [],
    savedKey: snapshotKey(present),
    clock: 0,
    lastEditAt: undefined,
    lastChange: 'reset',
  };
}

export function editConflictResult(
  state: ConflictHistoryState,
  resultText: string,
  now = Date.now(),
): ConflictHistoryState {
  if (resultText === state.present.resultText) return state;

  const nextClock = state.clock + 1;
  const next: ConflictSnapshot = {
    ...state.present,
    resultText,
    blocks: cloneBlocks(state.present.blocks),
    serverDocumentRevision: null,
    revision: nextClock,
  };
  const coalesce =
    state.lastChange === 'edit' &&
    state.lastEditAt !== undefined &&
    now - state.lastEditAt <= EDIT_COALESCE_MS;

  const bounded = boundHistory(coalesce ? state.past : [...state.past, state.present], next, []);
  return {
    ...state,
    past: bounded.past,
    present: next,
    future: bounded.future,
    clock: nextClock,
    lastEditAt: now,
    lastChange: 'edit',
  };
}

export function acceptChoiceDocument(
  state: ConflictHistoryState,
  document: ConflictDocument,
): ConflictHistoryState {
  const nextClock = state.clock + 1;
  const present = documentSnapshot(document, nextClock);
  const bounded = boundHistory([...state.past, state.present], present, []);
  return {
    ...state,
    sessionId: document.sessionId,
    conflictGeneration: document.conflictGeneration,
    past: bounded.past,
    present,
    future: bounded.future,
    clock: nextClock,
    lastEditAt: undefined,
    lastChange: 'choice',
  };
}

export function undoConflictHistory(state: ConflictHistoryState): ConflictHistoryState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  const nextClock = state.clock + 1;
  const present = { ...previous, blocks: cloneBlocks(previous.blocks), revision: nextClock };
  const bounded = boundHistory(state.past.slice(0, -1), present, [
    { ...state.present, blocks: cloneBlocks(state.present.blocks) },
    ...state.future,
  ]);

  return {
    ...state,
    past: bounded.past,
    present,
    future: bounded.future,
    clock: nextClock,
    lastEditAt: undefined,
    lastChange: 'undo',
  };
}

export function redoConflictHistory(state: ConflictHistoryState): ConflictHistoryState {
  const [next, ...rest] = state.future;
  if (!next) return state;
  const nextClock = state.clock + 1;
  const present = { ...next, blocks: cloneBlocks(next.blocks), revision: nextClock };
  const bounded = boundHistory([...state.past, state.present], present, rest);

  return {
    ...state,
    past: bounded.past,
    present,
    future: bounded.future,
    clock: nextClock,
    lastEditAt: undefined,
    lastChange: 'redo',
  };
}

export function markConflictSaved(
  state: ConflictHistoryState,
  document: ConflictDocument,
): ConflictHistoryState {
  const present = documentSnapshot(document, state.clock + 1);
  const nextClock = state.clock + 1;

  return {
    ...state,
    sessionId: document.sessionId,
    conflictGeneration: document.conflictGeneration,
    past: [],
    present,
    future: [],
    savedKey: snapshotKey(present),
    clock: nextClock,
    lastEditAt: undefined,
    lastChange: 'save',
  };
}

export function replaceConflictFromExternal(document: ConflictDocument): ConflictHistoryState {
  return createConflictHistory(document);
}

export function isConflictDirty(state: ConflictHistoryState): boolean {
  return snapshotKey(state.present) !== state.savedKey;
}

export function allConflictBlocksResolved(state: ConflictHistoryState): boolean {
  return state.present.blocks.every((block) => block.state !== 'unresolved');
}

export function createChoiceStamp(
  state: ConflictHistoryState,
  requestId: number,
): ChoiceRequestStamp {
  return {
    requestId,
    sessionId: state.sessionId,
    conflictGeneration: state.conflictGeneration,
    contentHash: state.present.contentHash,
    documentRevision: state.present.revision,
  };
}

export function isChoiceResponseCurrent(
  stamp: ChoiceRequestStamp,
  state: ConflictHistoryState,
  latestRequestId: number,
): boolean {
  return (
    stamp.requestId === latestRequestId &&
    stamp.sessionId === state.sessionId &&
    stamp.conflictGeneration === state.conflictGeneration &&
    stamp.contentHash === state.present.contentHash &&
    stamp.documentRevision === state.present.revision
  );
}
