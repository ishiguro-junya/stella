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

async function runHistoryAction(
  oid: string,
  menuLabel: string,
  kind: string,
  actionLabel: string,
  field?: { label: string; value: string },
): Promise<void> {
  await $('button=履歴').click();
  const commit = $(`[data-history-commit-oid="${oid}"]`);
  await commit.waitForDisplayed({ timeout: 20_000 });
  await commit.scrollIntoView();
  await commit.click();
  const trigger = $('.history-commit-item.is-current .history-action-trigger');
  await trigger.waitForEnabled({ timeout: 20_000 });
  await trigger.click();
  const menu = $('[role="menu"]');
  await menu.waitForDisplayed({ timeout: 20_000 });
  await menu.$(`button=${menuLabel}`).click();
  const dialog = $(`[role="dialog"][aria-labelledby="history-${kind}-title"]`);
  await expect(dialog).toBeDisplayed();
  if (field) await dialog.$(`[aria-label="${field.label}"]`).setValue(field.value);
  await dialog.$('button=次へ').click();
  const confirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
  await expect(confirmation).toBeDisplayed();
  await confirmation.$(`button=${actionLabel}`).click();
  await expect(confirmation).not.toExist();
}

async function commitPendingHistoryAction(description: string): Promise<void> {
  await $('button=差分').click();
  const trigger = $('.diff-action-bar .diff-action-button[aria-label="コミット"]');
  await trigger.waitForEnabled({ timeout: 20_000 });
  await trigger.click();
  const dialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
  await dialog.waitForDisplayed({ timeout: 20_000 });
  await dialog.$('[data-commit-field="description"]').setValue(description);
  await dialog.$('.commit-form button[type="submit"]').click();
  await expect(dialog).not.toExist();
}

