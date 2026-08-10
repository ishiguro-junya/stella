const STANDARD_BYTES = 1024 * 1024;
const STANDARD_LINES = 20_000;
const PERFORMANCE_MAX_LINE_BYTES = 256 * 1024;

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
  const binary = /(?:^|\n)(?:GIT binary patch|Binary files .+ differ)(?:\n|$)/u.test(patch);
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
