import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SCREENSHOT_APPEARANCES,
  debugAt,
  dispatchDoubleClick,
  openRepository,
  openRepositoryFromSwitcher,
  resetApp,
  saveScreenshotSizes,
  selectSetting,
  setLogicalWindowSize,
  type ScreenshotAppearance,
} from './support/app.js';
import {
  createEmptyRepository,
  createFixtureDirectory,
  ensureLocalBareRemote,
  removeFixture,
  runGit,
  writeExecutableRepositoryFile,
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
  run: (repository: VisualRepository, appearance: ScreenshotAppearance) => Promise<void>,
  prepare?: (repository: VisualRepository) => Promise<void>,
): Promise<void> {
  if (!screenshotMode) return;
  const visualRoot = await createFixtureDirectory('visual');
  try {
    const currentPath = await copyE2EShowcaseRepository(visualRoot, 'stella-visual-qa');
    await writeRepositoryFile(currentPath, 'README.md', '# Stella Visual QA\n');
    await runGit(currentPath, ['branch', 'feature/search']);
    await runGit(currentPath, ['branch', 'release']);
    await prepare?.({ currentPath, visualRoot });
    for (const appearance of SCREENSHOT_APPEARANCES) {
      // 外観ごとに初期状態を復元して同じ操作を撮影するため直列に実行する。
      // oxlint-disable-next-line no-await-in-loop
      await resetApp({ language: 'en', appearance });
      // oxlint-disable-next-line no-await-in-loop
      await openRepository(currentPath, { language: 'en' });
      // oxlint-disable-next-line no-await-in-loop
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
      // oxlint-disable-next-line no-await-in-loop
      await setLogicalWindowSize(1180, 760);
      // oxlint-disable-next-line no-await-in-loop
      await run({ currentPath, visualRoot }, appearance);
    }
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
  breakpoint: string,
  appearance: ScreenshotAppearance,
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
  await saveScreenshotSizes(visualQaDirectory, appearance, join('diff', 'tooltips', 'tooltip.png'));
  expect(await readTooltipPlacement()).toEqual({ centerDelta: 0, gap: 8, side: 'top' });
  await browser.keys(['Escape']);
}

async function captureDialog(
  directory: string,
  breakpoint: string,
  appearance: ScreenshotAppearance,
): Promise<void> {
  await debugAt(breakpoint);
  await saveScreenshotSizes(visualQaDirectory, appearance, `${directory}.png`);
}

describe('視覚確認用スクリーンショット', () => {
  after(async () => {
    if (
      process.env.STELLA_TEST_MODE !== 'vrt' ||
      process.env.STELLA_TEST_SMOKE === 'true' ||
      process.env.STELLA_VRT_UPDATE === 'true'
    )
      return;
    expect(await listPngFiles(visualQaDirectory)).toEqual(
      await listPngFiles(join(visualQaDirectory, '..', 'baseline')),
    );
  });

  it('差分を視覚確認用に撮影する @smoke', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await expect($('.settings-view')).toBeDisplayed();
      await expect($('select[name="diff-layout"]')).toHaveValue('unified');
      await $('button=Diff').click();
      await expect($('.diff-view')).toBeDisplayed();
      await debugAt('diff-screenshot');
      await saveScreenshotSizes(
        visualQaDirectory,
        appearance,
        join('diff', 'segmented-unified.png'),
      );

      await settings.click();
      await selectSetting('diff-layout', 'split');
      await $('button=Diff').click();
      await blurActiveElement();
      await saveScreenshotSizes(visualQaDirectory, appearance, join('diff', 'segmented-split.png'));

      await setLogicalWindowSize(1180, 760);
      await settings.click();
      await selectSetting('language', 'ja');
      await $('button[aria-label="差分"]').click();
      await saveScreenshotSizes(visualQaDirectory, appearance, join('diff', 'ja.png'));
    });
  });

  it('履歴を視覚確認用に撮影する', async function () {
    await withVisualRepository(async ({ currentPath }, appearance) => {
      const mainOid = (await runGit(currentPath, ['rev-parse', 'main'])).trim();
      await $('button=History').click();
      await expect($('.history-view')).toBeDisplayed();
      const mainCommit = $(`[data-history-commit-oid="${mainOid}"]`);
      await mainCommit.waitForClickable({ timeout: 20_000 });
      await mainCommit.click();
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
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const images = [
              ...document.querySelectorAll<HTMLImageElement>(
                '.history-view .image-diff-preview img',
              ),
            ];
            return (
              images.filter((image) => image.alt.endsWith('assets/number-17.svg')).length === 1 &&
              images.filter((image) => image.alt.endsWith('assets/uniform.svg')).length === 2 &&
              images.every(
                (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
              )
            );
          }),
        { timeout: 10_000, timeoutMsg: 'History image previews did not load.' },
      );
      await blurActiveElement();
      await debugAt('history');
      await saveScreenshotSizes(visualQaDirectory, appearance, join('history', 'segmented.png'));
    });
  });

  it('リポジトリ切替ダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath, visualRoot }, appearance) => {
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
      await saveScreenshotSizes(
        visualQaDirectory,
        appearance,
        join('repositories', 'switcher.png'),
      );
    });
  });

  it('ブランチ切替ダイアログを撮影する', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      await $('.branch-toggle').click();
      await expect($('[role="dialog"] .switcher-list')).toHaveText(
        expect.stringContaining('feature/search'),
      );
      await debugAt('branch-switcher');
      await saveScreenshotSizes(visualQaDirectory, appearance, join('branches', 'switcher.png'));
    });
  });

  it('設定を視覚確認用に撮影する', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await debugAt('settings');
      await saveScreenshotSizes(visualQaDirectory, appearance, join('settings', 'en.png'));
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);

      await selectSetting('language', 'ja');
      await saveScreenshotSizes(visualQaDirectory, appearance, join('settings', 'ja.png'));
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    });
  });

  it('ツールチップを撮影する', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      await expect($('.diff-view')).toBeDisplayed();
      const expectedColors =
        appearance === 'light'
          ? { background: 'rgb(29, 30, 34)', foreground: 'rgb(255, 255, 255)' }
          : { background: 'rgb(248, 248, 250)', foreground: 'rgb(28, 28, 30)' };
      await captureTooltip(`tooltip-${appearance}`, appearance, expectedColors);
    });
  });

  it('活動を視覚確認用に撮影する', async function () {
    await withVisualRepository(async ({ currentPath }, appearance) => {
      // 基底フィクスチャの日付に時計を固定し、撮影時刻による画像差分を防ぐ。
      const screenshotNow = new Date(
        (await runGit(currentPath, ['log', '-1', '--format=%cI'])).trim(),
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
      await debugAt(`activity-${appearance}`);
      await saveScreenshotSizes(visualQaDirectory, appearance, join('activity', 'en.png'));
    });
  });

  it('空のリポジトリ一覧を撮影する', async function () {
    if (!screenshotMode) return;
    for (const appearance of SCREENSHOT_APPEARANCES) {
      // 外観ごとに初期状態を復元して同じ画面を撮影するため直列に実行する。
      // oxlint-disable-next-line no-await-in-loop
      await resetApp({ language: 'en', appearance });
      // oxlint-disable-next-line no-await-in-loop
      await expect($('.repository-landing')).toBeDisplayed();
      // oxlint-disable-next-line no-await-in-loop
      await debugAt(`repository-list-empty-${appearance}`);
      // oxlint-disable-next-line no-await-in-loop
      await saveScreenshotSizes(
        visualQaDirectory,
        appearance,
        join('repositories', 'landing', 'empty.png'),
      );
    }
  });

  it('リポジトリ追加ダイアログを撮影する', async function () {
    if (!screenshotMode) return;
    for (const appearance of SCREENSHOT_APPEARANCES) {
      // 外観ごとに初期状態を復元して同じダイアログを撮影するため直列に実行する。
      // oxlint-disable-next-line no-await-in-loop
      await resetApp({ language: 'en', appearance });
      // oxlint-disable-next-line no-await-in-loop
      await $('button=Add').click();
      // oxlint-disable-next-line no-await-in-loop
      await expect($('[role="dialog"][aria-labelledby="add-repository-title"]')).toBeDisplayed();
      // oxlint-disable-next-line no-await-in-loop
      await debugAt(`add-repository-dialog-${appearance}`);
      // oxlint-disable-next-line no-await-in-loop
      await saveScreenshotSizes(visualQaDirectory, appearance, join('repositories', 'add.png'));
    }
  });

  it('Commitダイアログを撮影する', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      const commit = $('.diff-action-bar .diff-action-button[aria-label="Commit"]');
      await commit.waitForClickable({ timeout: 10_000 });
      await commit.click();
      await expect($('[role="dialog"][aria-labelledby="commit-dialog-title"]')).toBeDisplayed();
      await captureDialog('diff/dialogs/commit', 'commit-dialog', appearance);
    });
  });

  it('コミット操作の進捗ダイアログを撮影する', async function () {
    await withVisualRepository(
      async (_repository, appearance) => {
        const commit = $('.diff-action-bar .diff-action-button[aria-label="Commit"]');
        await commit.waitForClickable({ timeout: 10_000 });
        await commit.click();
        const commitDialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
        await commitDialog.waitForDisplayed({ timeout: 10_000 });
        await commitDialog
          .$('[data-commit-field="description"]')
          .setValue('Capture operation progress');
        await commitDialog.$('.commit-form button[type="submit"]').click();

        const operationProgress = $('[role="dialog"]:has(.operation-progress-dialog)');
        try {
          await operationProgress.waitForDisplayed({ timeout: 10_000 });
          await expect(operationProgress.$('h2')).toHaveText('Commit');
          await expect(operationProgress).toHaveText(expect.stringContaining('stella-visual-qa'));
          await expect(operationProgress.$('progress[aria-label="Commit"]')).toExist();
          await expect(operationProgress.$('progress[aria-label="Commit"]')).not.toHaveAttribute(
            'value',
          );
          await expect(operationProgress.$('.operation-progress-track')).toBeDisplayed();
          const cancel = operationProgress.$('button=Cancel');
          await cancel.waitForClickable({ timeout: 10_000 });
          await expect(operationProgress.$('.operation-progress-summary')).toHaveText(
            'Operation in progress',
          );
          await captureDialog(
            'diff/dialogs/operation-progress',
            'operation-progress-dialog',
            appearance,
          );
        } finally {
          const cancel = operationProgress.$('button=Cancel');
          if (await cancel.isExisting()) {
            await cancel.click();
            await operationProgress.waitForExist({ reverse: true, timeout: 10_000 });
          }
        }
      },
      async ({ currentPath }) => {
        await writeExecutableRepositoryFile(
          currentPath,
          '.git/hooks/commit-msg',
          '#!/bin/sh\nsleep 300\n',
        );
        await runGit(currentPath, ['add', '--', 'README.md']);
      },
    );
  });

  it('Pullダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath, visualRoot }, appearance) => {
      await ensureLocalBareRemote(currentPath, join(visualRoot, 'visual-remote.git'));
      await browser.execute(() => window.dispatchEvent(new Event('focus')));
      await $('.diff-action-bar .diff-action-button[aria-label="Pull"]').click();
      const dialog = $('[role="dialog"][aria-labelledby="pull-dialog-title"]');
      await expect(dialog).toBeDisplayed();
      await expect(dialog.$('select')).toHaveValue('origin/main');
      await captureDialog('diff/dialogs/pull', 'pull-dialog', appearance);
    });
  });

  it('Pushダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath, visualRoot }, appearance) => {
      await ensureLocalBareRemote(currentPath, join(visualRoot, 'visual-remote.git'));
      await browser.execute(() => window.dispatchEvent(new Event('focus')));
      await $('.diff-action-bar .diff-action-button[aria-label="Push"]').click();
      const dialog = $('[role="dialog"][aria-labelledby="push-dialog-title"]');
      await expect(dialog).toBeDisplayed();
      await expect(dialog.$('select')).toHaveValue('origin');
      await captureDialog('diff/dialogs/push', 'push-dialog', appearance);
    });
  });

  it('Branch作成ダイアログを撮影する', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      await $('.branch-toggle').click();
      const switcher = $('[role="dialog"][aria-labelledby]');
      await switcher.$('[role="option"][aria-current="true"]').click();
      const create = switcher.$('button=Create');
      await create.waitForEnabled();
      await create.click();
      await expect($('[role="dialog"][aria-labelledby="create-branch-title"]')).toBeDisplayed();
      await captureDialog('branches/dialogs/create', 'create-branch-dialog', appearance);
    });
  });

  it('Tag作成ダイアログを撮影する', async function () {
    await withVisualRepository(async ({ currentPath }, appearance) => {
      const mainOid = (await runGit(currentPath, ['rev-parse', 'main'])).trim();
      await $('button=History').click();
      const mainCommit = $(`[data-history-commit-oid="${mainOid}"]`);
      await mainCommit.waitForClickable({ timeout: 20_000 });
      await mainCommit.click();
      const actions = $('.history-commit-item.is-current .history-action-trigger');
      await actions.waitForEnabled({ timeout: 20_000 });
      await actions.click();
      await $('[role="menu"]').$('button=Create Tag').click();
      await expect($('[role="dialog"][aria-labelledby="history-createTag-title"]')).toBeDisplayed();
      await captureDialog('history/dialogs/create-tag', 'history-tag-dialog', appearance);
    });
  });

  it('リポジトリ情報ダイアログを撮影する', async function () {
    await withVisualRepository(async (_repository, appearance) => {
      await $('.repository-toggle').click();
      const switcher = $('[role="dialog"]');
      await switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger').click();
      await $('button=Change Repository Information').click();
      await expect($('[role="dialog"][aria-labelledby="remote-manager-title"]')).toBeDisplayed();
      await captureDialog('repositories/dialogs/information', 'remote-manager-dialog', appearance);
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
      for (const appearance of SCREENSHOT_APPEARANCES) {
        // 外観ごとに初期状態を復元して同じ一覧状態を撮影するため直列に実行する。
        // oxlint-disable-next-line no-await-in-loop
        await resetApp({
          language: 'en',
          appearance,
          registeredRepoPaths: [manualPath, conflictPath, currentPath, ...extraRepositoryPaths],
        });
        // oxlint-disable-next-line no-await-in-loop
        await $('.registered-repositories').waitForDisplayed({ timeout: 10_000 });
        expect(
          // oxlint-disable-next-line no-await-in-loop
          await browser.execute(() => {
            const list = document.querySelector<HTMLElement>('.registered-repositories');
            return list ? list.scrollHeight > list.clientHeight : false;
          }),
        ).toBe(true);
        // oxlint-disable-next-line no-await-in-loop
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
        // oxlint-disable-next-line no-await-in-loop
        await debugAt(`repository-list-${appearance}`);
        // oxlint-disable-next-line no-await-in-loop
        await saveScreenshotSizes(
          visualQaDirectory,
          appearance,
          join('repositories', 'list', 'populated.png'),
        );

        // oxlint-disable-next-line no-await-in-loop
        await setLogicalWindowSize(1180, 760);
        // oxlint-disable-next-line no-await-in-loop
        await $('.registered-repositories .switcher-option').moveTo();
        // oxlint-disable-next-line no-await-in-loop
        await saveScreenshotSizes(
          visualQaDirectory,
          appearance,
          join('repositories', 'list', 'hover.png'),
        );
        // oxlint-disable-next-line no-await-in-loop
        await $('.registered-repositories .switcher-action-trigger').click();
        // oxlint-disable-next-line no-await-in-loop
        await saveScreenshotSizes(
          visualQaDirectory,
          appearance,
          join('repositories', 'list', 'selected.png'),
        );
      }
    } finally {
      await Promise.all(extraRepositoryPaths.map(removeFixture));
      await removeFixture(visualRoot);
    }
  });
});
