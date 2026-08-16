import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Ban, CircleCheck, CircleX, LoaderCircle, RotateCw } from 'lucide-react';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { Button } from '../../ui/Button';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import type {
  ActivityEntry,
  ActivityRange,
  CommitActivityBucket,
  CommitActivitySeries,
  RepoSnapshot,
} from '../../domain/workspace';
import type { ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import { LEFT_PANE_MAX_WIDTH, LEFT_PANE_MIN_WIDTH } from '../../persistence/preferences';
import { PaneResizer } from '../../ui/PaneResizer';
import { SelectControl } from '../../ui/SelectControl';
import { useI18n, type I18nValue, type Language } from '../../i18n/i18n';
import {
  ACTIVITY_RANGE_DAYS,
  bucketsForActivityRange,
  createLocalDayBucketBoundaries,
} from './activityRange';

const CommitActivityChart = lazy(() => import('./CommitActivityChart'));
const ACTIVITY_RANGES: readonly ActivityRange[] = ['7d', '30d', '90d', '180d', '1y'];
const ACTIVITY_METRICS = ['commits', 'contributors', 'branches'] as const;
type ActivityMetric = (typeof ACTIVITY_METRICS)[number];

function isActivityRange(value: string): value is ActivityRange {
  return ACTIVITY_RANGES.some((range) => range === value);
}

function isActivityMetric(value: string): value is ActivityMetric {
  return ACTIVITY_METRICS.some((metric) => metric === value);
}

type AnalyticsState =
  | { kind: 'noRepo' }
  | { kind: 'loading' }
  | { kind: 'ready'; series: CommitActivitySeries }
  | { kind: 'error' };

export interface ActivityViewProps {
  adapter: WorkspaceAdapter;
  repo: RepoSnapshot | undefined;
  entries: ActivityEntry[];
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onCancel: (entry: ActivityEntry) => Promise<void>;
  onError: ShowWorkspaceError;
  onReady?: () => void;
  focusRequest?: number;
}

export function ActivityView({
  adapter,
  repo,
  entries,
  paneWidth,
  onPaneWidthChange,
  onCancel,
  onError,
  onReady,
  focusRequest = 0,
}: ActivityViewProps) {
  const { t } = useI18n();
  const [range, setRange] = useState<ActivityRange>('30d');
  const [metric, setMetric] = useState<ActivityMetric>('commits');
  const [retryRequest, setRetryRequest] = useState(0);
  const [analytics, setAnalytics] = useState<AnalyticsState>(() =>
    repo ? { kind: 'loading' } : { kind: 'noRepo' },
  );
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!repo) {
      setAnalytics({ kind: 'noRepo' });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setAnalytics({ kind: 'loading' });
    void adapter
      .query(
        {
          kind: 'commitActivity',
          repoId: repo.repoId,
          bucketBoundariesUnixSeconds: createLocalDayBucketBoundaries(range),
        },
        { signal: controller.signal },
      )
      .then((result) => {
        if (!active) return;
        if (result.kind !== 'commitActivity') {
          throw new Error('The workspace returned an unexpected Activity response.');
        }
        setAnalytics({ kind: 'ready', series: result.series });
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setAnalytics({ kind: 'error' });
        onError(t('activityUnavailable'), cause, t('activityLoadFailed'));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [adapter, onError, range, repo, retryRequest, t]);

  const activities = useMemo(
    () =>
      entries.toSorted(
        (left, right) =>
          Date.parse(right.finishedAt ?? right.startedAt) -
          Date.parse(left.finishedAt ?? left.startedAt),
      ),
    [entries],
  );
  const selected = activities.find((entry) => entry.id === selectedId) ?? activities[0];
  const series = analytics.kind === 'ready' ? analytics.series : undefined;
  const chartBuckets = useMemo(
    () =>
      series
        ? metric === 'contributors'
          ? series.buckets.map((bucket) => ({ ...bucket }))
          : bucketsForActivityRange(series, range)
        : [],
    [metric, range, series],
  );
  const tableBuckets = useMemo(
    () => series?.buckets.map((bucket) => ({ ...bucket })) ?? [],
    [series],
  );
  const paneStyle: CSSProperties & { '--activity-left-pane': string } = {
    '--activity-left-pane': `${paneWidth}px`,
  };
  const activityControls = (
    <div className="activity-analytics-controls">
      <SelectControl
        className="activity-metric-select"
        aria-label={t('activityMetric')}
        value={metric}
        onChange={(event) => {
          if (isActivityMetric(event.currentTarget.value)) {
            setMetric(event.currentTarget.value);
          }
        }}
      >
        {ACTIVITY_METRICS.map((option) => (
          <option key={option} value={option}>
            {activityMetricLabel(option, t)}
          </option>
        ))}
      </SelectControl>
      <SelectControl
        className="activity-range-select"
        aria-label={t('activityRange')}
        value={range}
        onChange={(event) => {
          if (isActivityRange(event.currentTarget.value)) {
            setRange(event.currentTarget.value);
          }
        }}
      >
        {ACTIVITY_RANGES.map((option) => (
          <option key={option} value={option}>
            {activityRangeLabel(option, t)}
          </option>
        ))}
      </SelectControl>
    </div>
  );

  return (
    <main className="activity-view" aria-labelledby="activity-title">
      <h1 id="activity-title" className="sr-only">
        {t('appActivity')}
      </h1>
      <div className="activity-page-content">
        <div className="activity-page-panels" style={paneStyle}>
          <AnalyticsPanel
            analytics={analytics}
            chartBuckets={chartBuckets}
            tableBuckets={tableBuckets}
            range={range}
            metric={metric}
            controls={activityControls}
            onRetry={() => setRetryRequest((current) => current + 1)}
          />
          <PaneResizer
            label={t('activityAnalyticsWidth')}
            value={paneWidth}
            direction="growRight"
            min={LEFT_PANE_MIN_WIDTH}
            max={LEFT_PANE_MAX_WIDTH}
            onChange={onPaneWidthChange}
          />
          <OperationsPanel
            activities={activities}
            selected={selected}
            focusRequest={focusRequest}
            onSelect={setSelectedId}
            onCancel={onCancel}
          />
        </div>
      </div>
    </main>
  );
}

interface OperationsPanelProps {
  activities: ActivityEntry[];
  selected: ActivityEntry | undefined;
  focusRequest: number;
  onSelect: (id: string) => void;
  onCancel: (entry: ActivityEntry) => Promise<void>;
}

function OperationsPanel({
  activities,
  selected,
  focusRequest,
  onSelect,
  onCancel,
}: OperationsPanelProps) {
  const { t, message, locale, language } = useI18n();
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const handledFocusRequestRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!selected || handledFocusRequestRef.current === focusRequest) return;
    const target = rowRefs.current.get(selected.id);
    if (!target) return;
    target.focus();
    handledFocusRequestRef.current = focusRequest;
  }, [activities, focusRequest, selected]);

  const moveSelection = (
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    index: number,
    offset: -1 | 1,
  ): void => {
    event.preventDefault();
    event.currentTarget.closest('.activity-list')?.classList.add('is-keyboard-navigating');
    const nextIndex = Math.min(Math.max(index + offset, 0), activities.length - 1);
    const next = activities[nextIndex];
    if (!next || nextIndex === index) return;
    onSelect(next.id);
    rowRefs.current.get(next.id)?.focus();
  };

  return (
    <section className="activity-operations-panel" aria-labelledby="operations-title">
      <h2 id="operations-title" className="sr-only">
        {t('activityOperations')}
      </h2>
      <div className="activity-operations-body">
        <div className="activity-operation-table">
          <table
            className="activity-list"
            onPointerMove={(event) =>
              event.currentTarget.classList.remove('is-keyboard-navigating')
            }
          >
            <caption className="sr-only">{t('activityOperations')}</caption>
            <colgroup>
              <col className="activity-status-column" />
              <col className="activity-action-column" />
              <col className="activity-summary-column" />
              <col className="activity-timestamp-column" />
              <col className="activity-duration-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{t('activityStatus')}</th>
                <th scope="col">{t('activityAction')}</th>
                <th scope="col">{t('activitySummary')}</th>
                <th scope="col">{t('activityTimestamp')}</th>
                <th scope="col">{t('activityDuration')}</th>
              </tr>
            </thead>
            <tbody>
              {activities.length ? (
                activities.map((entry, index) => {
                  const isSelected = selected?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      ref={(element) => {
                        if (element) rowRefs.current.set(entry.id, element);
                        else rowRefs.current.delete(entry.id);
                      }}
                      tabIndex={isSelected ? 0 : -1}
                      aria-selected={isSelected}
                      onClick={(event) => {
                        onSelect(entry.id);
                        event.currentTarget.focus();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') moveSelection(event, index, -1);
                        else if (event.key === 'ArrowDown') moveSelection(event, index, 1);
                        else if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(entry.id);
                        }
                      }}
                    >
                      <td>
                        <ActivityStatus status={entry.status} />
                      </td>
                      <th scope="row">{message(entry.action)}</th>
                      <td className="activity-item-summary">{message(entry.summary)}</td>
                      <td>
                        <time dateTime={entry.startedAt}>
                          {formatOperationDateTime(entry.startedAt, locale)}
                        </time>
                      </td>
                      <td className="activity-item-duration">
                        {formatDuration(entry, language, t)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-row" colSpan={5}>
                    {t('activityNoOperations')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <ActivityDetail selected={selected} onCancel={onCancel} />
      </div>
    </section>
  );
}

function ActivityDetail({
  selected,
  onCancel,
}: {
  selected: ActivityEntry | undefined;
  onCancel: (entry: ActivityEntry) => Promise<void>;
}) {
  const { t, message, locale, language } = useI18n();
  if (!selected) {
    return (
      <section className="activity-details" aria-label={t('activityOperationDetail')}>
        <p className="empty-state-small">{t('activitySelectOperation')}</p>
      </section>
    );
  }

  return (
    <section className="activity-details" aria-label={t('activityOperationDetail')}>
      <div className="activity-detail-heading">
        <div>
          <h3>{message(selected.action)}</h3>
          <p>{message(selected.summary)}</p>
        </div>
        {selected.detailAvailability === 'currentSession' &&
        selected.status === 'running' &&
        selected.cancellable ? (
          <Button type="button" onClick={() => void onCancel(selected)}>
            <CircleX aria-hidden="true" focusable="false" />
            <span>{t('cancel')}</span>
          </Button>
        ) : null}
      </div>
      <dl className="activity-metadata-list">
        <div>
          <dt>{t('activityRepository')}</dt>
          <dd>{selected.repositoryName}</dd>
        </div>
        <div>
          <dt>{t('activityStatus')}</dt>
          <dd>{statusLabel(selected.status, t)}</dd>
        </div>
        <div>
          <dt>{t('activityStarted')}</dt>
          <dd>
            <time dateTime={selected.startedAt}>
              {formatOperationDateTime(selected.startedAt, locale)}
            </time>
          </dd>
        </div>
        {selected.finishedAt ? (
          <div>
            <dt>{t('activityFinished')}</dt>
            <dd>
              <time dateTime={selected.finishedAt}>
                {formatOperationDateTime(selected.finishedAt, locale)}
              </time>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t('activityDuration')}</dt>
          <dd>{formatDuration(selected, language, t)}</dd>
        </div>
        {selected.detailAvailability === 'currentSession' && selected.exitCode !== undefined ? (
          <div>
            <dt>{t('activityExitCode')}</dt>
            <dd>{selected.exitCode}</dd>
          </div>
        ) : null}
      </dl>
      {selected.detailAvailability === 'summaryOnly' ? (
        <p className="activity-summary-only">{t('activitySummaryOnly')}</p>
      ) : (
        <>
          {selected.command ? (
            <div className="activity-command">
              <span>{t('activityCommand')}</span>
              <code>{selected.command}</code>
            </div>
          ) : null}
          {selected.stdout ? <LogOutput title="stdout" value={selected.stdout} /> : null}
          {selected.stderr ? <LogOutput title="stderr" value={selected.stderr} /> : null}
        </>
      )}
    </section>
  );
}

interface AnalyticsPanelProps {
  analytics: AnalyticsState;
  chartBuckets: CommitActivityBucket[];
  tableBuckets: CommitActivityBucket[];
  range: ActivityRange;
  metric: ActivityMetric;
  controls?: ReactNode;
  onRetry: () => void;
}

function AnalyticsPanel({
  analytics,
  chartBuckets,
  tableBuckets,
  range,
  metric,
  controls,
  onRetry,
}: AnalyticsPanelProps) {
  const { t } = useI18n();
  const days = ACTIVITY_RANGE_DAYS[range];
  return (
    <section
      className={`activity-analytics-panel${controls ? ' has-footer-controls' : ''}`}
      aria-labelledby="commit-activity-title"
    >
      <h2 id="commit-activity-title" className="sr-only">
        {t('activityAnalytics')}
      </h2>
      <div className="activity-analytics-body" aria-live="polite">
        {analytics.kind === 'noRepo' ? (
          <ActivityState title={t('activityNoRepository')}>
            {t('activityOpenRepository')}
          </ActivityState>
        ) : analytics.kind === 'loading' ? (
          <div className="activity-state" aria-busy="true">
            <LoadingIndicator />
          </div>
        ) : analytics.kind === 'error' ? (
          <ActivityState title={t('activityUnavailable')}>
            {t('activityLoadFailed')}
            <Button type="button" onClick={onRetry}>
              <RotateCw aria-hidden="true" focusable="false" />
              <span>{t('retry')}</span>
            </Button>
          </ActivityState>
        ) : analytics.series.totals.commits === 0 ? (
          <>
            <ActivityState title={t('activityNoCommits')}>
              {t('activityNoCommitsDescription', { days })}
            </ActivityState>
            <ChartDataTable buckets={tableBuckets} range={range} />
          </>
        ) : (
          <CommitAnalyticsReady
            series={analytics.series}
            chartBuckets={chartBuckets}
            tableBuckets={tableBuckets}
            range={range}
            metric={metric}
          />
        )}
      </div>
      {controls ? <footer className="activity-analytics-footer">{controls}</footer> : null}
    </section>
  );
}

function activityRangeLabel(range: ActivityRange, t: I18nValue['t']): string {
  return range === '1y'
    ? t('activityOneYear')
    : t('activityDays', { count: ACTIVITY_RANGE_DAYS[range] });
}

function activityMetricLabel(metric: ActivityMetric, t: I18nValue['t']): string {
  return t(
    metric === 'commits'
      ? 'activityCommits'
      : metric === 'contributors'
        ? 'activityContributors'
        : 'activityBranches',
  );
}

function CommitAnalyticsReady({
  series,
  chartBuckets,
  tableBuckets,
  range,
  metric,
}: {
  series: CommitActivitySeries;
  chartBuckets: CommitActivityBucket[];
  tableBuckets: CommitActivityBucket[];
  range: ActivityRange;
  metric: ActivityMetric;
}) {
  const { t, locale } = useI18n();
  const chartData = chartBuckets.map((bucket) => ({
    label: formatBucketLabel(bucket, metric === 'contributors' ? '30d' : range, locale),
    value: activityMetricValue(bucket, metric),
  }));
  return (
    <>
      {series.coverage.kind === 'truncated' ? (
        <output className="activity-coverage-note">
          {t('activityResultsTruncated', { count: series.coverage.scanLimit })}
        </output>
      ) : null}
      <figure className="activity-chart" aria-labelledby="activity-chart-caption">
        <figcaption id="activity-chart-caption" className="sr-only">
          {t('activityChartDescription')}
        </figcaption>
        <Suspense
          fallback={
            <div className="activity-chart-loading" aria-busy="true">
              <LoadingIndicator />
            </div>
          }
        >
          <CommitActivityChart data={chartData} metricLabel={activityMetricLabel(metric, t)} />
        </Suspense>
      </figure>
      <ChartDataTable buckets={tableBuckets} range={range} />
    </>
  );
}

function ChartDataTable({
  buckets,
  range,
}: {
  buckets: CommitActivityBucket[];
  range: ActivityRange;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="activity-chart-data">
      <div>
        <table>
          <caption className="sr-only">{t('activityData')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('activityPeriod')}</th>
              <th scope="col">{t('activityCommits')}</th>
              <th scope="col">{t('activityContributors')}</th>
              <th scope="col">{t('activityBranches')}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={`${bucket.startUnixSeconds}:${bucket.endUnixSeconds}`}>
                <th scope="row">{formatBucketLabel(bucket, range, locale, true)}</th>
                <td>{t('activityCommitValue', { count: bucket.commitCount })}</td>
                <td>{t('activityContributorValue', { count: bucket.contributorCount })}</td>
                <td>{t('activityBranchValue', { count: bucket.branchCount })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function activityMetricValue(bucket: CommitActivityBucket, metric: ActivityMetric): number {
  return metric === 'commits'
    ? bucket.commitCount
    : metric === 'contributors'
      ? bucket.contributorCount
      : bucket.branchCount;
}

function ActivityState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="activity-state">
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

function LogOutput({ title, value }: { title: string; value: string }) {
  return (
    <details className="log-output">
      <summary>{title}</summary>
      <pre>{value}</pre>
    </details>
  );
}

function ActivityStatus({ status }: { status: ActivityEntry['status'] }) {
  const { t } = useI18n();
  const Icon =
    status === 'succeeded'
      ? CircleCheck
      : status === 'running'
        ? LoaderCircle
        : status === 'failed'
          ? CircleX
          : Ban;
  return (
    <span className={`activity-status ${status}`}>
      <Icon aria-hidden="true" focusable="false" />
      <span>{statusLabel(status, t)}</span>
    </span>
  );
}

function statusLabel(status: ActivityEntry['status'], t: I18nValue['t']): string {
  return status === 'succeeded'
    ? t('activitySucceeded')
    : status === 'running'
      ? t('activityRunning')
      : status === 'failed'
        ? t('activityFailed')
        : t('activityCancelled');
}

function formatOperationDateTime(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(entry: ActivityEntry, language: Language, t: I18nValue['t']): string {
  if (!entry.finishedAt) return t('activityInProgress');
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(entry.finishedAt) - Date.parse(entry.startedAt)) / 1_000),
  );
  if (durationSeconds < 60)
    return language === 'ja' ? `${durationSeconds}秒` : `${durationSeconds}s`;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  if (minutes < 60)
    return language === 'ja'
      ? `${minutes}分 ${seconds.toString().padStart(2, '0')}秒`
      : `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return language === 'ja'
    ? `${hours}時間 ${(minutes % 60).toString().padStart(2, '0')}分`
    : `${hours}h ${(minutes % 60).toString().padStart(2, '0')}m`;
}

function formatBucketLabel(
  bucket: CommitActivityBucket,
  range: ActivityRange,
  locale: string,
  verbose = false,
): string {
  const start = new Date(bucket.startUnixSeconds * 1_000);
  const end = new Date((bucket.endUnixSeconds - 1) * 1_000);
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  });
  if ((range === '7d' || range === '30d') && !verbose) {
    return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(start);
  }
  if ((range === '180d' || range === '1y') && !verbose) {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      ...(range === '1y' ? { year: '2-digit' } : {}),
    }).format(start);
  }
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);
  return startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`;
}
