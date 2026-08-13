import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { rename } from 'node:fs/promises';

import {
  dispatchDoubleClick,
  expectInteractiveSelectedColors,
  openRepository,
  resetApp,
  selectSetting,
} from './support/app.js';
import {
  configureRepository,
  createEmptyRepository,
  removeFixture,
  runGit,
  writeRepositoryFile,
} from './support/fixtures.js';

describe('Repository and Branch navigation', () => {
  let repositoryPath = '';
  let relocatedPath = '';
  let remotePath = '';

  beforeEach(async () => {
    repositoryPath = await createEmptyRepository('repository');
    remotePath = await createEmptyRepository('repository-remote');
    await resetApp({ language: 'ja' });
  });

  afterEach(async () => {
    await removeFixture(repositoryPath);
    await removeFixture(relocatedPath);
    await removeFixture(remotePath);
    repositoryPath = '';
    relocatedPath = '';
    remotePath = '';
  });

  it('adds and initializes a repository and exposes the current Branch actions', async () => {
    await openRepository(repositoryPath, { language: 'ja', inspectDialog: true });
    await expect($('.changes-view')).toBeDisplayed();
    await expect($('.repository-view-tabs')).not.toExist();
    expect(
      await $$('.titlebar-actions .titlebar-menu-button').map((button) => button.getText()),
    ).toEqual(['変更', '履歴', '活動', '設定']);
    expect(
      await browser.tauri.execute(() =>
        [...document.querySelectorAll('.titlebar-context, .titlebar-actions')].every((element) =>
          element.hasAttribute('data-tauri-drag-region'),
        ),
      ),
    ).toBe(true);
    await expect($('button[aria-label="変更"]')).toHaveAttribute('aria-current', 'page');

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
    await expect(switcher.$('input[placeholder="リポジトリを検索"]')).toBeDisplayed();
    expect(
      await browser.execute(() => {
        const list = document.querySelector<HTMLElement>('.switcher-list')!;
        const option = document.querySelector<HTMLElement>('[role="option"][aria-current="true"]')!;
        const row = option.closest<HTMLElement>('.switcher-option-row')!;
        return {
          active: document.activeElement === option,
          listPadding: getComputedStyle(list).padding,
          optionBackground: getComputedStyle(option).backgroundColor,
          optionOutline: getComputedStyle(option).outlineStyle,
          rowRadius: getComputedStyle(row).borderRadius,
          rowFocus: getComputedStyle(row).boxShadow !== 'none',
        };
      }),
    ).toEqual({
      active: true,
      listPadding: '0px',
      optionBackground: 'rgba(0, 0, 0, 0)',
      optionOutline: 'none',
      rowRadius: '0px',
      rowFocus: true,
    });
    await expect(
      switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger'),
    ).toBeDisplayed();
    await expectInteractiveSelectedColors('[role="dialog"] .switcher-option-row.is-selected', {
      foreground: ['.switcher-check', '.switcher-option-icon'],
      mutedForeground: ['.switcher-option-copy small'],
    });
    expect(await switcher.getText()).not.toMatch(/Open repositories|Recent|[⌘⇧]/u);
    await expect(switcher.$('button=リポジトリを追加')).toBeDisplayed();
    await switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger').click();
    await $('button=リポジトリを削除').click();
    const deleteConfirmation = $('[role="alertdialog"][aria-labelledby="forget-repository-title"]');
    await expect(deleteConfirmation.$('button=登録だけ解除')).toBeDisplayed();
    await expect(deleteConfirmation.$('button=リポジトリを削除')).toBeDisplayed();
    await deleteConfirmation.$('button=キャンセル').click();

    const branchToggle = $('.branch-toggle');
    await branchToggle.click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toHaveText(
      expect.stringContaining('main'),
    );
    await expect(switcher.$('input[placeholder="ブランチを検索"]')).toBeDisplayed();
    expect(
      await browser.execute(
        () => document.activeElement?.matches('[role="option"][aria-current="true"]') ?? false,
      ),
    ).toBe(true);
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

  it('keeps uncommitted changes when switching and creating compatible branches', async () => {
    await configureRepository(repositoryPath);
    await writeRepositoryFile(repositoryPath, 'tracked.txt', 'base\n');
    await runGit(repositoryPath, ['add', '--', 'tracked.txt']);
    await runGit(repositoryPath, ['commit', '-m', 'feat: 追跡対象ファイルを追加']);
    await runGit(repositoryPath, ['branch', 'target']);
    await writeRepositoryFile(repositoryPath, 'tracked.txt', 'staged\n');
    await runGit(repositoryPath, ['add', '--', 'tracked.txt']);
    await writeRepositoryFile(repositoryPath, 'tracked.txt', 'unstaged\n');
    await writeRepositoryFile(repositoryPath, 'untracked.txt', 'untracked\n');
    const expectedStatus = (await runGit(repositoryPath, ['status', '--short'])).trim();

    await openRepository(repositoryPath, { language: 'ja' });
    await $('.branch-toggle').click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    const targetOption = switcher.$('[data-switcher-item-label="target"]');
    await expect(targetOption).toBeEnabled();
    await expect(switcher.$('button=ブランチを作成')).toBeEnabled();
    await targetOption.click();
    await expect(switcher).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('main'));
    await dispatchDoubleClick('[data-switcher-item-label="target"]');
    await switcher.waitForDisplayed({ reverse: true });
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('target'));
    expect((await runGit(repositoryPath, ['status', '--short'])).trim()).toBe(expectedStatus);

    await $('.branch-toggle').click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await switcher.waitForDisplayed();
    const createBranchButton = switcher.$('button=ブランチを作成');
    await expect(createBranchButton).toBeEnabled();
    await createBranchButton.click();
    const branchDialog = $('[role="dialog"][aria-labelledby="create-branch-title"]');
    await branchDialog.waitForDisplayed();
    await branchDialog.$('input[aria-label="ブランチ名"]').setValue('created-with-changes');
    await branchDialog.$('button=影響を確認').click();
    const confirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
    await expect(confirmation).toBeDisplayed();
    await confirmation.$('button=実行').click();
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('created-with-changes'));
    expect((await runGit(repositoryPath, ['status', '--short'])).trim()).toBe(expectedStatus);
  });

  it('reconnects a repository after its local directory is moved', async () => {
    const oldPath = repositoryPath;
    relocatedPath = `${repositoryPath}-moved`;
    await openRepository(oldPath, { language: 'ja' });
    await browser.execute((path) => {
      Reflect.set(window, 'stellaE2eDirectoryPickerResult', path);
    }, relocatedPath);

    await rename(oldPath, relocatedPath);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));

    const chooseLocation = $('button=場所を選び直す');
    await chooseLocation.waitForDisplayed({ timeout: 10_000 });
    await chooseLocation.click();
    const confirmation = $('[role="alertdialog"][aria-labelledby="repository-relocation-title"]');
    await confirmation.waitForDisplayed({ timeout: 10_000 });
    await expect(confirmation).toHaveText(expect.stringContaining(oldPath));
    await expect(confirmation).toHaveText(expect.stringContaining(relocatedPath));
    await confirmation.$('button=場所を付け替える').click();

    await $(`.repository-toggle[title="${relocatedPath}"]`).waitForDisplayed({ timeout: 10_000 });
    await expect($('.changes-view')).toBeDisplayed();
    expect((await runGit(relocatedPath, ['status', '--short'])).trim()).toBe('');
    expect(
      await browser.execute((expectedPath) => {
        const stored = localStorage.getItem('stella.preferences.v1');
        if (!stored) return false;
        const preferences: unknown = JSON.parse(stored);
        if (!preferences || typeof preferences !== 'object') return false;
        const registered: unknown = Object.getOwnPropertyDescriptor(
          preferences,
          'registeredRepoPaths',
        )?.value;
        const open: unknown = Object.getOwnPropertyDescriptor(preferences, 'openRepoPaths')?.value;
        const selected: unknown = Object.getOwnPropertyDescriptor(
          preferences,
          'selectedRepoPath',
        )?.value;
        return (
          Array.isArray(registered) &&
          registered.length === 1 &&
          registered[0] === expectedPath &&
          Array.isArray(open) &&
          open.length === 1 &&
          open[0] === expectedPath &&
          selected === expectedPath
        );
      }, relocatedPath),
    ).toBe(true);
  });

  it('repairs a failed Fetch by changing its URL and fetching the selected remote', async () => {
    const missingRemote = `${remotePath}-moved`;
    await runGit(repositoryPath, ['remote', 'add', 'origin', missingRemote]);
    await openRepository(repositoryPath, { language: 'ja' });

    await $('.changes-action-bar .changes-action-button[aria-label="フェッチ"]').click();
    const error = $('[role="alertdialog"][aria-labelledby="runtime-error-title"]');
    await expect(error).toHaveText(expect.stringContaining('リモートリポジトリを利用できません'));
    await error.$('button=閉じる').click();

    await $('.repository-toggle').click();
    const switcher = $('[role="dialog"]');
    await expect(switcher).toHaveText(expect.stringContaining('リモートを確認'));
    await switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger').click();
    await $('button=リモートURLを変更').click();
    const manager = $('[role="dialog"][aria-labelledby="remote-manager-title"]');
    const firstUrlInput = manager.$$('input')[0];
    if (!firstUrlInput) throw new Error('The remote URL input was not displayed.');
    await expect(firstUrlInput).toHaveValue(missingRemote);
    await firstUrlInput.setValue(remotePath);
    await manager.$('button=保存').click();
    await expect($('[role="alertdialog"][aria-labelledby="action-preview-title"]')).not.toExist();
    await browser.waitUntil(
      async () =>
        (await runGit(repositoryPath, ['remote', 'get-url', 'origin'])).trim() === remotePath,
      {
        timeout: 10_000,
        timeoutMsg: 'The updated remote URL was not retained.',
      },
    );
    await expect(manager).not.toExist();
  });
});
