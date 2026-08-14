import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import {
  commitCurrentChange,
  expectInteractiveSelectedColors,
  openRepository,
  resetApp,
} from './support/app.js';
import { createFixtureDirectory, removeFixture, writeRepositoryFile } from './support/fixtures.js';
import { copyE2EShowcaseRepository } from './support/showcaseRepository.js';

describe('Activity', () => {
  let fixturePath = '';
  let repositoryPath = '';

  beforeEach(async () => {
    fixturePath = await createFixtureDirectory('activity');
    repositoryPath = await copyE2EShowcaseRepository(fixturePath);
    await resetApp({ language: 'ja', splitStageView: true });
    await openRepository(repositoryPath);
    await writeRepositoryFile(repositoryPath, 'README.md', '# Stella E2E\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await commitCurrentChange('E2Eリポジトリを初期化する');
  });

  afterEach(async () => {
    await removeFixture(fixturePath);
    fixturePath = '';
    repositoryPath = '';
  });

  it('shows operation activity and repository analytics independently', async () => {
    const activity = $('button[aria-label="活動"]');
    await expect(activity).toHaveText('活動');
    await expect($('button[aria-label="設定"]')).toHaveText('設定');
    await activity.click();
    await expect($('.activity-view')).toBeDisplayed();
    const firstOperation = $('.activity-list tbody tr:first-child');
    const secondOperation = $('.activity-list tbody tr:nth-child(2)');
    await firstOperation.waitForDisplayed();
    expect(
      await browser.execute(
        () => document.activeElement === document.querySelector('.activity-list tbody tr'),
      ),
    ).toBe(true);
    await browser.keys(['ArrowDown']);
    await expect(secondOperation).toHaveAttribute('aria-selected', 'true');
    expect(
      await browser.execute(
        () =>
          document.activeElement === document.querySelector('.activity-list tbody tr:nth-child(2)'),
      ),
    ).toBe(true);
    await browser.keys(['ArrowUp']);
    await expect(firstOperation).toHaveAttribute('aria-selected', 'true');
    await expect(activity).toHaveAttribute('aria-current', 'page');
    await $('.activity-analytics-body').waitForDisplayed();
    const analyticsBoundsBefore = await browser.execute(() => {
      const bounds = document
        .querySelector<HTMLElement>('.activity-analytics-body')!
        .getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(await $('.activity-view').getText()).not.toMatch(/読み込み中|読み込んでいます/u);
    await $('.activity-list tbody tr[aria-selected="true"]').waitForDisplayed();
    await expectInteractiveSelectedColors('.activity-list tbody tr[aria-selected="true"]', {
      palette: 'neutral',
    });
    await expect($(`.repository-toggle[title="${repositoryPath}"]`)).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText('main');
    await activity.click();
    await expect($('.activity-view')).toBeDisplayed();
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector<HTMLElement>('button[aria-label="活動"]')!,
        ).getPropertyValue('box-shadow'),
      ),
    ).toBe('none');
    await expect($('#activity-title')).toHaveText('活動');
    await expect($('#commit-activity-title')).toHaveText('リポジトリ分析');
    await expect($('#commit-activity-title')).toHaveElementClass('sr-only');

    const activityRange = $('select[aria-label="活動の期間"]');
    await expect($('.activity-analytics-header select[aria-label="活動の期間"]')).toBeDisplayed();
    expect(await activityRange.getValue()).toBe('30d');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>('select[aria-label="活動の期間"] option'),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['7日', '30日', '90日', '180日', '1年']);
    const activityMetric = $('select[aria-label="活動の指標"]');
    await expect($('.activity-analytics-header select[aria-label="活動の指標"]')).toBeDisplayed();
    expect(await activityMetric.getValue()).toBe('commits');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>('select[aria-label="活動の指標"] option'),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['コミット', 'コントリビューター', 'ブランチ']);
    expect(
      await browser.execute(() => {
        const metric = document.querySelector('select[aria-label="活動の指標"]');
        const range = document.querySelector('select[aria-label="活動の期間"]');
        return Boolean(
          metric &&
          range &&
          metric.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    expect(
      await browser.execute(() => {
        const panels = document.querySelector<HTMLElement>('.activity-page-panels');
        return [...(panels?.children ?? [])].map((element) => element.className);
      }),
    ).toEqual([
      expect.stringContaining('activity-analytics-panel'),
      expect.stringContaining('pane-resizer'),
      expect.stringContaining('activity-operations-panel'),
    ]);

    expect(
      await $$('.activity-operation-table thead th').map((header) => header.getText()),
    ).toEqual(['状態', '操作', '概要', '日時', '所要時間']);
    await expect($('.activity-list')).toHaveText(expect.stringContaining('コミット'));
    expect(
      await browser.execute(() => {
        const status = document.querySelector<HTMLElement>('.activity-list tbody td:first-child');
        const details = document.querySelector<HTMLElement>('.activity-details');
        return {
          statusPaddingLeft: status ? Number.parseFloat(getComputedStyle(status).paddingLeft) : 0,
          detailPaddingLeft: details ? Number.parseFloat(getComputedStyle(details).paddingLeft) : 0,
        };
      }),
    ).toEqual({ statusPaddingLeft: 14, detailPaddingLeft: 18 });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelectorAll('.activity-chart-data tbody tr').length > 0,
        ),
      { timeout: 10_000, timeoutMsg: 'Commit activity data did not load.' },
    );
    expect(
      await browser.execute(() => {
        const bounds = document
          .querySelector<HTMLElement>('.activity-analytics-body')!
          .getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    ).toEqual(analyticsBoundsBefore);
    await expect($('.activity-metrics')).not.toExist();
    await expect($('.activity-analytics-summary')).not.toExist();
    await expect($('.activity-chart-data table')).toBeDisplayed();
    expect(await $$('.activity-chart-data thead th').map((header) => header.getText())).toEqual([
      '期間',
      'コミット',
      'コントリビューター',
      'ブランチ',
    ]);
    expect(
      await browser.execute(() => {
        const cells = document.querySelectorAll<HTMLElement>('.activity-chart-data thead th');
        const first = cells.item(0);
        const last = cells.item(cells.length - 1);
        return {
          firstPaddingLeft: Number.parseFloat(getComputedStyle(first).paddingLeft),
          lastPaddingRight: Number.parseFloat(getComputedStyle(last).paddingRight),
        };
      }),
    ).toEqual({ firstPaddingLeft: 14, lastPaddingRight: 14 });

    const activityResizer = $('[role="separator"][aria-label="リポジトリ分析の幅"]');
    await expect(activityResizer).toHaveAttribute('aria-valuenow', '360');
    await activityResizer.click();
    await browser.keys(['ArrowRight']);
    await expect(activityResizer).toHaveAttribute('aria-valuenow', '368');
    expect(
      await browser.execute(() => {
        const container = document.querySelector<HTMLElement>('.activity-chart-data > div');
        return {
          overflowY: container ? getComputedStyle(container).overflowY : '',
          scrollable: Boolean(container && container.scrollHeight > container.clientHeight),
        };
      }),
    ).toEqual({ overflowY: 'auto', scrollable: true });

    const setActivityMetric = async (value: 'commits' | 'contributors' | 'branches') => {
      await browser.execute((nextValue) => {
        const select = document.querySelector<HTMLSelectElement>('select[aria-label="活動の指標"]');
        if (!select) throw new Error('Activity metric select was not found.');
        select.value = nextValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await browser.waitUntil(async () => (await activityMetric.getValue()) === value, {
        timeout: 10_000,
        timeoutMsg: `Activity metric did not change to ${value}.`,
      });
    };
    await setActivityMetric('contributors');
    await setActivityMetric('branches');
    await setActivityMetric('commits');
    await browser.execute(() => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="活動の期間"]');
      if (!select) throw new Error('Activity range select was not found.');
      select.value = '7d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await activityRange.getValue()) === '7d', {
      timeout: 10_000,
      timeoutMsg: 'Activity range did not change to seven days.',
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelectorAll('.activity-chart-data tbody tr').length === 7,
        ),
      { timeout: 10_000, timeoutMsg: 'Seven-day commit activity did not settle.' },
    );
    await expect($('.activity-chart .recharts-wrapper svg.recharts-surface')).toBeDisplayed();
    await expect($('.activity-chart-data table')).toBeDisplayed();
    const yAxisLayout = await browser.execute(() => {
      const chart = document.querySelector<HTMLElement>('.activity-chart')?.getBoundingClientRect();
      const ticks = [...document.querySelectorAll<SVGTextElement>('.activity-chart svg text')].map(
        (tick) => tick.getBoundingClientRect(),
      );
      return {
        height: chart?.height ?? 0,
        tickCount: ticks.length,
        clipped: Boolean(chart && ticks.some((tick) => tick.left < chart.left)),
      };
    });
    expect(yAxisLayout.height).toBe(240);
    expect(yAxisLayout.tickCount).toBeGreaterThan(0);
    expect(yAxisLayout.clipped).toBe(false);

    const settings = $('button[aria-label="設定"]');
    await settings.click();
    await expect($('#settings-title')).toHaveText('設定');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await activity.click();
    await expect($('#activity-title')).toHaveText('活動');
    await expect(activity).toHaveAttribute('aria-current', 'page');
    await expect($('[role="separator"][aria-label="リポジトリ分析の幅"]')).toHaveAttribute(
      'aria-valuenow',
      '368',
    );

    await browser.keys(['Escape']);
    const changes = $('button[aria-label="変更"]');
    await changes.click();
    await expect($('.changes-view')).toBeDisplayed();
    await expect(activity).not.toHaveAttribute('aria-current');
    expect(
      await browser.execute(
        (selector) => document.activeElement === document.querySelector(selector),
        'button[aria-label="変更"]',
      ),
    ).toBe(true);
    const changesResizer = $('[role="separator"][aria-label="変更一覧の幅"]');
    await expect(changesResizer).toHaveAttribute('aria-valuenow', '368');
    await changesResizer.click();
    await browser.keys(['ArrowRight']);
    await expect(changesResizer).toHaveAttribute('aria-valuenow', '376');

    await $('button=履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    const historyResizer = $('[role="separator"][aria-label="履歴一覧の幅"]');
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '376');
    await historyResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '368');
    await activity.click();
    await expect($('[role="separator"][aria-label="リポジトリ分析の幅"]')).toHaveAttribute(
      'aria-valuenow',
      '368',
    );
    await $('button=履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('[role="separator"][aria-label="履歴一覧の幅"]')).toHaveAttribute(
      'aria-valuenow',
      '368',
    );
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('E2Eリポジトリを初期化する'),
    );
  });
});
