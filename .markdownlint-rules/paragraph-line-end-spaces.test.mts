import { describe, expect, it } from 'vitest';
import type { MicromarkToken, RuleParams } from 'markdownlint';

import { findParagraphLineEndSpaceViolations } from './paragraph-line-end-spaces.mts';

function params(line: string, nested = false): RuleParams {
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

  const list: MicromarkToken = {
    ...paragraph,
    type: 'listUnordered',
    children: [paragraph],
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
        tokens: nested ? [list] : [paragraph],
      },
    },
  };
}

describe('paragraph-line-end-spaces', () => {
  it.each(['日本語の文章です。', 'English sentence.'])(
    'detects a sentence without two trailing spaces: %s',
    (line) => {
      expect(findParagraphLineEndSpaceViolations(params(line))).toHaveLength(1);
    },
  );

  it.each(['日本語の文章です。  ', 'English sentence.  '])(
    'allows two trailing spaces: %s',
    (line) => {
      expect(findParagraphLineEndSpaceViolations(params(line))).toHaveLength(0);
    },
  );

  it.each([
    '![画面](image.png)',
    '[ドキュメント](docs/writing.md)',
    '`README.md`',
    '箇条書きです。',
  ])('ignores a non-sentence or list item line: %s', (line) => {
    expect(
      findParagraphLineEndSpaceViolations(params(line, line === '箇条書きです。')),
    ).toHaveLength(0);
  });
});
