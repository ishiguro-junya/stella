import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { join } from 'node:path';

import {
  debugAt,
  openRepository,
  resetApp,
  saveLogicalScreenshot,
  selectSetting,
} from './support/app.js';
import { createFixtureDirectory, removeFixture, runGit } from './support/fixtures.js';
import { copyE2EShowcaseRepository } from './support/showcaseRepository.js';

const screenshotMode = process.env.STELLA_SCREENSHOT === 'true';
const outputDirectory = 'screenshots';

async function waitForDiff(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() =>
        Boolean(
          document
            .querySelector<HTMLElement>('.diff-surface diffs-container')
            ?.shadowRoot?.querySelector('[data-line]'),
        ),
      ),
    { timeout: 10_000, timeoutMsg: '差分が表示されませんでした。' },
  );
}

async function waitForAddedAndDeletedLines(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        let hasAddition = false;
        let hasDeletion = false;
        document.querySelectorAll<HTMLElement>('.diff-surface diffs-container').forEach((host) => {
          hasAddition ||= Boolean(
            host.shadowRoot?.querySelector("[data-line-type='change-addition']"),
          );
          hasDeletion ||= Boolean(
            host.shadowRoot?.querySelector("[data-line-type='change-deletion']"),
          );
        });
        return hasAddition && hasDeletion;
      }),
    { timeout: 10_000, timeoutMsg: '追加行と削除行が両方表示されませんでした。' },
  );
}

async function blurActiveElement(): Promise<void> {
  await browser.execute(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function recordStageActivity(path: string): Promise<void> {
  const stage = $(`input[aria-label="ステージ ${path}"]`);
  await stage.waitForClickable({ timeout: 10_000 });
  await stage.click();
  const unstage = $(`input[aria-label="ステージ解除 ${path}"]`);
  await unstage.waitForClickable({ timeout: 10_000 });
  await unstage.click();
  await $(`input[aria-label="ステージ ${path}"]`).waitForDisplayed({ timeout: 20_000 });
}

async function recordScreenshotActivity(): Promise<void> {
  for (const path of [
    'src/records.ts',
    'README.md',
    'tests/records.test.ts',
    'tests/fifty-fifty.test.ts',
    'src/career.ts',
  ]) {
    // StageとUnstageは同じ画面状態を順番に更新するため直列に実行する。
    // oxlint-disable-next-line no-await-in-loop
    await recordStageActivity(path);
  }
}

async function prepareDiffScreenshot(): Promise<void> {
  await recordScreenshotActivity();
  await $('button[aria-label="設定"]').click();
  await $('#settings-title').waitForDisplayed({ timeout: 10_000 });
  await $('button[data-settings-category="diff"]').click();
  await selectSetting('stage-display', 'hide');
  await $('button=差分').click();
  await expect($('.diff-view')).toBeDisplayed();
  await expect($('.change-groups')).toHaveElementClass('is-stage-hidden');
  await expect($('.stage-toggle')).not.toExist();

  await $('button.change-row[aria-label$="src/teams/angels/shohei-ohtani.ts"]').click();
  await browser.execute(() => {
    document
      .querySelector<HTMLButtonElement>(
        'button.change-row[aria-label$="src/teams/dodgers/shohei-ohtani.ts"]',
      )
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  });
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () => document.querySelectorAll('button.change-row[aria-pressed="true"]').length,
      )) === 2,
    { timeout: 10_000, timeoutMsg: '移籍前後のファイルを同時選択できませんでした。' },
  );
  await waitForDiff();
  await waitForAddedAndDeletedLines();
}

async function withReadmeRepository(run: (repositoryPath: string) => Promise<void>): Promise<void> {
  if (!screenshotMode) return;
  const fixtureRoot = await createFixtureDirectory('readme-screenshots');
  try {
    const repositoryPath = await copyE2EShowcaseRepository(fixtureRoot, 'major-league-baseball', {
      preserveChanges: true,
    });
    await resetApp({ language: 'ja', appearance: 'dark', splitStageView: true });
    await openRepository(repositoryPath);
    await run(repositoryPath);
  } finally {
    await removeFixture(fixtureRoot);
  }
}

