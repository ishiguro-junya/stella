import type {
  ActivityRange,
  CommitActivityBucket,
  CommitActivitySeries,
} from '../../domain/workspace';

export const ACTIVITY_RANGE_DAYS: Readonly<Record<ActivityRange, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '1y': 365,
};

function localMidnight(date: Date, dayOffset: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
}

export function createLocalDayBucketBoundaries(
  range: ActivityRange,
  now: Date = new Date(),
): number[] {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Activity range date must be valid.');
  const days = ACTIVITY_RANGE_DAYS[range];
  const firstDayOffset = 1 - days;
  return Array.from({ length: days + 1 }, (_, index) =>
    Math.floor(localMidnight(now, firstDayOffset + index).getTime() / 1_000),
  );
}

function aggregateBuckets(buckets: readonly CommitActivityBucket[]): CommitActivityBucket {
  const first = buckets[0];
  const last = buckets.at(-1);
  if (!first || !last) throw new Error('Cannot aggregate an empty activity bucket group.');
  return {
    startUnixSeconds: first.startUnixSeconds,
    endUnixSeconds: last.endUnixSeconds,
    commitCount: buckets.reduce((total, bucket) => total + bucket.commitCount, 0),
    contributorCount: buckets.reduce((total, bucket) => total + bucket.contributorCount, 0),
    branchCount: buckets.reduce((total, bucket) => total + bucket.branchCount, 0),
  };
}

function aggregateBucketsByCalendarMonth(
  buckets: readonly CommitActivityBucket[],
): CommitActivityBucket[] {
  const monthly: CommitActivityBucket[] = [];
  let group: CommitActivityBucket[] = [];
  let groupMonth: number | undefined;

  for (const bucket of buckets) {
    const start = new Date(bucket.startUnixSeconds * 1_000);
    const month = start.getFullYear() * 12 + start.getMonth();
    if (groupMonth !== undefined && month !== groupMonth) {
      monthly.push(aggregateBuckets(group));
      group = [];
    }
    groupMonth = month;
    group.push(bucket);
  }
  if (group.length > 0) monthly.push(aggregateBuckets(group));
  return monthly;
}

export function bucketsForActivityRange(
  series: Pick<CommitActivitySeries, 'buckets'>,
  range: ActivityRange,
): CommitActivityBucket[] {
  if (range === '7d' || range === '30d') {
    return series.buckets.map((bucket) => ({ ...bucket }));
  }

  if (range === '180d' || range === '1y') {
    return aggregateBucketsByCalendarMonth(series.buckets);
  }

  const weekly: CommitActivityBucket[] = [];
  for (let end = series.buckets.length; end > 0; end -= 7) {
    weekly.unshift(aggregateBuckets(series.buckets.slice(Math.max(0, end - 7), end)));
  }
  return weekly;
}
