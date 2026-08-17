import { describe, expect, it } from 'vitest';

import { conflictDocument } from '../test/unit/fixtures';
import {
  CONFLICT_HISTORY_BYTE_BUDGET,
  acceptChoiceDocument,
  conflictHistoryChargedBytes,
  createChoiceStamp,
  createConflictHistory,
  editConflictResult,
  isChoiceResponseCurrent,
  isConflictDirty,
  markConflictSaved,
  redoConflictHistory,
  undoConflictHistory,
} from './conflictSession';

describe('conflict history', () => {
  it('undoes and redoes result text and block state together', () => {
    const initial = createConflictHistory(conflictDocument());
    const edited = editConflictResult(initial, 'manual\n', 1_000);
    expect(initial.present.baseDocumentRevision).toBe('revision-1');
    expect(edited.present.baseDocumentRevision).toBe('revision-1');
    const chosen = acceptChoiceDocument(
      edited,
      conflictDocument({
        documentRevision: 'revision-choice',
        result: { text: 'incoming\n', lineEnding: 'lf' },
        blocks: [{ ...conflictDocument().blocks[0]!, state: 'incoming' }],
      }),
    );

    const undone = undoConflictHistory(chosen);
    expect(undone.present.resultText).toBe('manual\n');
    expect(undone.present.blocks[0]?.state).toBe('unresolved');
    expect(undone.present.baseDocumentRevision).toBe('revision-1');
    const redone = redoConflictHistory(undone);
    expect(redone.present.resultText).toBe('incoming\n');
    expect(redone.present.blocks[0]?.state).toBe('incoming');
    expect(redone.present.baseDocumentRevision).toBe('revision-choice');
    expect(isConflictDirty(redone)).toBe(true);
  });

  it('drops history after Save replaces the backend conflict session', () => {
    const edited = editConflictResult(createConflictHistory(conflictDocument()), 'manual\n', 1_000);
    const saved = markConflictSaved(
      edited,
      conflictDocument({
        sessionId: 'session-2',
        documentRevision: 'revision-saved',
        result: { text: 'manual\n', lineEnding: 'lf' },
      }),
    );

    expect(saved.sessionId).toBe('session-2');
    expect(saved.past).toEqual([]);
    expect(saved.future).toEqual([]);
    expect(saved.present.baseDocumentRevision).toBe('revision-saved');
    expect(isConflictDirty(saved)).toBe(false);
  });

  it('rejects a choice response after a local edit', () => {
    const state = createConflictHistory(conflictDocument());
    const stamp = createChoiceStamp(state, 4);
    const edited = editConflictResult(state, 'new draft', 1_000);
    expect(isChoiceResponseCurrent(stamp, edited, 4)).toBe(false);
    expect(isChoiceResponseCurrent(stamp, state, 5)).toBe(false);
  });

  it('bounds performance-mode history while retaining the current server anchor', () => {
    const largeText = 'x'.repeat(5 * 1024 * 1024);
    let state = createConflictHistory(
      conflictDocument({
        documentRevision: 'server-anchor',
        result: { text: largeText, lineEnding: 'lf' },
        blocks: [],
      }),
    );

    for (let index = 1; index <= 12; index += 1) {
      state = acceptChoiceDocument(
        state,
        conflictDocument({
          documentRevision: 'server-anchor',
          result: { text: largeText, lineEnding: 'lf' },
          blocks: [],
        }),
      );
    }
    const anchorRevision = state.present.baseDocumentRevision;
    state = editConflictResult(state, `m${largeText.slice(1)}`, 20_000);

    expect(conflictHistoryChargedBytes(state)).toBeLessThanOrEqual(CONFLICT_HISTORY_BYTE_BUDGET);
    expect(state.past.length).toBeLessThan(12);
    expect(state.present.serverDocumentRevision).toBeNull();
    expect(state.past.some((snapshot) => snapshot.serverDocumentRevision === anchorRevision)).toBe(
      true,
    );
  });
});