describe('README用スクリーンショット', () => {
  it('履歴を撮影する', async function () {
    await withReadmeRepository(async () => {
      await $('button=履歴').click();
      await expect($('.history-view')).toBeDisplayed();
      const worldSeries = $('.history-commit-item > .commit-row');
      await worldSeries.waitForClickable({ timeout: 20_000 });
      await worldSeries.click();
      await expect($('.commit-detail-pane')).toHaveText(
        expect.stringContaining('feat: ドジャースがワールドシリーズ2連覇'),
      );
      await expect($('.commit-detail-pane')).toHaveText(
        expect.stringContaining('2025/11/02 13:08'),
      );
      await waitForDiff();
      await waitForAddedAndDeletedLines();
      await blurActiveElement();
      await debugAt('history');
      await saveLogicalScreenshot(join(outputDirectory, 'history', 'history.png'), 1180, 760);
    });
  });

  it('差分を撮影する', async function () {
    await withReadmeRepository(async () => {
      await prepareDiffScreenshot();
      await expect($('.diff-view')).toBeDisplayed();
      await blurActiveElement();
      await debugAt('diff-screenshot');
      await saveLogicalScreenshot(join(outputDirectory, 'diff', 'diff.png'), 1180, 760);
    });
  });

  it('エディタを撮影する', async function () {
    await withReadmeRepository(async () => {
      await prepareDiffScreenshot();
      const dodgersRoster = $(
        'button.change-row[aria-label$="src/teams/dodgers/shohei-ohtani.ts"]',
      );
      await dodgersRoster.click();
      await expect(dodgersRoster).toHaveAttribute('aria-current', 'true');
      await expect($('#selected-file-title')).toHaveText('src/teams/dodgers/shohei-ohtani.ts');
      await waitForDiff();
      await browser.execute(() => {
        const root = document.querySelector<HTMLElement>(
          '.diff-surface diffs-container',
        )?.shadowRoot;
        const lineNumber = [
          ...(root?.querySelectorAll<HTMLElement>('[data-column-number]') ?? []),
        ].find((element) => element.textContent?.trim() === '17');
        if (!lineNumber) throw new Error('差分の17行目が見つかりません。');
        lineNumber.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      });
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const root = document.querySelector<HTMLElement>(
              '.diff-surface diffs-container',
            )?.shadowRoot;
            return [...(root?.querySelectorAll<HTMLElement>('[data-selected-line]') ?? [])].some(
              (element) => element.textContent?.trim() === '17',
            );
          }),
        { timeout: 10_000, timeoutMsg: '差分の17行目を選択できませんでした。' },
      );
      await $('.diff-file-toolbar .file-view-mode-toggle').click();
      const editor = $('.file-editor-pane');
      await editor.waitForDisplayed({ timeout: 10_000 });
      await expect(editor.$('[role="textbox"]')).toHaveAttribute(
        'aria-label',
        'src/teams/dodgers/shohei-ohtani.tsを編集',
      );
      await expect(editor.$('.cm-activeLineGutter')).toHaveText('17');
      await debugAt('editor');
      await saveLogicalScreenshot(join(outputDirectory, 'diff', 'editor.png'), 1180, 760);
    });
  });

  it('活動を撮影する', async function () {
    await withReadmeRepository(async (repositoryPath) => {
      // 基底フィクスチャの日付に時計を固定し、撮影時刻による画像差分を防ぐ。
      const screenshotNow = new Date(
        (await runGit(repositoryPath, ['log', '-1', '--format=%cI'])).trim(),
      ).toISOString();
      await browser.execute((now) => {
        const fixedTime = Date.parse(now);
        window.Date = new Proxy(Date, {
          apply: (target) => new target(fixedTime).toString(),
          construct: (target, args) =>
            Reflect.construct(target, args.length === 0 ? [fixedTime] : args),
          get: (target, property, receiver) =>
            property === 'now' ? () => fixedTime : Reflect.get(target, property, receiver),
        });
      }, screenshotNow);
      await recordScreenshotActivity();
      await $('button[aria-label="活動"]').click();
      await expect($('.activity-view')).toBeDisplayed();
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelectorAll('.activity-list tbody tr').length,
          )) >= 10,
        { timeout: 10_000, timeoutMsg: '活動の操作一覧が10件まで揃いませんでした。' },
      );
      expect(
        await browser.execute((now) => {
          const timestamps = [...document.querySelectorAll<HTMLTimeElement>('.activity-view time')];
          return timestamps.length >= 10 && timestamps.every((time) => time.dateTime === now);
        }, screenshotNow),
      ).toBe(true);
      await browser.waitUntil(
        async () => /[1-9]\d*件/.test(await $('.activity-chart-data').getText()),
        { timeout: 10_000, timeoutMsg: '活動の初期集計が完了しませんでした。' },
      );
      await browser.execute(() => {
        const range = document.querySelector<HTMLSelectElement>('select[aria-label="活動の期間"]');
        if (!range) throw new Error('活動の期間が見つかりません。');
        range.value = '1y';
        range.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.waitUntil(
        async () =>
          browser.execute(
            () =>
              document.querySelector<HTMLSelectElement>('select[aria-label="活動の期間"]')
                ?.value === '1y' &&
              document.querySelector<HTMLSelectElement>('select[aria-label="活動の指標"]')
                ?.value === 'commits' &&
              document.querySelector('.activity-chart-data')?.textContent?.includes('件') === true,
          ),
        { timeout: 10_000, timeoutMsg: '1年のコミット集計が整いませんでした。' },
      );
      await $('.activity-chart .recharts-surface').waitForDisplayed({ timeout: 10_000 });
      await browser.pause(1_000);
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const bars = [
              ...document.querySelectorAll<SVGPathElement>('.activity-chart .recharts-rectangle'),
            ];
            const heights = bars.map((bar) => bar.getBoundingClientRect().height);
            return (
              heights.length === 13 &&
              heights.every((height) => height > 1) &&
              heights.at(-1)! > heights[0]! * 10
            );
          }),
        { timeout: 10_000, timeoutMsg: '右肩上がりのコミットグラフが描画されませんでした。' },
      );
      await browser.execute(() => {
        const accent = getComputedStyle(document.documentElement)
          .getPropertyValue('--accent')
          .trim();
        document
          .querySelectorAll<SVGPathElement>('.activity-chart .recharts-rectangle')
          .forEach((bar) => bar.setAttribute('fill', accent));
      });
      await blurActiveElement();
      await debugAt('activity');
      await saveLogicalScreenshot(join(outputDirectory, 'activity', 'activity.png'), 1180, 760);
    });
  });

  it('設定を撮影する', async function () {
    await withReadmeRepository(async () => {
      await $('button[aria-label="設定"]').click();
      await $('#settings-title').waitForDisplayed({ timeout: 10_000 });
      await $('button[data-settings-category="editor"]').click();
      await $('#settings-category-editor-title').waitForDisplayed({ timeout: 10_000 });
      await expect($('#settings-category-editor-title')).toBeDisplayed();
      await blurActiveElement();
      await debugAt('settings');
      await saveLogicalScreenshot(join(outputDirectory, 'settings', 'settings.png'), 1180, 760);
    });
  });
});
