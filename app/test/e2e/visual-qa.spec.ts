import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  debugAt,
  dispatchDoubleClick,
  openRepository,
  openRepositoryFromSwitcher,
  resetApp,
  saveLogicalScreenshot,
  selectSetting,
  setLogicalWindowSize,
} from './support/app.js';
import {
  createEmptyRepository,
  createFixtureDirectory,
  ensureLocalBareRemote,
  removeFixture,
  runGit,
  writeRepositoryFile,
} from './support/fixtures.js';
import { copyE2EShowcaseRepository } from './support/showcaseRepository.js';

const screenshotMode = ['scr', 'vrt'].includes(process.env.STELLA_TEST_MODE ?? '');
const visualQaDirectory = process.env.STELLA_SCREENSHOT_OUTPUT ?? 'screenshots';

async function listPngFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true }))
    .filter((path) => path.endsWith('.png'))
    .toSorted();
}

interface VisualRepository {
  currentPath: string;
  visualRoot: string;
}

async function blurActiveElement(): Promise<void> {
  await browser.execute(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function withVisualRepository(
  run: (repository: VisualRepository) => Promise<void>,
): Promise<void> {
  if (!screenshotMode) return;
  const visualRoot = await createFixtureDirectory('visual');
  try {
    const currentPath = await copyE2EShowcaseRepository(visualRoot, 'stella-visual-qa');
    await writeRepositoryFile(currentPath, 'README.md', '# Stella Visual QA\n');
    await runGit(currentPath, ['branch', 'feature/search']);
    await runGit(currentPath, ['branch', 'release']);
    await resetApp({ language: 'en', appearance: 'light' });
    await openRepository(currentPath, { language: 'en' });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            document
              .querySelector<HTMLElement>('.diff-surface diffs-container')
              ?.shadowRoot?.querySelector('[data-line]'),
          ),
        ),
      { timeout: 10_000, timeoutMsg: 'Diff did not load.' },
    );
    await setLogicalWindowSize(1180, 760);
    await run({ currentPath, visualRoot });
  } finally {
    await removeFixture(visualRoot);
  }
}

const readTooltipPlacement = async () =>
  browser.execute(() => {
    const trigger = document.querySelector<HTMLElement>('button[aria-label="Fetch"]')!;
    const tooltip = document.querySelector<HTMLElement>('.app-tooltip')!;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    return {
      centerDelta: Math.round(
        Math.abs(
          triggerRect.left + triggerRect.width / 2 - (tooltipRect.left + tooltipRect.width / 2),
        ),
      ),
      gap: Math.round(triggerRect.top - tooltipRect.bottom),
      side: tooltip.dataset.side,
    };
  });

async function captureTooltip(
  fileName: string,
  breakpoint: string,
  expectedColors: { background: string; foreground: string },
): Promise<void> {
  await setLogicalWindowSize(860, 560);
  await browser.execute(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Fetch"]')?.focus();
  });
  await expect($('.app-tooltip')).toBeDisplayed();
  await setLogicalWindowSize(1180, 760);
  await browser.waitUntil(async () => {
    const placement = await readTooltipPlacement();
    return placement.centerDelta === 0 && placement.gap === 8 && placement.side === 'top';
  });
  expect(
    await browser.execute(() => {
      const tooltip = document.querySelector<HTMLElement>('.app-tooltip')!;
      return {
        arrow: getComputedStyle(tooltip, '::after').backgroundColor,
        background: getComputedStyle(tooltip).backgroundColor,
        foreground: getComputedStyle(tooltip).color,
      };
    }),
  ).toEqual({
    arrow: expectedColors.background,
    background: expectedColors.background,
    foreground: expectedColors.foreground,
  });
  await debugAt(breakpoint);
  await saveLogicalScreenshot(join(visualQaDirectory, 'diff', 'tooltips', fileName), 1180, 760);
  expect(await readTooltipPlacement()).toEqual({ centerDelta: 0, gap: 8, side: 'top' });
  await browser.keys(['Escape']);
}

async function captureDialog(directory: string, breakpoint: string): Promise<void> {
  await debugAt(breakpoint);
  await saveLogicalScreenshot(join(visualQaDirectory, directory, 'light-1180x760.png'), 1180, 760);
  await saveLogicalScreenshot(join(visualQaDirectory, directory, 'light-860x560.png'), 860, 560);
}

