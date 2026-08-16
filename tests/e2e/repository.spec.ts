import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { spawn } from 'node:child_process';
import { rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';

import {
  dispatchDoubleClick,
  expectInteractiveSelectedColors,
  openRepository,
  resetApp,
  selectSetting,
} from './support/app.js';
import {
  configureRepository,
  createFixtureDirectory,
  createEmptyRepository,
  removeFixture,
  runGit,
  writeRepositoryFile,
} from './support/fixtures.js';

describe('Repository and Branch navigation', () => {
  let repositoryPath = '';
  let relocatedPath = '';
  let remotePath = '';
  let cloneParentPath = '';

  beforeEach(async () => {
    repositoryPath = await createEmptyRepository('repository');
    remotePath = await createEmptyRepository('repository-remote');
    await resetApp({ language: 'ja' });
  });

  afterEach(async () => {
    await removeFixture(repositoryPath);
    await removeFixture(relocatedPath);
    await removeFixture(remotePath);
    await removeFixture(cloneParentPath);
    repositoryPath = '';
    relocatedPath = '';
    remotePath = '';
    cloneParentPath = '';
  });

  it('separates local Add from URL Clone and aligns the Clone fields', async () => {
    await $('button=クローン').click();
    const dialog = $('[role="dialog"][aria-labelledby="clone-repository-title"]');
    await expect(dialog).toBeDisplayed();
    await expect(dialog.$('#repository-url')).toBeDisplayed();
    await expect(dialog.$('#repository-clone-parent')).toBeDisplayed();
    await expect(dialog.$('.directory-picker-button')).toExist();
    await expect(dialog.$('[role="tab"]')).not.toExist();
    expect(await dialog.$('#repository-clone-parent').getValue()).toMatch(/\/Documents\/?$/u);
    expect(
      await browser.execute(() => {
        const form = document.querySelector<HTMLElement>('.add-repository-form')!;
        const url = document.querySelector<HTMLElement>('#repository-url')!;
        const path = document.querySelector<HTMLElement>(
          '#repository-clone-parent',
        )!.parentElement!;
        const name = document.querySelector<HTMLElement>('#repository-display-name')!;
        const formRect = form.getBoundingClientRect();
        const formStyle = getComputedStyle(form);
        const metrics = [url, path, name].map((input) => {
          const rect = input.getBoundingClientRect();
          return [rect.left - formRect.left, formRect.right - rect.right, rect.width];
        });
        return {
          aligned: metrics.every(
            (metric) =>
              metric[0] === metrics[0]?.[0] &&
              metric[1] === metrics[0]?.[1] &&
              metric[2] === metrics[0]?.[2],
          ),
          fillsContent: metrics.every(
            (metric) =>
              metric[0] === Number.parseFloat(formStyle.paddingLeft) &&
              metric[1] === Number.parseFloat(formStyle.paddingRight),
          ),
        };
      }),
    ).toEqual({ aligned: true, fillsContent: true });
  });

  it('clones a URL repository into the selected local path through the native adapter', async () => {
    await configureRepository(remotePath);
    await writeRepositoryFile(remotePath, 'README.md', '# Clone target\n');
    await runGit(remotePath, ['add', '--', 'README.md']);
    await runGit(remotePath, ['commit', '-m', 'docs: クローン対象を追加']);
    cloneParentPath = await createFixtureDirectory('clone-parent');

    const portProbe = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', () => {
        const address = portProbe.address();
        if (typeof address === 'object' && address) resolve(address.port);
        else reject(new Error('Could not reserve a local Git daemon port.'));
      });
    });
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );

    const repositoriesRoot = dirname(remotePath);
    const daemon = spawn(
      '/usr/bin/git',
      [
        'daemon',
        '--reuseaddr',
        '--export-all',
        `--base-path=${repositoriesRoot}`,
        '--listen=127.0.0.1',
        `--port=${port}`,
        repositoriesRoot,
      ],
      { stdio: 'ignore' },
    );
    const remoteUrl = `git://127.0.0.1:${port}/${basename(remotePath)}`;
    const clonedPath = join(cloneParentPath, basename(remotePath));

    try {
      await browser.waitUntil(
        () =>
          runGit(remotePath, ['ls-remote', remoteUrl]).then(
            () => true,
            () => false,
          ),
        { timeoutMsg: 'The local Git daemon did not become ready.' },
      );

      await $('button=クローン').click();
      const dialog = $('[role="dialog"][aria-labelledby="clone-repository-title"]');
      await dialog.$('#repository-url').setValue(remoteUrl);
      await dialog.$('#repository-clone-parent').setValue(cloneParentPath);
      await dialog.$('button=クローン').click();

      await $(`.repository-toggle[data-repository-path="${clonedPath}"]`).waitForDisplayed({
        timeout: 20_000,
      });
      expect((await runGit(clonedPath, ['branch', '--show-current'])).trim()).toBe('main');
      expect((await runGit(clonedPath, ['show', 'HEAD:README.md'])).trim()).toBe('# Clone target');
      expect((await runGit(clonedPath, ['remote', 'get-url', 'origin'])).trim()).toBe(remoteUrl);
    } finally {
      await new Promise<void>((resolve) => {
        if (daemon.exitCode !== null) return resolve();
        daemon.once('exit', () => resolve());
        daemon.kill();
      });
    }
  });

  it('adds and initializes a repository and exposes the current Branch actions', async () => {
    await openRepository(repositoryPath, { language: 'ja', inspectDialog: true });
    await expect($('.diff-view')).toBeDisplayed();
    await expect($('.diff-list-footer .diff-action-bar')).toBeDisplayed();
    await expect($('.repository-view-tabs')).not.toExist();
    const footerActions = $$('.diff-list-footer .diff-action-button');
    const actionLabels = ['コミット', 'プル', 'プッシュ', 'フェッチ'];
    expect(await footerActions.map((button) => button.getAttribute('aria-label'))).toEqual(
      actionLabels,
    );
    expect(await footerActions.map((button) => button.getText())).toEqual(['', '', '', '']);
    expect(await footerActions.map((button) => button.getAttribute('title'))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(
      await $$('.titlebar-actions .titlebar-menu-button').map((button) => button.getText()),
    ).toEqual(['差分', '履歴', '活動', '設定']);
    expect(
      await browser.tauri.execute(() =>
        document.querySelector('.app-header')?.getAttribute('data-tauri-drag-region'),
      ),
    ).toBe('deep');
    expect(
      await browser.execute(() => {
        const header = document.querySelector<HTMLElement>('.app-header')!;
        const headerContent = header.querySelector<HTMLElement>('.window-header-content')!;
        const sidebar = document.querySelector<HTMLElement>('.diff-sidebar-pane')!;
        const footer = sidebar.querySelector<HTMLElement>('.diff-list-footer')!;
        const sidebarToggle = header.querySelector<HTMLElement>('.sidebar-toggle-button')!;
        const actionBar = footer.querySelector<HTMLElement>('.diff-action-bar')!;
        const actionButton = actionBar.querySelector<HTMLElement>('.diff-action-button')!;
        const actionButtons = [...actionBar.querySelectorAll<HTMLElement>('.diff-action-button')];
        const menuButton = header.querySelector<HTMLElement>('.titlebar-menu-button')!;
        const repositoryToggle = header.querySelector<HTMLElement>('.repository-toggle')!;
        const paneResizer = document.querySelector<HTMLElement>('.pane-resizer')!;
        const content = document.querySelector<HTMLElement>('.diff-content-pane')!;
        const headerRect = header.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const sidebarToggleRect = sidebarToggle.getBoundingClientRect();
        const actionBarRect = actionBar.getBoundingClientRect();
        const actionButtonRect = actionButton.getBoundingClientRect();
        const menuButtonRect = menuButton.getBoundingClientRect();
        const menuButtonStyle = getComputedStyle(menuButton);
        return {
          unifiedHeader:
            headerContent.getBoundingClientRect().width === headerRect.width &&
            !header.querySelector('.app-header-divider'),
          actionsInFooter:
            actionBarRect.top >= footerRect.top &&
            actionBarRect.bottom <= footerRect.bottom &&
            actionBar.parentElement === footer,
          repositoryLeft: repositoryToggle.getBoundingClientRect().left,
          repositoryBeforePaneSplit:
            repositoryToggle.getBoundingClientRect().left < sidebar.getBoundingClientRect().right,
          sidebarToggleBorder: getComputedStyle(sidebarToggle).borderTopWidth,
          sidebarToggleBottom: headerRect.bottom - sidebarToggleRect.bottom,
          sidebarToggleLeft: sidebarToggleRect.left,
          sidebarToggleHeight: sidebarToggleRect.height,
          sidebarToggleWidth: sidebarToggleRect.width,
          footerHeight: footerRect.height,
          footerRight: footerRect.right,
          footerAtSidebarBottom: footerRect.bottom === sidebar.getBoundingClientRect().bottom,
          actionBarRightGap: footerRect.right - actionBarRect.right,
          actionButtonIconWidth: actionButton.querySelector('svg')!.getBoundingClientRect().width,
          actionButtonSize: [actionButtonRect.width, actionButtonRect.height],
          actionButtonHorizontalGaps: actionButtons
            .slice(1)
            .map(
              (button, index) =>
                button.getBoundingClientRect().left -
                actionButtons[index]!.getBoundingClientRect().right,
            ),
          actionLabels: actionButtons.filter((button) => button.querySelector('span')).length,
          menuButtonVertical: [
            menuButtonRect.height,
            menuButtonRect.top - headerRect.top,
            headerRect.bottom - menuButtonRect.bottom,
          ],
          headerBottom: headerRect.bottom,
          sidebarRight: sidebar.getBoundingClientRect().right,
          menuButtonFontSize: menuButtonStyle.fontSize,
          menuButtonGap: menuButtonStyle.gap,
          menuButtonHeight: menuButton.getBoundingClientRect().height,
          menuButtonIconWidth: menuButton.querySelector('svg')!.getBoundingClientRect().width,
          menuButtonMinWidth: menuButtonStyle.minWidth,
          menuButtonPaddingLeft: menuButtonStyle.paddingLeft,
          menuButtonPaddingTop: menuButtonStyle.paddingTop,
          paneResizerWidth: paneResizer.getBoundingClientRect().width,
          paneSeparatorWidth: getComputedStyle(paneResizer, '::before').width,
          paneSeparatorDiffersFromContent:
            getComputedStyle(paneResizer, '::before').backgroundColor !==
            getComputedStyle(content).backgroundColor,
          contentLeft: content.getBoundingClientRect().left,
        };
      }),
    ).toEqual({
      unifiedHeader: true,
      actionsInFooter: true,
      repositoryLeft: 76,
      repositoryBeforePaneSplit: true,
      sidebarToggleBorder: '0px',
      sidebarToggleBottom: 11,
      sidebarToggleLeft: 3,
      sidebarToggleHeight: 24,
      sidebarToggleWidth: 24,
      footerHeight: 38,
      footerRight: 360,
      footerAtSidebarBottom: true,
      actionBarRightGap: 6,
      actionButtonIconWidth: 16,
      actionButtonSize: [28, 28],
      actionButtonHorizontalGaps: [2, 2, 2],
      actionLabels: 0,
      headerBottom: 64,
      sidebarRight: 360,
      menuButtonFontSize: '11px',
      menuButtonGap: '4px',
      menuButtonHeight: 52,
      menuButtonIconWidth: 18,
      menuButtonMinWidth: '48px',
      menuButtonPaddingLeft: '10px',
      menuButtonPaddingTop: '6px',
      menuButtonVertical: [52, 5.5, 6.5],
      paneResizerWidth: 5,
      paneSeparatorWidth: '1px',
      paneSeparatorDiffersFromContent: true,
      contentLeft: 361,
    });
    await $('button[aria-label="サイドバーを閉じる"]').click();
    await expect($('.diff-sidebar-pane')).not.toBeDisplayed();
    await expect($('.window-header-content')).toBeDisplayed();
    await expect($('button[aria-label="サイドバーを開く"]')).not.toHaveAttribute('title');
    await $('button[aria-label="サイドバーを開く"]').click();
    await expect($('.diff-sidebar-pane')).toBeDisplayed();
    await expect($('button[aria-label="差分"]')).toHaveAttribute('aria-current', 'page');

    const repositoryToggle = $(`.repository-toggle[data-repository-path="${repositoryPath}"]`);
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
    await expect(
      switcher.$('[role="option"][aria-current="true"] .switcher-option-copy small'),
    ).toHaveText(repositoryPath);
    await expect(switcher.$('input[placeholder="リポジトリを検索"]')).toBeDisplayed();
    expect(
      await browser.execute(() => {
        const list = document.querySelector<HTMLElement>('.switcher-list')!;
        const option = document.querySelector<HTMLElement>('[role="option"][aria-current="true"]')!;
        const row = option.closest<HTMLElement>('.switcher-option-row')!;
        return {
          active: document.activeElement === option,
          listHeight: list.getBoundingClientRect().height,
          listPadding: getComputedStyle(list).padding,
          optionBackground: getComputedStyle(option).backgroundColor,
          optionOutline: getComputedStyle(option).outlineStyle,
          rowRadius: getComputedStyle(row).borderRadius,
          rowFocus: getComputedStyle(row).boxShadow !== 'none',
        };
      }),
    ).toEqual({
      active: true,
      listHeight: 280,
      listPadding: '0px',
      optionBackground: 'rgba(0, 0, 0, 0)',
      optionOutline: 'none',
      rowRadius: '0px',
      rowFocus: true,
    });
    await expect(
      switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger'),
    ).toBeDisplayed();
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.switcher-action-trigger')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    await expect($('.app-tooltip')).toHaveText('その他の操作');
    await expectInteractiveSelectedColors('[role="dialog"] .switcher-option-row.is-selected', {
      foreground: ['.switcher-check', '.switcher-option-icon'],
      mutedForeground: ['.switcher-option-copy small'],
      palette: 'neutral',
    });
    expect(await switcher.getText()).not.toMatch(/Open repositories|Recent|[⌘⇧]/u);
    await expect(switcher.$('button=追加')).toBeDisplayed();
    await expect(switcher.$('button=クローン')).not.toHaveElementClass('primary');
    await switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger').click();
    await $('button=削除').click();
    const deleteConfirmation = $('[role="alertdialog"][aria-labelledby="forget-repository-title"]');
    await expect(deleteConfirmation.$('button=登録だけ解除')).toBeDisplayed();
    await expect(deleteConfirmation.$('button=ゴミ箱に移動')).toBeDisplayed();
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
    await expect(switcher.$('button=作成')).not.toHaveElementClass('primary');
    await expect(switcher.$('button=作成')).toBeDisabled();
    await expect(switcher.$('button=Git Flow')).not.toExist();
    await browser.keys(['Escape']);
    expect(
      await browser.execute(() => {
        const toggle = document.querySelector<HTMLElement>('.branch-toggle');
        if (!toggle) return undefined;
        const style = getComputedStyle(toggle);
        return {
          focused: document.activeElement === toggle,
          customFocused: toggle.classList.contains('is-focused'),
          outlineStyle: style.outlineStyle,
        };
      }),
    ).toEqual({ focused: true, customFocused: false, outlineStyle: 'none' });

    await $('button[aria-label="設定"]').click();
    await selectSetting('language', 'en');
    await expect($('h1=Settings')).toBeDisplayed();
    await expect($('.repository-toggle')).not.toExist();
    await expect($('.branch-toggle')).not.toExist();
    await $('button[aria-label="Diff"]').click();
    await $('.branch-toggle').click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher.$('button=Create')).toBeDisplayed();
    await expect(switcher.$('button=Git Flow')).not.toExist();
  });

  it('removes only the repository registration without deleting the local repository', async () => {
    await openRepository(repositoryPath, { language: 'ja' });
    await $('.repository-toggle').click();
    const switcher = $('[role="dialog"][aria-labelledby]');
    await switcher.$('[role="option"][aria-current="true"] + .switcher-action-trigger').click();
    await $('button=削除').click();
    const confirmation = $('[role="alertdialog"][aria-labelledby="forget-repository-title"]');
    await confirmation.$('button=登録だけ解除').click();

    await expect($('button=追加')).toBeDisplayed();
    expect((await runGit(repositoryPath, ['status', '--short'])).trim()).toBe('');
    expect(
      await browser.execute(() => {
        const stored = localStorage.getItem('stella.preferences.v1');
        if (!stored) return undefined;
        const preferences: unknown = JSON.parse(stored);
        if (!preferences || typeof preferences !== 'object') return undefined;
        return Object.getOwnPropertyDescriptor(preferences, 'registeredRepoPaths')?.value;
      }),
    ).toEqual([]);
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
    await $('.repository-toggle').click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    await switcher.waitForDisplayed();
    expect(
      await browser.execute(() => {
        const toggle = document.querySelector<HTMLElement>('.repository-toggle')!;
        const option = document.querySelector<HTMLElement>('[role="option"][aria-current="true"]')!;
        const badge = option.querySelector<HTMLElement>('.switcher-count-badge')!;
        return {
          toggleHasWarning: Boolean(toggle.querySelector('.repository-status-dot.warning')),
          formHasWarning: Boolean(option.querySelector('.switcher-status-dot.warning')),
          count: badge.textContent,
          beforeEllipsis:
            option.lastElementChild === badge &&
            option.nextElementSibling?.classList.contains('switcher-action-trigger'),
        };
      }),
    ).toEqual({
      toggleHasWarning: false,
      formHasWarning: false,
      count: '2',
      beforeEllipsis: true,
    });
    await browser.keys('Escape');
    await switcher.waitForDisplayed({ reverse: true });
    await $('.branch-toggle').click();
    switcher = $('[role="dialog"][aria-labelledby]');
    const targetOption = switcher.$('[data-switcher-item-label="target"]');
    await expect(targetOption).toBeEnabled();
    await expect(switcher.$('button=作成')).toBeEnabled();
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
    const createBranchButton = switcher.$('button=作成');
    await expect(createBranchButton).toBeEnabled();
    await createBranchButton.click();
    const branchDialog = $('[role="dialog"][aria-labelledby="create-branch-title"]');
    await branchDialog.waitForDisplayed();
    await branchDialog.$('input[aria-label="ブランチ名"]').setValue('created-with-changes');
    await branchDialog.$('button=影響を確認').click();
    const confirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
    await expect(confirmation).toBeDisplayed();
    await confirmation.$('button=作成').click();
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('created-with-changes'));
    expect((await runGit(repositoryPath, ['status', '--short'])).trim()).toBe(expectedStatus);
  });

  it('confirms and deletes an unmerged local branch from the branch switcher', async () => {
    await configureRepository(repositoryPath);
    await writeRepositoryFile(repositoryPath, 'tracked.txt', 'base\n');
    await runGit(repositoryPath, ['add', '--', 'tracked.txt']);
    await runGit(repositoryPath, ['commit', '-m', 'feat: 追跡対象ファイルを追加']);
    await runGit(repositoryPath, ['switch', '-c', 'delete-me']);
    await writeRepositoryFile(repositoryPath, 'experiment.txt', 'trial\n');
    await runGit(repositoryPath, ['add', '--', 'experiment.txt']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 検証結果を追加']);
    await runGit(repositoryPath, ['switch', 'main']);

    await openRepository(repositoryPath, { language: 'ja' });
    await $('.branch-toggle').click();
    const switcher = $('[role="dialog"][aria-labelledby]');
    await switcher.waitForDisplayed();
    await switcher.$('[data-switcher-item-label="delete-me"] + .switcher-action-trigger').click();
    await $('button=削除').click();

    const confirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
    await expect(confirmation).toHaveText(expect.stringContaining('delete-me'));
    await expect(confirmation).toHaveText(expect.stringContaining('未マージのコミットがあります'));
    await confirmation.$('button=削除').click();
    await confirmation.waitForDisplayed({ reverse: true });

    await browser.waitUntil(
      async () => !(await runGit(repositoryPath, ['branch', '--list', 'delete-me'])).trim(),
      { timeoutMsg: 'The unmerged local branch was not deleted.' },
    );
    expect((await runGit(repositoryPath, ['branch', '--list', 'delete-me'])).trim()).toBe('');
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
    await confirmation.$('button=登録を変更').click();

    await $(`.repository-toggle[data-repository-path="${relocatedPath}"]`).waitForDisplayed({
      timeout: 10_000,
    });
    await expect($('.diff-view')).toBeDisplayed();
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

    await $('.diff-action-bar .diff-action-button[aria-label="フェッチ"]').click();
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
