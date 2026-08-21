import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { join } from 'node:path';

import {
  debugAt,
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

const visualQaDirectory =
  process.env.STELLA_TEST_MODE === 'scr'
    ? (process.env.STELLA_SCREENSHOT_OUTPUT ?? 'screenshots')
    : undefined;

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
  const next = dialog.$('button=次へ');
  await next.waitForClickable();
  await next.click();
  const confirmation = $('[role="alertdialog"][aria-labelledby="action-preview-title"]');
  const runtimeError = $('[role="alertdialog"][aria-labelledby="runtime-error-title"]');
  await browser.waitUntil(
    async () => (await confirmation.isDisplayed()) || (await runtimeError.isDisplayed()),
    { timeoutMsg: `The ${kind} preview did not finish.` },
  );
  if (await runtimeError.isDisplayed()) throw new Error(await runtimeError.getText());
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
  let fixtureHeadOid = '';

  beforeEach(async () => {
    fixturePath = await createFixtureDirectory('history');
    repositoryPath = await copyE2EShowcaseRepository(fixturePath, 'major-league-baseball');
    await writeRepositoryFile(
      repositoryPath,
      'CHANGELOG.md',
      `${Array.from({ length: 120 }, (_, index) => `History layout line ${index + 1}`).join('\n')}\n`,
    );
    await runGit(repositoryPath, ['add', 'CHANGELOG.md']);
    await runGit(repositoryPath, ['commit', '--amend', '--no-edit']);
    fixtureHeadOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    await resetApp({ language: 'ja', appearance: 'dark', stickyFileHeaders: true });
    await openRepository(repositoryPath);
  });

  afterEach(async () => {
    await removeFixture(fixturePath);
    fixturePath = '';
    repositoryPath = '';
    fixtureHeadOid = '';
  });

  it('loads History incrementally and keeps every visible graph painted while scrolling', async () => {
    const expectedCommitCount = Number(
      (await runGit(repositoryPath, ['rev-list', '--all', '--count'])).trim(),
    );
    await $('button=履歴').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const list = document.querySelector<HTMLElement>('.commit-list');
          return (
            document.querySelectorAll('.history-commit-item').length > 0 &&
            list?.getAttribute('aria-busy') === 'false'
          );
        }),
      { timeout: 20_000, timeoutMsg: 'The initial History page was not painted.' },
    );
    const initialCommitCount = await browser.execute(
      () => document.querySelectorAll('.history-commit-item').length,
    );
    expect(initialCommitCount).toBeLessThan(expectedCommitCount);

    await browser.waitUntil(
      async () =>
        browser.execute((count) => {
          const list = document.querySelector<HTMLOListElement>('.commit-list');
          const loaded = document.querySelectorAll('.history-commit-item').length;
          const idle = list?.getAttribute('aria-busy') === 'false';
          if (list && loaded < count && idle) list.scrollTop = list.scrollHeight;
          return loaded === count && idle;
        }, expectedCommitCount),
      {
        timeout: 30_000,
        timeoutMsg: 'History did not finish loading after scrolling to each page end.',
      },
    );

    const graphAfterScroll = await browser.executeAsync<
      {
        busy: string | null;
        invalidVisibleEdgeGeometry: number;
        maxSvgPerGraph: number;
        missingVisibleGraphs: number;
        visibleRowCount: number;
        willChange: string;
      },
      []
    >((done) => {
      const list = document.querySelector<HTMLOListElement>('.commit-list');
      if (!list) throw new Error('The History list was not found.');
      const positions = [0.9, 0.1, 0.8, 0.2, 0.7, 0.3, 0.95, 0.05, 0.75, 0.25];
      let index = 0;
      let invalidVisibleEdgeGeometry = 0;
      let missingVisibleGraphs = 0;
      let visibleRowCount = 0;
      const inspect = (): void => {
        const listBounds = list.getBoundingClientRect();
        const visibleRows = [
          ...document.querySelectorAll<HTMLElement>('.history-commit-item'),
        ].filter((row) => {
          const bounds = row.getBoundingClientRect();
          return bounds.bottom > listBounds.top && bounds.top < listBounds.bottom;
        });
        visibleRowCount = visibleRows.length;
        missingVisibleGraphs = Math.max(
          missingVisibleGraphs,
          visibleRows.filter(
            (row) =>
              !row.querySelector('.history-graph-node') ||
              row.querySelectorAll('.history-graph-canvas').length !== 1,
          ).length,
        );
        invalidVisibleEdgeGeometry = Math.max(
          invalidVisibleEdgeGeometry,
          visibleRows
            .flatMap((row) => Array.from(row.querySelectorAll<SVGLineElement>('line')))
            .filter((line) => line.getBBox().height <= 0).length,
        );
        if (index === positions.length) {
          const graphs = [...document.querySelectorAll<HTMLElement>('.history-graph')];
          done({
            busy: list.getAttribute('aria-busy'),
            invalidVisibleEdgeGeometry,
            maxSvgPerGraph: Math.max(
              ...graphs.map((graph) => graph.querySelectorAll('svg').length),
            ),
            missingVisibleGraphs,
            visibleRowCount,
            willChange: getComputedStyle(list).willChange,
          });
          return;
        }
        list.scrollTop = Math.round((list.scrollHeight - list.clientHeight) * positions[index]!);
        index += 1;
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    });
    expect(graphAfterScroll).toMatchObject({
      busy: 'false',
      invalidVisibleEdgeGeometry: 0,
      maxSvgPerGraph: 1,
      missingVisibleGraphs: 0,
      visibleRowCount: expect.any(Number),
      willChange: 'scroll-position',
    });
    expect(graphAfterScroll.visibleRowCount).toBeGreaterThan(0);
  });

  it('moves exactly once for every rapid History arrow-key event', async () => {
    await $('button=履歴').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const list = document.querySelector<HTMLElement>('.commit-list');
          return (
            document.querySelectorAll('.history-commit-item').length >= 4 &&
            list?.getAttribute('aria-busy') === 'false'
          );
        }),
      { timeout: 20_000, timeoutMsg: 'History was not ready for keyboard navigation.' },
    );

    const movement = await browser.executeAsync<
      { focusedIndex: number; initialIndex: number; selectedIndex: number },
      []
    >((done) => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-history-commit-oid]')];
      const initialIndex = rows.findIndex((row) => row.getAttribute('aria-current') === 'true');
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      for (let index = 0; index < 3; index += 1) {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        );
      }
      requestAnimationFrame(() => {
        done({
          focusedIndex: rows.findIndex((row) => row === document.activeElement),
          initialIndex,
          selectedIndex: rows.findIndex((row) => row.getAttribute('aria-current') === 'true'),
        });
      });
    });

    expect(movement.initialIndex).toBeGreaterThanOrEqual(0);
    expect(movement.focusedIndex).toBe(movement.initialIndex + 3);
    expect(movement.selectedIndex).toBe(movement.initialIndex + 3);
  });

  it('keeps keyboard selection and scrolling frame-stable while commit details update', async () => {
    await $('button=履歴').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const list = document.querySelector<HTMLElement>('.commit-list');
          return (
            document.querySelectorAll('.history-commit-item').length >= 13 &&
            list?.getAttribute('aria-busy') === 'false'
          );
        }),
      { timeout: 20_000, timeoutMsg: 'History was not ready for measured keyboard navigation.' },
    );
    await $('.commit-detail-heading .history-action-trigger').waitForEnabled({ timeout: 20_000 });

    const movement = await browser.executeAsync<
      {
        maxDispatchDuration: number;
        maxRowHeight: number;
        maxScrollDelta: number;
        samples: Array<{
          expectedIndex: number;
          focused: boolean;
          selectedIndex: number;
          visible: boolean;
        }>;
      },
      []
    >((done) => {
      const list = document.querySelector<HTMLOListElement>('.commit-list');
      const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-history-commit-oid]')];
      if (!list) throw new Error('The History list was not found.');
      rows[0]?.click();
      rows[0]?.focus({ preventScroll: true });
      list.scrollTop = 0;
      const initialIndex = 0;
      const stepCount = Math.min(12, rows.length - initialIndex - 1);
      const samples: Array<{
        expectedIndex: number;
        focused: boolean;
        selectedIndex: number;
        visible: boolean;
      }> = [];
      let maxDispatchDuration = 0;
      let maxRowHeight = 0;
      let maxScrollDelta = 0;
      let step = 0;

      const move = (): void => {
        if (step === stepCount) {
          done({ maxDispatchDuration, maxRowHeight, maxScrollDelta, samples });
          return;
        }
        const previousScrollTop = list.scrollTop;
        const startedAt = performance.now();
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        );
        maxDispatchDuration = Math.max(maxDispatchDuration, performance.now() - startedAt);
        step += 1;
        requestAnimationFrame(() => {
          const selectedIndex = rows.findIndex(
            (row) => row.getAttribute('aria-current') === 'true',
          );
          const selected = rows[selectedIndex];
          const listBounds = list.getBoundingClientRect();
          const selectedBounds = selected?.getBoundingClientRect();
          maxRowHeight = Math.max(maxRowHeight, selectedBounds?.height ?? 0);
          maxScrollDelta = Math.max(maxScrollDelta, Math.abs(list.scrollTop - previousScrollTop));
          samples.push({
            expectedIndex: initialIndex + step,
            focused: selected === document.activeElement,
            selectedIndex,
            visible: Boolean(
              selectedBounds &&
              selectedBounds.top >= listBounds.top - 1 &&
              selectedBounds.bottom <= listBounds.bottom + 1,
            ),
          });
          requestAnimationFrame(move);
        });
      };
      requestAnimationFrame(move);
    });

    expect(movement.samples).toHaveLength(12);
    expect(movement.samples.every((sample) => sample.selectedIndex === sample.expectedIndex)).toBe(
      true,
    );
    expect(movement.samples.every((sample) => sample.focused && sample.visible)).toBe(true);
    expect(movement.maxScrollDelta).toBeLessThanOrEqual(movement.maxRowHeight + 1);
    expect(movement.maxDispatchDuration).toBeLessThan(16);
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
    const fixtureHeadCommit = $(`[data-history-commit-oid="${fixtureHeadOid}"]`);
    await fixtureHeadCommit.waitForDisplayed({ timeout: 20_000 });
    await fixtureHeadCommit.click();
    await browser.waitUntil(
      () =>
        browser.execute((oid) => {
          const selected = document.querySelector<HTMLElement>(
            '.history-commit-item.is-current [data-history-commit-oid]',
          );
          return (
            selected?.dataset.historyCommitOid === oid &&
            [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')].some(
              (host) => host.shadowRoot?.textContent?.includes('History layout line 120'),
            )
          );
        }, fixtureHeadOid),
      { timeout: 20_000, timeoutMsg: 'The amended History commit details did not render.' },
    );

    const scrollState = await browser.execute(() => {
      const detailPane = document.querySelector<HTMLElement>('.commit-detail-pane');
      const diffSurfaces = detailPane?.querySelectorAll<HTMLElement>('.diff-surface');
      const diffSurface = diffSurfaces?.[0];
      const lastDiffSurface = diffSurfaces?.[diffSurfaces.length - 1];
      if (!detailPane || !diffSurface) throw new Error('The History right pane was not found.');

      const lastDiffHost = lastDiffSurface?.querySelector<HTMLElement>('diffs-container');
      if (!lastDiffHost) throw new Error('The final History diff was not found.');
      const lastDiffCode = lastDiffHost.shadowRoot?.querySelector<HTMLElement>('[data-code]');
      if (!lastDiffCode) throw new Error('The final History diff code was not found.');

      detailPane.scrollTop = detailPane.scrollHeight - detailPane.clientHeight;
      const paneBounds = detailPane.getBoundingClientRect();
      const lastDiffBounds = lastDiffHost.getBoundingClientRect();
      return {
        detailOverflowY: getComputedStyle(detailPane).overflowY,
        detailHasOverflow: detailPane.scrollHeight > detailPane.clientHeight,
        detailAtEnd:
          Math.abs(detailPane.scrollTop - (detailPane.scrollHeight - detailPane.clientHeight)) <= 1,
        diffOverflowY: getComputedStyle(diffSurface).overflowY,
        diffHostAllowsVerticalScrollChaining:
          getComputedStyle(lastDiffHost).overscrollBehaviorY !== 'none',
        diffCodeAllowsVerticalScrollChaining:
          getComputedStyle(lastDiffCode).overscrollBehaviorY !== 'none',
        lastDiffAtPaneEnd:
          lastDiffBounds.bottom <= paneBounds.bottom + 1 &&
          lastDiffBounds.bottom >= paneBounds.top - 1 &&
          lastDiffBounds.top <= paneBounds.bottom + 1,
      };
    });

    expect(scrollState).toEqual({
      detailOverflowY: 'auto',
      detailHasOverflow: true,
      detailAtEnd: true,
      diffOverflowY: 'visible',
      diffHostAllowsVerticalScrollChaining: true,
      diffCodeAllowsVerticalScrollChaining: true,
      lastDiffAtPaneEnd: true,
    });
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
        join(visualQaDirectory, 'history', 'commit-body-1180x760.png'),
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
        join(visualQaDirectory, 'history', 'graph-and-branch-dark-1180x760.png'),
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
        join(visualQaDirectory, 'history', 'graph-and-branch-light-1180x760.png'),
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
    const refTargetOid = fixtureHeadOid;
    const graphTargetOid = (await runGit(repositoryPath, ['rev-parse', '50-50^'])).trim();
    const secondParentOid = (
      await runGit(repositoryPath, ['rev-parse', `${graphTargetOid}^2`])
    ).trim();
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    await browser.waitUntil(
      () =>
        browser.execute(
          ({ branchNames, oid }) => {
            const commit = document
              .querySelector<HTMLElement>(`[data-history-commit-oid="${oid}"]`)
              ?.closest<HTMLElement>('.history-commit-item');
            return branchNames.every((branchName) => commit?.textContent?.includes(branchName));
          },
          { branchNames: overflowBranchNames, oid: refTargetOid },
        ),
      { timeout: 10_000, timeoutMsg: 'The overflow refs were not shown in History.' },
    );
    const graphTarget = $(`[data-history-commit-oid="${graphTargetOid}"]`);
    await graphTarget.waitForDisplayed({ timeout: 20_000 });
    const secondParent = $(`[data-history-commit-oid="${secondParentOid}"]`);
    await secondParent.waitForDisplayed({ timeout: 20_000 });
    const graphLayout = await browser.execute(
      ({ mergeOid, secondParentOid: targetSecondParentOid }) => {
        const mergeCommit = document
          .querySelector<HTMLElement>(`[data-history-commit-oid="${mergeOid}"]`)
          ?.closest<HTMLElement>('.history-commit-item');
        const secondParentCommit = document
          .querySelector<HTMLElement>(`[data-history-commit-oid="${targetSecondParentOid}"]`)
          ?.closest<HTMLElement>('.history-commit-item');
        const mergeLane =
          mergeCommit?.querySelector<HTMLElement>('.history-graph-node')?.dataset.nodeLane;
        const secondParentLane =
          secondParentCommit?.querySelector<HTMLElement>('.history-graph-node')?.dataset.nodeLane;
        const corner =
          mergeLane && secondParentLane
            ? mergeCommit?.querySelector<SVGPathElement>(
                `.history-graph-edge.parent[data-from-lane="${mergeLane}"][data-to-lane="${secondParentLane}"]`,
              )
            : undefined;
        const vertical = secondParentLane
          ? mergeCommit?.querySelector<SVGPathElement>(
              `.history-graph-edge.parent-vertical[data-to-lane="${secondParentLane}"]`,
            )
          : undefined;
        const yamamotoBranch = [
          ...document.querySelectorAll<HTMLElement>('.history-commit-item'),
        ].find((commit) => commit.textContent?.includes('ヤンキース戦で7回無失点7奪三振'));
        const yamamotoBase = [
          ...document.querySelectorAll<HTMLElement>('.history-commit-item'),
        ].find((commit) => commit.textContent?.includes('5回無失点8奪三振でMLB初勝利'));
        const branchLane =
          yamamotoBranch?.querySelector<HTMLElement>('.history-graph-node')?.dataset.nodeLane;
        const baseLane =
          yamamotoBase?.querySelector<HTMLElement>('.history-graph-node')?.dataset.nodeLane;
        const branchContinuesVertically = branchLane
          ? yamamotoBranch?.querySelector(
              `.history-graph-edge.parent[data-from-lane="${branchLane}"][data-to-lane="${branchLane}"]`,
            )
          : undefined;
        const baseStartsDiagonally =
          branchLane && baseLane
            ? yamamotoBase?.querySelector(
                `.history-graph-edge.incoming[data-from-lane="${branchLane}"][data-to-lane="${baseLane}"]`,
              )
            : undefined;
        if (!corner || !vertical) return null;
        const cornerRect = corner.getBoundingClientRect();
        const verticalRect = vertical.getBoundingClientRect();
        return {
          mergeLane,
          secondParentLane,
          cornerHeight: cornerRect.height,
          cornerPath: corner.getAttribute('d'),
          cornerToVerticalGap: Math.abs(cornerRect.bottom - verticalRect.top),
          branchContinuesVertically: Boolean(branchContinuesVertically),
          baseStartsDiagonally: Boolean(baseStartsDiagonally),
        };
      },
      { mergeOid: graphTargetOid, secondParentOid },
    );
    const refLayout = await browser.execute((oid) => {
      const targetCommit = document
        .querySelector<HTMLElement>(`[data-history-commit-oid="${oid}"]`)
        ?.closest<HTMLElement>('.history-commit-item');
      const refs = [...(targetCommit?.querySelectorAll<HTMLElement>('.ref-chip') ?? [])];
      const refList = targetCommit?.querySelector<HTMLElement>('.ref-list');
      if (!refList || refs.length === 0) return null;
      const refListRect = refList.getBoundingClientRect();
      const visibleRefs = refs.filter(
        (ref) => ref.getBoundingClientRect().bottom <= refListRect.bottom + 1,
      );
      return {
        refRows: new Set(refs.map((ref) => Math.round(ref.getBoundingClientRect().top))).size,
        visibleRefRows: new Set(
          visibleRefs.map((ref) => Math.round(ref.getBoundingClientRect().top)),
        ).size,
        hasClippedRefs: refList.scrollHeight > refList.clientHeight,
        visibleRefsAreComplete: visibleRefs.every((ref) => ref.scrollWidth <= ref.clientWidth + 1),
      };
    }, refTargetOid);

    expect(graphLayout).toEqual(
      expect.objectContaining({
        cornerHeight: 8,
        cornerToVerticalGap: 0,
        branchContinuesVertically: true,
        baseStartsDiagonally: true,
      }),
    );
    expect(graphLayout?.cornerPath).toBe(
      `M ${6 + Number(graphLayout?.mergeLane) * 12} 0 L ${6 + Number(graphLayout?.secondParentLane) * 12} 8`,
    );
    expect(refLayout).toEqual(
      expect.objectContaining({
        visibleRefRows: 3,
        hasClippedRefs: true,
        visibleRefsAreComplete: true,
      }),
    );
    expect(refLayout?.refRows).toBeGreaterThan(3);
  });

  it('shows several branch tips that have not been merged', async () => {
    const branchNames = ['darvish-mlb-debut', 'family-news', 'ohtani-mlb-debut', 'senga-mlb-debut'];
    const mainOid = (await runGit(repositoryPath, ['rev-parse', 'main'])).trim();
    const branchTipOids = await Promise.all(
      branchNames.map(async (name) => ({
        name,
        oid: (await runGit(repositoryPath, ['rev-parse', name])).trim(),
      })),
    );
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
    const mainCommit = $(`[data-history-commit-oid="${mainOid}"]`);
    await mainCommit.waitForDisplayed({ timeout: 20_000 });
    await expect(mainCommit).toHaveText(
      expect.stringContaining('feat: ドジャースがワールドシリーズ2連覇'),
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
            oid: row?.querySelector<HTMLElement>('[data-history-commit-oid]')?.dataset
              .historyCommitOid,
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
      branchTipOids.map(({ name, oid }) => ({
        name,
        oid,
        incomingEdges: 0,
        continuesToParent: true,
      })),
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
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await expect($('.branch-toggle')).toHaveText('e2e-cherry-target');
    await runGit(repositoryPath, ['switch', currentBranch]);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await expect($('.branch-toggle')).toHaveText(currentBranch);
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
    this.timeout(process.env.STELLA_E2E_BREAKPOINT ? 2_147_483_646 : 120_000);
    const multiFileCommitOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    const mainSecondParentOid = (
      await runGit(repositoryPath, ['rev-parse', `${multiFileCommitOid}^2`])
    ).trim();
    const familyNewsOid = (await runGit(repositoryPath, ['rev-parse', 'family-news'])).trim();
    const fiftyFiftyOid = (await runGit(repositoryPath, ['rev-parse', '50-50'])).trim();
    await $('button=履歴').click();
    const multiFileCommit = $(`[data-history-commit-oid="${multiFileCommitOid}"]`);
    await multiFileCommit.waitForDisplayed({ timeout: 20_000 });
    const mainSecondParentCommit = $(`[data-history-commit-oid="${mainSecondParentOid}"]`);
    await mainSecondParentCommit.waitForDisplayed({ timeout: 20_000 });
    await expect($('.history-view')).toBeDisplayed();
    await expect($('button[aria-label="履歴"]')).toHaveAttribute('aria-current', 'page');
    await expect($('.repository-toggle')).toHaveText(
      expect.stringContaining('major-league-baseball'),
    );
    await expect(multiFileCommit).toHaveText(
      expect.stringContaining('feat: ドジャースがワールドシリーズ2連覇'),
    );
    await expect(multiFileCommit).toHaveText(expect.stringContaining('山本由伸'));
    await browser.waitUntil(
      async () => (await $('.commit-list').getText()).includes('feat: 第一子誕生を発表'),
      { timeout: 10_000, timeoutMsg: 'The first-child branch was not shown in History.' },
    );
    expect((await runGit(repositoryPath, ['rev-parse', 'family-news^'])).trim()).toBe(
      (await runGit(repositoryPath, ['rev-parse', '50-50'])).trim(),
    );
    expect(
      await browser.execute(
        () =>
          [...document.querySelectorAll<HTMLElement>('.history-commit-item')].filter((commit) =>
            commit.textContent?.includes('feat: 50本塁打・50盗塁 (50-50) を達成'),
          ).length,
      ),
    ).toBe(1);
    const postseasonSeries = (await runGit(repositoryPath, ['log', '--all', '--format=%s%x1f%P']))
      .trim()
      .split('\n')
      .map((line) => line.split('\x1f'))
      .filter(([subject]) => /^feat: (?:WCS|DS|LCS) /u.test(subject ?? ''))
      .map(([subject, parents]) => ({
        subject,
        parentCount: parents?.split(' ').length,
      }))
      .toSorted((left, right) => left.subject!.localeCompare(right.subject!, 'ja'));
    expect(postseasonSeries).toEqual(
      [
        'feat: WCS ドジャース2勝0敗・レッズ0勝2敗',
        'feat: WCS カブス2勝1敗・パドレス1勝2敗',
        'feat: WCS タイガース2勝1敗・ガーディアンズ1勝2敗',
        'feat: WCS ヤンキース2勝1敗・レッドソックス1勝2敗',
        'feat: DS ブルージェイズ3勝1敗・ヤンキース1勝3敗',
        'feat: DS ドジャース3勝1敗・フィリーズ1勝3敗',
        'feat: DS マリナーズ3勝2敗・タイガース2勝3敗',
        'feat: DS ブルワーズ3勝2敗・カブス2勝3敗',
        'feat: LCS ドジャース4勝0敗・ブルワーズ0勝4敗',
        'feat: LCS ブルージェイズ4勝3敗・マリナーズ3勝4敗',
      ]
        .map((subject) => ({ subject, parentCount: 2 }))
        .toSorted((left, right) => left.subject.localeCompare(right.subject, 'ja')),
    );
    const showcaseBranch = await browser.execute(
      ({
        familyNewsOid: targetFamilyNewsOid,
        fiftyFiftyOid: targetFiftyFiftyOid,
        mainOid,
        mainSecondParentOid: targetMainSecondParentOid,
      }) => {
        const commits = [...document.querySelectorAll<HTMLElement>('.history-commit-item')];
        const postseasonBase = commits.find((commit) =>
          commit.textContent?.includes('feat: ドジャースがナ・リーグ西地区4連覇'),
        );
        const familyNews = document
          .querySelector<HTMLElement>(`[data-history-commit-oid="${targetFamilyNewsOid}"]`)
          ?.closest<HTMLElement>('.history-commit-item');
        const fiftyFifty = document
          .querySelector<HTMLElement>(`[data-history-commit-oid="${targetFiftyFiftyOid}"]`)
          ?.closest<HTMLElement>('.history-commit-item');
        const mainCommit = document
          .querySelector<HTMLElement>(`[data-history-commit-oid="${mainOid}"]`)
          ?.closest<HTMLElement>('.history-commit-item');
        const targetMainSecondParentCommit = document
          .querySelector<HTMLElement>(`[data-history-commit-oid="${targetMainSecondParentOid}"]`)
          ?.closest<HTMLElement>('.history-commit-item');
        const mainNode = mainCommit?.querySelector<HTMLElement>('.history-graph-node');
        const mainSecondParentNode =
          targetMainSecondParentCommit?.querySelector<HTMLElement>('.history-graph-node');
        const familyNewsNode = familyNews?.querySelector<HTMLElement>('.history-graph-node');
        const fiftyFiftyNode = fiftyFifty?.querySelector<HTMLElement>('.history-graph-node');
        const postseasonBaseNode =
          postseasonBase?.querySelector<HTMLElement>('.history-graph-node');
        const mainLane = mainNode?.dataset.nodeLane;
        const mainSecondParentLane = mainSecondParentNode?.dataset.nodeLane;
        const familyNewsLane = familyNewsNode?.dataset.nodeLane;
        const fiftyFiftyLane = fiftyFiftyNode?.dataset.nodeLane;
        const postseasonBaseLane = postseasonBaseNode?.dataset.nodeLane;
        const branchReturnEdge =
          familyNewsLane && fiftyFiftyLane
            ? fiftyFifty?.querySelector<SVGPathElement>(
                `.history-graph-edge.incoming[data-from-lane="${familyNewsLane}"][data-to-lane="${fiftyFiftyLane}"]`,
              )
            : undefined;
        const mainSecondParentEdge =
          mainLane && mainSecondParentLane
            ? mainCommit?.querySelector<SVGPathElement>(
                `.history-graph-edge.parent[data-from-lane="${mainLane}"][data-to-lane="${mainSecondParentLane}"]`,
              )
            : undefined;
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
          mainLane,
          mainSecondParentLane,
          familyNewsLane,
          fiftyFiftyLane,
          postseasonBaseLane,
          branch: familyNews?.querySelector<HTMLElement>('.ref-chip.branch')?.textContent,
          branches: [...document.querySelectorAll<HTMLElement>('.ref-chip.branch')].map(
            (ref) => ref.textContent,
          ),
          mainColor: mainNode ? getComputedStyle(mainNode).borderColor : undefined,
          mainSecondParentColor: mainSecondParentNode
            ? getComputedStyle(mainSecondParentNode).borderColor
            : undefined,
          mainSecondParentEdgeColor: mainSecondParentEdge
            ? getComputedStyle(mainSecondParentEdge).stroke
            : undefined,
          firstChildColor: familyNewsNode
            ? getComputedStyle(familyNewsNode).borderColor
            : undefined,
          branchReturnEdgeColor: branchReturnEdge
            ? getComputedStyle(branchReturnEdge).stroke
            : undefined,
          branchReturnEdgePath: branchReturnEdge?.getAttribute('d'),
          fanOut: [...(mainCommit?.querySelectorAll('[data-edge-kind="parent"]') ?? [])].map(
            (edge) =>
              `${edge.getAttribute('data-from-lane')}->${edge.getAttribute('data-to-lane')}`,
          ),
          fanIn: [...(postseasonBase?.querySelectorAll('[data-edge-kind="incoming"]') ?? [])].map(
            (edge) =>
              `${edge.getAttribute('data-from-lane')}->${edge.getAttribute('data-to-lane')}`,
          ),
          maxNodeTitleOffset: Math.max(...nodeTitleOffsets),
        };
      },
      { familyNewsOid, fiftyFiftyOid, mainOid: multiFileCommitOid, mainSecondParentOid },
    );
    expect(showcaseBranch).toEqual(expect.objectContaining({ branch: 'family-news' }));
    expect(showcaseBranch.branches).toEqual(
      expect.arrayContaining([
        'family-news',
        'yamamoto-yankees',
        'senga-200-strikeouts',
        'seiya-season-debut',
        'postseason-dodgers',
        'postseason-blue-jays',
      ]),
    );
    expect(showcaseBranch.mainLane).toBeTruthy();
    expect(showcaseBranch.mainSecondParentLane).toBeTruthy();
    expect(showcaseBranch.familyNewsLane).toBeTruthy();
    expect(showcaseBranch.fiftyFiftyLane).toBeTruthy();
    expect(showcaseBranch.postseasonBaseLane).toBeTruthy();
    expect(showcaseBranch.familyNewsLane).not.toBe(showcaseBranch.mainLane);
    expect(showcaseBranch.firstChildColor).not.toBe(showcaseBranch.mainColor);
    expect(showcaseBranch.mainSecondParentEdgeColor).toBe(showcaseBranch.mainSecondParentColor);
    expect(showcaseBranch.branchReturnEdgeColor).toBe(showcaseBranch.firstChildColor);
    expect(showcaseBranch.branchReturnEdgePath).toBe(
      `M ${6 + Number(showcaseBranch.familyNewsLane) * 12} 0 L ${6 + Number(showcaseBranch.fiftyFiftyLane) * 12} 8`,
    );
    expect(showcaseBranch.fanOut).toEqual([
      `${showcaseBranch.mainLane}->${showcaseBranch.mainLane}`,
      `${showcaseBranch.mainLane}->${showcaseBranch.mainSecondParentLane}`,
    ]);
    expect(showcaseBranch.fanIn).toHaveLength(12);
    expect(
      showcaseBranch.fanIn.every((edge) => edge.endsWith(`->${showcaseBranch.postseasonBaseLane}`)),
    ).toBe(true);
    expect(showcaseBranch.maxNodeTitleOffset).toBeLessThanOrEqual(0.5);
    await $('.history-commit-item:not(.is-current) .commit-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement ===
            document.querySelector('.history-commit-item.is-current .commit-row'),
        ),
      { timeoutMsg: 'A clicked History commit did not keep focus.' },
    );
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
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '472');
    await historyResizer.click();
    await browser.keys(['ArrowRight']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '480');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );

    const historySearch = $('input[aria-label="履歴を検索"]');
    await expect(historySearch).toBeDisplayed();
    await expect($('.history-list-footer input[aria-label="履歴を検索"]')).toBeDisplayed();
    await expect($('.commit-list-pane .history-list-footer')).toExist();
    expect(
      await browser.execute(() => {
        const footer = document.querySelector<HTMLElement>('.history-list-footer')!;
        const input = footer.querySelector<HTMLInputElement>('.history-search input')!;
        const icon = footer.querySelector<HTMLElement>('.history-search-icon')!;
        const footerRect = footer.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        return {
          footerHeight: footerRect.height,
          insideFooter: inputRect.top >= footerRect.top && inputRect.bottom <= footerRect.bottom,
          leftGap: inputRect.left - footerRect.left,
          rightGap: footerRect.right - inputRect.right,
          sidebarToggleCount: footer.querySelectorAll('.sidebar-toggle-button').length,
          iconInset: icon.getBoundingClientRect().left - inputRect.left,
          inputHeight: inputRect.height,
          inputPaddingLeft: getComputedStyle(input).paddingLeft,
        };
      }),
    ).toEqual({
      footerHeight: 38,
      insideFooter: true,
      leftGap: 6,
      rightGap: 6,
      sidebarToggleCount: 0,
      iconInset: 10,
      inputHeight: 24,
      inputPaddingLeft: '28px',
    });
    await historySearch.setValue('50本塁打');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: 50本塁打・50盗塁 (50-50) を達成'),
    );
    await historySearch.setValue('一致しない検索');
    await expect($('.history-search-empty')).toHaveText('一致する履歴はありません。');
    await historySearch.setValue('');
    await browser.waitUntil(
      () =>
        browser.execute((oid) => {
          const search = document.querySelector<HTMLInputElement>('input[aria-label="履歴を検索"]');
          const list = document.querySelector<HTMLElement>('.commit-list');
          return (
            search?.value === '' &&
            !document.querySelector('.history-search-loading') &&
            list?.getAttribute('aria-busy') === 'false' &&
            Boolean(document.querySelector(`[data-history-commit-oid="${oid}"]`))
          );
        }, multiFileCommitOid),
      {
        timeout: 10_000,
        timeoutMsg: 'The cleared History search did not restore the target commit.',
      },
    );
    await multiFileCommit.click();
    await expect(multiFileCommit).toHaveAttribute('aria-current', 'true');
    await browser.waitUntil(async () => (await historyDiffFileCount()) === 15, {
      timeout: 10_000,
      timeoutMsg: 'The History multi-file diff did not render fifteen files.',
    });
    const historyDiffNames = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('.diff-surface diffs-container')].map(
        (host) =>
          host.querySelector<HTMLElement>('.diff-file-custom-header-title > span:last-child')
            ?.textContent ?? '',
      ),
    );
    expect(historyDiffNames).toEqual([
      'CHANGELOG.md',
      'data/current-champion.json',
      'docs/2025-postseason/ds/blue-jays-yankees.md',
      'docs/2025-postseason/ds/mariners-tigers.md',
      'docs/2025-postseason/lcs/blue-jays-mariners.md',
      'docs/2025-postseason/teams/blue-jays.md',
      'docs/2025-postseason/teams/guardians.md',
      'docs/2025-postseason/teams/mariners.md',
      'docs/2025-postseason/teams/red-sox.md',
      'docs/2025-postseason/teams/tigers.md',
      'docs/2025-postseason/teams/yankees.md',
      'docs/2025-postseason/wcs/tigers-guardians.md',
      'docs/2025-postseason/wcs/yankees-red-sox.md',
      'docs/2025-world-series.md',
      'src/records.ts',
    ]);
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
    await debugAt('history-tag-dialog');
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
    const sourceBranch = switcher.$('[role="option"][aria-current="true"]');
    const sourceBranchName = await sourceBranch.getAttribute('data-switcher-item-label');
    await sourceBranch.click();
    const createBranchButton = switcher.$('button=作成');
    await expect(createBranchButton).toBeEnabled();
    await createBranchButton.click();
    const branchDialog = $('[role="dialog"][aria-labelledby="create-branch-title"]');
    await debugAt('create-branch-dialog');
    await expect(branchDialog).toHaveText(
      expect.stringContaining(
        `ブランチ「${sourceBranchName}」から新しいブランチを作成し、そのブランチへ切り替えます。`,
      ),
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

  it('defers soft commit diffs until each file is expanded', async () => {
    await writeRepositoryFile(
      repositoryPath,
      'history-soft-limit.txt',
      `${Array.from({ length: 20_001 }, (_, index) => `history soft line ${index + 1}`).join('\n')}\n`,
    );
    await runGit(repositoryPath, ['add', 'history-soft-limit.txt']);
    await runGit(repositoryPath, ['commit', '-m', 'test: defer large History diff']);
    const commitOid = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();

    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('button=履歴').click();
    const commit = $(`[data-history-commit-oid="${commitOid}"]`);
    await commit.waitForDisplayed({ timeout: 20_000 });
    await commit.click();

    await expect($('.commit-detail-pane output.inline-alert.warning')).toHaveText(
      expect.stringContaining('差分本文が大きいため初期表示では省略しています。'),
    );
    const softDiffToggle = $('.history-image-file-header .diff-file-collapse-toggle');
    await expect(softDiffToggle).toHaveAttribute('aria-expanded', 'false');
    const controlsId = await softDiffToggle.getAttribute('aria-controls');
    if (!controlsId) throw new Error('The History soft diff toggle has no controlled body.');
    expect(
      await browser.execute((bodyId) => {
        const toggle = document.querySelector(
          '.history-image-file-header .diff-file-collapse-toggle',
        );
        const body = document.getElementById(bodyId);
        return Boolean(body && !body.contains(toggle));
      }, controlsId),
    ).toBe(true);
    await expect($('.history-view .diff-surface')).not.toExist();

    await softDiffToggle.click();
    await expect(softDiffToggle).toHaveAttribute('aria-expanded', 'true');
    await $('.history-view .diff-surface').waitForDisplayed({ timeout: 20_000 });
    await softDiffToggle.click();
    await expect(softDiffToggle).toHaveAttribute('aria-expanded', 'false');
  });
});
