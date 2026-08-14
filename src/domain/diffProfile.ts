import { parsePatchFiles } from '@pierre/diffs';

const STANDARD_BYTES = 1024 * 1024;
const STANDARD_LINES = 20_000;
const PERFORMANCE_MAX_LINE_BYTES = 256 * 1024;
const BINARY_PATCH_PATTERN = /(?:^|\n)(?:GIT binary patch|Binary files .+ differ)(?:\n|$)/u;

export interface DiffPatchProfile {
  binary: boolean;
  performanceMode: boolean;
  bytes: number;
  lines: number;
  maxLineBytes: number;
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function profileDiffPatch(patch: string, truncated = false): DiffPatchProfile {
  const patchLines = patch.split('\n');
  const patchBytes = bytes(patch);
  const maxLineBytes = patchLines.reduce((maximum, line) => Math.max(maximum, bytes(line)), 0);
  const filePatches = patch.split(/^diff --git /gmu).slice(1);
  const binary =
    BINARY_PATCH_PATTERN.test(patch) &&
    filePatches.every((filePatch) => BINARY_PATCH_PATTERN.test(filePatch));
  return {
    binary,
    performanceMode:
      !binary &&
      (truncated ||
        patchBytes > STANDARD_BYTES ||
        patchLines.length > STANDARD_LINES ||
        maxLineBytes > PERFORMANCE_MAX_LINE_BYTES),
    bytes: patchBytes,
    lines: patchLines.length,
    maxLineBytes,
  };
}

export function patchContainsMultipleFiles(patch: string): boolean {
  return patch.split(/^diff --git /gmu).length > 2;
}

export function editorLineForDiffSelection(
  patch: string,
  cacheKey: string,
  selection: { side: 'additions' | 'deletions'; startLine: number },
): number {
  if (selection.side === 'additions') return selection.startLine;
  try {
    const file = parsePatchFiles(patch, cacheKey)[0]?.files[0];
    for (const hunk of file?.hunks ?? []) {
      const deletionIndex = hunk.deletionLineIndex + selection.startLine - hunk.deletionStart;
      for (const content of hunk.hunkContent) {
        const deletionCount = content.type === 'context' ? content.lines : content.deletions;
        const offset = deletionIndex - content.deletionLineIndex;
        if (offset < 0 || offset >= deletionCount) continue;
        const additionIndex = content.additionLineIndex + (content.type === 'context' ? offset : 0);
        return Math.max(1, hunk.additionStart + additionIndex - hunk.additionLineIndex);
      }
    }
  } catch {
    // 表示済みの差分を再解析できない場合は、現在の行番号で編集画面を開く。
  }
  return selection.startLine;
}
