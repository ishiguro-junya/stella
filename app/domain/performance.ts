import type { ConflictDocument } from './workspace';

type ConflictRenderMode = 'standard' | 'performance' | 'external';

export interface ConflictPerformanceProfile {
  mode: ConflictRenderMode;
  bytes: number;
  lines: number;
  maxLineBytes: number;
  reason?: 'binary' | 'structural' | 'tooLarge';
}

const CONFLICT_STANDARD_LIMITS = {
  bytes: 1024 * 1024,
  lines: 20_000,
} as const;

const CONFLICT_PERFORMANCE_LIMITS = {
  bytes: 5 * 1024 * 1024,
  lines: 100_000,
  maxLineBytes: 256 * 1024,
} as const;

const REGULAR_FILE_MODES = new Set(['', '0', '000000', '100644', '100755']);

function encodedLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function profileConflictDocument(document: ConflictDocument): ConflictPerformanceProfile {
  const sideModes = [document.sides.current?.mode ?? '', document.sides.incoming?.mode ?? ''];
  if (!document.capabilities.inAppEdit) {
    const reason =
      document.kind === 'binary' || document.kind === 'nonUtf8' || document.kind === 'nul'
        ? 'binary'
        : document.kind === 'oversize'
          ? 'tooLarge'
          : 'structural';
    return { mode: 'external', bytes: 0, lines: 0, maxLineBytes: 0, reason };
  }
  if (sideModes.some((mode) => !REGULAR_FILE_MODES.has(mode))) {
    return { mode: 'external', bytes: 0, lines: 0, maxLineBytes: 0, reason: 'structural' };
  }
  if (document.sides.current?.text === undefined || document.sides.incoming?.text === undefined) {
    return { mode: 'external', bytes: 0, lines: 0, maxLineBytes: 0, reason: 'binary' };
  }

  const resultText = document.result.text;
  const lines = resultText.split(/\r?\n/u);
  const bytes = encodedLength(resultText);
  const maxLineBytes = lines.reduce((maximum, line) => Math.max(maximum, encodedLength(line)), 0);
  const lineCount = lines.length;

  if (
    bytes > CONFLICT_PERFORMANCE_LIMITS.bytes ||
    lineCount > CONFLICT_PERFORMANCE_LIMITS.lines ||
    maxLineBytes > CONFLICT_PERFORMANCE_LIMITS.maxLineBytes
  ) {
    return { mode: 'external', bytes, lines: lineCount, maxLineBytes, reason: 'tooLarge' };
  }
  if (
    document.capabilities.performanceView ||
    bytes > CONFLICT_STANDARD_LIMITS.bytes ||
    lineCount > CONFLICT_STANDARD_LIMITS.lines
  ) {
    return { mode: 'performance', bytes, lines: lineCount, maxLineBytes };
  }
  return { mode: 'standard', bytes, lines: lineCount, maxLineBytes };
}