describe('History', () => {
  let fixturePath = '';
  let repositoryPath = '';

  beforeEach(async () => {
    fixturePath = await createFixtureDirectory('history');
    repositoryPath = await copyE2EShowcaseRepository(fixturePath, 'major-league-baseball');
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

  it('scrolls the commit details in the right pane', async () => {
    await $('button=履歴').click();
    await $('.history-view .diff-surface').waitForDisplayed({ timeout: 10_000 });

    expect(
      await browser.execute(() => {
        const detailPane = document.querySelector<HTMLElement>('.commit-detail-pane');
        const diffSurface = detailPane?.querySelector<HTMLElement>('.diff-surface');
        if (!detailPane || !diffSurface) throw new Error('The History right pane was not found.');
        detailPane.scrollTop = detailPane.scrollHeight;
        return {
          detailOverflowY: getComputedStyle(detailPane).overflowY,
          detailScrolls: detailPane.scrollTop > 0,
          diffOverflowY: getComputedStyle(diffSurface).overflowY,
        };
      }),
    ).toEqual({ detailOverflowY: 'auto', detailScrolls: true, diffOverflowY: 'visible' });
  });

  it('uses the regular file header for History image previews', async () => {
    await writeRepositoryFile(
      repositoryPath,
      'history-image.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#f00"/></svg>\n',
    );
    await writeRepositoryFile(repositoryPath, 'history-image.txt', 'before\n');
    await runGit(repositoryPath, ['add', 'history-image.svg', 'history-image.txt']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 履歴画像の基準を作成する']);
    await writeRepositoryFile(
      repositoryPath,
      'history-image.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#00f"/></svg>\n',
    );
    await writeRepositoryFile(repositoryPath, 'history-image.txt', 'after\n');
    await runGit(repositoryPath, ['add', 'history-image.svg', 'history-image.txt']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 履歴画像のヘッダーを確認する']);
    const commitOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();

    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    const commit = $(`[data-history-commit-oid="${commitOid}"]`);
    await commit.waitForDisplayed({ timeout: 20_000 });
    await commit.click();
    await $('.history-image-file-header').waitForDisplayed({ timeout: 10_000 });

    expect(
      await browser.execute(() => {
        const imageHeader = document.querySelector<HTMLElement>('.history-image-file-header');
        const normalHost = document.querySelector<HTMLElement>('.diff-surface diffs-container');
        const normalHeader =
          normalHost?.shadowRoot?.querySelector<HTMLElement>('[data-diffs-header]');
        if (!imageHeader || !normalHeader || !normalHost) {
          throw new Error('The regular or image History file header was not found.');
        }
        const imageStyle = getComputedStyle(imageHeader);
        const normalStyle = getComputedStyle(normalHeader);
        return {
          backgroundMatches: imageStyle.backgroundColor === normalStyle.backgroundColor,
          heightMatches:
            imageHeader.getBoundingClientRect().height ===
            normalHeader.getBoundingClientRect().height,
          paddingMatches:
            imageStyle.paddingLeft === normalStyle.paddingLeft &&
            imageStyle.paddingRight === normalStyle.paddingRight,
          hasCollapseToggle: Boolean(
            imageHeader.querySelector('.diff-file-collapse-toggle') &&
            normalHost.querySelector('.diff-file-collapse-toggle'),
          ),
          hasImageToggle: Boolean(imageHeader.querySelector('.image-preview-toggle')),
        };
      }),
    ).toEqual({
      backgroundMatches: true,
      heightMatches: true,
      paddingMatches: true,
      hasCollapseToggle: true,
      hasImageToggle: true,
    });
  });

  it('separates a commit body from the subject as secondary text', async () => {
    await writeRepositoryFile(repositoryPath, 'src/commit-body.md', 'Commit body spacing\n');
    await runGit(repositoryPath, ['add', 'src/commit-body.md']);
    await runGit(repositoryPath, [
      'commit',
      '-m',
      'test: コミット本文の表示を確認する',
      '-m',
      'この変更が必要な理由を補足します。',
    ]);
    const commitOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    const commit = $(`[data-history-commit-oid="${commitOid}"]`);
    await commit.waitForDisplayed({ timeout: 20_000 });
    await commit.click();
    await expect($('.commit-detail-body')).toHaveText('この変更が必要な理由を補足します。');
    await browser.waitUntil(async () => (await historyDiffFileCount()) === 1, {
      timeout: 10_000,
      timeoutMsg: 'The commit body History diff did not render.',
    });

    expect(
      await browser.execute(() => {
        const heading = document.querySelector<HTMLElement>('.commit-detail-heading');
        const body = document.querySelector<HTMLElement>('.commit-detail-body');
        const path = document.querySelector<HTMLElement>(
          '.diff-file-custom-header-title > span:last-child',
        );
        if (!heading || !body || !path) {
          throw new Error('The commit body or nested file path was not found.');
        }
        const secondaryProbe = document.createElement('span');
        secondaryProbe.style.color = 'var(--text-secondary)';
        document.body.append(secondaryProbe);
        const result = {
          gapAbove: body.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
          usesSecondaryColor:
            getComputedStyle(body).color === getComputedStyle(secondaryProbe).color,
          fullPath: path.textContent,
          hasPathPrefix: Boolean(path.querySelector('.file-path-prefix')),
        };
        secondaryProbe.remove();
        return result;
      }),
    ).toEqual({
      gapAbove: 8,
      usesSecondaryColor: true,
      fullPath: 'src/commit-body.md',
      hasPathPrefix: false,
    });

    if (visualQaDirectory) {
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'history-commit-body-1180x760.png'),
        1180,
        760,
      );
    }
  });

  it('shows a tooltip when focusing a single-file diff toggle', async () => {
    await writeRepositoryFile(repositoryPath, 'single-tooltip.txt', 'single file\n');
    await runGit(repositoryPath, ['add', 'single-tooltip.txt']);
    await runGit(repositoryPath, [
      'commit',
      '-m',
      'test: 単一ファイル差分のツールチップを確認する',
    ]);
    const commitOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    const commit = $(`[data-history-commit-oid="${commitOid}"]`);
    await commit.waitForDisplayed({ timeout: 20_000 });
    await commit.click();
    await browser.waitUntil(async () => (await historyDiffFileCount()) === 1, {
      timeout: 10_000,
      timeoutMsg: 'The single-file History diff did not render.',
    });

    const toggleLabel = await browser.execute(() => {
      const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
      const toggle =
        host?.querySelector<HTMLButtonElement>('.diff-file-collapse-toggle') ??
        host?.shadowRoot?.querySelector<HTMLButtonElement>('.diff-file-collapse-toggle');
      toggle?.focus();
      return toggle?.getAttribute('aria-label');
    });
    if (!toggleLabel) throw new Error('The single-file diff toggle has no accessible label.');
    await expect($('.app-tooltip')).toHaveText(toggleLabel);
    await clickHistoryDiffToggle();
    await browser.waitUntil(async () => (await historyDiffExpanded()) === false, {
      timeoutMsg: 'The single-file History diff did not collapse.',
    });
  });

  it('keeps the Commit lane continuous and distinct from the working tree in Light and Dark appearances', async () => {
    await writeRepositoryFile(repositoryPath, 'SECOND.md', 'Second commit\n');
    await runGit(repositoryPath, ['add', 'SECOND.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 履歴の配色を確認する']);
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
      palette: 'neutral',
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
    expect(historyColors).toEqual(
      expect.objectContaining({
        selectedCommitEdge: 'rgb(20, 115, 230)',
        listBranchFontSize: '12px',
        nextCommitEdge: 'rgb(20, 115, 230)',
        workingTreeEdge: 'rgb(119, 120, 129)',
        workingTreeNode: 'rgb(119, 120, 129)',
        branchForeground: 'rgb(100, 177, 255)',
        branchBackground: 'rgb(23, 54, 82)',
        detailBranchFontSize: '12px',
      }),
    );
    expect(historyColors?.selectedCommitNode).not.toBe(historyColors?.workingTreeNode);
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
    expect(lightHistoryColors).toEqual(
      expect.objectContaining({
        selectedBackground: 'rgb(222, 223, 227)',
        selectedCommitEdge: 'rgb(8, 127, 245)',
        nextCommitEdge: 'rgb(8, 127, 245)',
        workingTreeEdge: 'rgb(115, 115, 123)',
      }),
    );
    expect(lightHistoryColors?.selectedCommitNode).not.toBe(lightHistoryColors?.workingTreeEdge);
    if (visualQaDirectory) {
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'history-graph-and-branch-light-1180x760.png'),
        1180,
        760,
      );
    }
  });

  it('keeps branch corners fixed and shows up to three ref rows', async () => {
    const overflowBranchNames = [
      'history-ref-layout-alpha',
      'history-ref-layout-bravo',
      'history-ref-layout-charlie',
      'history-ref-layout-delta',
    ];
    for (const branchName of overflowBranchNames) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Git参照のロック競合を避けるため直列に作成する。
      await runGit(repositoryPath, ['branch', branchName, 'HEAD']);
    }
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    await browser.waitUntil(
      () =>
        browser.execute((branchNames) => {
          const firstCommit = document.querySelector<HTMLElement>('.history-commit-item');
          return branchNames.every((branchName) => firstCommit?.textContent?.includes(branchName));
        }, overflowBranchNames),
      { timeout: 10_000, timeoutMsg: 'The overflow refs were not shown in History.' },
    );

    const layout = await browser.execute(() => {
      const firstCommit = document.querySelector<HTMLElement>('.history-commit-item');
      const corner = firstCommit?.querySelector<SVGPathElement>(
        '.history-graph-edge.parent[data-from-lane="0"][data-to-lane="1"]',
      );
      const vertical = firstCommit?.querySelector<SVGPathElement>(
        '.history-graph-edge.parent-vertical[data-to-lane="1"]',
      );
      const yamamotoBranch = [
        ...document.querySelectorAll<HTMLElement>('.history-commit-item'),
      ].find((commit) => commit.textContent?.includes('ヤンキース戦で7回無失点7奪三振'));
      const yamamotoBase = [...document.querySelectorAll<HTMLElement>('.history-commit-item')].find(
        (commit) => commit.textContent?.includes('5回無失点8奪三振でMLB初勝利'),
      );
      const branchContinuesVertically = yamamotoBranch?.querySelector(
        '.history-graph-edge.parent[data-from-lane="1"][data-to-lane="1"]',
      );
      const baseStartsDiagonally = yamamotoBase?.querySelector(
        '.history-graph-edge.incoming[data-from-lane="1"][data-to-lane="0"]',
      );
      const refs = [...(firstCommit?.querySelectorAll<HTMLElement>('.ref-chip') ?? [])];
      const refList = firstCommit?.querySelector<HTMLElement>('.ref-list');
      if (!corner?.ownerSVGElement || !vertical?.ownerSVGElement || !refList || refs.length === 0)
        return null;
      const cornerRect = corner.ownerSVGElement.getBoundingClientRect();
      const verticalRect = vertical.ownerSVGElement.getBoundingClientRect();
      const refListRect = refList.getBoundingClientRect();
      const visibleRefs = refs.filter(
        (ref) => ref.getBoundingClientRect().bottom <= refListRect.bottom + 1,
      );
      return {
        cornerHeight: cornerRect.height,
        cornerPath: corner.getAttribute('d'),
        cornerToVerticalGap: Math.abs(cornerRect.bottom - verticalRect.top),
        branchContinuesVertically: Boolean(branchContinuesVertically),
        baseStartsDiagonally: Boolean(baseStartsDiagonally),
        refRows: new Set(refs.map((ref) => Math.round(ref.getBoundingClientRect().top))).size,
        visibleRefRows: new Set(
          visibleRefs.map((ref) => Math.round(ref.getBoundingClientRect().top)),
        ).size,
        hasClippedRefs: refList.scrollHeight > refList.clientHeight,
        visibleRefsAreComplete: visibleRefs.every((ref) => ref.scrollWidth <= ref.clientWidth + 1),
      };
    });

    expect(layout).toEqual(
      expect.objectContaining({
        cornerHeight: 8,
        cornerPath: 'M 6 0 L 18 8',
        cornerToVerticalGap: 0,
        branchContinuesVertically: true,
        baseStartsDiagonally: true,
        visibleRefRows: 3,
        hasClippedRefs: true,
        visibleRefsAreComplete: true,
      }),
    );
    expect(layout?.refRows).toBeGreaterThan(3);
  });

  it('shows several branch tips that have not been merged', async () => {
    const branchNames = ['darvish-mlb-debut', 'ohtani-mlb-debut', 'senga-mlb-debut'];
    const unmergedBranches = (
      await runGit(repositoryPath, [
        'branch',
        '--no-merged',
        'main',
        '--format=%(refname:short)',
        '--sort=refname',
      ])
    )
      .trim()
      .split('\n');
    expect(unmergedBranches).toEqual(branchNames);

    await $('button=履歴').click();
    await browser.waitUntil(
      async () => {
        const history = await $('.commit-list').getText();
        return branchNames.every((name) => history.includes(name));
      },
      { timeout: 10_000, timeoutMsg: 'Unmerged branch tips were not shown in History.' },
    );
    await expect($('.history-commit-item:first-child .commit-row')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );

    const branchTips = await browser.execute(
      (names) =>
        names.map((name) => {
          const chip = [...document.querySelectorAll<HTMLElement>('.ref-chip.branch')].find(
            (ref) => ref.textContent === name,
          );
          const row = chip?.closest<HTMLElement>('.history-commit-item');
          const lane = row?.querySelector<HTMLElement>('.history-graph-node')?.dataset.nodeLane;
          return {
            name,
            incomingEdges: row?.querySelectorAll('[data-edge-kind="incoming"]').length,
            continuesToParent: Boolean(
              lane &&
              row?.querySelector(
                `[data-edge-kind="parent"][data-from-lane="${lane}"][data-to-lane="${lane}"]`,
              ),
            ),
          };
        }),
      branchNames,
    );
    expect(branchTips).toEqual(
      branchNames.map((name) => ({ name, incomingEdges: 0, continuesToParent: true })),
    );
  });

  it('executes every Commit action through preview against a real repository', async function () {
    this.timeout(120_000);
    const currentBranch = (await runGit(repositoryPath, ['branch', '--show-current'])).trim();
    const baseOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    const createTarget = async (branch: string, path: string): Promise<string> => {
      await runGit(repositoryPath, ['switch', '-c', branch, baseOid]);
      await writeRepositoryFile(repositoryPath, path, `${branch}\n`);
      await runGit(repositoryPath, ['add', path]);
      await runGit(repositoryPath, ['commit', '-m', `test: ${branch}`]);
      return (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    };
    const rebaseOid = await createTarget('e2e-rebase-target', 'e2e-rebase.txt');
    const mergeOid = await createTarget('e2e-merge-target', 'e2e-merge.txt');
    const cherryPickOid = await createTarget('e2e-cherry-target', 'e2e-cherry.txt');
    await runGit(repositoryPath, ['switch', currentBranch]);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();

    await runHistoryAction(baseOid, 'ブランチを作成', 'createBranch', '作成', {
      label: 'ブランチ名',
      value: 'e2e-created-branch',
    });
    await browser.waitUntil(
      async () =>
        runGit(repositoryPath, ['rev-parse', 'refs/heads/e2e-created-branch']).then(
          (oid) => oid.trim() === baseOid,
          () => false,
        ),
      { timeout: 20_000, timeoutMsg: 'Create Branch did not create the selected ref.' },
    );
    expect(
      (await runGit(repositoryPath, ['rev-parse', 'refs/heads/e2e-created-branch'])).trim(),
    ).toBe(baseOid);

    await runHistoryAction(baseOid, 'タグを作成', 'createTag', '作成', {
      label: 'タグ名',
      value: 'e2e-history-actions',
    });
    await browser.waitUntil(
      async () =>
        runGit(repositoryPath, ['rev-parse', 'refs/tags/e2e-history-actions']).then(
          (oid) => oid.trim() === baseOid,
          () => false,
        ),
      { timeout: 20_000, timeoutMsg: 'Create Tag did not create the selected ref.' },
    );
    expect(
      (await runGit(repositoryPath, ['rev-parse', 'refs/tags/e2e-history-actions'])).trim(),
    ).toBe(baseOid);

    await runHistoryAction(rebaseOid, 'リベース', 'rebase', '実行');
    await browser.waitUntil(
      async () => (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim() === rebaseOid,
      { timeout: 20_000, timeoutMsg: 'Rebase did not update HEAD.' },
    );

    await runHistoryAction(mergeOid, 'マージ', 'merge', '実行');
    const operationBanner = $('[aria-label="Git操作が進行中"]');
    await expect(operationBanner).toBeDisplayed();
    await expect(operationBanner.$('button=続行')).toBeDisabled();
    await commitPendingHistoryAction('履歴からマージする');
    await browser.waitUntil(
      async () =>
        (await runGit(repositoryPath, ['rev-list', '--parents', '-n', '1', 'HEAD']))
          .trim()
          .split(' ').length === 3,
      { timeout: 20_000, timeoutMsg: 'Merge did not create a merge commit.' },
    );
    const mergedHead = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();

    await runHistoryAction(cherryPickOid, 'チェリーピック', 'cherryPick', '実行');
    const runtimeError = $('[role="alertdialog"][aria-labelledby="runtime-error-title"]');
    await browser.waitUntil(
      async () =>
        (await runtimeError.isExisting()) ||
        (await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).trim() ===
          'e2e-cherry.txt',
      {
        timeout: 20_000,
        timeoutMsg: 'Cherry-pick neither staged its changes nor displayed an error.',
      },
    );
    if (await runtimeError.isExisting()) {
      throw new Error(`Cherry-pick failed: ${await runtimeError.getText()}`);
    }
    await commitPendingHistoryAction('履歴からチェリーピックする');
    await browser.waitUntil(
      async () => (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim() !== mergedHead,
      { timeout: 20_000, timeoutMsg: 'Cherry-pick did not create a commit.' },
    );
    const cherryPickedHead = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    expect((await runGit(repositoryPath, ['show', 'HEAD:e2e-cherry.txt'])).trim()).toBe(
      'e2e-cherry-target',
    );

    await runHistoryAction(cherryPickedHead, 'リバート', 'revert', '実行');
    await browser.waitUntil(
      async () =>
        (await runtimeError.isExisting()) ||
        (await runGit(repositoryPath, ['diff', '--cached', '--name-status'])).trim() ===
          'D\te2e-cherry.txt',
      {
        timeout: 20_000,
        timeoutMsg: 'Revert neither staged its changes nor displayed an error.',
      },
    );
    if (await runtimeError.isExisting()) {
      throw new Error(`Revert failed: ${await runtimeError.getText()}`);
    }
    await commitPendingHistoryAction('履歴からリバートする');
    await browser.waitUntil(
      async () => (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim() !== cherryPickedHead,
      { timeout: 20_000, timeoutMsg: 'Revert did not create a commit.' },
    );
    expect(
      (
        await runGit(repositoryPath, ['ls-tree', '-r', '--name-only', 'HEAD', 'e2e-cherry.txt'])
      ).trim(),
    ).toBe('');

    await runHistoryAction(mergedHead, 'リセット', 'reset', '実行');
    await browser.waitUntil(
      async () => (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim() === mergedHead,
      { timeout: 20_000, timeoutMsg: 'Reset did not move HEAD to the selected commit.' },
    );
    expect((await runGit(repositoryPath, ['status', '--porcelain'])).trim()).toBe('');
  });

  it('searches history and creates Tags and Branches from a Commit', async function () {
    this.timeout(120_000);
    await $('button=履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('button[aria-label="履歴"]')).toHaveAttribute('aria-current', 'page');
    await expect($('.repository-toggle')).toHaveText(
      expect.stringContaining('major-league-baseball'),
    );
    await expect($('.history-commit-item:first-child .commit-row')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );
    await expect($('.history-commit-item:first-child .commit-row')).toHaveText(
      expect.stringContaining('大谷翔平'),
    );
    await browser.waitUntil(
      async () => (await $('.commit-list').getText()).includes('feat: 第一子誕生を発表'),
      { timeout: 10_000, timeoutMsg: 'The first-child branch was not shown in History.' },
    );
    const showcaseBranch = await browser.execute(() => {
      const commits = [...document.querySelectorAll<HTMLElement>('.history-commit-item')];
      const firstChild = commits.find((commit) => commit.textContent?.includes('第一子誕生'));
      const firstNode = commits[0]?.querySelector<HTMLElement>('.history-graph-node');
      const firstChildNode = firstChild?.querySelector<HTMLElement>('.history-graph-node');
      const branchStartEdge = commits[0]?.querySelector<SVGPathElement>(
        '.history-graph-edge.parent[data-from-lane="0"][data-to-lane="1"]',
      );
      const nodeTitleOffsets = [
        ...document.querySelectorAll<HTMLElement>(
          '.history-working-tree-item, .history-commit-item',
        ),
      ]
        .slice(0, 4)
        .map((row) => {
          const node = row.querySelector<HTMLElement>('.history-graph-node');
          const title = row.querySelector<HTMLElement>('.commit-copy strong');
          if (!node || !title) return undefined;
          const nodeRect = node.getBoundingClientRect();
          const titleRect = title.getBoundingClientRect();
          return Math.abs(
            nodeRect.top + nodeRect.height / 2 - (titleRect.top + titleRect.height / 2),
          );
        })
        .filter((offset): offset is number => offset !== undefined);
      return {
        firstLane: firstNode?.dataset.nodeLane,
        firstChildLane: firstChildNode?.dataset.nodeLane,
        branch: firstChild?.querySelector<HTMLElement>('.ref-chip.branch')?.textContent,
        branches: [...document.querySelectorAll<HTMLElement>('.ref-chip.branch')].map(
          (ref) => ref.textContent,
        ),
        firstColor: firstNode ? getComputedStyle(firstNode).borderColor : undefined,
        firstChildColor: firstChildNode ? getComputedStyle(firstChildNode).borderColor : undefined,
        branchStartEdgeColor: branchStartEdge
          ? getComputedStyle(branchStartEdge).stroke
          : undefined,
        branchStartEdgePath: branchStartEdge?.getAttribute('d'),
        maxNodeTitleOffset: Math.max(...nodeTitleOffsets),
      };
    });
    expect(showcaseBranch).toEqual(
      expect.objectContaining({ firstLane: '0', firstChildLane: '1', branch: 'family-news' }),
    );
    expect(showcaseBranch.branches).toEqual(
      expect.arrayContaining([
        'family-news',
        'yamamoto-yankees',
        'senga-200-strikeouts',
        'seiya-season-debut',
      ]),
    );
    expect(showcaseBranch.firstChildColor).not.toBe(showcaseBranch.firstColor);
    expect(showcaseBranch.branchStartEdgeColor).toBe(showcaseBranch.firstChildColor);
    expect(showcaseBranch.branchStartEdgePath).toBe('M 6 0 L 18 8');
    expect(showcaseBranch.maxNodeTitleOffset).toBeLessThanOrEqual(0.5);
    const initiallyFocusedOid = await browser.execute(() => {
      const active = document.activeElement;
      const selected = document.querySelector<HTMLElement>(
        '.history-commit-item.is-current .commit-row',
      );
      return active === selected && active instanceof HTMLElement
        ? active.dataset.historyCommitOid
        : undefined;
    });
    expect(initiallyFocusedOid).toBeTruthy();
    await browser.keys(['ArrowDown']);
    await browser.waitUntil(
      async () =>
        browser.execute((previousOid) => {
          const active = document.activeElement;
          return (
            active === document.querySelector('.history-commit-item.is-current .commit-row') &&
            active instanceof HTMLElement &&
            active.dataset.historyCommitOid !== previousOid
          );
        }, initiallyFocusedOid),
      { timeoutMsg: 'ArrowDown did not move the focused History selection.' },
    );
    await expect($('.commit-list')).toHaveElementClass('is-keyboard-navigating');
    await browser.keys(['ArrowUp']);
    await browser.waitUntil(
      async () =>
        browser.execute((expectedOid) => {
          const active = document.activeElement;
          return (
            active instanceof HTMLElement &&
            active.dataset.historyCommitOid === expectedOid &&
            active === document.querySelector('.history-commit-item.is-current .commit-row')
          );
        }, initiallyFocusedOid),
      { timeoutMsg: 'ArrowUp did not restore the focused History selection.' },
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.commit-list')
        ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    });
    await expect($('.commit-list')).not.toHaveElementClass('is-keyboard-navigating');
    expect(await $('.commit-detail-pane').getText()).not.toContain('コミット詳細を読み込み中...');
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.history-commit-item .history-action-trigger')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    await expect($('.app-tooltip')).toHaveText('その他の操作');
    await expect($('.commit-detail-heading .history-action-trigger')).toExist();
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.history-commit-item .history-action-trigger')!
        .dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
      document
        .querySelector<HTMLElement>('.commit-detail-heading .history-action-trigger')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    await expect($('.app-tooltip')).toHaveText('その他の操作');
    expect(
      await browser.execute(() => {
        const listPane = document.querySelector<HTMLElement>('.commit-list-pane')!;
        const listAction = document.querySelector<HTMLElement>(
          '.history-commit-item .history-action-trigger',
        )!;
        const detailHeading = document.querySelector<HTMLElement>('.commit-detail-heading')!;
        const detailTitle = detailHeading.querySelector<HTMLElement>('h2')!;
        const detailAction = detailHeading.querySelector<HTMLElement>('.history-action-trigger')!;
        const listActions = [
          ...document.querySelectorAll<HTMLElement>(
            '.history-commit-item > .history-action-trigger',
          ),
        ];
        return {
          listActionTrailingGap:
            listPane.getBoundingClientRect().right - listAction.getBoundingClientRect().right,
          detailActionTopOffset:
            detailAction.getBoundingClientRect().top - detailTitle.getBoundingClientRect().top,
          allListActionsVisible: listActions.every((action) => {
            const style = getComputedStyle(action);
            return style.opacity === '1' && style.visibility === 'visible';
          }),
          detailActionVisible: (() => {
            const style = getComputedStyle(detailAction);
            return style.opacity === '1' && style.visibility === 'visible';
          })(),
        };
      }),
    ).toEqual({
      listActionTrailingGap: 8,
      detailActionTopOffset: 0,
      allListActionsVisible: true,
      detailActionVisible: true,
    });
    await expectInteractiveSelectedColors('.history-commit-item.is-current', {
      palette: 'neutral',
    });
    await expect($('.repository-view-tabs')).not.toExist();

    const historyResizer = $('[role="separator"][aria-label="履歴一覧の幅"]');
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '360');
    await historyResizer.click();
    await browser.keys(['ArrowRight']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '368');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );

    const historySearch = $('input[aria-label="履歴を検索"]');
    await expect(historySearch).toBeDisplayed();
    await expect($('.history-pane-toolbar input[aria-label="履歴を検索"]')).toBeDisplayed();
    await expect($('.commit-list-pane .history-search')).toExist();
    expect(
      await browser.execute(() => {
        const toolbar = document.querySelector<HTMLElement>('.history-pane-toolbar')!;
        const input = toolbar.querySelector<HTMLInputElement>('.history-search input')!;
        const icon = toolbar.querySelector<HTMLElement>('.history-search-icon')!;
        const toolbarRect = toolbar.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        return {
          insideToolbar: inputRect.top >= toolbarRect.top && inputRect.bottom <= toolbarRect.bottom,
          rightGap: toolbarRect.right - inputRect.right,
          leftGap: inputRect.left - toolbarRect.left,
          iconInset: icon.getBoundingClientRect().left - inputRect.left,
          inputPaddingLeft: getComputedStyle(input).paddingLeft,
        };
      }),
    ).toEqual({
      insideToolbar: true,
      rightGap: 10,
      leftGap: 10,
      iconInset: 11,
      inputPaddingLeft: '34px',
    });
    await historySearch.setValue('50本塁打');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );
    await historySearch.setValue('一致しない検索');
    await expect($('.history-search-empty')).toHaveText('一致する履歴はありません。');
    await historySearch.setValue('');
    await browser.waitUntil(async () => (await historyDiffFileCount()) === 3, {
      timeout: 10_000,
      timeoutMsg: 'The History multi-file diff did not render three files.',
    });
    const historyDiffNames = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')].map(
        (host) =>
          host.querySelector<HTMLElement>('.diff-file-custom-header-title > span:last-child')
            ?.textContent ?? '',
      ),
    );
    expect(historyDiffNames).toEqual(['CHANGELOG.md', 'docs/first-child.md', 'src/records.ts']);
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

    const historyFileLayout = await browser.execute(() => {
      const surface = document.querySelector<HTMLElement>('.diff-surface');
      const hosts = [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')];
      const firstHeader = hosts[0]?.shadowRoot?.querySelector<HTMLElement>('[data-diffs-header]');
      if (!surface || !firstHeader)
        throw new Error('The History file header layout was not found.');
      surface.scrollTop = 40;
      surface.getBoundingClientRect();
      const stickyOffset = Math.abs(
        firstHeader.getBoundingClientRect().top - surface.getBoundingClientRect().top,
      );

      const firstHost = hosts[0];
      if (!firstHost) throw new Error('The first History diff host was not found.');
      surface.scrollTop = Math.max(0, firstHost.offsetHeight - surface.clientHeight / 2);
      surface.getBoundingClientRect();
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
      'マージ',
      'リベース',
      'チェリーピック',
      'リバート',
      'リセット',
    ]);
    await historyActionsMenu.$('button=タグを作成').click();
    const historyActionsDialog = $('[role="dialog"][aria-labelledby="history-createTag-title"]');
    await expect(historyActionsDialog).toBeDisplayed();
    await setLogicalWindowSize(860, 560);
    const createTagHelp = historyActionsDialog.$('#create-tag-help');
    await expect(createTagHelp).toHaveText(
      '軽量タグをローカルに作成します。\nリモートへはプッシュしません。',
    );
    expect((await createTagHelp.getCSSProperty('white-space')).value).toBe('pre-line');
    expect(
      await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="history-createTag-title"]',
        );
        return dialog ? dialog.scrollWidth <= dialog.clientWidth : false;
      }),
    ).toBe(true);
    expect(
      await browser.execute(
        () =>
          document.activeElement ===
          document.querySelector('[role="dialog"] input[aria-label="タグ名"]'),
      ),
    ).toBe(true);
    const tagName = 'e2e-v1.0.0';
    await historyActionsDialog.$('input[aria-label="タグ名"]').setValue(tagName);
    await historyActionsDialog.$('button=次へ').click();
    const tagConfirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
    await expect(tagConfirmation).toBeDisplayed();
    await expect(historyActionsDialog).not.toExist();
    await tagConfirmation.$('button=作成').click();
    await expect(tagConfirmation).not.toExist();
    await setLogicalWindowSize(1180, 760);
    await expect($(`.ref-chip.tag[aria-label="タグ ${tagName}"]`)).toHaveText(tagName);
    expect(await runGit(repositoryPath, ['rev-parse', `refs/tags/${tagName}`])).toMatch(
      /^[0-9a-f]{40}\n$/u,
    );
    expect(
      await browser.execute(() => {
        const active = document.activeElement;
        return {
          tagName: active?.tagName,
          isCommitRow: active?.classList.contains('commit-row'),
          ariaLabel: active?.getAttribute('aria-label'),
        };
      }),
    ).toEqual({ tagName: 'BUTTON', isCommitRow: true, ariaLabel: null });

    const branchName = 'history-double-click';
    await $('.branch-toggle').click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    const createBranchButton = switcher.$('button=作成');
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
    await branchConfirmation.$('button=作成').click();
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

    await $('button=差分').click();
    await expect($('.diff-view')).toBeDisplayed();
  });
});
