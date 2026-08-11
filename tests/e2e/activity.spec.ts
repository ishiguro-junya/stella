import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import { commitCurrentChange, openRepository, resetApp } from './support/app.js';
import {
  configureRepository,
  createEmptyRepository,
  removeFixture,
  writeRepositoryFile,
} from './support/fixtures.js';

describe('Activity', () => {
  let repositoryPath = '';

  beforeEach(async () => {
    repositoryPath = await createEmptyRepository('activity');
    await resetApp({ language: 'ja' });
    await openRepository(repositoryPath);
    await configureRepository(repositoryPath);
    await writeRepositoryFile(repositoryPath, 'README.md', '# Stella E2E\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await commitCurrentChange('E2Eリポジトリを初期化する');
  });

  afterEach(async () => {
    await removeFixture(repositoryPath);
    repositoryPath = '';
  });

  it('shows operation activity and repository analytics independently', async () => {
    const activity = $('button[aria-label="アクティビティ"]');
    await expect(activity).toHaveText('アクティビティ');
    await expect($('button[aria-label="設定"]')).toHaveText('設定');
    await activity.click();
    await expect($('.activity-view')).toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'アクティビティ',
    );
    await expect(activity).toHaveAttribute('aria-current', 'page');
    await expect($(`.repository-toggle[title="${repositoryPath}"]`)).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText('main');
    await activity.click();
    await expect($('.activity-view')).toBeDisplayed();
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector<HTMLElement>('button[aria-label="アクティビティ"]')!,
        ).getPropertyValue('box-shadow'),
      ),
    ).toBe('none');
    await expect($('#activity-title')).toHaveText('アクティビティ');
    const activityPanelHeader = $('.activity-panel-header');
    await expect(activityPanelHeader).toBeDisplayed();
    await expect($('#commit-activity-title')).toHaveText('リポジトリ分析');
    await expect($('#commit-activity-title')).toHaveElementClass('sr-only');
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLElement>('.activity-panel-header')?.getBoundingClientRect()
            .height,
      ),
    ).toBeLessThanOrEqual(60);

    const activityRange = $('select[aria-label="アクティビティの期間"]');
    expect(await activityRange.getValue()).toBe('30d');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>(
            'select[aria-label="アクティビティの期間"] option',
          ),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['7日', '30日', '90日', '180日', '1年']);
    const activityMetric = $('select[aria-label="アクティビティの指標"]');
    expect(await activityMetric.getValue()).toBe('commits');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>(
            'select[aria-label="アクティビティの指標"] option',
          ),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['コミット', 'コントリビューター', 'ブランチ']);
    expect(
      await browser.execute(() => {
        const metric = document.querySelector('select[aria-label="アクティビティの指標"]');
        const range = document.querySelector('select[aria-label="アクティビティの期間"]');
        return Boolean(
          metric &&
          range &&
          metric.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);

    expect(
      await $$('.activity-operation-table thead th').map((header) => header.getText()),
    ).toEqual(['状態', '操作', '概要', '日時', '所要時間']);
    await expect($('.activity-list')).toHaveText(expect.stringContaining('Commit'));
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
      async () => (await $('.activity-chart-data').getText()).includes('1件'),
      { timeout: 10_000, timeoutMsg: 'Commit activity data did not load.' },
    );
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

    const activityResizer = $('[role="separator"][aria-label="操作一覧の幅"]');
    await expect(activityResizer).toHaveAttribute('aria-valuenow', '560');
    await activityResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(activityResizer).toHaveAttribute('aria-valuenow', '552');
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
        const select = document.querySelector<HTMLSelectElement>(
          'select[aria-label="アクティビティの指標"]',
        );
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
      const select = document.querySelector<HTMLSelectElement>(
        'select[aria-label="アクティビティの期間"]',
      );
      if (!select) throw new Error('Activity range select was not found.');
      select.value = '7d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await activityRange.getValue()) === '7d', {
      timeout: 10_000,
      timeoutMsg: 'Activity range did not change to seven days.',
    });
    await browser.waitUntil(
      async () => (await $('.activity-chart-data').getText()).includes('1件'),
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
        tickCount: ticks.length,
        clipped: Boolean(chart && ticks.some((tick) => tick.left < chart.left)),
      };
    });
    expect(yAxisLayout.tickCount).toBeGreaterThan(0);
    expect(yAxisLayout.clipped).toBe(false);

    const settings = $('button[aria-label="設定"]');
    await settings.click();
    await expect($('#settings-title')).toHaveText('設定');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await activity.click();
    await expect($('#activity-title')).toHaveText('アクティビティ');
    await expect(activity).toHaveAttribute('aria-current', 'page');
    await expect($('[role="separator"][aria-label="操作一覧の幅"]')).toHaveAttribute(
      'aria-valuenow',
      '552',
    );

    await browser.keys(['Escape']);
    const changes = $('button[aria-label="変更差分"]');
    await changes.click();
    await expect($('.changes-view')).toBeDisplayed();
    await expect(activity).not.toHaveAttribute('aria-current');
    expect(
      await browser.execute(
        (selector) => document.activeElement === document.querySelector(selector),
        'button[aria-label="変更差分"]',
      ),
    ).toBe(true);
    const changesResizer = $('[role="separator"][aria-label="変更一覧の幅"]');
    await expect(changesResizer).toHaveAttribute('aria-valuenow', '320');
    await changesResizer.click();
    await browser.keys(['ArrowRight']);
    await expect(changesResizer).toHaveAttribute('aria-valuenow', '328');

    await $('button=操作履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    const historyResizer = $('[role="separator"][aria-label="操作履歴一覧の幅"]');
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '244');
    await historyResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '236');
    await activity.click();
    await expect($('[role="separator"][aria-label="操作一覧の幅"]')).toHaveAttribute(
      'aria-valuenow',
      '552',
    );
    await $('button=操作履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('[role="separator"][aria-label="操作履歴一覧の幅"]')).toHaveAttribute(
      'aria-valuenow',
      '236',
    );
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: E2Eリポジトリを初期化する'),
    );
  });
});
