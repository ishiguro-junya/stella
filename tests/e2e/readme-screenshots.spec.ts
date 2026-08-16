import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { join } from 'node:path';

import { openRepository, resetApp, saveLogicalScreenshot, selectSetting } from './support/app.js';
import { createFixtureDirectory, removeFixture } from './support/fixtures.js';
import { copyE2EShowcaseRepository } from './support/showcaseRepository.js';

const outputDirectory = process.env.VISUAL_QA_OUTPUT_DIR;

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

async function blurActiveElement(): Promise<void> {
  await browser.execute(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

describe('README用スクリーンショット', () => {
  it('変更、履歴、活動、設定を撮影する', async function () {
    this.timeout(180_000);
    if (!outputDirectory) return;

    const fixtureRoot = await createFixtureDirectory('readme-screenshots');
    try {
      const repositoryPath = await copyE2EShowcaseRepository(fixtureRoot, 'major-league-baseball', {
        preserveChanges: true,
      });

      await resetApp({ language: 'ja', appearance: 'dark', splitStageView: true });
      await openRepository(repositoryPath);
      await $('button=履歴').click();
      await expect($('.history-view')).toBeDisplayed();
      const fiftyFifty = $('.history-commit-item > .commit-row');
      await fiftyFifty.waitForClickable({ timeout: 20_000 });
      await fiftyFifty.click();
      await expect($('.commit-detail-pane')).toHaveText(
        expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
      );
      await expect($('.commit-detail-pane')).toHaveText(
        expect.stringContaining('2024/09/19 19:10'),
      );
      await waitForDiff();
      await blurActiveElement();
      await saveLogicalScreenshot(join(outputDirectory, 'history.png'), 1180, 760);

      await browser.execute(() => window.dispatchEvent(new Event('focus')));
      await $('.history-working-tree-entry').waitForDisplayed({ timeout: 20_000 });
      await $('button=差分').click();
      await expect($('.diff-view')).toBeDisplayed();

      const recordsStage = $('input[aria-label="ステージ src/records.ts"]');
      await recordsStage.waitForClickable({ timeout: 10_000 });
      await recordsStage.click();
      const recordsUnstage = $('input[aria-label="ステージ解除 src/records.ts"]');
      await recordsUnstage.waitForClickable({ timeout: 10_000 });
      await recordsUnstage.click();
      await $('input[aria-label="ステージ src/records.ts"]').waitForDisplayed({ timeout: 20_000 });

      await $('button[aria-label="設定"]').click();
      await $('#settings-title').waitForDisplayed({ timeout: 10_000 });
      await $('button[data-settings-category="diff"]').click();
      await selectSetting('stage-display', 'hide');
      await $('button=差分').click();
      await expect($('.diff-view')).toBeDisplayed();
      await expect($('.change-groups')).toHaveElementClass('is-stage-hidden');
      await expect($('.stage-toggle')).not.toExist();

      const dodgersRoster = $(
        'button.change-row[aria-label$="src/teams/dodgers/shohei-ohtani.ts"]',
      );
      await dodgersRoster.click();
      await expect(dodgersRoster).toHaveAttribute('aria-current', 'true');
      await expect($('#selected-file-title')).toHaveText('src/teams/dodgers/shohei-ohtani.ts');
      await waitForDiff();
      await blurActiveElement();
      await saveLogicalScreenshot(join(outputDirectory, 'changes.png'), 1180, 760);

      await $('.diff-file-toolbar .file-view-mode-toggle').click();
      const editor = $('.file-editor-pane');
      await editor.waitForDisplayed({ timeout: 10_000 });
      await expect(editor.$('[role="textbox"]')).toHaveAttribute(
        'aria-label',
        'src/teams/dodgers/shohei-ohtani.tsを編集',
      );
      await blurActiveElement();
      await saveLogicalScreenshot(join(outputDirectory, 'editor.png'), 1180, 760);

      await $('button[aria-label="活動"]').click();
      await expect($('.activity-view')).toBeDisplayed();
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
      await saveLogicalScreenshot(join(outputDirectory, 'activity.png'), 1180, 760);

      await resetApp({ language: 'ja', appearance: 'dark', splitStageView: false });
      await $('button[aria-label="設定"]').click();
      await $('#settings-title').waitForDisplayed({ timeout: 10_000 });
      await $('button[data-settings-category="git"]').click();
      await $('#settings-category-git-title').waitForDisplayed({ timeout: 10_000 });
      await blurActiveElement();
      await saveLogicalScreenshot(join(outputDirectory, 'settings.png'), 1180, 760);
    } finally {
      await removeFixture(fixtureRoot);
    }
  });
});
