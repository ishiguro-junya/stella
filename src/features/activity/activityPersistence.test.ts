import { describe, expect, it } from 'vitest';

import type { ActivityEntry } from '../../domain/workspace';
import {
  ACTIVITY_STORAGE_KEY,
  ACTIVITY_SUMMARY_TTL_MS,
  MAX_PERSISTED_ACTIVITIES,
  mergeActivityEntries,
  persistTerminalActivities,
  readPersistedActivities,
} from './activityPersistence';

const NOW = Date.parse('2026-08-09T03:00:00.000Z');

function activity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'operation-1',
    repoId: 'repo-1',
    repositoryName: 'stella',
    action: { id: 'actionPush' },
    summary: { id: 'backendPushCompleted' },
    status: 'succeeded',
    startedAt: '2026-08-09T02:59:00.000Z',
    finishedAt: '2026-08-09T03:00:00.000Z',
    detailAvailability: 'currentSession',
    ...overrides,
  };
}

describe('activity persistence', () => {
  it('does not migrate the pre-release string-only v1 cache', () => {
    localStorage.setItem(
      'stella.activity.v1',
      JSON.stringify([{ id: 'old', action: 'Push', summary: 'Push completed.' }]),
    );

    expect(readPersistedActivities(localStorage, NOW)).toEqual([]);
    expect(localStorage.getItem('stella.activity.v1')).not.toBeNull();
  });

  it('stores only the exact terminal summary fields and hydrates them as summary-only', () => {
    persistTerminalActivities(
      [
        activity({
          exitCode: 1,
          eventSeq: 3,
          cancellable: true,
          command: 'git push origin main',
          stdout: 'raw stdout',
          stderr: 'raw stderr',
        }),
      ],
      localStorage,
      NOW,
    );

    const stored: unknown = JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? 'null');
    expect(stored).toEqual([
      {
        id: 'operation-1',
        repoId: 'repo-1',
        repositoryName: 'stella',
        action: { id: 'actionPush' },
        summary: { id: 'backendPushCompleted' },
        status: 'succeeded',
        startedAt: '2026-08-09T02:59:00.000Z',
        finishedAt: '2026-08-09T03:00:00.000Z',
      },
    ]);
    expect(readPersistedActivities(localStorage, NOW)).toEqual([
      {
        id: 'operation-1',
        repoId: 'repo-1',
        repositoryName: 'stella',
        action: { id: 'actionPush' },
        summary: { id: 'backendPushCompleted' },
        status: 'succeeded',
        startedAt: '2026-08-09T02:59:00.000Z',
        finishedAt: '2026-08-09T03:00:00.000Z',
        detailAvailability: 'summaryOnly',
      },
    ]);
  });

  it('ignores running entries and terminal entries without a finish time', () => {
    const running = activity({
      id: 'running',
      status: 'running',
    });
    const unfinished = activity({ id: 'unfinished' });
    delete running.finishedAt;
    delete unfinished.finishedAt;
    persistTerminalActivities([running, unfinished], localStorage, NOW);

    expect(readPersistedActivities(localStorage, NOW)).toEqual([]);
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBeNull();
  });

  it('expires summaries older than 30 days while keeping the exact boundary', () => {
    const boundary = new Date(NOW - ACTIVITY_SUMMARY_TTL_MS).toISOString();
    const expired = new Date(NOW - ACTIVITY_SUMMARY_TTL_MS - 1).toISOString();
    persistTerminalActivities(
      [
        activity({ id: 'boundary', startedAt: boundary, finishedAt: boundary }),
        activity({ id: 'expired', startedAt: expired, finishedAt: expired }),
      ],
      localStorage,
      NOW,
    );

    expect(readPersistedActivities(localStorage, NOW).map((entry) => entry.id)).toEqual([
      'boundary',
    ]);
  });

  it('recovers from corrupt storage and removes its unusable value', () => {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, '{broken');

    expect(readPersistedActivities(localStorage, NOW)).toEqual([]);
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBeNull();
  });

  it('does not let unavailable storage block workspace activity', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error('Storage unavailable');
      },
      setItem: () => {
        throw new Error('Storage unavailable');
      },
      removeItem: () => {
        throw new Error('Storage unavailable');
      },
    };

    expect(readPersistedActivities(unavailableStorage, NOW)).toEqual([]);
    expect(() => persistTerminalActivities([activity()], unavailableStorage, NOW)).not.toThrow();
  });

  it('drops malformed records, deduplicates ids by newest finish time, and caps at 500', () => {
    const entries = Array.from({ length: MAX_PERSISTED_ACTIVITIES + 2 }, (_, index) =>
      activity({
        id: `operation-${index}`,
        startedAt: new Date(NOW - index * 1_000 - 100).toISOString(),
        finishedAt: new Date(NOW - index * 1_000).toISOString(),
      }),
    );
    localStorage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify([
        { id: 'malformed' },
        ...entries,
        {
          ...entries[0],
          summary: { id: 'backendOperationInProgress' },
          finishedAt: new Date(NOW - 10_000).toISOString(),
        },
      ]),
    );

    const restored = readPersistedActivities(localStorage, NOW);
    expect(restored).toHaveLength(MAX_PERSISTED_ACTIVITIES);
    expect(restored[0]?.summary).toEqual({ id: 'backendPushCompleted' });
    expect(restored.some((entry) => entry.id === 'operation-501')).toBe(false);
    const normalized: unknown = JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? 'null');
    expect(normalized).toHaveLength(MAX_PERSISTED_ACTIVITIES);
    expect(JSON.stringify(normalized)).not.toContain('malformed');
  });

  it('physically removes storage when every summary has expired', () => {
    const expired = new Date(NOW - ACTIVITY_SUMMARY_TTL_MS - 1).toISOString();
    localStorage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'expired',
          repoId: 'repo-1',
          repositoryName: 'stella',
          action: { id: 'actionPush' },
          summary: { id: 'backendPushCompleted' },
          status: 'succeeded',
          startedAt: expired,
          finishedAt: expired,
        },
      ]),
    );

    expect(readPersistedActivities(localStorage, NOW)).toEqual([]);
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBeNull();
  });

  it('lets current-session details replace a hydrated summary with the same id', () => {
    const hydrated = activity({ detailAvailability: 'summaryOnly' });
    const current = activity({ command: 'git push', stdout: 'ok' });

    expect(mergeActivityEntries([hydrated], [current])).toEqual([current]);
  });
});
