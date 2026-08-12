import fixtures from '../../fixtures/conventional-commits.json';
import { describe, expect, it } from 'vitest';

import {
  isValidConventionalCommitMessage,
  validateCommitInput,
  validatePlainCommitMessage,
} from './commit';

describe('Plain Commit validation', () => {
  it('accepts a single-line Unicode message', () => {
    expect(validatePlainCommitMessage('通常形式でコミットする')).toEqual({});
  });

  it.each(['', '   ', 'first\nsecond', 'first\rsecond', 'first\0second'])(
    'rejects an invalid message: %j',
    (message) => {
      expect(validatePlainCommitMessage(message).description).toBeDefined();
    },
  );
});

describe('Conventional Commit validation', () => {
  it.each(fixtures.valid)('accepts shared valid fixture: %s', (message) => {
    expect(isValidConventionalCommitMessage(message)).toBe(true);
  });

  it.each(fixtures.invalid)('rejects shared invalid fixture: %s', (message) => {
    expect(isValidConventionalCommitMessage(message)).toBe(false);
  });

  it("matches Cocogitto's lowercase-letter-only type", () => {
    expect(validateCommitInput({ type: 'stella', breaking: false, description: 'save' })).toEqual(
      {},
    );
    expect(
      validateCommitInput({ type: 'stella2', breaking: false, description: 'save' }).type,
    ).toBeDefined();
    expect(
      validateCommitInput({ type: 'stella-tool', breaking: false, description: 'save' }).type,
    ).toBeDefined();
  });
});
