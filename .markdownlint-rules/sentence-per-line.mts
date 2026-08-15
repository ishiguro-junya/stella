import type { MicromarkToken, Rule, RuleOnError, RuleOnErrorInfo, RuleParams } from 'markdownlint';

const sentenceTerminators = new Set(['。', '！', '？', '.', '!', '?']);
const excludedTokenTypes = new Set([
  'autolink',
  'characterReference',
  'codeText',
  'gfmFootnoteCall',
  'image',
  'link',
  'literalAutolink',
  'mathText',
]);
const pairedDelimiters = new Map([
  ['「', '」'],
  ['『', '』'],
  ['（', '）'],
  ['【', '】'],
  ['〈', '〉'],
  ['《', '》'],
  ['〔', '〕'],
  ['［', '］'],
  ['｛', '｝'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['“', '”'],
  ['‘', '’'],
]);
const symmetricQuotes = ['"', "'"];
const ignoredFormattingSymbols = new Set(['*', '+', '=', '^', '_', '~']);
const meaningfulCharacter = /[\p{L}\p{N}\p{S}]/u;
const htmlBreak = /^<br(?:\s[^>]*)?\s*\/?\s*>$/iu;
const sentenceTerminatorName = '句点';
const explanationParticles = ['が', 'で', 'と', 'に', 'の', 'は', 'へ', 'も', 'を'];

function lineMask(
  masks: Map<number, Uint8Array>,
  lineNumber: number,
  lineLength: number,
): Uint8Array {
  let mask = masks.get(lineNumber);
  if (!mask) {
    mask = new Uint8Array(lineLength);
    masks.set(lineNumber, mask);
  }
  return mask;
}

function maskToken(
  token: MicromarkToken,
  lines: readonly string[],
  masks: Map<number, Uint8Array>,
): void {
  for (let lineNumber = token.startLine; lineNumber <= token.endLine; lineNumber++) {
    const line = lines[lineNumber - 1] ?? '';
    const start = lineNumber === token.startLine ? token.startColumn - 1 : 0;
    const end = lineNumber === token.endLine ? token.endColumn - 1 : line.length;
    lineMask(masks, lineNumber, line.length).fill(
      1,
      Math.max(0, start),
      Math.min(line.length, end),
    );
  }
}

function collectParagraphs(tokens: MicromarkToken[]): MicromarkToken[] {
  const paragraphs: MicromarkToken[] = [];
  const visit = (token: MicromarkToken) => {
    if (token.type === 'paragraph') {
      paragraphs.push(token);
      return;
    }
    for (const child of token.children ?? []) {
      visit(child);
    }
  };
  for (const token of tokens) {
    visit(token);
  }
  return paragraphs;
}

function syntaxExclusions(
  paragraph: MicromarkToken,
  lines: readonly string[],
): { breaks: Map<number, number[]>; masks: Map<number, Uint8Array>; skip: boolean } {
  const masks = new Map<number, Uint8Array>();
  const breaks = new Map<number, number[]>();
  let skip = false;

  const visit = (token: MicromarkToken) => {
    if (token.type === 'htmlText') {
      maskToken(token, lines, masks);
      if (htmlBreak.test(token.text.trim()) && token.startLine === token.endLine) {
        const lineBreaks = breaks.get(token.startLine) ?? [];
        lineBreaks.push(token.startColumn - 1);
        breaks.set(token.startLine, lineBreaks);
      } else {
        skip = true;
      }
      return;
    }
    if (excludedTokenTypes.has(token.type)) {
      maskToken(token, lines, masks);
      return;
    }
    for (const child of token.children ?? []) {
      visit(child);
    }
  };

  for (const child of paragraph.children ?? []) {
    visit(child);
  }
  for (const lineBreaks of breaks.values()) {
    lineBreaks.sort((left, right) => left - right);
  }
  return { breaks, masks, skip };
}

function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function delimiterExclusions(
  paragraph: MicromarkToken,
  lines: readonly string[],
  syntaxMasks: Map<number, Uint8Array>,
): Map<number, Uint8Array> {
  const masks = new Map<number, Uint8Array>();

  for (const quote of symmetricQuotes) {
    const positions: Array<{ index: number; lineNumber: number }> = [];
    for (let lineNumber = paragraph.startLine; lineNumber <= paragraph.endLine; lineNumber++) {
      const line = lines[lineNumber - 1] ?? '';
      const syntaxMask = syntaxMasks.get(lineNumber);
      const start = lineNumber === paragraph.startLine ? paragraph.startColumn - 1 : 0;
      const end = lineNumber === paragraph.endLine ? paragraph.endColumn - 1 : line.length;
      for (let index = start; index < end; index++) {
        if (line[index] === quote && !syntaxMask?.[index] && !isEscaped(line, index)) {
          positions.push({ index, lineNumber });
        }
      }
    }
    for (let position = 0; position + 1 < positions.length; position += 2) {
      const opening = positions[position]!;
      const closing = positions[position + 1]!;
      for (let lineNumber = opening.lineNumber; lineNumber <= closing.lineNumber; lineNumber++) {
        const line = lines[lineNumber - 1] ?? '';
        const start = lineNumber === opening.lineNumber ? opening.index : 0;
        const end = lineNumber === closing.lineNumber ? closing.index + 1 : line.length;
        lineMask(masks, lineNumber, line.length).fill(1, start, end);
      }
    }
  }

  const delimiterStack: string[] = [];
  for (let lineNumber = paragraph.startLine; lineNumber <= paragraph.endLine; lineNumber++) {
    const line = lines[lineNumber - 1] ?? '';
    const syntaxMask = syntaxMasks.get(lineNumber);
    const delimiterMask = lineMask(masks, lineNumber, line.length);
    const start = lineNumber === paragraph.startLine ? paragraph.startColumn - 1 : 0;
    const end = lineNumber === paragraph.endLine ? paragraph.endColumn - 1 : line.length;

    for (let index = start; index < end; index++) {
      if (syntaxMask?.[index] || delimiterMask[index]) {
        continue;
      }

      const character = line[index];
      if (character === undefined) {
        continue;
      }
      if (delimiterStack.length > 0) {
        delimiterMask[index] = 1;
        if (delimiterStack.at(-1) === character) {
          delimiterStack.pop();
          continue;
        }
      }

      const closer = pairedDelimiters.get(character);
      if (closer) {
        delimiterMask[index] = 1;
        delimiterStack.push(closer);
      }
    }
  }
  return masks;
}

function isMeaningful(character: string): boolean {
  return (
    character === '※' ||
    (meaningfulCharacter.test(character) && !ignoredFormattingSymbols.has(character))
  );
}

function hasLaterProse(
  line: string,
  start: number,
  end: number,
  syntaxMask: Uint8Array | undefined,
  delimiterMask: Uint8Array | undefined,
): boolean {
  for (let index = start; index < end; index++) {
    if (!syntaxMask?.[index] && !delimiterMask?.[index] && isMeaningful(line[index] ?? '')) {
      return true;
    }
  }
  return false;
}

function isSentenceTerminatorExample(line: string, index: number): boolean {
  if (line[index] !== '。') return false;
  const before = line.slice(0, index);
  const after = line.slice(index + 1);
  const followsName =
    before.endsWith(sentenceTerminatorName) &&
    explanationParticles.some((particle) => after.startsWith(particle));
  const precedesName = explanationParticles.some((particle) =>
    after.startsWith(`${particle}${sentenceTerminatorName}`),
  );
  return followsName || precedesName;
}

function isNonTerminalPeriod(line: string, index: number): boolean {
  if (line[index] !== '.') return false;
  const previous = line[index - 1] ?? '';
  const next = line[index + 1] ?? '';
  if (/\p{L}|\p{N}/u.test(previous) && /\p{L}|\p{N}/u.test(next)) return true;
  const prefix = line.slice(0, index + 1);
  return /(?:\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|No|Fig)\.|\b[A-Z]\.)$/iu.test(prefix);
}

