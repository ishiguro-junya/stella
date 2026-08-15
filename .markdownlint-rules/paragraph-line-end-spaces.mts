import type { MicromarkToken, Rule, RuleOnError, RuleOnErrorInfo, RuleParams } from 'markdownlint';

const requiredSpaces = '  ';
const sentenceLineEnd = /[。！？.!?](?:[」』）】〉》〕］｝”’"')\]}*_~]*)[ \t]*$/u;

function collectParagraphs(tokens: MicromarkToken[]): MicromarkToken[] {
  const paragraphs: MicromarkToken[] = [];
  const visit = (token: MicromarkToken, inList = false) => {
    const nestedInList = inList || token.type.startsWith('list');
    if (token.type === 'paragraph') {
      if (!nestedInList) {
        paragraphs.push(token);
      }
      return;
    }
    for (const child of token.children ?? []) {
      visit(child, nestedInList);
    }
  };
  for (const token of tokens) {
    visit(token);
  }
  return paragraphs;
}

export function findParagraphLineEndSpaceViolations(params: RuleParams): RuleOnErrorInfo[] {
  const violations: RuleOnErrorInfo[] = [];
  const paragraphs = collectParagraphs(params.parsers.micromark.tokens);

  for (const paragraph of paragraphs) {
    for (let lineNumber = paragraph.startLine; lineNumber <= paragraph.endLine; lineNumber++) {
      const line = params.lines[lineNumber - 1] ?? '';
      if (!sentenceLineEnd.test(line)) {
        continue;
      }

      const trailingWhitespace = line.match(/[ \t]+$/u)?.[0] ?? '';
      if (trailingWhitespace === requiredSpaces) {
        continue;
      }

      violations.push({
        lineNumber,
        detail: `行末の半角空白は2つ必要です。現在は${trailingWhitespace.length}つです`,
        context: line,
        fixInfo: {
          editColumn: line.length - trailingWhitespace.length + 1,
          deleteCount: trailingWhitespace.length,
          insertText: requiredSpaces,
        },
      });
    }
  }
  return violations;
}

export default {
  names: ['paragraph-line-end-spaces'],
  description: '箇条書きを除く文章行の末尾に半角空白2つを付けます',
  tags: ['whitespace'],
  parser: 'micromark',
  function: function paragraphLineEndSpaces(params: RuleParams, onError: RuleOnError) {
    for (const violation of findParagraphLineEndSpaceViolations(params)) {
      onError(violation);
    }
  },
} satisfies Rule;
