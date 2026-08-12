import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import {
  expectInteractiveSelectedColors,
  openRepository,
  resetApp,
  selectSetting,
} from './support/app.js';
import { createEmptyRepository, removeFixture } from './support/fixtures.js';

describe('Repository and Branch navigation', () => {
  let repositoryPath = '';

  beforeEach(async () => {
    repositoryPath = await createEmptyRepository('repository');
    await resetApp({ language: 'ja' });
  });

  afterEach(async () => {
    await removeFixture(repositoryPath);
    repositoryPath = '';
  });

  it('adds and initializes a repository and exposes the current Branch actions', async () => {
    await openRepository(repositoryPath, { language: 'ja', inspectDialog: true });
    await expect($('.changes-view')).toBeDisplayed();
    await expect($('.repository-view-tabs')).not.toExist();
    expect(
      await $$('.titlebar-actions .titlebar-menu-button').map((button) => button.getText()),
    ).toEqual(['変更差分', '操作履歴', 'アクティビティ', '設定']);
    expect(
      await browser.tauri.execute(() =>
        [...document.querySelectorAll('.titlebar-context, .titlebar-actions')].every((element) =>
          element.hasAttribute('data-tauri-drag-region'),
        ),
      ),
    ).toBe(true);
    await expect($('button[aria-label="変更差分"]')).toHaveAttribute('aria-current', 'page');

    const repositoryToggle = $(`.repository-toggle[title="${repositoryPath}"]`);
    await expect(repositoryToggle).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText('main');
    expect(
      await browser.execute(() => {
        const toggle = document.querySelector<HTMLButtonElement>('.branch-toggle');
        const label = toggle?.querySelector<HTMLSpanElement>('span');
        if (!label) return false;
        const currentLabel = label.textContent;
        label.textContent = 'feature/keep-a-branch-name-this-long-visible';
        const fits = label.scrollWidth <= label.clientWidth;
        label.textContent = currentLabel;
        return fits;
      }),
    ).toBe(true);

    await repositoryToggle.click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toBeDisplayed();
    await expectInteractiveSelectedColors(
      '[role="dialog"] .switcher-option[aria-selected="true"]',
      {
        foreground: ['.switcher-check', '.switcher-option-icon'],
        mutedForeground: ['.switcher-option-copy small'],
      },
    );
    expect(await switcher.getText()).not.toMatch(/Open repositories|Recent|[⌘⇧]/u);
    await browser.keys(['Escape']);

    const branchToggle = $('.branch-toggle');
    await branchToggle.click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toHaveText(
      expect.stringContaining('main'),
    );
    await expect(switcher.$('button=ブランチを作成')).toBeDisplayed();
    await expect(switcher.$('button=ブランチを作成')).toBeDisabled();
    await expect(switcher.$('button=Git Flow')).not.toExist();
    await browser.keys(['Escape']);
    expect(
      await browser.execute(() => {
        const toggle = document.querySelector<HTMLElement>('.branch-toggle');
        if (!toggle) return undefined;
        const style = getComputedStyle(toggle);
        return {
          focused: document.activeElement === toggle,
          outlineWidth: style.outlineWidth,
          outlineOffset: style.outlineOffset,
        };
      }),
    ).toEqual({ focused: true, outlineWidth: '2px', outlineOffset: '-2px' });

    await $('button[aria-label="設定"]').click();
    await selectSetting('language', 'en');
    await expect($('h1=Settings')).toBeDisplayed();
    await $('button[aria-label="Changes"]').click();
    await $('.branch-toggle').click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher.$('button=Create branch')).toBeDisplayed();
    await expect(switcher.$('button=Git Flow')).not.toExist();
  });
});
