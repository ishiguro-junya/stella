import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import type { ActivityEntry, CommitActivitySeries, WorkspaceQuery } from '../../domain/workspace';
import { I18nProvider } from '../../i18n/i18n';
import { repoSnapshot } from '../../test/fixtures';
import type { ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import { ActivityView } from './ActivityView';

vi.mock('./CommitActivityChart', () => ({
  default: ({ data }: { data: unknown[] }) => (
    <div data-testid="commit-activity-chart">{data.length}</div>
  ),
}));

const repo = repoSnapshot();
const noopCancel = async (): Promise<void> => undefined;
const noopError: ShowWorkspaceError = () => undefined;
const noopPaneWidthChange = (): void => undefined;

function latestCommitActivityQuery(adapter: WorkspaceAdapter): {
  request: Extract<WorkspaceQuery, { kind: 'commitActivity' }>;
  signal: AbortSignal | undefined;
} {
  const call = vi.mocked(adapter.query).mock.calls.at(-1);
  if (!call || call[0].kind !== 'commitActivity') {
    throw new Error('Expected a commitActivity query.');
  }
  return { request: call[0], signal: call[1]?.signal };
}

function activity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'fetch-1',
    repoId: repo.repoId,
    repositoryName: repo.name,
    action: { id: 'actionFetch' },
    summary: { id: 'backendOperationInProgress' },
    status: 'running',
    startedAt: '2026-08-09T00:00:00.000Z',
    detailAvailability: 'currentSession',
    cancellable: true,
    command: 'git fetch origin',
    stdout: 'remote: Counting objects',
    ...overrides,
  };
}

function series(overrides: Partial<CommitActivitySeries> = {}): CommitActivitySeries {
  return {
    repoId: repo.repoId,
    repoGeneration: repo.generation,
    historyRevision: 'history-1',
    timeBasis: 'committed',
    totals: { commits: 8, activeDays: 4, contributors: 2, branches: 3 },
    buckets: Array.from({ length: 30 }, (_, index) => ({
      startUnixSeconds: 1_754_092_800 + index * 86_400,
      endUnixSeconds: 1_754_179_200 + index * 86_400,
      commitCount: index % 5 === 0 ? 1 : 0,
      contributorCount: index % 10 === 0 ? 1 : 0,
      branchCount: index >= 27 ? 1 : 0,
    })),
    coverage: { kind: 'complete' },
    ...overrides,
  };
}