export function findSentenceViolations(params: RuleParams): RuleOnErrorInfo[] {
  const violations: RuleOnErrorInfo[] = [];
  const paragraphs = collectParagraphs(params.parsers.micromark.tokens);

  for (const paragraph of paragraphs) {
    const { breaks, masks: syntaxMasks, skip } = syntaxExclusions(paragraph, params.lines);
    if (skip) {
      continue;
    }
    const delimiterMasks = delimiterExclusions(paragraph, params.lines, syntaxMasks);

    for (let lineNumber = paragraph.startLine; lineNumber <= paragraph.endLine; lineNumber++) {
      const line = params.lines[lineNumber - 1] ?? '';
      const start = lineNumber === paragraph.startLine ? paragraph.startColumn - 1 : 0;
      const end = lineNumber === paragraph.endLine ? paragraph.endColumn - 1 : line.length;
      const syntaxMask = syntaxMasks.get(lineNumber);
      const delimiterMask = delimiterMasks.get(lineNumber);
      const lineBreaks = breaks.get(lineNumber) ?? [];

      for (let index = start; index < end; index++) {
        const character = line[index] ?? '';
        if (
          !sentenceTerminators.has(character) ||
          syntaxMask?.[index] ||
          delimiterMask?.[index] ||
          isSentenceTerminatorExample(line, index) ||
          isNonTerminalPeriod(line, index) ||
          line[index - 1] === character ||
          line[index + 1] === character
        ) {
          continue;
        }

        const nextBreak = lineBreaks.find((lineBreak) => lineBreak > index) ?? end;
        if (hasLaterProse(line, index + 1, nextBreak, syntaxMask, delimiterMask)) {
          violations.push({
            lineNumber,
            detail: 'Sentence must be followed by a line break',
            context: line,
            range: [index + 1, 1],
          });
        }
      }
    }
  }
  return violations;
}

export default {
  names: ['sentence-per-line'],
  description: 'Sentences must start on a new line after a terminator',
  tags: ['whitespace', 'language'],
  parser: 'micromark',
  function: function sentencePerLine(params: RuleParams, onError: RuleOnError) {
    for (const violation of findSentenceViolations(params)) {
      onError(violation);
    }
  },
} satisfies Rule;
