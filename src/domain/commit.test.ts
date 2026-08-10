import fixtures from '../../fixtures/conventional-commits.json';
import { describe, expect, it } from 'vitest';

import { isValidConventionalCommitMessage, validateCommitInput } from './commit';

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
