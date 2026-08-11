import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import {
  dispatchDoubleClick,
  expectHistoryCommitLayout,
  openRepository,
  resetApp,
  setLogicalWindowSize,
} from './support/app.js';
import {
  createCommittedRepository,
  createFixtureDirectory,
  removeFixture,
  runGit,
} from './support/fixtures.js';

describe('History', () => {
  let fixturePath = '';
  let repositoryPath = '';

  beforeEach(async () => {
    fixturePath = await createFixtureDirectory('history');
    repositoryPath = await createCommittedRepository(fixturePath, 'repository', {
      message: 'feat: E2Eリポジトリを初期化する',
    });
    await resetApp({ language: 'ja' });
    await openRepository(repositoryPath);
  });

  afterEach(async () => {
    await removeFixture(fixturePath);
    fixturePath = '';
    repositoryPath = '';
  });

  it('searches history and creates Tags and Branches from a Commit', async () => {
    await $('button=操作履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('button[aria-label="操作履歴"]')).toHaveAttribute('aria-current', 'page');
    await expect($('.repository-view-tabs')).not.toExist();
    const historyResizer = $('[role="separator"][aria-label="操作履歴一覧の幅"]');
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '244');
    await historyResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '236');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: E2Eリポジトリを初期化する'),
    );

    const historySearch = $('input[aria-label="操作履歴を検索"]');
    await expect(historySearch).toBeDisplayed();
    await historySearch.setValue('E2Eリポジトリ');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: E2Eリポジトリを初期化する'),
    );
    await historySearch.setValue('一致しない検索');
    await expect($('.history-search-empty')).toHaveText('一致する操作履歴はありません。');
    await historySearch.setValue('');
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
          return host?.shadowRoot?.textContent?.includes('README.md') ?? false;
        }),
      { timeout: 10_000, timeoutMsg: 'The History diff did not display its file name.' },
    );
    const historyDiffText = await browser.execute(
      () =>
        document.querySelector<HTMLElement>('.diff-surface diffs-container')?.shadowRoot
          ?.textContent ?? '',
    );
    expect(historyDiffText).not.toMatch(/unmodified lines?/iu);
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector<HTMLElement>('.commit-row[aria-current="true"]')!,
        ).getPropertyValue('box-shadow'),
      ),
    ).toBe('none');

    await expectHistoryCommitLayout(1180, 760);
    await expectHistoryCommitLayout(860, 560);
    await setLogicalWindowSize(1180, 760);

    const selectedCommit = $('.history-commit-item.is-current');
    const historyActions = selectedCommit.$('.history-action-trigger');
    await historyActions.click();
    const historyActionsMenu = $('[role="menu"]');
    await expect(historyActionsMenu).toBeDisplayed();
    expect(
      await browser.execute(() =>
        [...document.querySelectorAll<HTMLElement>('.history-action-menu [role="menuitem"]')].map(
          (item) => item.textContent?.trim(),
        ),
      ),
    ).toEqual([
      'ブランチを作成',
      'タグを作成',
      'マージを実行',
      'リベースを実行',
      'チェリーピックを実行',
      'リバートを実行',
      'リセットを実行',
    ]);
    await historyActionsMenu.$('button=タグを作成').click();
    const historyActionsDialog = $('[role="dialog"][aria-labelledby="history-createTag-title"]');
    await expect(historyActionsDialog).toBeDisplayed();
    expect(
      await browser.execute(
        () =>
          document.activeElement ===
          document.querySelector('[role="dialog"] input[aria-label="タグ名"]'),
      ),
    ).toBe(true);
    const tagName = 'e2e-v1.0.0';
    await historyActionsDialog.$('input[aria-label="タグ名"]').setValue(tagName);
    await historyActionsDialog.$('button=影響を確認').click();
    const tagConfirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
    await expect(tagConfirmation).toBeDisplayed();
    await expect(historyActionsDialog).not.toExist();
    await tagConfirmation.$('button=実行').click();
    await expect(tagConfirmation).not.toExist();
    await expect($('.ref-chip.tag')).toHaveText(tagName);
    expect(await runGit(repositoryPath, ['rev-parse', `refs/tags/${tagName}`])).toMatch(
      /^[0-9a-f]{40}\n$/u,
    );
    expect(
      await browser.execute(() => {
        const active = document.activeElement;
        return {
          tagName: active?.tagName,
          className: active?.getAttribute('class'),
          ariaLabel: active?.getAttribute('aria-label'),
        };
      }),
    ).toEqual({ tagName: 'BUTTON', className: 'commit-row', ariaLabel: null });

    const branchName = 'history-double-click';
    await $('.branch-toggle').click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    const createBranchButton = switcher.$('button=ブランチを作成');
    await expect(createBranchButton).toBeEnabled();
    await createBranchButton.click();
    const branchDialog = $('[role="dialog"][aria-labelledby="create-branch-title"]');
    await expect(branchDialog).toHaveText(
      expect.stringContaining('現在のCommitからブランチを作成し、そのブランチへ切り替えます。'),
    );
    await branchDialog.$('input[aria-label="ブランチ名"]').setValue(branchName);
    await branchDialog.$('button=影響を確認').click();
    const branchConfirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
    await expect(branchConfirmation).toBeDisplayed();
    await branchConfirmation.$('button=実行').click();
    await expect(branchConfirmation).not.toExist();
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining(branchName));
    expect(await runGit(repositoryPath, ['branch', '--show-current'])).toBe(`${branchName}\n`);
    await expect($(`[data-local-branch="${branchName}"]`)).toBeDisplayed();

    await $('.branch-toggle').click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await switcher.$('[role="option"]*=main').click();
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('main'));
    await expect($('.history-commit-item.is-current .history-action-trigger')).toBeEnabled();

    await dispatchDoubleClick('.history-commit-item.is-current .commit-row');
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining(branchName));
    expect(await runGit(repositoryPath, ['branch', '--show-current'])).toBe(`${branchName}\n`);
    await expect($('.history-commit-item.is-current .history-action-trigger')).toBeEnabled();
    await dispatchDoubleClick('[data-local-branch="main"]');
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('main'));
    expect(await runGit(repositoryPath, ['branch', '--show-current'])).toBe('main\n');

    await $('button=変更差分').click();
    await expect($('.changes-view')).toBeDisplayed();
  });
});
