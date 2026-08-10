// @ts-check

const requiredSpaces = '  ';

export default {
  names: ['paragraph-line-end-spaces'],
  description: 'Paragraph lines must end with two spaces',
  tags: ['whitespace'],
  parser: 'micromark',
  function: function paragraphLineEndSpaces(params, onError) {
    const contentTokens = params.parsers.micromark.tokens.filter(
      (token) => token.type === 'content',
    );

    for (const contentToken of contentTokens) {
      const paragraphs = (contentToken.children ?? []).filter(
        (token) => token.type === 'paragraph',
      );

      for (const paragraph of paragraphs) {
        for (let lineNumber = paragraph.startLine; lineNumber <= paragraph.endLine; lineNumber++) {
          const line = params.lines[lineNumber - 1];
          const trailingWhitespace = line.match(/[ \t]+$/u)?.[0] ?? '';

          if (trailingWhitespace === requiredSpaces) {
            continue;
          }

          const editColumn = line.length - trailingWhitespace.length + 1;
          onError({
            lineNumber: lineNumber,
            detail: `Expected: 2 trailing spaces; Actual: ${trailingWhitespace.length}`,
            context: line,
            fixInfo: {
              editColumn,
              deleteCount: trailingWhitespace.length,
              insertText: requiredSpaces,
            },
          });
        }
      }
    }
  },
};
