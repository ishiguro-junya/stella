import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { join } from 'node:path';

import {
  dispatchDoubleClick,
  expectInteractiveSelectedColors,
  expectHistoryCommitLayout,
  openRepository,
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

async function clickHistoryDiffToggle(): Promise<void> {
  await browser.execute(() => {
    const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
    const toggle = host?.querySelector<HTMLButtonElement>('.diff-file-collapse-toggle');
    if (!toggle) throw new Error('The History diff collapse toggle was not found.');
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
}

async function historyDiffExpanded(): Promise<boolean | undefined> {
  return browser.execute(() => {
    const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
    const toggle =
      host?.querySelector<HTMLButtonElement>('.diff-file-collapse-toggle') ??
      host?.shadowRoot?.querySelector<HTMLButtonElement>('.diff-file-collapse-toggle');
    return toggle ? toggle.getAttribute('aria-expanded') === 'true' : undefined;
  });
}

async function historyDiffBodyVisible(): Promise<boolean> {
  return browser.execute(() => {
    const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
    return host?.shadowRoot?.querySelector('pre') !== null;
  });
}

async function historyDiffFileCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll('.diff-surface diffs-container').length);
}

describe('History', () => {
  let fixturePath = '';
  let repositoryPath = '';

  beforeEach(async () => {
    fixturePath = await createFixtureDirectory('history');
    repositoryPath = await copyE2EShowcaseRepository(fixturePath);
    await writeRepositoryFile(
      repositoryPath,
      'CHANGELOG.md',
      `${Array.from({ length: 30 }, (_, index) => `History layout line ${index + 1}`).join('\n')}\n`,
    );
    await runGit(repositoryPath, ['add', 'CHANGELOG.md']);
    await runGit(repositoryPath, ['commit', '--amend', '--no-edit']);
    await resetApp({ language: 'ja', appearance: 'dark', stickyFileHeaders: true });
    await openRepository(repositoryPath);
  });

  afterEach(async () => {
    await removeFixture(fixturePath);
    fixturePath = '';
    repositoryPath = '';
  });

  it('applies the shared line wrapping settings to the right pane Diff', async () => {
    await $('button=設定').click();
    await selectSetting('editor-line-wrapping', 'enabled');
    await $('input[name="editor-wrap-column"]').setValue('80');
    await $('button=履歴').click();
    await $('.history-view .diff-surface').waitForDisplayed({ timeout: 10_000 });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const host = document.querySelector<HTMLElement>('.history-view .diff-surface');
          const root = host?.querySelector<HTMLElement>('diffs-container')?.shadowRoot;
          return (
            host?.dataset.lineWrapping === 'true' &&
            host.dataset.wrapColumn === '80' &&
            Boolean(root?.querySelector('[data-overflow="wrap"]')) &&
            [...(root?.querySelectorAll('style') ?? [])].some((style) =>
              style.textContent?.includes('calc(100% - 80ch - 1ch)'),
            )
          );
        }),
      { timeout: 10_000, timeoutMsg: 'History did not apply the wrapping settings.' },
    );
    await expect($('.history-view .diff-surface')).toHaveAttribute('data-wrap-column', '80');
  });

  it('keeps the Commit lane continuous and distinct from the working tree in Light and Dark appearances', async () => {
    await writeRepositoryFile(repositoryPath, 'SECOND.md', 'Second commit\n');
    await runGit(repositoryPath, ['add', 'SECOND.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: History配色を確認する']);
    const paletteCommitOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    await writeRepositoryFile(repositoryPath, 'UNCOMMITTED.md', 'Uncommitted change\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    const paletteCommit = $(`[data-history-commit-oid="${paletteCommitOid}"]`);
    await paletteCommit.waitForDisplayed({ timeout: 20_000 });
    await paletteCommit.click();
    await $('.commit-detail-header .ref-chip.branch').waitForDisplayed({ timeout: 20_000 });
    await expectInteractiveSelectedColors('.history-commit-item.is-current', {
      foreground: ['.row-action-trigger', '.ref-chip'],
      mutedForeground: ['.commit-metadata', '.commit-oid'],
    });

    const historyColors = await browser.execute(() => {
      const selectedCommit = document.querySelector<HTMLElement>('.history-commit-item.is-current');
      const selectedCommitEdge = selectedCommit?.querySelector<SVGPathElement>(
        '.history-graph-edge:not(.working-tree)',
      );
      const selectedCommitNode = selectedCommit?.querySelector<HTMLElement>('.history-graph-node');
      const listBranch = selectedCommit?.querySelector<HTMLElement>('.ref-chip.branch');
      const nextCommit = selectedCommit?.nextElementSibling;
      const nextCommitEdge = nextCommit?.querySelector<SVGPathElement>('.history-graph-edge');
      const workingTreeEdge = document.querySelector<SVGPathElement>(
        '.history-working-tree-graph .history-graph-edge',
      );
      const workingTreeNode = document.querySelector<HTMLElement>(
        '.history-working-tree-graph .history-graph-node',
      );
      const detailBranch = document.querySelector<HTMLElement>(
        '.commit-detail-header .ref-chip.branch',
      );
      if (
        !selectedCommit ||
        !selectedCommitEdge ||
        !selectedCommitNode ||
        !listBranch ||
        !nextCommitEdge ||
        !workingTreeEdge ||
        !workingTreeNode ||
        !detailBranch
      )
        return null;
      return {
        selectedBackground: getComputedStyle(selectedCommit).backgroundColor,
        selectedCommitEdge: getComputedStyle(selectedCommitEdge).stroke,
        selectedCommitNode: getComputedStyle(selectedCommitNode).borderColor,
        listBranchFontSize: getComputedStyle(listBranch).fontSize,
        nextCommitEdge: getComputedStyle(nextCommitEdge).stroke,
        workingTreeEdge: getComputedStyle(workingTreeEdge).stroke,
        workingTreeNode: getComputedStyle(workingTreeNode).borderColor,
        branchForeground: getComputedStyle(detailBranch).color,
        branchBackground: getComputedStyle(detailBranch).backgroundColor,
        detailBranchFontSize: getComputedStyle(detailBranch).fontSize,
      };
    });
    expect(historyColors).toEqual({
      selectedBackground: 'rgb(20, 115, 230)',
      selectedCommitEdge: 'rgb(182, 109, 226)',
      selectedCommitNode: 'rgb(182, 109, 226)',
      listBranchFontSize: '12px',
      nextCommitEdge: 'rgb(182, 109, 226)',
      workingTreeEdge: 'rgb(119, 120, 129)',
      workingTreeNode: 'rgb(119, 120, 129)',
      branchForeground: 'rgb(100, 177, 255)',
      branchBackground: 'rgb(23, 54, 82)',
      detailBranchFontSize: '12px',
    });
    if (visualQaDirectory) {
      await browser.execute(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'history-graph-and-branch-dark-1180x760.png'),
        1180,
        760,
      );
    }

    const lightHistoryColors = await browser.execute(async () => {
      document.documentElement.dataset.theme = 'light';
      await new Promise((resolve) => setTimeout(resolve, 150));
      const selectedCommit = document.querySelector<HTMLElement>('.history-commit-item.is-current');
      const selectedCommitEdge = selectedCommit?.querySelector<SVGPathElement>(
        '.history-graph-edge:not(.working-tree)',
      );
      const selectedCommitNode = selectedCommit?.querySelector<HTMLElement>('.history-graph-node');
      const nextCommitEdge =
        selectedCommit?.nextElementSibling?.querySelector<SVGPathElement>('.history-graph-edge');
      const workingTreeEdge = document.querySelector<SVGPathElement>(
        '.history-working-tree-graph .history-graph-edge',
      );
      if (
        !selectedCommit ||
        !selectedCommitEdge ||
        !selectedCommitNode ||
        !nextCommitEdge ||
        !workingTreeEdge
      )
        return null;
      return {
        selectedBackground: getComputedStyle(selectedCommit).backgroundColor,
        selectedCommitEdge: getComputedStyle(selectedCommitEdge).stroke,
        selectedCommitNode: getComputedStyle(selectedCommitNode).borderColor,
        nextCommitEdge: getComputedStyle(nextCommitEdge).stroke,
        workingTreeEdge: getComputedStyle(workingTreeEdge).stroke,
      };
    });
    expect(lightHistoryColors).toEqual({
      selectedBackground: 'rgb(8, 127, 245)',
      selectedCommitEdge: 'rgb(123, 44, 191)',
      selectedCommitNode: 'rgb(123, 44, 191)',
      nextCommitEdge: 'rgb(123, 44, 191)',
      workingTreeEdge: 'rgb(115, 115, 123)',
    });
    if (visualQaDirectory) {
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'history-graph-and-branch-light-1180x760.png'),
        1180,
        760,
      );
    }
  });

  it('searches history and creates Tags and Branches from a Commit', async function () {
    this.timeout(120_000);
    await $('button=履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('button[aria-label="履歴"]')).toHaveAttribute('aria-current', 'page');
    await expectInteractiveSelectedColors('.history-commit-item.is-current', {
      foreground: ['.row-action-trigger', '.ref-chip'],
      mutedForeground: ['.commit-metadata', '.commit-oid'],
    });
    await expect($('.repository-view-tabs')).not.toExist();

    const historyResizer = $('[role="separator"][aria-label="履歴一覧の幅"]');
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '320');
    await historyResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '312');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );

    const historySearch = $('input[aria-label="履歴を検索"]');
    await expect(historySearch).toBeDisplayed();
    await historySearch.setValue('50本塁打');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );
    await historySearch.setValue('一致しない検索');
    await expect($('.history-search-empty')).toHaveText('一致する履歴はありません。');
    await historySearch.setValue('');
    await browser.waitUntil(async () => (await historyDiffFileCount()) === 2, {
      timeout: 10_000,
      timeoutMsg: 'The History multi-file diff did not render two files.',
    });
    const historyDiffNames = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')].map(
        (host) =>
          host.querySelector<HTMLElement>('.diff-file-custom-header-title > span:last-child')
            ?.textContent ?? '',
      ),
    );
    expect(historyDiffNames).toEqual(['CHANGELOG.md', 'src/records.ts']);
    const historyFileNameTypography = await browser.execute(() => {
      const fileName = document.querySelector<HTMLElement>(
        '.history-view .diff-file-custom-header-title > span:last-child',
      );
      if (!fileName) throw new Error('The History file name was not found.');
      const style = getComputedStyle(fileName);
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      };
    });
    expect(historyFileNameTypography).toEqual({
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '20px',
    });
    const historyDiffText = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')]
        .map((host) => host.shadowRoot?.textContent ?? '')
        .join('\n'),
    );
    expect(historyDiffText).not.toMatch(/unmodified lines?/iu);

    const historyFileLayout = await browser.execute(async () => {
      const surface = document.querySelector<HTMLElement>('.diff-surface');
      const hosts = [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')];
      const firstHeader = hosts[0]?.shadowRoot?.querySelector<HTMLElement>('[data-diffs-header]');
      if (!surface || !firstHeader)
        throw new Error('The History file header layout was not found.');
      surface.scrollTop = 40;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const stickyOffset = Math.abs(
        firstHeader.getBoundingClientRect().top - surface.getBoundingClientRect().top,
      );

      const firstHost = hosts[0];
      if (!firstHost) throw new Error('The first History diff host was not found.');
      surface.scrollTop = Math.max(0, firstHost.offsetHeight - surface.clientHeight / 2);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const renderedHosts = [
        ...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container'),
      ];
      const firstLines = [
        ...(renderedHosts[0]?.shadowRoot?.querySelectorAll<HTMLElement>('[data-line]') ?? []),
      ];
      const lastFirstLine = firstLines.at(-1);
      const secondHeader =
        renderedHosts[1]?.shadowRoot?.querySelector<HTMLElement>('[data-diffs-header]');
      if (!lastFirstLine || !secondHeader)
        throw new Error('The expanded History file boundary was not rendered.');

      const probe = document.createElement('div');
      probe.style.border = '1px solid var(--border-strong)';
      document.body.append(probe);
      const expectedBorderColor = getComputedStyle(probe).borderTopColor;
      probe.remove();
      const secondHeaderStyle = getComputedStyle(secondHeader);
      const boundaryGap = Math.round(
        secondHeader.getBoundingClientRect().top - lastFirstLine.getBoundingClientRect().bottom,
      );
      surface.scrollTop = 0;
      return {
        boundaryGap,
        borderTopColor: secondHeaderStyle.borderTopColor,
        borderTopWidth: secondHeaderStyle.borderTopWidth,
        expectedBorderColor,
        stickyOffset,
      };
    });
    expect(historyFileLayout).toEqual({
      boundaryGap: 0,
      borderTopColor: historyFileLayout.expectedBorderColor,
      borderTopWidth: '1px',
      expectedBorderColor: historyFileLayout.expectedBorderColor,
      stickyOffset: 0,
    });

    await browser.waitUntil(historyDiffBodyVisible, {
      timeoutMsg: 'The History diff body was not visible before collapsing it.',
    });

    await clickHistoryDiffToggle();
    await browser.waitUntil(async () => (await historyDiffExpanded()) === false, {
      timeoutMsg: 'Clicking the History diff toggle did not collapse its diff.',
    });
    await browser.waitUntil(async () => !(await historyDiffBodyVisible()), {
      timeoutMsg: 'Clicking the History diff toggle did not hide its diff body.',
    });
    await clickHistoryDiffToggle();
    await browser.waitUntil(async () => (await historyDiffExpanded()) === true, {
      timeoutMsg: 'Clicking the collapsed History diff toggle did not expand its diff.',
    });
    await browser.waitUntil(historyDiffBodyVisible, {
      timeoutMsg: 'Clicking the collapsed History diff toggle did not show its diff body.',
    });

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
    await expect($(`.ref-chip.tag[aria-label="タグ ${tagName}"]`)).toHaveText(tagName);
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
      expect.stringContaining('現在のコミットからブランチを作成し、そのブランチへ切り替えます。'),
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
    await expect(switcher.$('[data-switcher-item-label="main"]')).toBeDisplayed();
    await dispatchDoubleClick('[data-switcher-item-label="main"]');
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('main'));
    await expect($('.history-commit-item.is-current .history-action-trigger')).toBeEnabled();

    await dispatchDoubleClick('.history-commit-item.is-current .commit-row');
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining(branchName));
    expect(await runGit(repositoryPath, ['branch', '--show-current'])).toBe(`${branchName}\n`);
    await expect($('.history-commit-item.is-current .history-action-trigger')).toBeEnabled();
    await dispatchDoubleClick('[data-local-branch="main"]');
    await expect($('.branch-toggle')).toHaveText(expect.stringContaining('main'));
    expect(await runGit(repositoryPath, ['branch', '--show-current'])).toBe('main\n');

    await $('button=変更').click();
    await expect($('.changes-view')).toBeDisplayed();
  });
});
