import { describe, expect, it } from 'vitest';

import { conflictDocument } from '../test/fixtures';
import { profileConflictDocument } from './performance';

describe('conflict performance profile', () => {
  it('uses standard mode for ordinary text', () => {
    expect(profileConflictDocument(conflictDocument()).mode).toBe('standard');
  });

  it('uses performance mode above 1 MiB', () => {
    const text = `${'x'.repeat(1024)}\n`.repeat(1025);
    expect(
      profileConflictDocument(conflictDocument({ result: { text, lineEnding: 'lf' } })).mode,
    ).toBe('performance');
  });

  it('routes a line longer than 256 KiB externally', () => {
    const text = 'x'.repeat(256 * 1024 + 1);
    expect(
      profileConflictDocument(conflictDocument({ result: { text, lineEnding: 'lf' } })).mode,
    ).toBe('external');
  });
});
