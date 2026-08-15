import { describe, expect, it } from 'vitest';
import type { MicromarkToken, RuleParams } from 'markdownlint';

import { findSentenceViolations } from './sentence-per-line.mts';

function params(line: string): RuleParams {
  const paragraph: MicromarkToken = {
    type: 'paragraph',
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: line.length + 1,
    text: line,
    children: [],
    parent: null,
  };

  return {
    name: 'test.md',
    lines: [line],
    frontMatterLines: [],
    config: true,
    version: 'test',
    parsers: {
      markdownit: {
        tokens: [],
      },
      micromark: {
        tokens: [paragraph],
      },
    },
  };
}

describe('sentence-per-line', () => {
  it.each([
    '最初の文です。次の文です。',
    'First sentence. Second sentence.',
    '続けます！次です。',
    'Continue! Next sentence.',
  ])('detects prose after a sentence terminator: %s', (line) => {
    expect(findSentenceViolations(params(line))).toHaveLength(1);
  });

  it.each([
    '一文だけです。',
    'One sentence.',
    'Node.js 24を使用します。',
    'Version 1.2.0 is supported.',
    'See e.g. README.md for details.',
  ])('allows a single sentence, identifier, version, or abbreviation: %s', (line) => {
    expect(findSentenceViolations(params(line))).toHaveLength(0);
  });
});