describe('視覚確認用スクリーンショット', () => {
  after(async () => {
    if (process.env.STELLA_TEST_MODE !== 'vrt' || process.env.STELLA_VRT_UPDATE === 'true') return;
    expect(await listPngFiles(visualQaDirectory)).toEqual(
      await listPngFiles(join(visualQaDirectory, '..', 'baseline')),
    );
  });

  it('差分を撮影する', async function () {
    await withVisualRepository(async () => {
      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await expect($('.settings-view')).toBeDisplayed();
      await expect($('select[name="diff-layout"]')).toHaveValue('unified');
      await $('button=Diff').click();
      await expect($('.diff-view')).toBeDisplayed();
      await debugAt('diff-screenshot');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'diff', 'segmented-unified-1180x760.png'),
        1180,
        760,
      );

      await settings.click();
      await selectSetting('diff-layout', 'split');
      await $('button=Diff').click();
      await blurActiveElement();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'diff', 'segmented-split-1180x760.png'),
        1180,
        760,
      );

      await setLogicalWindowSize(1180, 760);
      await settings.click();
      await selectSetting('language', 'ja');
      await $('button[aria-label="差分"]').click();
      await saveLogicalScreenshot(join(visualQaDirectory, 'diff', 'ja-1180x760.png'), 1180, 760);
      await saveLogicalScreenshot(join(visualQaDirectory, 'diff', 'ja-860x560.png'), 860, 560);
    });
  });

  it('履歴を撮影する', async function () {
    await withVisualRepository(async () => {
      await $('button=History').click();
      await expect($('.history-view')).toBeDisplayed();
      await browser.waitUntil(
        async () =>
          browser.execute(() =>
            Boolean(
              document
                .querySelector<HTMLElement>('.diff-surface diffs-container')
                ?.shadowRoot?.querySelector('[data-line] span'),
            ),
          ),
        { timeout: 10_000, timeoutMsg: 'History syntax highlighting did not load.' },
      );
      await blurActiveElement();
      await debugAt('history');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'history', 'segmented-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'history', 'segmented-860x560.png'),
        860,
        560,
      );
    });
  });

  it('リポジトリ切替ダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath, visualRoot }) => {
      const conflictPath = await copyE2EShowcaseRepository(visualRoot, 'stella-conflict');
      await openRepositoryFromSwitcher(conflictPath, 'en');
      await $('.repository-toggle').click();
      await dispatchDoubleClick('[data-switcher-item-label="stella-visual-qa"]');
      await $(`.repository-toggle[data-repository-path="${currentPath}"]`).waitForDisplayed({
        timeout: 10_000,
      });
      await $('.repository-toggle').click();
      await expect($('[role="dialog"] .switcher-list')).toBeDisplayed();
      await debugAt('repository-switcher');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repositories', 'switcher', '1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repositories', 'switcher', '860x560.png'),
        860,
        560,
      );
    });
  });

  it('ブランチ切替ダイアログを撮影する', async function () {
    await withVisualRepository(async () => {
      await $('.branch-toggle').click();
      await expect($('[role="dialog"] .switcher-list')).toHaveText(
        expect.stringContaining('feature/search'),
      );
      await debugAt('branch-switcher');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'branches', 'switcher', '1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'branches', 'switcher', '860x560.png'),
        860,
        560,
      );
    });
  });

  it('設定を撮影する', async function () {
    await withVisualRepository(async () => {
      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await debugAt('settings');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings', 'en-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings', 'en-light-860x560.png'),
        860,
        560,
      );
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);

      await selectSetting('language', 'ja');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings', 'ja-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings', 'ja-light-860x560.png'),
        860,
        560,
      );
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);

      await selectSetting('language', 'en');
      await selectSetting('appearance', 'dark');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings', 'en-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings', 'en-dark-860x560.png'),
        860,
        560,
      );
    });
  });

  it('ツールチップを撮影する', async function () {
    await withVisualRepository(async () => {
      await expect($('.diff-view')).toBeDisplayed();
      await captureTooltip('tooltip-en-light-1180x760.png', 'tooltip-light', {
        background: 'rgb(29, 30, 34)',
        foreground: 'rgb(255, 255, 255)',
      });
      await $('.titlebar-actions button:last-child').click();
      await selectSetting('appearance', 'dark');
      await $('button[aria-label="Diff"]').click();
      await captureTooltip('tooltip-en-dark-1180x760.png', 'tooltip-dark', {
        background: 'rgb(248, 248, 250)',
        foreground: 'rgb(28, 28, 30)',
      });
    });
  });

  it('活動を撮影する', async function () {
    await withVisualRepository(async () => {
      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await selectSetting('appearance', 'dark');
      await $('button[aria-label="Activity"]').click();
      await expect($('.activity-view')).toBeDisplayed();
      await browser.waitUntil(
        async () =>
          browser.execute(
            () => document.querySelectorAll('.activity-chart-data tbody tr').length > 0,
          ),
        { timeout: 10_000, timeoutMsg: 'Commit activity data did not load.' },
      );
      await $('.activity-chart .recharts-surface').waitForDisplayed({ timeout: 10_000 });
      await debugAt('activity-dark');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity', 'en-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity', 'en-dark-860x560.png'),
        860,
        560,
      );

      await settings.click();
      await selectSetting('appearance', 'light');
      await $('button[aria-label="Activity"]').click();
      await $('.activity-chart .recharts-surface').waitForDisplayed({ timeout: 10_000 });
      await debugAt('activity-light');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity', 'en-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity', 'en-light-860x560.png'),
        860,
        560,
      );
    });
  });

  it('空のリポジトリ一覧を撮影する', async function () {
    if (!screenshotMode) return;
    await resetApp({ language: 'en', appearance: 'light' });
    await expect($('.repository-landing')).toBeDisplayed();
    await debugAt('repository-list-empty');
    await saveLogicalScreenshot(
      join(visualQaDirectory, 'repositories', 'landing', 'empty-light-1180x760.png'),
      1180,
      760,
    );
    await saveLogicalScreenshot(
      join(visualQaDirectory, 'repositories', 'landing', 'empty-light-860x560.png'),
      860,
      560,
    );
  });

  it('リポジトリ追加ダイアログを撮影する', async function () {
    if (!screenshotMode) return;
    await resetApp({ language: 'en', appearance: 'light' });
    await $('button=Add').click();
    await expect($('[role="dialog"][aria-labelledby="add-repository-title"]')).toBeDisplayed();
    await debugAt('add-repository-dialog');
    await saveLogicalScreenshot(
      join(visualQaDirectory, 'repositories', 'add', 'light-1180x760.png'),
      1180,
      760,
    );
    await saveLogicalScreenshot(
      join(visualQaDirectory, 'repositories', 'add', 'light-860x560.png'),
      860,
      560,
    );

    await resetApp({ language: 'en', appearance: 'dark' });
    await $('button=Add').click();
    await debugAt('add-repository-dialog-dark');
    await saveLogicalScreenshot(
      join(visualQaDirectory, 'repositories', 'add', 'dark-1180x760.png'),
      1180,
      760,
    );
    await saveLogicalScreenshot(
      join(visualQaDirectory, 'repositories', 'add', 'dark-860x560.png'),
      860,
      560,
    );
  });

  it('Commitダイアログを撮影する', async function () {
    await withVisualRepository(async () => {
      const commit = $('.diff-action-bar .diff-action-button[aria-label="Commit"]');
      await commit.waitForClickable({ timeout: 10_000 });
      await commit.click();
      await expect($('[role="dialog"][aria-labelledby="commit-dialog-title"]')).toBeDisplayed();
      await captureDialog('diff/dialogs/commit', 'commit-dialog');
    });
  });

  it('Pullダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath, visualRoot }) => {
      await ensureLocalBareRemote(currentPath, join(visualRoot, 'visual-remote.git'));
      await browser.execute(() => window.dispatchEvent(new Event('focus')));
      await $('.diff-action-bar .diff-action-button[aria-label="Pull"]').click();
      const dialog = $('[role="dialog"][aria-labelledby="pull-dialog-title"]');
      await expect(dialog).toBeDisplayed();
      await expect(dialog.$('select')).toHaveValue('origin/main');
      await captureDialog('diff/dialogs/pull', 'pull-dialog');
    });
  });

  it('Pushダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath, visualRoot }) => {
      await ensureLocalBareRemote(currentPath, join(visualRoot, 'visual-remote.git'));
      await browser.execute(() => window.dispatchEvent(new Event('focus')));
      await $('.diff-action-bar .diff-action-button[aria-label="Push"]').click();
      const dialog = $('[role="dialog"][aria-labelledby="push-dialog-title"]');
      await expect(dialog).toBeDisplayed();
      await expect(dialog.$('select')).toHaveValue('origin');
      await captureDialog('diff/dialogs/push', 'push-dialog');
    });
  });

  it('Branch作成ダイアログを撮影する', async function () {
    await withVisualRepository(async () => {
      await $('.branch-toggle').click();
      const switcher = $('[role="dialog"][aria-labelledby]');
      await switcher.$('[role="option"][aria-current="true"]').click();
      const create = switcher.$('button=Create');
      await create.waitForEnabled();
      await create.click();
      await expect($('[role="dialog"][aria-labelledby="create-branch-title"]')).toBeDisplayed();
      await captureDialog('branches/dialogs/create', 'create-branch-dialog');
    });
  });

  it('Tag作成ダイアログを撮影する', async function () {
    await withVisualRepository(async () => {
      await $('button=History').click();
      const commit = $('.history-commit-item .commit-row');
      await commit.waitForClickable({ timeout: 20_000 });
      await commit.click();
      const actions = $('.history-commit-item.is-current .history-action-trigger');
      await actions.waitForEnabled({ timeout: 20_000 });
      await actions.click();
      await $('[role="menu"]').$('button=Create Tag').click();
      await expect($('[role="dialog"][aria-labelledby="history-createTag-title"]')).toBeDisplayed();
      await captureDialog('history/dialogs/create-tag', 'history-tag-dialog');
    });
  });

  it('リポジトリ情報ダイアログを撮影する', async function () {
    await withVisualRepository(async () => {
      await $('.repository-toggle').click();
      const switcher = $('[role="dialog"]');
      await switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger').click();
      await $('button=Change Repository Information').click();
      await expect($('[role="dialog"][aria-labelledby="remote-manager-title"]')).toBeDisplayed();
      await captureDialog('repositories/dialogs/information', 'remote-manager-dialog');
    });
  });

  it('リポジトリ一覧を撮影する', async function () {
    if (!screenshotMode) return;
    const visualRoot = await createFixtureDirectory('visual-list');
    const extraRepositoryPaths: string[] = [];
    try {
      const currentPath = await copyE2EShowcaseRepository(visualRoot, 'stella-visual-qa');
      const conflictPath = await copyE2EShowcaseRepository(visualRoot, 'stella-conflict');
      const manualPath = await copyE2EShowcaseRepository(visualRoot, 'stella-manual');
      extraRepositoryPaths.push(
        ...(await Promise.all(
          Array.from({ length: 9 }, (_, index) =>
            createEmptyRepository(`stella-visual-list-${index + 1}`),
          ),
        )),
      );
      await resetApp({
        language: 'en',
        appearance: 'dark',
        registeredRepoPaths: [manualPath, conflictPath, currentPath, ...extraRepositoryPaths],
      });
      await $('.registered-repositories').waitForDisplayed({ timeout: 10_000 });
      expect(
        await browser.execute(() => {
          const list = document.querySelector<HTMLElement>('.registered-repositories');
          return list ? list.scrollHeight > list.clientHeight : false;
        }),
      ).toBe(true);
      const tenthRowMetrics = await browser.execute(() => {
        const list = document.querySelector<HTMLElement>('.registered-repositories')!;
        const tenthRow = list.children.item(9)!;
        const listRect = list.getBoundingClientRect();
        return {
          contentBottom:
            listRect.bottom - Number.parseFloat(getComputedStyle(list).borderBottomWidth),
          rowBottom: tenthRow.getBoundingClientRect().bottom,
        };
      });
      expect(tenthRowMetrics.rowBottom).toBeLessThanOrEqual(tenthRowMetrics.contentBottom);
      await debugAt('repository-list');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repositories', 'list', 'populated-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repositories', 'list', 'populated-dark-860x560.png'),
        860,
        560,
      );

      await setLogicalWindowSize(1180, 760);
      await $('.registered-repositories .switcher-option').moveTo();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repositories', 'list', 'hover-dark-1180x760.png'),
        1180,
        760,
      );
      await $('.registered-repositories .switcher-action-trigger').click();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repositories', 'list', 'selected-dark-1180x760.png'),
        1180,
        760,
      );
    } finally {
      await Promise.all(extraRepositoryPaths.map(removeFixture));
      await removeFixture(visualRoot);
    }
  });
});
