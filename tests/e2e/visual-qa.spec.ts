import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { join } from 'node:path';

import {
  dispatchDoubleClick,
  openRepository,
  openRepositoryFromSwitcher,
  resetApp,
  saveLogicalScreenshot,
  selectSetting,
  setLogicalWindowSize,
} from './support/app.js';
import {
  createFixtureDirectory,
  removeFixture,
  runGit,
  writeRepositoryFile,
} from './support/fixtures.js';
import { copyE2EShowcaseRepository } from './support/showcaseRepository.js';

const visualQaDirectory = process.env.VISUAL_QA_OUTPUT_DIR;

describe('Visual QA', () => {
  it('captures repository and branch switcher visual QA states when requested', async function () {
    this.timeout(180_000);
    if (!visualQaDirectory) return;

    const visualRoot = await createFixtureDirectory('visual');
    try {
      const currentPath = await copyE2EShowcaseRepository(visualRoot, 'stella-visual-qa');
      const conflictPath = await copyE2EShowcaseRepository(visualRoot, 'stella-conflict');
      const manualPath = await copyE2EShowcaseRepository(visualRoot, 'stella-manual');
      await writeRepositoryFile(currentPath, 'README.md', '# Stella Visual QA\n');
      await writeRepositoryFile(conflictPath, 'README.md', '# Stella Conflict\n');
      await runGit(currentPath, ['branch', 'feature/search']);
      await runGit(currentPath, ['branch', 'release']);

      await resetApp({ language: 'en', appearance: 'light' });
      await openRepository(currentPath, { language: 'en' });
      await openRepositoryFromSwitcher(conflictPath, 'en');
      await openRepositoryFromSwitcher(manualPath, 'en');

      let repositoryToggle = $('.repository-toggle');
      await repositoryToggle.click();
      let switcher = $('[role="dialog"]');
      const repositoryOptions = switcher.$$('[role="option"]');
      const repositoryOptionTexts = await repositoryOptions.map((option) => option.getText());
      const currentOption =
        repositoryOptions[repositoryOptionTexts.findIndex((text) => text.includes(currentPath))];
      if (!currentOption) throw new Error('The visual QA repository was not in the switcher.');
      await dispatchDoubleClick('[data-switcher-item-label="stella-visual-qa"]');
      repositoryToggle = $(`.repository-toggle[title="${currentPath}"]`);
      await repositoryToggle.waitForDisplayed({ timeout: 10_000 });
      await expect($('.changes-view')).toBeDisplayed();

      await setLogicalWindowSize(1180, 760);
      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await expect($('.settings-view')).toBeDisplayed();
      await expect($('select[name="diff-layout"]')).toHaveValue('unified');
      await $('button=Changes').click();
      await expect($('.changes-view')).toBeDisplayed();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'segmented-changes-unified-1180x760.png'),
        1180,
        760,
      );
      await settings.click();
      await expect($('.settings-view')).toBeDisplayed();
      await selectSetting('diff-layout', 'split');
      await expect($('select[name="diff-layout"]')).toHaveValue('split');
      await $('button=Changes').click();
      await expect($('.changes-view')).toBeDisplayed();
      await browser.execute(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'segmented-changes-split-1180x760.png'),
        1180,
        760,
      );

      await $('button=History').click();
      await expect($('.history-view')).toBeDisplayed();
      await expect($('button=History')).toHaveAttribute('aria-current', 'page');
      await browser.execute(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'segmented-history-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'segmented-history-860x560.png'),
        860,
        560,
      );
      await setLogicalWindowSize(1180, 760);
      await $('button=Changes').click();
      await expect($('.changes-view')).toBeDisplayed();

      await repositoryToggle.click();
      switcher = $('[role="dialog"]');
      await expect(switcher.$('.switcher-list')).toBeDisplayed();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repository-switcher-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repository-switcher-860x560.png'),
        860,
        560,
      );
      await setLogicalWindowSize(1180, 760);
      await browser.keys(['Escape']);

      await $('.branch-toggle').click();
      await expect($('[role="dialog"] .switcher-list')).toHaveText(
        expect.stringContaining('feature/search'),
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'branch-switcher-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(join(visualQaDirectory, 'branch-switcher-860x560.png'), 860, 560);
      await setLogicalWindowSize(1180, 760);
      await browser.keys(['Escape']);

      await settings.click();
      await selectSetting('language', 'en');
      await selectSetting('appearance', 'light');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings-en-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings-en-light-860x560.png'),
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
        join(visualQaDirectory, 'settings-ja-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings-ja-light-860x560.png'),
        860,
        560,
      );
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await setLogicalWindowSize(1180, 760);
      await $('button[aria-label="変更"]').click();
      await saveLogicalScreenshot(join(visualQaDirectory, 'changes-ja-1180x760.png'), 1180, 760);
      await saveLogicalScreenshot(join(visualQaDirectory, 'changes-ja-860x560.png'), 860, 560);
      await settings.click();
      await selectSetting('language', 'en');
      await selectSetting('appearance', 'dark');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings-en-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'settings-en-dark-860x560.png'),
        860,
        560,
      );
      const activity = $('button[aria-label="Activity"]');
      await activity.click();
      await expect($('.activity-view')).toBeDisplayed();
      expect(await $('select[aria-label="Activity range"]').getValue()).toBe('30d');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity-en-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity-en-dark-860x560.png'),
        860,
        560,
      );
      await settings.click();
      await selectSetting('appearance', 'light');
      await activity.click();
      await expect($('.activity-view')).toBeDisplayed();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity-en-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'activity-en-light-860x560.png'),
        860,
        560,
      );
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await setLogicalWindowSize(1180, 760);
      await $('button[aria-label="Changes"]').click();

      await browser.tauri.execute(() => {
        const preferences = JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}');
        localStorage.setItem(
          'stella.preferences.v1',
          JSON.stringify({
            ...preferences,
            appearance: 'light',
            language: 'en',
            registeredRepoPaths: [],
            openRepoPaths: [],
            selectedRepoPath: undefined,
          }),
        );
      });
      await browser.refresh();
      await $('.repository-landing').waitForDisplayed({ timeout: 10_000 });
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repository-list-empty-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repository-list-empty-light-860x560.png'),
        860,
        560,
      );
      await $('button=Add Repository').click();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'add-repository-sheet-light-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'add-repository-sheet-light-860x560.png'),
        860,
        560,
      );
      await $('[role="dialog"]').$('button=Cancel').click();

      await browser.execute(
        (registeredRepoPaths) => {
          const preferences = JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}');
          localStorage.setItem(
            'stella.preferences.v1',
            JSON.stringify({
              ...preferences,
              appearance: 'dark',
              registeredRepoPaths,
              openRepoPaths: [],
              selectedRepoPath: undefined,
            }),
          );
        },
        [manualPath, conflictPath, currentPath],
      );
      await browser.refresh();
      await $('.registered-repositories').waitForDisplayed({ timeout: 10_000 });
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repository-list-populated-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'repository-list-populated-dark-860x560.png'),
        860,
        560,
      );
      await $('button=Add Repository').click();
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'add-repository-sheet-dark-1180x760.png'),
        1180,
        760,
      );
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'add-repository-sheet-dark-860x560.png'),
        860,
        560,
      );
    } finally {
      await removeFixture(visualRoot);
    }
  });
});
