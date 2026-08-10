// @ts-check

const sentenceTerminator = '。';
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

/**
 * @param {Map<number, Uint8Array>} masks Masks by 1-based line number.
 * @param {number} lineNumber 1-based line number.
 * @param {number} lineLength Line length.
 * @returns {Uint8Array} Line mask.
 */
function lineMask(masks, lineNumber, lineLength) {
  let mask = masks.get(lineNumber);
  if (!mask) {
    mask = new Uint8Array(lineLength);
    masks.set(lineNumber, mask);
  }
  return mask;
}

/**
 * @param {import("markdownlint").MicromarkToken} token Token to mask.
 * @param {string[]} lines Markdown lines.
 * @param {Map<number, Uint8Array>} masks Masks by line.
 */
function maskToken(token, lines, masks) {
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

/**
 * @param {import("markdownlint").MicromarkToken[]} tokens Tokens to search.
 * @returns {import("markdownlint").MicromarkToken[]} Paragraph tokens.
 */
function collectParagraphs(tokens) {
  const paragraphs = [];
  const visit = (token) => {
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

/**
 * @param {import("markdownlint").MicromarkToken} paragraph Paragraph token.
 * @param {string[]} lines Markdown lines.
 * @returns {{breaks: Map<number, number[]>, masks: Map<number, Uint8Array>, skip: boolean}} Syntax exclusions.
 */
function syntaxExclusions(paragraph, lines) {
  const masks = new Map();
  const breaks = new Map();
  let skip = false;

  const visit = (token) => {
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

/**
 * @param {string} line Line text.
 * @param {number} index Character index.
 * @returns {boolean} Whether the character is escaped.
 */
function isEscaped(line, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

/**
 * @param {import("markdownlint").MicromarkToken} paragraph Paragraph token.
 * @param {string[]} lines Markdown lines.
 * @param {Map<number, Uint8Array>} syntaxMasks Syntax masks.
 * @returns {Map<number, Uint8Array>} Delimiter masks.
 */
function delimiterExclusions(paragraph, lines, syntaxMasks) {
  const masks = new Map();

  for (const quote of symmetricQuotes) {
    const positions = [];
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
      const opening = positions[position];
      const closing = positions[position + 1];
      for (let lineNumber = opening.lineNumber; lineNumber <= closing.lineNumber; lineNumber++) {
        const line = lines[lineNumber - 1] ?? '';
        const start = lineNumber === opening.lineNumber ? opening.index : 0;
        const end = lineNumber === closing.lineNumber ? closing.index + 1 : line.length;
        lineMask(masks, lineNumber, line.length).fill(1, start, end);
      }
    }
  }

  /** @type {string[]} */
  const delimiterStack = [];
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

/**
 * @param {string} character Character to classify.
 * @returns {boolean} Whether it represents visible prose.
 */
function isMeaningful(character) {
  return (
    character === '※' ||
    (meaningfulCharacter.test(character) && !ignoredFormattingSymbols.has(character))
  );
}

/**
 * @param {string} line Line text.
 * @param {number} start Start index.
 * @param {number} end End index.
 * @param {Uint8Array | undefined} syntaxMask Syntax mask.
 * @param {Uint8Array | undefined} delimiterMask Delimiter mask.
 * @returns {boolean} Whether later prose exists.
 */
function hasLaterProse(line, start, end, syntaxMask, delimiterMask) {
  for (let index = start; index < end; index++) {
    if (!syntaxMask?.[index] && !delimiterMask?.[index] && isMeaningful(line[index])) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} line Line text.
 * @param {number} index Character index.
 * @returns {boolean} Whether the terminator is being described as punctuation.
 */
function isSentenceTerminatorExample(line, index) {
  const before = line.slice(0, index);
  const after = line.slice(index + sentenceTerminator.length);
  const followsName =
    before.endsWith(sentenceTerminatorName) &&
    explanationParticles.some((particle) => after.startsWith(particle));
  const precedesName = explanationParticles.some((particle) =>
    after.startsWith(`${particle}${sentenceTerminatorName}`),
  );
  return followsName || precedesName;
}

/**
 * @param {import("markdownlint").RuleParams} params Rule parameters.
 * @returns {import("markdownlint").RuleOnErrorInfo[]} Violations.
 */
export function findJapaneseSentenceViolations(params) {
  const violations = [];
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
        if (
          line[index] !== sentenceTerminator ||
          syntaxMask?.[index] ||
          delimiterMask?.[index] ||
          isSentenceTerminatorExample(line, index) ||
          line[index - 1] === sentenceTerminator ||
          line[index + 1] === sentenceTerminator
        ) {
          continue;
        }

        const nextBreak = lineBreaks.find((lineBreak) => lineBreak > index) ?? end;
        if (hasLaterProse(line, index + 1, nextBreak, syntaxMask, delimiterMask)) {
          violations.push({
            lineNumber,
            detail: 'Japanese sentence must be followed by a line break',
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
  names: ['japanese-sentence-per-line'],
  description: 'Japanese sentences must start on a new line after 。',
  tags: ['whitespace', 'language'],
  parser: 'micromark',
  function: function japaneseSentencePerLine(params, onError) {
    for (const violation of findJapaneseSentenceViolations(params)) {
      onError(violation);
    }
  },
};
