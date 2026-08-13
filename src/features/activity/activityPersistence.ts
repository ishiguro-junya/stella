import type { ActivityEntry } from '../../domain/workspace';
import { isLocalizedMessage, type LocalizedMessage } from '../../i18n/i18n';

export const ACTIVITY_STORAGE_KEY = 'stella.activity.v2';
export const ACTIVITY_SUMMARY_TTL_MS = 365 * 24 * 60 * 60 * 1_000;

type TerminalActivityStatus = Exclude<ActivityEntry['status'], 'running'>;

interface PersistedActivitySummary {
  id: string;
  repoId: string;
  repositoryName: string;
  action: LocalizedMessage;
  summary: LocalizedMessage;
  status: TerminalActivityStatus;
  startedAt: string;
  finishedAt: string;
}

type ActivityStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function terminalStatus(value: unknown): value is TerminalActivityStatus {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled';
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function persistedSummary(value: unknown): PersistedActivitySummary | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.repoId !== 'string' ||
    typeof value.repositoryName !== 'string' ||
    !isLocalizedMessage(value.action) ||
    !isLocalizedMessage(value.summary) ||
    !terminalStatus(value.status) ||
    !validTimestamp(value.startedAt) ||
    !validTimestamp(value.finishedAt)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    repoId: value.repoId,
    repositoryName: value.repositoryName,
    action: value.action,
    summary: value.summary,
    status: value.status,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
  };
}

function summaryFromEntry(entry: ActivityEntry): PersistedActivitySummary | undefined {
  if (!terminalStatus(entry.status) || !entry.finishedAt) return undefined;
  return persistedSummary(entry);
}

function normalizeSummaries(
  summaries: readonly PersistedActivitySummary[],
  nowUnixMs: number,
): PersistedActivitySummary[] {
  const oldestAllowed = nowUnixMs - ACTIVITY_SUMMARY_TTL_MS;
  const byId = new Map<string, PersistedActivitySummary>();
  for (const summary of summaries) {
    const finishedAt = Date.parse(summary.finishedAt);
    if (finishedAt < oldestAllowed || finishedAt > nowUnixMs) continue;
    const current = byId.get(summary.id);
    if (!current || Date.parse(current.finishedAt) <= finishedAt) byId.set(summary.id, summary);
  }
  return [...byId.values()].toSorted(
    (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
  );
}

function hydratedEntry(summary: PersistedActivitySummary): ActivityEntry {
  return { ...summary, detailAvailability: 'summaryOnly' };
}

export function readPersistedActivities(
  storage?: ActivityStorage,
  nowUnixMs: number = Date.now(),
): ActivityEntry[] {
  try {
    const target = storage ?? window.localStorage;
    const raw = target.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      target.removeItem(ACTIVITY_STORAGE_KEY);
      return [];
    }
    const normalized = normalizeSummaries(
      parsed.flatMap((candidate) => {
        const summary = persistedSummary(candidate);
        return summary ? [summary] : [];
      }),
      nowUnixMs,
    );
    if (normalized.length) target.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(normalized));
    else target.removeItem(ACTIVITY_STORAGE_KEY);
    return normalized.map(hydratedEntry);
  } catch {
    try {
      (storage ?? window.localStorage).removeItem(ACTIVITY_STORAGE_KEY);
    } catch {
      // 利用不能なstorageでworkspace操作を妨げない。
    }
    return [];
  }
}

export function persistTerminalActivities(
  entries: readonly ActivityEntry[],
  storage?: ActivityStorage,
  nowUnixMs: number = Date.now(),
): void {
  try {
    const target = storage ?? window.localStorage;
    const existing = readPersistedActivities(target, nowUnixMs).flatMap((entry) => {
      const summary = summaryFromEntry(entry);
      return summary ? [summary] : [];
    });
    const incoming = entries.flatMap((entry) => {
      const summary = summaryFromEntry(entry);
      return summary ? [summary] : [];
    });
    const normalized = normalizeSummaries([...existing, ...incoming], nowUnixMs);
    if (normalized.length) target.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(normalized));
    else target.removeItem(ACTIVITY_STORAGE_KEY);
  } catch {
    // 利用不能または満杯のstorageでworkspace操作を妨げない。
  }
}

export function mergeActivityEntries(
  persisted: readonly ActivityEntry[],
  currentSession: readonly ActivityEntry[],
): ActivityEntry[] {
  const byId = new Map(persisted.map((entry) => [entry.id, entry]));
  for (const entry of currentSession) byId.set(entry.id, entry);
  return [...byId.values()].toSorted((left, right) => {
    const leftTime = Date.parse(left.finishedAt ?? left.startedAt);
    const rightTime = Date.parse(right.finishedAt ?? right.startedAt);
    return rightTime - leftTime;
  });
}
