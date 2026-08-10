import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ActivityRange,
  CommitActivityBucket,
  CommitActivitySeries,
} from '../../domain/workspace';
import {
  ACTIVITY_RANGE_DAYS,
  bucketsForActivityRange,
  createLocalDayBucketBoundaries,
} from './activityRange';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLocalDayBucketBoundaries', () => {
  it.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
    ['180d', 180],
    ['1y', 365],
  ] as const)('returns one local boundary around every day in %s', (range, days) => {
    const boundaries = createLocalDayBucketBoundaries(range, new Date(2026, 7, 9, 14, 30));

    expect(ACTIVITY_RANGE_DAYS[range]).toBe(days);
    expect(boundaries).toHaveLength(days + 1);
    expect(new Date((boundaries[0] ?? 0) * 1_000)).toEqual(new Date(2026, 7, 10 - days, 0, 0));
    expect(new Date((boundaries.at(-1) ?? 0) * 1_000)).toEqual(new Date(2026, 7, 10, 0, 0));
  });

  it('uses calendar midnights instead of fixed 24-hour offsets across DST', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const boundaries = createLocalDayBucketBoundaries('7d', new Date(2026, 2, 10, 12));
    const durations = boundaries.slice(1).map((boundary, index) => boundary - boundaries[index]!);

    expect(durations).toContain(23 * 60 * 60);
    expect(durations.filter((duration) => duration === 24 * 60 * 60)).toHaveLength(6);
  });

  it('rejects an invalid reference date', () => {
    expect(() => createLocalDayBucketBoundaries('7d', new Date(Number.NaN))).toThrow(RangeError);
  });
});

function dailyBuckets(count: number): CommitActivityBucket[] {
  return Array.from({ length: count }, (_, index) => ({
    startUnixSeconds: index * 10,
    endUnixSeconds: (index + 1) * 10,
    commitCount: index + 1,
  }));
}

function calendarDailyBuckets(range: ActivityRange): CommitActivityBucket[] {
  const boundaries = createLocalDayBucketBoundaries(range, new Date(2026, 7, 9, 14, 30));
  return boundaries.slice(0, -1).map((startUnixSeconds, index) => ({
    startUnixSeconds,
    endUnixSeconds: boundaries[index + 1]!,
    commitCount: index + 1,
  }));
}

function series(buckets: CommitActivityBucket[]): CommitActivitySeries {
  return {
    repoId: 'repo-1',
    repoGeneration: 1,
    historyRevision: 'history-1',
    timeBasis: 'committed',
    totals: { commits: 0, activeDays: 0, contributors: 0, branches: 0 },
    buckets,
    coverage: { kind: 'complete' },
  };
}

describe('bucketsForActivityRange', () => {
  it('keeps daily buckets for 7 and 30 day ranges without exposing mutable source objects', () => {
    const source = dailyBuckets(7);
    const displayed = bucketsForActivityRange(series(source), '7d');

    expect(displayed).toEqual(source);
    expect(displayed[0]).not.toBe(source[0]);
  });

  it('aggregates 90 daily buckets backwards into twelve full weeks and one partial week', () => {
    const displayed = bucketsForActivityRange(series(dailyBuckets(90)), '90d');

    expect(displayed).toHaveLength(13);
    expect(displayed[0]).toEqual({
      startUnixSeconds: 0,
      endUnixSeconds: 60,
      commitCount: 21,
    });
    expect(displayed[1]).toEqual({
      startUnixSeconds: 60,
      endUnixSeconds: 130,
      commitCount: 70,
    });
    expect(displayed.at(-1)).toEqual({
      startUnixSeconds: 830,
      endUnixSeconds: 900,
      commitCount: 609,
    });
    expect(displayed.reduce((total, bucket) => total + bucket.commitCount, 0)).toBe(4_095);
  });

  it.each([
    ['180d', 180, 7],
    ['1y', 365, 13],
  ] as const)('aggregates the %s range into calendar months', (range, days, bucketCount) => {
    const source = calendarDailyBuckets(range);
    const displayed = bucketsForActivityRange(series(source), range);

    expect(displayed).toHaveLength(bucketCount);
    expect(displayed[0]?.startUnixSeconds).toBe(source[0]?.startUnixSeconds);
    expect(displayed.at(-1)?.endUnixSeconds).toBe(source.at(-1)?.endUnixSeconds);
    expect(displayed.reduce((total, bucket) => total + bucket.commitCount, 0)).toBe(
      (days * (days + 1)) / 2,
    );
  });

  it('preserves real bucket edges when a week includes a DST transition', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const boundaries = createLocalDayBucketBoundaries('90d', new Date(2026, 2, 10, 12));
    const buckets = boundaries.slice(0, -1).map((startUnixSeconds, index) => ({
      startUnixSeconds,
      endUnixSeconds: boundaries[index + 1]!,
      commitCount: 1,
    }));

    const displayed = bucketsForActivityRange(series(buckets), '90d');

    expect(displayed.at(-1)?.endUnixSeconds).toBe(boundaries.at(-1));
    expect(
      (displayed.at(-1)?.endUnixSeconds ?? 0) - (displayed.at(-1)?.startUnixSeconds ?? 0),
    ).toBe(167 * 60 * 60);
    expect(displayed.reduce((total, bucket) => total + bucket.commitCount, 0)).toBe(90);
  });
});