function adapterWithSeries(value: CommitActivitySeries = series()): WorkspaceAdapter {
  return {
    attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
    query: vi.fn<WorkspaceAdapter['query']>(async () => ({
      kind: 'commitActivity',
      series: value,
    })),
    preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
      throw new Error('unused');
    }),
    execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
      throw new Error('unused');
    }),
    cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
    subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('ActivityView', () => {
  it('keeps the fixed activity state free of a line-shaped pulse while activity is pending', () => {
    const adapter = adapterWithSeries();
    vi.mocked(adapter.query).mockImplementation(async () => await new Promise<never>(() => {}));
    const { container } = render(
      <ActivityView
        adapter={adapter}
        repo={repo}
        entries={[]}
        paneWidth={560}
        onPaneWidthChange={noopPaneWidthChange}
        onCancel={noopCancel}
        onError={noopError}
      />,
    );

    const loadingState = container.querySelector('.activity-state[aria-busy="true"]');
    expect(loadingState).not.toContainElement(container.querySelector('.loading-pulse'));
    expect(loadingState).not.toHaveTextContent(/Loading|読み込み/u);
  });

  it('retranslates an existing structured Activity entry when the language changes', () => {
    const entry = activity({
      status: 'succeeded',
      summary: { id: 'backendFetchCompleted' },
      finishedAt: '2026-08-09T00:00:01.000Z',
      cancellable: false,
    });
    const props = {
      adapter: adapterWithSeries(),
      repo: undefined,
      entries: [entry],
      paneWidth: 560,
      onPaneWidthChange: noopPaneWidthChange,
      onCancel: noopCancel,
      onError: noopError,
    };
    const { rerender } = render(
      <I18nProvider language="en">
        <ActivityView {...props} />
      </I18nProvider>,
    );
    expect(screen.getAllByText('Fetch completed').length).toBeGreaterThan(0);

    rerender(
      <I18nProvider language="ja">
        <ActivityView {...props} />
      </I18nProvider>,
    );
    expect(screen.getAllByText('フェッチしました').length).toBeGreaterThan(0);
    expect(screen.getAllByText('成功').length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: '活動の指標' })).toBeVisible();
    expect(screen.getByRole('separator', { name: 'リポジトリ分析の幅' })).toBeVisible();
  });

  it('loads 30-day commit metrics, exposes chart data, and keeps raw session detail cancellable', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithSeries();
    const onCancel = vi.fn<(entry: ActivityEntry) => Promise<void>>(async () => undefined);
    const onPaneWidthChange = vi.fn<(width: number) => void>();
    const committed = activity({
      id: 'commit-1',
      action: { id: 'actionCommit' },
      summary: { id: 'backendCommitCreated' },
      status: 'succeeded',
      startedAt: '2026-08-08T23:00:00.000Z',
      finishedAt: '2026-08-08T23:00:02.000Z',
      cancellable: false,
    });

    const { container } = render(
      <ActivityView
        adapter={adapter}
        repo={repo}
        entries={[activity(), committed]}
        paneWidth={560}
        onPaneWidthChange={onPaneWidthChange}
        onCancel={onCancel}
        onError={noopError}
      />,
    );

    expect(container.querySelector('h1')).toHaveClass('sr-only');
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    const panels = container.querySelector('.activity-page-panels');
    expect(panels?.children.item(0)).toHaveClass('activity-analytics-panel');
    expect(panels?.children.item(1)).toHaveClass('pane-resizer');
    expect(panels?.children.item(2)).toHaveClass('activity-operations-panel');
    const rangeSelect = screen.getByRole('combobox', { name: 'Activity range' });
    expect(rangeSelect).toHaveValue('30d');
    expect(
      within(rangeSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['7 days', '30 days', '90 days', '180 days', '1 year']);
    const metricSelect = screen.getByRole('combobox', { name: 'Activity metric' });
    expect(metricSelect).toHaveValue('commits');
    expect(
      within(metricSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Commits', 'Contributors', 'Branches']);
    expect(
      metricSelect.compareDocumentPosition(rangeSelect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('Commit activity')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Repository analytics' })).toHaveClass('sr-only');
    const operations = screen.getByRole('table', { name: 'Operations' });
    expect(within(operations).getByRole('columnheader', { name: 'Status' })).toBeVisible();
    expect(within(operations).getByRole('columnheader', { name: 'Action' })).toBeVisible();
    expect(within(operations).getByRole('columnheader', { name: 'Summary' })).toBeVisible();
    expect(within(operations).getByRole('columnheader', { name: 'Timestamp' })).toBeVisible();
    expect(within(operations).getByRole('columnheader', { name: 'Duration' })).toBeVisible();
    expect(within(operations).getByRole('rowheader', { name: 'Fetch' })).toBeVisible();
    const fetchRow = within(operations).getByRole('row', {
      name: /Running Fetch Operation in progress/u,
    });
    expect(fetchRow).toHaveAttribute('tabindex', '0');
    expect(fetchRow).toHaveAttribute('aria-selected', 'true');
    expect(fetchRow.querySelector('button')).toBeNull();
    const commitRow = within(operations).getByRole('row', {
      name: /Succeeded Commit Commit created/u,
    });
    await waitFor(() => expect(fetchRow).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(commitRow).toHaveFocus();
    expect(commitRow).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}');
    expect(fetchRow).toHaveFocus();
    expect(fetchRow).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    expect(await screen.findByTestId('commit-activity-chart')).toHaveTextContent('30');

    const query = latestCommitActivityQuery(adapter);
    expect(query.request).toMatchObject({ kind: 'commitActivity', repoId: repo.repoId });
    expect(query.request.bucketBoundariesUnixSeconds).toHaveLength(31);
    expect(query.signal).toBeInstanceOf(AbortSignal);

    const table = screen.getByRole('table', { name: 'Activity data' });
    expect(within(table).getAllByRole('row')).toHaveLength(31);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Period', 'Commits', 'Contributors', 'Branches']);
    expect(within(table).getAllByText('1 commit').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('1 contributor').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('1 branch').length).toBeGreaterThan(0);
    expect(table.closest('.activity-chart-data')).not.toBeInstanceOf(HTMLDetailsElement);
    await user.selectOptions(metricSelect, 'contributors');
    expect(await screen.findByTestId('commit-activity-chart')).toHaveTextContent('30');
    await user.selectOptions(metricSelect, 'branches');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    const resizer = screen.getByRole('separator', { name: 'Repository analytics width' });
    expect(resizer).toHaveAttribute('aria-valuenow', '560');
    resizer.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onPaneWidthChange).toHaveBeenCalledWith(552);
    expect(screen.getByText('git fetch origin')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'fetch-1' }));

    await user.click(within(operations).getByText('Commit created'));
    expect(commitRow).toHaveAttribute('aria-selected', 'true');
    expect(
      within(screen.getByRole('region', { name: 'Operation detail' })).getByRole('heading', {
        name: 'Commit',
      }),
    ).toBeVisible();

    fetchRow.focus();
    await user.keyboard(' ');
    expect(fetchRow).toHaveAttribute('aria-selected', 'true');
    expect(
      within(screen.getByRole('region', { name: 'Operation detail' })).getByRole('heading', {
        name: 'Fetch',
      }),
    ).toBeVisible();

    commitRow.focus();
    await user.keyboard('{Enter}');
    expect(commitRow).toHaveAttribute('aria-selected', 'true');
  });

  it('changes repository analytics across weekly and monthly ranges', async () => {
    const user = userEvent.setup();
    const adapter = adapterWithSeries(
      series({
        totals: { commits: 18, activeDays: 10, contributors: 3, branches: 2 },
        buckets: Array.from({ length: 90 }, (_, index) => ({
          startUnixSeconds: 1_748_908_800 + index * 86_400,
          endUnixSeconds: 1_748_995_200 + index * 86_400,
          commitCount: index % 7 === 0 ? 2 : 0,
          contributorCount: index % 14 === 0 ? 1 : 0,
          branchCount: index === 80 || index === 89 ? 1 : 0,
        })),
      }),
    );

    render(
      <ActivityView
        adapter={adapter}
        repo={repo}
        entries={[]}
        paneWidth={560}
        onPaneWidthChange={noopPaneWidthChange}
        onCancel={noopCancel}
        onError={noopError}
      />,
    );
    await screen.findByRole('table', { name: 'Activity data' });

    const rangeSelect = screen.getByRole('combobox', { name: 'Activity range' });
    await user.selectOptions(rangeSelect, '90d');
    await waitFor(() => {
      expect(latestCommitActivityQuery(adapter).request.bucketBoundariesUnixSeconds).toHaveLength(
        91,
      );
    });
    expect(await screen.findByTestId('commit-activity-chart')).toHaveTextContent('13');

    const metricSelect = screen.getByRole('combobox', { name: 'Activity metric' });
    await user.selectOptions(metricSelect, 'contributors');
    expect(await screen.findByTestId('commit-activity-chart')).toHaveTextContent('90');
    await user.selectOptions(metricSelect, 'branches');
    expect(await screen.findByTestId('commit-activity-chart')).toHaveTextContent('13');

    await user.selectOptions(rangeSelect, '180d');
    await waitFor(() => {
      expect(latestCommitActivityQuery(adapter).request.bucketBoundariesUnixSeconds).toHaveLength(
        181,
      );
    });

    await user.selectOptions(rangeSelect, '1y');
    await waitFor(() => {
      expect(latestCommitActivityQuery(adapter).request.bucketBoundariesUnixSeconds).toHaveLength(
        366,
      );
    });
  });

  it('aborts stale range queries and ignores their late responses', async () => {
    const user = userEvent.setup();
    let resolveFirst: ((value: Awaited<ReturnType<WorkspaceAdapter['query']>>) => void) | undefined;
    let resolveSecond:
      | ((value: Awaited<ReturnType<WorkspaceAdapter['query']>>) => void)
      | undefined;
    const adapter = adapterWithSeries();
    adapter.query = vi.fn<WorkspaceAdapter['query']>(
      async () =>
        await new Promise((resolve) => {
          if (resolveFirst) resolveSecond = resolve;
          else resolveFirst = resolve;
        }),
    );

    const { unmount } = render(
      <ActivityView
        adapter={adapter}
        repo={repo}
        entries={[]}
        paneWidth={560}
        onPaneWidthChange={noopPaneWidthChange}
        onCancel={noopCancel}
        onError={noopError}
      />,
    );
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(1));
    const firstSignal = latestCommitActivityQuery(adapter).signal;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Activity range' }), '7d');
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2));
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal?.aborted).toBe(true);
    const secondSignal = latestCommitActivityQuery(adapter).signal;

    await act(async () => {
      resolveFirst?.({
        kind: 'commitActivity',
        series: series({
          totals: { commits: 999, activeDays: 30, contributors: 20, branches: 12 },
          buckets: [{ ...series().buckets[0]!, commitCount: 999 }],
        }),
      });
      resolveSecond?.({
        kind: 'commitActivity',
        series: series({
          totals: { commits: 7, activeDays: 5, contributors: 2, branches: 1 },
          buckets: [{ ...series().buckets[0]!, commitCount: 7 }],
        }),
      });
    });
    expect(await screen.findByText('7 commits')).toBeVisible();
    expect(screen.queryByText(/999 commits/u)).not.toBeInTheDocument();

    unmount();
    expect(secondSignal?.aborted).toBe(true);
  });

  it('shows persisted operations as summary-only and supports no-repo and empty states', async () => {
    const persisted: ActivityEntry = {
      id: 'fetch-1',
      repoId: repo.repoId,
      repositoryName: repo.name,
      action: { id: 'actionFetch' },
      summary: { id: 'backendFetchCompleted' },
      status: 'succeeded',
      startedAt: '2026-08-09T00:00:00.000Z',
      finishedAt: '2026-08-09T00:01:00.000Z',
      detailAvailability: 'summaryOnly',
    };
    const emptyAdapter = adapterWithSeries(
      series({
        totals: { commits: 0, activeDays: 0, contributors: 0, branches: 0 },
        buckets: Array.from({ length: 30 }, (_, index) => ({
          startUnixSeconds: 1_754_092_800 + index * 86_400,
          endUnixSeconds: 1_754_179_200 + index * 86_400,
          commitCount: 0,
          contributorCount: 0,
          branchCount: 0,
        })),
      }),
    );
    const { rerender } = render(
      <ActivityView
        adapter={emptyAdapter}
        repo={undefined}
        entries={[persisted]}
        paneWidth={560}
        onPaneWidthChange={noopPaneWidthChange}
        onCancel={noopCancel}
        onError={noopError}
      />,
    );

    expect(screen.getByText('No repository selected', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText(/Command output is only available/u)).toBeVisible();
    expect(screen.queryByText('git fetch secret-remote')).not.toBeInTheDocument();

    rerender(
      <ActivityView
        adapter={emptyAdapter}
        repo={repo}
        entries={[persisted]}
        paneWidth={560}
        onPaneWidthChange={noopPaneWidthChange}
        onCancel={noopCancel}
        onError={noopError}
      />,
    );
    expect(await screen.findByText('No commits in this range')).toBeVisible();
  });

  it('keeps a retryable error state, reports through the common error path, and flags truncation', async () => {
    const user = userEvent.setup();
    const onError = vi.fn<ShowWorkspaceError>();
    const truncated = series({ coverage: { kind: 'truncated', scanLimit: 5_000 } });
    const adapter = adapterWithSeries(truncated);
    vi.mocked(adapter.query)
      .mockRejectedValueOnce(new Error('History unavailable'))
      .mockResolvedValueOnce({ kind: 'commitActivity', series: truncated });

    render(
      <ActivityView
        adapter={adapter}
        repo={repo}
        entries={[]}
        paneWidth={560}
        onPaneWidthChange={noopPaneWidthChange}
        onCancel={noopCancel}
        onError={onError}
      />,
    );

    expect(await screen.findByText('Commit activity unavailable')).toBeVisible();
    expect(onError).toHaveBeenCalledWith(
      'Commit activity unavailable',
      expect.any(Error),
      'Could not load commit activity.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByText(/Results are truncated after scanning 5,000 commits/u),
    ).toBeVisible();
  });
});
