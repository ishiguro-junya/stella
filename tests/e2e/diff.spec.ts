import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  expectAttachedTabs,
  expectInteractiveSelectedColors,
  openRepository,
  resetApp,
  selectSetting,
  setLogicalWindowSize,
} from './support/app.js';
import {
  cloneLocalRemote,
  createFixtureDirectory,
  ensureLocalBareRemote,
  removeFixture,
  runGit,
  writeExecutableRepositoryFile,
  writeRepositoryFile,
} from './support/fixtures.js';
import { copyE2EShowcaseRepository } from './support/showcaseRepository.js';

interface EditorPosition {
  scrollTop: number;
  activeLine: string;
  focused: boolean;
  viewportRatio: number;
}

async function readEditorPosition(): Promise<EditorPosition> {
  return browser.execute(() => {
    const scroller = document.querySelector<HTMLElement>('.file-editor .cm-scroller');
    const activeLine = document.querySelector<HTMLElement>('.file-editor .cm-activeLine');
    const scrollerRect = scroller?.getBoundingClientRect();
    const activeLineRect = activeLine?.getBoundingClientRect();
    return {
      scrollTop: scroller?.scrollTop ?? 0,
      activeLine: activeLine?.textContent ?? '',
      focused: document.activeElement?.classList.contains('cm-content') ?? false,
      viewportRatio:
        scrollerRect && activeLineRect
          ? (activeLineRect.top + activeLineRect.height / 2 - scrollerRect.top) /
            scrollerRect.height
          : 1,
    };
  });
}

// フレーキー: 全E2E実行時にCodeMirrorのレイアウト確定が遅れ、
// activeLineとfocusが正しくてもscrollTopが0のままになることがある。
// 要素の寸法確定を待ってからスクロール位置を検証する。
async function waitForEditorPosition(expectedLine: string): Promise<EditorPosition> {
  let position = await readEditorPosition();
  try {
    await browser.waitUntil(
      async () => {
        position = await readEditorPosition();
        return (
          position.scrollTop > 0 &&
          position.activeLine === expectedLine &&
          position.focused &&
          position.viewportRatio > 0.2 &&
          position.viewportRatio < 0.3
        );
      },
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: `The editor did not settle at ${expectedLine} above center with focus.`,
      },
    );
  } catch (cause) {
    throw new Error(`The editor did not settle at ${expectedLine}: ${JSON.stringify(position)}`, {
      cause,
    });
  }
  return position;
}

async function selectAndExpectImagePreview(path: string, toggleExpected = true): Promise<void> {
  await browser.execute((selectedPath) => {
    const item = [...document.querySelectorAll<HTMLElement>('.change-item')].find((row) =>
      row.querySelector('.file-path strong')?.textContent?.includes(selectedPath),
    );
    item?.querySelector<HTMLButtonElement>('button.change-row')?.click();
  }, path);
  const toggle = $('.diff-file-toolbar button[aria-label="画像プレビュー"]');
  if (toggleExpected) {
    await toggle.waitForDisplayed({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(toggle).not.toExist();
  }
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const image = document.querySelector<HTMLImageElement>('.image-diff-preview img');
        return Boolean(image?.complete && image.naturalWidth > 0);
      }),
    { timeout: 20_000, timeoutMsg: `${path} was not decoded by WebKit.` },
  );
}

describe('Diff', () => {
  let fixturePath = '';
  let repositoryPath = '';

  beforeEach(async () => {
    fixturePath = await createFixtureDirectory('diff');
    repositoryPath = await copyE2EShowcaseRepository(fixturePath);
    await resetApp({ language: 'ja', splitStageView: true });
    await openRepository(repositoryPath);
    await writeRepositoryFile(repositoryPath, 'README.md', '# Stella E2E\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('input[aria-label="ステージ README.md"]').waitForClickable({ timeout: 20_000 });
  });

  afterEach(async () => {
    await removeFixture(fixturePath);
    fixturePath = '';
    repositoryPath = '';
  });

  // フレーキー: フォーカス移動直後の描画が間に合わず、ツールチップが表示されないことがある。
  // フォーカス状態と描画完了を同期してから表示を検証する。
  it('shows the shared rich tooltip for pointer and keyboard use in both themes', async () => {
    const groupToggle = $('.change-group-collapse-toggle');
    await groupToggle.waitForDisplayed();
    await expect(groupToggle).not.toHaveAttribute('title');

    await browser.execute(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.change-group-collapse-toggle')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    const pointerTooltip = $('.app-tooltip');
    const groupToggleLabel = await groupToggle.getAttribute('aria-label');
    if (!groupToggleLabel) throw new Error('The change group toggle has no accessible label.');
    await expect(pointerTooltip).toHaveText(groupToggleLabel);
    const darkStyle = await browser.execute(() => {
      const tooltip = document.querySelector<HTMLElement>('.app-tooltip')!;
      const rect = tooltip.getBoundingClientRect();
      const style = getComputedStyle(tooltip);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        color: style.color,
        arrowColor: getComputedStyle(tooltip, '::after').backgroundColor,
        insideViewport:
          rect.left >= 8 &&
          rect.top >= 8 &&
          rect.right <= window.innerWidth - 8 &&
          rect.bottom <= window.innerHeight - 8,
      };
    });
    expect(darkStyle).toEqual({
      backgroundColor: 'rgb(248, 248, 250)',
      borderRadius: '8px',
      boxShadow: expect.not.stringMatching(/^none$/u),
      color: 'rgb(28, 28, 30)',
      arrowColor: 'rgb(248, 248, 250)',
      insideViewport: true,
    });

    await browser.execute(() => {
      document.documentElement.dataset.theme = 'light';
      document.querySelector<HTMLButtonElement>('.change-group-collapse-toggle')?.focus();
    });
    const keyboardTooltip = $('.app-tooltip');
    await expect(keyboardTooltip).toBeDisplayed();
    expect(
      await browser.execute(() => {
        const tooltip = document.querySelector<HTMLElement>('.app-tooltip')!;
        const style = getComputedStyle(tooltip);
        return { backgroundColor: style.backgroundColor, color: style.color };
      }),
    ).toEqual({ backgroundColor: 'rgb(29, 30, 34)', color: 'rgb(255, 255, 255)' });
    await browser.keys(['Escape']);
    await expect($('.app-tooltip')).not.toExist();

    await browser.execute(() => {
      document.querySelector<HTMLButtonElement>('.sidebar-toggle-button')?.focus();
    });
    const edgeTooltip = $('.app-tooltip');
    await expect(edgeTooltip).toBeDisplayed();
    const edgeMetrics = await browser.execute(() => {
      const rect = document.querySelector<HTMLElement>('.app-tooltip')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(edgeMetrics.left).toBeGreaterThanOrEqual(8);
    expect(edgeMetrics.right).toBeLessThanOrEqual(edgeMetrics.viewportWidth - 8);
    await browser.keys(['Escape']);

    await $('input[aria-label="ステージ README.md"]').click();
    const commitTrigger = $('.diff-action-bar .diff-action-button[aria-label="コミット"]');
    await commitTrigger.waitForClickable({ timeout: 10_000 });
    await commitTrigger.click();
    const dialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
    const closeButton = dialog.$('.dialog-close-button');
    await closeButton.waitForDisplayed({ timeout: 10_000 });
    await browser.execute(() => {
      document.querySelector<HTMLButtonElement>('.dialog-close-button')?.focus();
    });
    const closeButtonLabel = await closeButton.getAttribute('aria-label');
    if (!closeButtonLabel) throw new Error('The dialog close button has no accessible label.');
    await expect($('.app-tooltip')).toHaveText(closeButtonLabel);
    await closeButton.click();
    await expect(dialog).not.toExist();
  });

  it('previews PNG and SVG changes in WebKit while keeping SVG diff and editing available', async () => {
    await writeFile(
      join(repositoryPath, 'preview.png'),
      Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da63fcff1f0003030200efa39dc50000000049454e44ae426082',
        'hex',
      ),
    );
    await writeRepositoryFile(
      repositoryPath,
      'preview.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#087ff5"/></svg>\n',
    );
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('input[aria-label="ステージ preview.png"]').waitForExist({ timeout: 20_000 });
    await $('input[aria-label="ステージ preview.svg"]').waitForExist({ timeout: 20_000 });

    await selectAndExpectImagePreview('preview.png', false);
    await selectAndExpectImagePreview('preview.svg');

    const svgToggle = $('.diff-file-toolbar button[aria-label="画像プレビュー"]');
    const fileModeToggle = $('.diff-file-toolbar button[aria-label="編集"]');
    expect((await svgToggle.getLocation('x')) < (await fileModeToggle.getLocation('x'))).toBe(true);
    await $('.diff-file-toolbar .file-action-trigger').click();
    await $('button=画像をプレビュー').click();
    await expect(svgToggle).toHaveAttribute('aria-pressed', 'false');
    await expect($('.diff-surface')).toBeDisplayed();
    await svgToggle.click();
    await expect(svgToggle).toHaveAttribute('aria-pressed', 'true');
    await $('.diff-file-toolbar button[aria-label="編集"]').click();
    await expect($('.file-editor')).toBeDisplayed();
    const editorImageToggle = $('.file-editor-toolbar button[aria-label="画像プレビュー"]');
    await expect(editorImageToggle).toBeDisabled();
    await $('.file-editor-toolbar .file-action-trigger').click();
    await expect($('button=画像をプレビュー')).toBeDisabled();
  });

  it('defaults to file names with parent paths and keeps keyboard navigation responsive', async () => {
    await writeRepositoryFile(
      repositoryPath,
      'src/keyboard-navigation.md',
      '# Keyboard navigation\n',
    );
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('input[aria-label="ステージ src/keyboard-navigation.md"]').waitForExist();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement ===
            document.querySelector('.change-item.is-current .change-row'),
        ),
      { timeoutMsg: 'The selected Diff file did not receive initial focus.' },
    );

    const initial = await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('.change-item')];
      const selectedIndex = rows.findIndex((row) => row.classList.contains('is-current'));
      const fileItem = rows.find((row) =>
        row.querySelector('.file-path strong')?.textContent?.includes('keyboard-navigation.md'),
      );
      const actionTriggers = rows.map((row) =>
        row.querySelector<HTMLElement>('.row-action-trigger'),
      );
      const fileRow = fileItem?.querySelector<HTMLElement>('.change-row');
      return {
        selectedIndex,
        rowCount: rows.length,
        fileName: fileItem?.querySelector('.file-path strong')?.textContent,
        parentPath: fileItem?.querySelector('.file-path small')?.textContent,
        hasPathPrefix: Boolean(fileItem?.querySelector('.file-path-prefix')),
        isSingleLine: fileRow?.classList.contains('is-single-line'),
        allActionsVisible: actionTriggers.every((trigger) => {
          if (!trigger) return false;
          const style = getComputedStyle(trigger);
          return style.opacity === '1' && style.visibility === 'visible';
        }),
      };
    });
    expect(initial).toEqual({
      selectedIndex: expect.any(Number),
      rowCount: 2,
      fileName: 'keyboard-navigation.md',
      parentPath: 'src',
      hasPathPrefix: false,
      isSingleLine: false,
      allActionsVisible: true,
    });
    expect(initial.selectedIndex).toBeGreaterThanOrEqual(0);

    const direction = initial.selectedIndex === 0 ? 'ArrowDown' : 'ArrowUp';
    const expectedIndex = initial.selectedIndex === 0 ? 1 : 0;
    await browser.keys([direction]);
    expect(
      await browser.execute(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.change-item')];
        const selectedIndex = rows.findIndex((row) => row.classList.contains('is-current'));
        return {
          selectedIndex,
          focused: document.activeElement === rows[selectedIndex]?.querySelector('.change-row'),
        };
      }),
    ).toEqual({ selectedIndex: expectedIndex, focused: true });

    await browser.keys([direction === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown']);
    expect(
      await browser.execute(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.change-item')];
        const selectedIndex = rows.findIndex((row) => row.classList.contains('is-current'));
        return {
          selectedIndex,
          focused: document.activeElement === rows[selectedIndex]?.querySelector('.change-row'),
        };
      }),
    ).toEqual({ selectedIndex: initial.selectedIndex, focused: true });

    await $('.diff-file-toolbar h2').waitForDisplayed();
    await browser.execute(() => window.getSelection()?.removeAllRanges());
    await $('.diff-file-toolbar h2').dragAndDrop(
      $('.change-item:not(.is-current) .file-path strong'),
      { duration: 300 },
    );
    expect(await browser.execute(() => window.getSelection()?.toString() ?? '')).toBe('');

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.change-item:not(.is-current) .row-action-trigger')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    await expect($('.app-tooltip')).toHaveText('その他の操作');
  });

  it('applies line wrapping to the displayed Diff and defaults to no wrapping', async () => {
    await $('button.change-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(root?.querySelector('[data-overflow="scroll"]'));
        }),
      { timeout: 10_000, timeoutMsg: 'The Diff did not default to no wrapping.' },
    );
    await expect($('.diff-surface')).toHaveAttribute('data-line-wrapping', 'false');

    await $('button=設定').click();
    await selectSetting('editor-line-wrapping', 'enabled');
    const wrapColumn = $('input[name="editor-wrap-column"]');
    await wrapColumn.setValue('80');
    await $('button=差分').click();

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const host = document.querySelector<HTMLElement>('.diff-surface');
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
      { timeout: 10_000, timeoutMsg: 'The Diff did not apply the wrapping settings.' },
    );
    await expect($('.diff-surface')).toHaveAttribute('data-wrap-column', '80');
  });

  // フレーキー: 設定保存後のスナップショット更新が遅れ、対象ファイルが10秒以内に消えないことがある。
  // 保存完了とスナップショット更新を待ってから表示を検証する。
  it('applies the global ignore list without changing plain Git behavior', async () => {
    const ignoredPath = 'stella-e2e-only.ignore';
    await writeRepositoryFile(repositoryPath, ignoredPath, 'ignored by Stella\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    const stageIgnoredFile = `input[aria-label="ステージ ${ignoredPath}"]`;
    await $(stageIgnoredFile).waitForExist();

    await $('button=設定').click();
    await $('button[data-settings-category="git"]').click();
    const ignorePatterns = $('textarea[name="ignore-patterns"]');
    await ignorePatterns.waitForEnabled();
    const originalPatterns = await ignorePatterns.getValue();
    const testPatterns = `${originalPatterns}${originalPatterns.endsWith('\n') ? '' : '\n'}${ignoredPath}`;

    try {
      await ignorePatterns.setValue(testPatterns);
      await browser.keys(['Tab']);
      await ignorePatterns.waitForEnabled();
      await $('button=差分').click();
      await $(stageIgnoredFile).waitForExist({ reverse: true, timeout: 10_000 });
      expect(await runGit(repositoryPath, ['status', '--short'])).toContain(ignoredPath);
    } finally {
      await $('button=設定').click();
      await $('button[data-settings-category="git"]').click();
      const restorePatterns = $('textarea[name="ignore-patterns"]');
      await restorePatterns.waitForEnabled();
      await restorePatterns.setValue(originalPatterns);
      await browser.keys(['Tab']);
      await restorePatterns.waitForEnabled();
      await $('button=差分').click();
      await $(stageIgnoredFile).waitForExist({ timeout: 10_000 });
    }
  });

  it('commits every change when Stage display is hidden', async () => {
    await $('button=設定').click();
    await selectSetting('stage-display', 'hide');
    await $('button=差分').click();
    await expect($('input[aria-label^="ステージ "]')).not.toExist();

    const trigger = $('.diff-action-bar .diff-action-button[aria-label="コミット"]');
    await trigger.click();
    const dialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
    await dialog.$('[data-commit-field="description"]').setValue('全変更をコミットする');
    await dialog.$('.commit-form button[type="submit"]').click();

    await expect(dialog).not.toExist();
    await browser.waitUntil(
      async () => (await runGit(repositoryPath, ['status', '--short'])) === '',
      {
        timeout: 10_000,
        timeoutMsg: 'Stage displayなしのCommit後も変更が残っています。',
      },
    );
    expect(await runGit(repositoryPath, ['show', 'HEAD:README.md'])).toBe('# Stella E2E\n');
  });

  it('opens the Pull dialog after remote branches load and keeps refresh stationary', async () => {
    const remotePath = `${fixturePath}/layout-shift-remote.git`;
    await ensureLocalBareRemote(repositoryPath, remotePath);
    await runGit(repositoryPath, ['update-ref', '-d', 'refs/remotes/origin/main']);
    await writeRepositoryFile(repositoryPath, 'refresh-generation.txt', 'refresh\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('input[aria-label="ステージ refresh-generation.txt"]').waitForExist();
    await browser.execute(() => {
      const observer = new MutationObserver(() => {
        const dialog = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="pull-dialog-title"]',
        );
        if (!dialog) return;
        const busy =
          dialog.querySelector('.remote-operation-form')?.getAttribute('aria-busy') === 'true';
        const data = document.documentElement.dataset;
        if (busy) data.pullDialogRenderedBusy = 'true';
        if (
          !dialog.querySelector('.remote-operation-empty-row') ||
          data.pullDialogReadyTop !== undefined
        )
          return;
        const rect = dialog.getBoundingClientRect();
        data.pullDialogReadyTop = String(rect.top);
        data.pullDialogReadyHeight = String(rect.height);
        data.pullDialogInputHeight = String(
          dialog.querySelector('#pull-local-branch')?.getBoundingClientRect().height,
        );
        data.pullDialogRefreshButtonHeight = String(
          dialog.querySelector('.remote-operation-refresh-button')?.getBoundingClientRect().height,
        );
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.querySelector<HTMLButtonElement>('.diff-action-button[aria-label="プル"]')?.click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => document.documentElement.dataset.pullDialogReadyTop !== undefined),
      { timeoutMsg: 'Pull dialog did not finish loading remote branches.' },
    );
    const positions = await browser.execute(() => {
      const data = document.documentElement.dataset;
      return {
        inputHeight: Number(data.pullDialogInputHeight),
        refreshButtonHeight: Number(data.pullDialogRefreshButtonHeight),
      };
    });
    expect(
      await browser.execute(
        () => document.documentElement.dataset.pullDialogRenderedBusy === 'true',
      ),
    ).toBe(false);
    expect(positions.inputHeight).toBe(36);
    expect(positions.refreshButtonHeight).toBe(positions.inputHeight);
    await expect($('#pull-local-branch')).toBeDisabled();
    await expect($('#pull-local-branch')).toHaveValue('main');
    await expect($('.remote-operation-empty-row')).toBeDisplayed();

    await browser.execute(() => {
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-labelledby="pull-dialog-title"]',
      );
      const source = dialog?.querySelector<HTMLElement>('.remote-operation-source');
      const refresh = dialog?.querySelector<HTMLButtonElement>('.remote-operation-refresh-button');
      if (!dialog || !source || !refresh) return;
      const baseline = {
        dialog: dialog.getBoundingClientRect(),
        source: source.getBoundingClientRect(),
      };
      let sawBusy = false;
      const shifted = (): boolean => {
        const currentSource = dialog.querySelector<HTMLElement>('.remote-operation-source');
        if (!currentSource) return true;
        const currentDialogRect = dialog.getBoundingClientRect();
        const currentSourceRect = currentSource.getBoundingClientRect();
        return [
          currentDialogRect.top - baseline.dialog.top,
          currentDialogRect.height - baseline.dialog.height,
          currentSourceRect.top - baseline.source.top,
        ].some((delta) => Math.abs(delta) > 0.5);
      };
      const observer = new MutationObserver(() => {
        if (shifted()) document.documentElement.dataset.pullDialogRefreshShifted = 'true';
        if (refresh.getAttribute('aria-busy') === 'true') sawBusy = true;
        if (sawBusy && refresh.getAttribute('aria-busy') === 'false') {
          document.documentElement.dataset.pullDialogRefreshFinished = 'true';
          observer.disconnect();
        }
      });
      document.documentElement.dataset.pullDialogRefreshShifted = 'false';
      observer.observe(dialog, { attributes: true, childList: true, subtree: true });
      refresh.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.documentElement.dataset.pullDialogRefreshFinished === 'true',
        ),
      { timeoutMsg: 'Pull dialog did not finish refreshing remote branches.' },
    );
    expect(
      await browser.execute(
        () => document.documentElement.dataset.pullDialogRefreshShifted === 'true',
      ),
    ).toBe(false);
    const refreshedRemoteBranch = $('#pull-remote-branch');
    await refreshedRemoteBranch.waitForExist();
    await expect(refreshedRemoteBranch).toHaveValue('origin/main');
    expect(
      await browser.execute(() => {
        const localBranch = document.querySelector<HTMLElement>('#pull-local-branch');
        const remoteBranch = document.querySelector<HTMLElement>('#pull-remote-branch');
        if (!localBranch || !remoteBranch) return undefined;
        const disabledStyle = getComputedStyle(localBranch);
        const enabledStyle = getComputedStyle(remoteBranch);
        return {
          equalHeight:
            localBranch.getBoundingClientRect().height ===
            remoteBranch.getBoundingClientRect().height,
          backgroundDiffers: disabledStyle.backgroundColor !== enabledStyle.backgroundColor,
          borderDiffers: disabledStyle.borderColor !== enabledStyle.borderColor,
          boxShadow: disabledStyle.boxShadow,
          cursor: disabledStyle.cursor,
        };
      }),
    ).toEqual({
      equalHeight: true,
      backgroundDiffers: true,
      borderDiffers: true,
      boxShadow: 'none',
      cursor: 'not-allowed',
    });
  });

  it('pulls the selected remote branch through the native adapter', async () => {
    const remotePath = `${fixturePath}/pull-remote.git`;
    await ensureLocalBareRemote(repositoryPath, remotePath);
    const peerPath = await cloneLocalRemote(fixturePath, remotePath, 'pull-peer');
    await writeRepositoryFile(peerPath, 'remote-update.md', 'remote update\n');
    await runGit(peerPath, ['add', 'remote-update.md']);
    await runGit(peerPath, ['commit', '-m', 'test: リモートから更新する']);
    await runGit(peerPath, ['push', 'origin', 'main']);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));

    await $('.diff-action-button[aria-label="プル"]').click();
    const pullDialog = $('[role="dialog"][aria-labelledby="pull-dialog-title"]');
    await expect(pullDialog.$('select')).toHaveValue('origin/main');
    const refreshBranches = pullDialog.$('button[aria-label="ブランチを更新"]');
    await refreshBranches.click();
    await refreshBranches.waitForEnabled();
    await pullDialog.$('button[type="submit"]').click();
    const failureDialog = $('[role="alertdialog"]');
    await browser.waitUntil(
      async () => !(await pullDialog.isExisting()) || (await failureDialog.isExisting()),
      { timeoutMsg: 'Pull did not complete or report a failure.' },
    );
    if (await failureDialog.isExisting()) {
      throw new Error(`Pull failed: ${await failureDialog.getText()}`);
    }
    await expect(pullDialog).not.toExist();
    expect(await runGit(repositoryPath, ['show', 'HEAD:remote-update.md'])).toBe('remote update\n');
  });

  it('opens Pull and Push dialogs and resets Push options when reopened', async () => {
    const remotePath = `${fixturePath}/remote.git`;
    await ensureLocalBareRemote(repositoryPath, remotePath);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));

    await $('.diff-action-button[aria-label="プル"]').click();
    const pullDialog = $('[role="dialog"][aria-labelledby="pull-dialog-title"]');
    await expect(pullDialog).toBeDisplayed();
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.activeElement ===
            document.querySelector(
              '[role="dialog"][aria-labelledby="pull-dialog-title"] button[type="submit"]',
            ),
        ),
      { timeoutMsg: 'Pull action did not receive initial focus.' },
    );
    await expect(pullDialog).toHaveText(
      expect.stringContaining('ローカルブランチへ取り込むリモートブランチを選択します。'),
    );
    await expect(pullDialog).toHaveText(expect.stringContaining('ローカルブランチ'));
    await expect(pullDialog.$('select')).toHaveValue('origin/main');
    await expect(pullDialog.$('label=マージした変更をすぐにコミット').$('input')).toBeChecked();
    const refreshBranches = pullDialog.$('button[aria-label="ブランチを更新"]');
    await refreshBranches.click();
    await refreshBranches.waitForEnabled();
    await expect(pullDialog.$('select')).toHaveValue('origin/main');
    await pullDialog.$('button=キャンセル').click();

    await $('.diff-action-button[aria-label="プッシュ"]').click();
    let pushDialog = $('[role="dialog"][aria-labelledby="push-dialog-title"]');
    await pushDialog.waitForDisplayed();
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.activeElement ===
            document.querySelector(
              '[role="dialog"][aria-labelledby="push-dialog-title"] button[type="submit"]',
            ),
        ),
      { timeoutMsg: 'Push action did not receive initial focus.' },
    );
    await expect(pushDialog).toHaveText(expect.stringContaining('ローカルブランチ'));
    await expect(pushDialog.$('#push-local-branch')).toBeDisabled();
    await expect(pushDialog.$('#push-local-branch')).toHaveValue('main');
    await expect(pushDialog.$('select')).toHaveValue('origin');
    expect(
      await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="push-dialog-title"]',
        );
        return [
          '#push-local-branch',
          '#push-remote',
          'input[list="push-remote-branches"]',
          '.remote-operation-refresh-button',
          '.dialog-footer button[type="submit"]',
        ].map((selector) => dialog?.querySelector(selector)?.getBoundingClientRect().height);
      }),
    ).toEqual([36, 36, 36, 36, 36]);
    await expect(pushDialog.$('button[aria-label="ブランチを更新"]')).toBeDisplayed();
    await expect(pushDialog.$('input[list="push-remote-branches"]')).toHaveValue('main');
    const force = pushDialog.$('label=安全に強制プッシュ（--force-with-lease）').$('input');
    const tags = pushDialog.$('label=すべてのローカルタグをプッシュ').$('input');
    await force.click();
    await tags.click();
    await setLogicalWindowSize(860, 560);
    const forceWarning = pushDialog.$('.inline-alert.warning');
    await expect(forceWarning).toBeDisplayed();
    await expect(forceWarning).toHaveText(
      'リモートブランチの履歴を書き換える可能性があります。\nリモートブランチが想定外に更新されている場合は失敗します。',
    );
    expect((await forceWarning.getCSSProperty('white-space')).value).toBe('pre-line');
    expect(
      await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="push-dialog-title"]',
        );
        return dialog ? dialog.scrollWidth <= dialog.clientWidth : false;
      }),
    ).toBe(true);
    await expect(pushDialog.$('button[type="submit"]')).not.toHaveElementClass('danger');
    await pushDialog.$('button=キャンセル').click();
    await setLogicalWindowSize(1180, 760);

    await $('.diff-action-button[aria-label="プッシュ"]').click();
    pushDialog = $('[role="dialog"][aria-labelledby="push-dialog-title"]');
    await pushDialog.waitForDisplayed();
    await browser.waitUntil(
      async () => (await pushDialog.$$('input[type="checkbox"]').map(() => true)).length === 2,
      { timeoutMsg: 'Push options did not load after reopening the dialog.' },
    );
    expect(
      await pushDialog.$$('input[type="checkbox"]').map((input) => input.isSelected()),
    ).toEqual([false, false]);
  });

  it('pushes the current branch and all local tags to a local remote', async () => {
    const remotePath = `${fixturePath}/push-remote.git`;
    await ensureLocalBareRemote(repositoryPath, remotePath);
    await runGit(repositoryPath, ['add', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: リモートへ送信する']);
    await runGit(repositoryPath, ['tag', 'e2e-local-tag']);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));

    await $('.diff-action-button[aria-label="プッシュ"]').click();
    const pushDialog = $('[role="dialog"][aria-labelledby="push-dialog-title"]');
    await pushDialog.waitForDisplayed();
    await pushDialog.$('label=すべてのローカルタグをプッシュ').$('input').click();
    await pushDialog.$('button[type="submit"]').click();
    await expect(pushDialog).not.toExist();

    const localHead = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    expect((await runGit(remotePath, ['rev-parse', 'refs/heads/main'])).trim()).toBe(localHead);
    expect((await runGit(remotePath, ['rev-parse', 'refs/tags/e2e-local-tag'])).trim()).toBe(
      localHead,
    );
  });

  it('rejects a force-with-lease push after a peer updates the remote', async () => {
    const remotePath = `${fixturePath}/lease-remote.git`;
    await ensureLocalBareRemote(repositoryPath, remotePath);
    const peerPath = await cloneLocalRemote(fixturePath, remotePath, 'lease-peer');

    await writeRepositoryFile(repositoryPath, 'local-update.md', 'local update\n');
    await runGit(repositoryPath, ['add', 'local-update.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: ローカルを更新する']);
    await writeRepositoryFile(peerPath, 'peer-update.md', 'peer update\n');
    await runGit(peerPath, ['add', 'peer-update.md']);
    await runGit(peerPath, ['commit', '-m', 'test: ピアから更新する']);
    await runGit(peerPath, ['push', 'origin', 'main']);
    const peerHead = (await runGit(peerPath, ['rev-parse', 'HEAD'])).trim();
    await browser.execute(() => window.dispatchEvent(new Event('focus')));

    await $('.diff-action-button[aria-label="プッシュ"]').click();
    const pushDialog = $('[role="dialog"][aria-labelledby="push-dialog-title"]');
    await pushDialog.waitForDisplayed();
    await pushDialog.$('label=安全に強制プッシュ（--force-with-lease）').$('input').click();
    await pushDialog.$('button[type="submit"]').click();
    const errorDialog = $('[role="alertdialog"]');
    await errorDialog.waitForDisplayed();

    await expect(pushDialog).toBeDisplayed();
    expect((await runGit(remotePath, ['rev-parse', 'refs/heads/main'])).trim()).toBe(peerHead);
  });

  it('shows, stages, and commits a working tree change', async () => {
    const commitTrigger = $('.diff-action-bar .diff-action-button[aria-label="コミット"]');
    await expect(commitTrigger).toHaveAttribute('aria-expanded', 'false');
    const actionButtons = $$('.diff-action-bar .diff-action-button');
    expect(await actionButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'コミット',
      'プル',
      'プッシュ',
      'フェッチ',
    ]);
    expect(await actionButtons.map((button) => button.getAttribute('title'))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    await expect($('[role="dialog"] [data-commit-field="description"]')).not.toExist();

    await $('button=履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    const uncommittedChanges = $('.history-working-tree-entry');
    await expect(uncommittedChanges).toBeDisplayed();
    await expect(uncommittedChanges).toHaveText(expect.stringContaining('未コミットの変更'));
    await expect(uncommittedChanges).toHaveText(expect.stringContaining('1ファイル'));
    await expect($('.history-working-tree-graph')).toHaveAttribute(
      'style',
      expect.stringContaining('--history-lane-color: var(--history-working-tree)'),
    );
    await uncommittedChanges.click();
    await expect($('button[aria-label="差分"]')).toHaveAttribute('aria-current', 'page');
    expect(
      await browser.execute(
        () =>
          document.activeElement === document.querySelector('.change-item.is-current .change-row'),
      ),
    ).toBe(true);

    const stagedGroup = $('section[aria-labelledby="area-staged"]');
    const unstagedGroup = $('section[aria-labelledby="area-worktree"]');
    await expect(stagedGroup).toBeDisplayed();
    await expect(unstagedGroup).toBeDisplayed();
    const groupCountLayout = await browser.execute(() => {
      const header = document.querySelector<HTMLElement>(
        '.change-group-worktree .change-group-header',
      );
      const title = header?.querySelector<HTMLElement>('.change-group-title');
      const badge = header?.querySelector<HTMLElement>('.change-count');
      if (!header || !title || !badge) return undefined;
      const headerRect = header.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      return {
        gap: badgeRect.left - titleRect.right,
        trailingSpace: headerRect.right - badgeRect.right,
      };
    });
    expect(groupCountLayout).toEqual(
      expect.objectContaining({ gap: 4, trailingSpace: expect.any(Number) }),
    );
    expect(groupCountLayout?.trailingSpace).toBeGreaterThan(20);

    const stage = $('input[aria-label="ステージ README.md"]');
    await stage.waitForClickable();
    const changesPaneLayout = await browser.execute(() => {
      const sidebar = document.querySelector<HTMLElement>('.diff-sidebar-pane')!;
      const footer = sidebar.querySelector<HTMLElement>('.diff-list-footer')!;
      const actionBar = footer.querySelector<HTMLElement>('.diff-action-bar')!;
      const actionButtonElements = [
        ...actionBar.querySelectorAll<HTMLElement>('.diff-action-button'),
      ];
      const filesRegion = sidebar.querySelector<HTMLElement>('.diff-files-scroll-region')!;
      const staged = sidebar.querySelector<HTMLElement>('.change-group-staged')!;
      const unstaged = sidebar.querySelector<HTMLElement>('.change-group-worktree')!;
      const stagedContent = staged.querySelector<HTMLElement>('.change-group-content')!;
      const unstagedContent = unstaged.querySelector<HTMLElement>('.change-group-content')!;
      const stagedHeader = staged.querySelector<HTMLElement>('.change-group-header')!;
      const unstagedHeader = unstaged.querySelector<HTMLElement>('.change-group-header')!;
      const stagedHeaderHeight = stagedHeader.getBoundingClientRect().height;
      const unstagedHeaderHeight = unstagedHeader.getBoundingClientRect().height;
      const actionRect = actionBar.getBoundingClientRect();
      const filesRect = filesRegion.getBoundingClientRect();
      const stagedRect = staged.getBoundingClientRect();
      const unstagedRect = unstaged.getBoundingClientRect();
      return {
        actionsInFooter:
          actionRect.top >= footer.getBoundingClientRect().top &&
          actionRect.bottom <= footer.getBoundingClientRect().bottom,
        firstGroupOffset: stagedRect.top - filesRect.top,
        actionLabelsRemoved: actionButtonElements.every((button) => !button.querySelector('span')),
        actionIconSizes: actionButtonElements.map((button) => {
          const icon = button.querySelector<SVGElement>('.lucide')!;
          const style = getComputedStyle(icon);
          return [style.width, style.height];
        }),
        stageTogglesUseCompactHeight: [
          ...sidebar.querySelectorAll<HTMLElement>('.stage-toggle'),
        ].every((toggle) => toggle.getBoundingClientRect().height === 15),
        groupsMeetAtMiddle: Math.abs(stagedRect.bottom - unstagedRect.top) <= 1,
        groupHeightDifference: Math.abs(stagedRect.height - unstagedRect.height),
        stagedHeaderHeight,
        unstagedHeaderHeight,
        groupHeaderHeightDifference: Math.abs(stagedHeaderHeight - unstagedHeaderHeight),
        stagedOverflow: getComputedStyle(stagedContent).overflowY,
        unstagedOverflow: getComputedStyle(unstagedContent).overflowY,
      };
    });
    expect(changesPaneLayout).toEqual({
      actionsInFooter: true,
      firstGroupOffset: 0,
      actionLabelsRemoved: true,
      actionIconSizes: [
        ['16px', '16px'],
        ['16px', '16px'],
        ['16px', '16px'],
        ['15px', '15px'],
      ],
      stageTogglesUseCompactHeight: true,
      groupsMeetAtMiddle: true,
      groupHeightDifference: 0,
      stagedHeaderHeight: 34,
      unstagedHeaderHeight: 34,
      groupHeaderHeightDifference: 0,
      stagedOverflow: 'auto',
      unstagedOverflow: 'auto',
    });

    await $('button.change-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
          return Boolean(host?.shadowRoot?.querySelector('[data-line-type]'));
        }),
      { timeout: 10_000, timeoutMsg: 'Selecting a changed file did not render any diff lines.' },
    );
    const renderedDiffText = await browser.execute(
      () =>
        document.querySelector<HTMLElement>('.diff-surface diffs-container')?.shadowRoot
          ?.textContent ?? '',
    );
    expect(renderedDiffText).toContain('# Stella E2E');
    await expect($('.loading-state')).not.toExist();
    await expect($('.change-item.is-current')).toBeDisplayed();
    await expectInteractiveSelectedColors('.change-item.is-current', {
      palette: 'neutral',
    });
    const selectedRowPaint = await browser.execute(() => {
      const item = document.querySelector<HTMLElement>('.change-item.is-current');
      const row = item?.querySelector<HTMLElement>('.change-row');
      const stageHitbox = item?.querySelector<HTMLElement>('.stage-toggle-hitbox');
      const action = item?.querySelector<HTMLElement>('.row-action-trigger');
      if (!item || !row || !stageHitbox || !action) return null;
      const probe = document.createElement('div');
      probe.style.background = 'var(--list-selection-surface)';
      document.body.append(probe);
      const selectedSurface = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        itemBackground: getComputedStyle(item).backgroundColor,
        selectedSurface,
        rowBackground: getComputedStyle(row).backgroundColor,
        stageHitboxBackground: getComputedStyle(stageHitbox).backgroundColor,
        actionBackground: getComputedStyle(action).backgroundColor,
        transitionProperty: getComputedStyle(item).transitionProperty,
      };
    });
    expect(selectedRowPaint).toEqual({
      itemBackground: selectedRowPaint?.selectedSurface,
      selectedSurface: selectedRowPaint?.selectedSurface,
      rowBackground: 'rgba(0, 0, 0, 0)',
      stageHitboxBackground: 'rgba(0, 0, 0, 0)',
      actionBackground: 'rgba(0, 0, 0, 0)',
      transitionProperty: 'opacity',
    });
    expect(
      await browser.execute(() => document.activeElement?.classList.contains('change-row')),
    ).toBe(true);
    expect(
      await browser.execute(() =>
        document.querySelector<HTMLElement>('.change-row')?.hasAttribute('draggable'),
      ),
    ).toBe(false);
    await browser.execute(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector<HTMLElement>('.change-item.is-current')!,
        ).getPropertyValue('box-shadow'),
      ),
    ).toBe('none');

    await stage.click();
    await expect($('input[aria-label="ステージ解除 README.md"]')).toBeDisplayed();
    expect(await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).toBe('README.md\n');
    await $('input[aria-label="ステージ解除 README.md"]').click();
    await expect($('input[aria-label="ステージ README.md"]')).toBeDisplayed();
    expect(await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).toBe('');
    await $('input[aria-label="ステージ README.md"]').click();
    await expect($('input[aria-label="ステージ解除 README.md"]')).toBeDisplayed();
    expect(await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).toBe('README.md\n');

    const activeCommitTrigger = $('.diff-action-bar .diff-action-button[aria-label="コミット"]');
    await activeCommitTrigger.waitForClickable();
    await activeCommitTrigger.click();
    await expect(activeCommitTrigger).toHaveAttribute('aria-expanded', 'true');
    const commitDialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
    await expect(commitDialog).toBeDisplayed();
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-commit-field')),
    ).toBe('description');
    await expect(commitDialog.$('[data-commit-field="type"]')).not.toExist();
    await expect(commitDialog.$('[data-commit-field="scope"]')).not.toExist();
    await expect(commitDialog.$('.commit-breaking')).not.toExist();
    await commitDialog.$('button=キャンセル').click();
    await expect(commitDialog).not.toExist();
    await $('button=設定').click();
    await selectSetting('conventional-commits', 'enabled');
    await expect($('select[name="conventional-commits"]')).toHaveValue('enabled');
    await $('button=差分').click();
    const conventionalCommitTrigger = $(
      '.diff-action-bar .diff-action-button[aria-label="コミット"]',
    );
    await conventionalCommitTrigger.waitForClickable();
    await conventionalCommitTrigger.click();
    const conventionalCommitDialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
    await expect(conventionalCommitDialog).toBeDisplayed();
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-commit-field')),
    ).toBe('description');
    await setLogicalWindowSize(860, 560);
    expect(
      await browser.execute(() => {
        const element = document.querySelector<HTMLElement>('[role="dialog"]');
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
          rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
        );
      }),
    ).toBe(true);
    const compactCommitFormSpacing = await browser.execute(() => {
      const description = document.querySelector<HTMLElement>('[data-commit-field="description"]');
      const type = document.querySelector<HTMLElement>('[data-commit-field="type"]');
      const breaking = document.querySelector<HTMLElement>('.commit-breaking');
      if (!description || !type || !breaking) return undefined;
      const typeLabel = type.closest('label');
      if (!typeLabel) return undefined;
      return {
        descriptionToMetadata:
          typeLabel.getBoundingClientRect().top - description.getBoundingClientRect().bottom,
        metadataToBreaking:
          breaking.getBoundingClientRect().top - type.getBoundingClientRect().bottom,
      };
    });
    expect(compactCommitFormSpacing?.descriptionToMetadata).toBeLessThanOrEqual(16);
    expect(compactCommitFormSpacing?.metadataToBreaking).toBeLessThanOrEqual(16);
    await conventionalCommitDialog.$('[data-commit-field="type"]').setValue('Ss');
    await expect(conventionalCommitDialog.$('#commit-type-error')).toBeDisplayed();
    const validationLayout = await browser.execute(() => {
      const type = document.querySelector<HTMLElement>('[data-commit-field="type"]');
      const scope = document.querySelector<HTMLElement>('[data-commit-field="scope"]');
      if (!type || !scope) return undefined;
      return {
        fieldsAligned: Math.abs(
          type.getBoundingClientRect().top - scope.getBoundingClientRect().top,
        ),
      };
    });
    expect(validationLayout?.fieldsAligned).toBeLessThanOrEqual(1);
    await conventionalCommitDialog.$('[data-commit-field="type"]').setValue('feat');
    await expect(conventionalCommitDialog.$('#commit-type-error')).not.toBeDisplayed();
    await setLogicalWindowSize(1180, 760);
    await conventionalCommitDialog
      .$('[data-commit-field="description"]')
      .setValue('E2Eリポジトリを初期化する');
    const commit = conventionalCommitDialog.$('.commit-form button[type="submit"]');
    await commit.waitForClickable();
    await commit.click();
    await expect(conventionalCommitDialog).not.toExist();
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.querySelectorAll('.change-row').length)) === 0,
      {
        timeout: 10_000,
        timeoutMsg: 'Committed changes did not disappear from the change list.',
      },
    );
    expect(await $('.change-group-worktree .empty-state-small').isExisting()).toBe(false);
  });

  it('always shows Git Hook output and scrolls output longer than five lines', async () => {
    await writeExecutableRepositoryFile(
      repositoryPath,
      '.git/hooks/commit-msg',
      '#!/bin/sh\nprintf "hook-line-1\\nhook-line-2\\nhook-line-3\\nhook-line-4\\nhook-line-5\\nhook-line-6\\n" >&2\nexit 1\n',
    );
    await $('input[aria-label="ステージ README.md"]').click();
    await $('input[aria-label="ステージ解除 README.md"]').waitForDisplayed({ timeout: 10_000 });
    const commitTrigger = $('.diff-action-bar .diff-action-button[aria-label="コミット"]');
    await commitTrigger.waitForClickable({ timeout: 10_000 });
    await commitTrigger.click();
    const commitDialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
    await commitDialog.waitForDisplayed({ timeout: 10_000 });
    await commitDialog.$('[data-commit-field="description"]').setValue('Git Hookエラーを確認する');
    await commitDialog.$('.commit-form button[type="submit"]').click();

    const errorDialog = $('[role="alertdialog"][aria-labelledby="runtime-error-title"]');
    await errorDialog.waitForDisplayed({ timeout: 10_000 });
    await expect(errorDialog).toHaveText(
      expect.stringContaining('Gitフックによって操作が拒否されました。'),
    );
    await expect(errorDialog.$('.eyebrow')).not.toExist();
    await expect(errorDialog.$('details')).not.toExist();
    await expect(errorDialog.$('summary')).not.toExist();
    await expect(errorDialog.$('pre[aria-label="stderr"]')).toHaveText(
      expect.stringContaining('hook-line-6'),
    );
    const outputLayout = await browser.execute(() => {
      const output = document.querySelector<HTMLElement>(
        '[role="alertdialog"] .notice-output-streams',
      )!;
      return {
        overflowY: getComputedStyle(output).overflowY,
        scrolls: output.scrollHeight > output.clientHeight,
      };
    });
    expect(outputLayout).toEqual({ overflowY: 'auto', scrolls: true });
  });

  it('shows every Shift-selected file in the right pane', async () => {
    await writeRepositoryFile(repositoryPath, 'second.ts', 'export const second = true;\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.querySelectorAll('button.change-row').length)) === 2,
      { timeout: 10_000, timeoutMsg: 'The second changed file did not appear.' },
    );

    await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>('button.change-row')];
      rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const selectedRows = document.querySelectorAll('button.change-row[aria-pressed="true"]');
          const hosts = [
            ...document.querySelectorAll<HTMLElement>(
              '.multi-diff-list .diff-surface diffs-container',
            ),
          ];
          return (
            selectedRows.length === 2 &&
            hosts.length === 2 &&
            hosts.every((host) => Boolean(host.shadowRoot?.querySelector('[data-line-type]')))
          );
        }),
      {
        timeout: 10_000,
        timeoutMsg: 'The Shift-selected files were not both rendered in the right pane.',
      },
    );

    const visibleFileHeaders = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('.multi-diff-list .selected-file-heading h2')].map(
        (header) => header.textContent?.trim() ?? '',
      ),
    );
    expect(visibleFileHeaders).toEqual(['README.md', 'second.ts']);

    const multiFileToggle = $('.selected-file-toggle');
    await browser.execute(() => {
      document.querySelector<HTMLButtonElement>('.selected-file-toggle')?.focus();
    });
    const multiFileToggleLabel = await multiFileToggle.getAttribute('aria-label');
    if (!multiFileToggleLabel)
      throw new Error('The multi-file diff toggle has no accessible label.');
    await expect($('.app-tooltip')).toHaveText(multiFileToggleLabel);
    await multiFileToggle.click();
    await expect(multiFileToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a changed file in the editor and returns to its Diff', async () => {
    await $('button.change-row').click();
    await expect($('.selected-file-toggle')).not.toExist();
    const editToggle = $('.diff-file-toolbar button[aria-label="編集"]');
    await expect(editToggle).toHaveAttribute('aria-pressed', 'false');
    await expectInteractiveSelectedColors(
      '.diff-file-toolbar button[aria-label="編集"] .toggle-button-thumb',
      { palette: 'neutral' },
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          const line = root?.querySelector<HTMLElement>('[data-line]');
          return line ? getComputedStyle(line).fontSize : '';
        })) === '13px',
      {
        timeout: 10_000,
        timeoutMsg: 'The Diff line did not render at the shared 13px font size.',
      },
    );
    const diffFontSize = '13px';
    const diffLineMetrics = await browser.execute(() => {
      const host = document.querySelector<HTMLElement>('.diff-surface diffs-container')!;
      const root = host.shadowRoot!;
      const line = root.querySelector<HTMLElement>('[data-content] [data-line]')!;
      const changedLine = root.querySelector<HTMLElement>(
        "[data-content] [data-line-type='change-addition'], [data-content] [data-line-type='change-deletion']",
      )!;
      const lineNumber = root.querySelector<HTMLElement>('[data-column-number]')!;
      const lineStyle = getComputedStyle(line);
      const lineNumberStyle = getComputedStyle(lineNumber);
      return {
        indicator: getComputedStyle(changedLine, '::before').content,
        lineHeight: lineStyle.lineHeight,
        lineNumberFontFamily: lineNumberStyle.fontFamily,
        lineNumberWidth: lineNumber.getBoundingClientRect().width,
        lineNumberPaddingLeft: lineNumberStyle.paddingLeft,
        lineNumberPaddingRight: lineNumberStyle.paddingRight,
        textLeft:
          line.getBoundingClientRect().left -
          host.getBoundingClientRect().left +
          Number.parseFloat(lineStyle.paddingLeft),
      };
    });
    expect(diffLineMetrics.indicator).toMatch(/[+-]/u);
    expect(diffLineMetrics.lineHeight).toBe('20px');
    await editToggle.waitForClickable({ timeout: 10_000 });
    await expect(editToggle).not.toHaveAttribute('title');
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.diff-file-toolbar button[aria-label="編集"]')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    await expect($('.app-tooltip')).toHaveText('ファイル編集切り替え');
    await expect(editToggle).toHaveText('');
    await editToggle.click();

    const editor = $('.file-editor-pane');
    await editor.waitForDisplayed({ timeout: 10_000 });
    await expect(editor.$('h2')).toHaveText('README.md');
    await expect(editor.$('button[aria-label="表示"]')).toHaveAttribute('aria-pressed', 'true');
    await expectInteractiveSelectedColors(
      '.file-editor-pane button[aria-label="表示"] .toggle-button-thumb',
      { palette: 'neutral' },
    );
    await expect(editor.$('button=保存する')).not.toExist();
    await expect(editor.$('button=キャンセル')).not.toExist();
    const textbox = editor.$('[role="textbox"]');
    await expect(textbox).toHaveAttribute('aria-label', 'README.mdを編集');
    const editorFontSize = await textbox.getCSSProperty('font-size');
    expect(editorFontSize.value).toBe(diffFontSize);
    const editorMenu = editor.$('button[aria-haspopup="menu"]');
    await expect(editorMenu).toHaveAttribute(
      'aria-label',
      '選択中のファイルREADME.mdのその他の操作',
    );
    const gutterSpacing = await browser.execute(() => {
      const lineNumber = document.querySelector<HTMLElement>(
        '.file-editor .cm-lineNumbers .cm-gutterElement',
      );
      const foldGutter = document.querySelector<HTMLElement>('.file-editor .cm-foldGutter');
      const foldMarkerChevron = foldGutter?.querySelector('.text-editor-fold-marker polyline');
      const editorRoot = document.querySelector<HTMLElement>('.file-editor .cm-editor');
      const scroller = document.querySelector<HTMLElement>('.file-editor .cm-scroller');
      const firstLine = document.querySelector<HTMLElement>('.file-editor .cm-line');
      const lineStyle = firstLine ? getComputedStyle(firstLine) : undefined;
      const lineNumberStyle = lineNumber ? getComputedStyle(lineNumber) : undefined;
      return {
        firstLineTopGap:
          firstLine && scroller
            ? firstLine.getBoundingClientRect().top - scroller.getBoundingClientRect().top
            : undefined,
        lineHeight: lineStyle?.lineHeight ?? '',
        lineNumberFontFamily: lineNumberStyle?.fontFamily ?? '',
        lineNumberWidth: lineNumber?.getBoundingClientRect().width,
        lineNumberPaddingLeft: lineNumberStyle?.paddingLeft ?? '',
        lineNumberPaddingRight: lineNumber ? getComputedStyle(lineNumber).paddingRight : '',
        foldGutterWidth: foldGutter ? getComputedStyle(foldGutter).width : '',
        foldMarkerPoints: foldMarkerChevron?.getAttribute('points') ?? '',
        textLeft:
          firstLine && editorRoot && lineStyle
            ? firstLine.getBoundingClientRect().left -
              editorRoot.getBoundingClientRect().left +
              Number.parseFloat(lineStyle.paddingLeft)
            : undefined,
      };
    });
    expect(gutterSpacing).toEqual({
      firstLineTopGap: 0,
      lineHeight: diffLineMetrics.lineHeight,
      lineNumberFontFamily: diffLineMetrics.lineNumberFontFamily,
      lineNumberWidth: diffLineMetrics.lineNumberWidth,
      lineNumberPaddingLeft: diffLineMetrics.lineNumberPaddingLeft,
      lineNumberPaddingRight: '4px',
      foldGutterWidth: '18px',
      foldMarkerPoints: '4 2 8 6 4 10',
      textLeft: diffLineMetrics.textLeft,
    });

    await textbox.click();
    await textbox.addValue('x');
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll('.change-item .unsaved-file-dot').length === 1 &&
            document.querySelectorAll('.file-editor-toolbar .unsaved-file-dot').length === 1,
        ),
      { timeout: 10_000, timeoutMsg: 'The unsaved dots did not appear in both panes.' },
    );

    await editor.$('button[aria-label="表示"]').click();
    const displayDialog = $('[role="alertdialog"]');
    await displayDialog.waitForDisplayed({ timeout: 10_000 });
    await expect(displayDialog.$('h2')).toHaveText('未保存の変更');
    await displayDialog.$('button=保存せずに表示').click();
    await expect(editor).not.toExist();
    await $('.diff-surface').waitForDisplayed({ timeout: 10_000 });
  });

  it('applies the selected size and code font to Diff and Editor text', async () => {
    await resetApp({
      language: 'ja',
      splitStageView: true,
      fontSize: 120,
      uiFont: 'avenirNext',
      codeFont: 'menlo',
    });
    await openRepository(repositoryPath);
    await $('button.change-row').click();

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(root?.querySelector('[data-line]'));
        }),
      { timeoutMsg: 'The Diff did not render with the selected typography.' },
    );
    const diffTypography = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const style = getComputedStyle(root.querySelector<HTMLElement>('[data-line]')!);
      return {
        fontFamily: style.fontFamily,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(diffTypography.fontFamily).toContain('Menlo');
    expect(diffTypography.fontSize).toBeCloseTo(15.6);
    expect(diffTypography.lineHeight).toBeCloseTo(24);

    await $('.diff-file-toolbar button[aria-label="編集"]').click();
    const textbox = $('.file-editor-pane [role="textbox"]');
    await textbox.waitForDisplayed({ timeout: 10_000 });
    const editorTypography = await browser.execute(() => {
      const style = getComputedStyle(
        document.querySelector<HTMLElement>('.file-editor .cm-content')!,
      );
      return {
        fontFamily: style.fontFamily,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(editorTypography.fontFamily).toContain('Menlo');
    expect(editorTypography).toMatchObject({
      fontSize: diffTypography.fontSize,
      lineHeight: diffTypography.lineHeight,
    });
  });

  it('uses the shared accent selection in the Conflict editor', async () => {
    await runGit(repositoryPath, ['add', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 競合の基点を作成する']);
    await runGit(repositoryPath, ['checkout', '-b', 'incoming']);
    await writeRepositoryFile(repositoryPath, 'README.md', '# Incoming\n');
    await runGit(repositoryPath, ['add', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 取り込み側を変更する']);
    await runGit(repositoryPath, ['checkout', 'main']);
    await writeRepositoryFile(repositoryPath, 'README.md', '# Current\n');
    await runGit(repositoryPath, ['add', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 現在側を変更する']);

    let mergeConflicted = false;
    try {
      await runGit(repositoryPath, ['merge', 'incoming']);
    } catch {
      mergeConflicted = true;
    }
    expect(mergeConflicted).toBe(true);

    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('.file-status.conflicted').waitForDisplayed({ timeout: 20_000 });
    await $('button.change-row').click();
    await $('.conflict-workspace').waitForDisplayed({ timeout: 10_000 });
    await expectAttachedTabs('.conflict-comparison .segmented');
    await expectInteractiveSelectedColors('.conflict-comparison .segmented [aria-selected="true"]');
    await expectInteractiveSelectedColors('.block-selector[aria-current="true"]');
  });

  it('opens Hunk and line editing above center and focused at the selected start position', async () => {
    const base = [...Array.from({ length: 200 }, (_, index) => `line-${index + 1}`), ''].join('\n');
    await writeRepositoryFile(repositoryPath, 'README.md', base);
    await runGit(repositoryPath, ['add', '--', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 編集開始位置の基準を作る']);
    await writeRepositoryFile(repositoryPath, 'README.md', base.replace('line-120', 'changed-120'));
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('.change-item .file-status.modified').waitForExist({ timeout: 10_000 });
    await $('button.change-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].some(
            (button) => button.textContent === 'ハンクを編集',
          );
        }),
      { timeout: 10_000, timeoutMsg: 'The Hunk edit action did not appear.' },
    );
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      [...root.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'ハンクを編集')
        ?.click();
    });
    const editor = $('.file-editor-pane');
    await editor.waitForDisplayed({ timeout: 10_000 });
    const hunkEditorPosition = await waitForEditorPosition('line-117');
    expect(hunkEditorPosition.scrollTop).toBeGreaterThan(0);
    expect(hunkEditorPosition.activeLine).toBe('line-117');
    expect(hunkEditorPosition.focused).toBe(true);
    expect(hunkEditorPosition.viewportRatio).toBeGreaterThan(0.2);
    expect(hunkEditorPosition.viewportRatio).toBeLessThan(0.3);

    await editor.$('button[aria-label="表示"]').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(root?.querySelector("[data-line-type='change-addition']"));
        }),
      { timeout: 10_000, timeoutMsg: 'The Diff did not return after Hunk editing.' },
    );
    const contextLineText = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const line = root.querySelector<HTMLElement>("[data-content] [data-line-type='context']")!;
      line.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      return line.textContent?.trim() ?? '';
    });
    expect(contextLineText).toMatch(/^line-\d+$/u);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(root?.querySelector('[data-content] [data-line][data-selected-line]'));
        }),
      { timeout: 10_000, timeoutMsg: 'The unchanged Diff line was not selected.' },
    );
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const line = root.querySelector<HTMLElement>(
        '[data-content] [data-line][data-selected-line]',
      )!;
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          clientX: rect.left + 8,
          clientY: rect.top + 8,
        }),
      );
    });
    await $('[role="menu"]').waitForDisplayed({ timeout: 10_000 });
    expect(await $$('[role="menuitem"]').map((item) => item.getText())).toEqual([
      '選択した行を編集',
      '選択した行をコピー',
    ]);
    await browser.keys(['Escape']);
    await $('.diff-file-actions button[aria-label="編集"]').click();
    await $('.file-editor-pane').waitForDisplayed({ timeout: 10_000 });
    const contextEditorPosition = await waitForEditorPosition(contextLineText);
    expect(contextEditorPosition.scrollTop).toBeGreaterThan(0);
    expect(contextEditorPosition.activeLine).toBe(contextLineText);
    expect(contextEditorPosition.focused).toBe(true);

    await $('.file-editor-pane button[aria-label="表示"]').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(
            root?.querySelector<HTMLElement>('[data-content] [data-line][data-selected-line]'),
          );
        }),
      {
        timeout: 10_000,
        timeoutMsg: 'The selected Diff line was not restored.',
      },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          const line = root?.querySelector<HTMLElement>(
            '[data-content] [data-line][data-selected-line]',
          );
          return Boolean(line && root?.activeElement === line);
        }),
      {
        timeout: 10_000,
        timeoutMsg: 'The restored Diff line was not focused.',
      },
    );
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const line = root.querySelector<HTMLElement>(
        "[data-content] [data-line-type='change-addition']",
      )!;
      line.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(root?.querySelector('[data-content] [data-line][data-selected-line]'));
        }),
      { timeout: 10_000, timeoutMsg: 'The Diff line was not selected.' },
    );
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const line = root.querySelector<HTMLElement>(
        '[data-content] [data-line][data-selected-line]',
      )!;
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          clientX: rect.left + 8,
          clientY: rect.top + 8,
        }),
      );
    });
    await $('button=選択した行を編集').waitForClickable({ timeout: 10_000 });
    await $('button=選択した行を編集').click();
    await $('.file-editor-pane').waitForDisplayed({ timeout: 10_000 });
    const lineEditorPosition = await waitForEditorPosition('changed-120');
    expect(lineEditorPosition.scrollTop).toBeGreaterThan(0);
    expect(lineEditorPosition.activeLine).toBe('changed-120');
    expect(lineEditorPosition.focused).toBe(true);
    expect(lineEditorPosition.viewportRatio).toBeGreaterThan(0.2);
    expect(lineEditorPosition.viewportRatio).toBeLessThan(0.3);
  });

  it('opens a deleted line at the next remaining line and scrolls the last line to the top', async () => {
    const base = Array.from({ length: 80 }, (_, index) => `line-${index + 1}`).join('\n');
    const changed = base.replace('line-40\nline-41\n', '');
    await writeRepositoryFile(repositoryPath, 'README.md', base);
    await runGit(repositoryPath, ['add', '--', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: 削除行の編集位置を確認する']);
    await writeRepositoryFile(repositoryPath, 'README.md', changed);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('.change-item .file-status.modified').waitForExist({ timeout: 10_000 });
    await $('button.change-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return (
            root?.querySelectorAll("[data-content] [data-line-type='change-deletion']").length === 2
          );
        }),
      { timeout: 10_000, timeoutMsg: 'The deleted Diff lines did not render.' },
    );
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const deletedLines = root.querySelectorAll<HTMLElement>(
        "[data-content] [data-line-type='change-deletion']",
      );
      deletedLines[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await $('.diff-file-actions button[aria-label="編集"]').click();
    await $('.file-editor-pane').waitForDisplayed({ timeout: 10_000 });

    const editorPosition = await waitForEditorPosition('line-42');
    expect(editorPosition.focused).toBe(true);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const scroller = document.querySelector<HTMLElement>('.file-editor .cm-scroller');
          const content = document.querySelector<HTMLElement>('.file-editor .cm-content');
          const lastLine = document.querySelector<HTMLElement>('.file-editor .cm-line:last-child');
          if (!scroller || !content || !lastLine) return false;
          scroller.scrollTop = scroller.scrollHeight;
          const contentPaddingTop = Number.parseFloat(getComputedStyle(content).paddingTop) || 0;
          return (
            Math.abs(
              lastLine.getBoundingClientRect().top -
                (scroller.getBoundingClientRect().top + contentPaddingTop),
            ) <= 2
          );
        }),
      { timeout: 10_000, timeoutMsg: 'The last editor line could not reach the viewport top.' },
    );
  });

  it('places Hunk actions at the right edge and opens line actions from a blue selection', async () => {
    const longOldLine = `old-a-${'x'.repeat(500)}`;
    const base = [
      ...Array.from({ length: 30 }, (_, index) => {
        if (index === 7) return longOldLine;
        if (index === 21) return 'old-b';
        return `line-${index + 1}`;
      }),
      '',
    ].join('\n');
    const changed = base
      .replace(longOldLine, `new-a-${'y'.repeat(500)}\nnew-a-2\nnew-a-3`)
      .replace('old-b', 'new-b');
    await writeRepositoryFile(repositoryPath, 'README.md', base);
    await runGit(repositoryPath, ['add', '--', 'README.md']);
    await runGit(repositoryPath, ['commit', '-m', 'test: ハンク操作の基準を作る']);
    await writeRepositoryFile(repositoryPath, 'README.md', changed);
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('.change-item .file-status.modified').waitForExist({ timeout: 10_000 });
    await $('button.change-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return Boolean(root?.querySelector('[data-line-type]'));
        }),
      { timeout: 10_000, timeoutMsg: 'The modified file diff was not rendered.' },
    );
    const separatorDiagnostics = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      return {
        controlCount: root.querySelectorAll('[data-stella-hunk-controls]').length,
        separators: [...root.querySelectorAll<HTMLElement>('[data-content] [data-separator]')].map(
          (separator) => [...separator.attributes].map(({ name, value }) => [name, value]),
        ),
      };
    });
    if (separatorDiagnostics.controlCount !== 2) {
      throw new Error(`Unexpected separators: ${JSON.stringify(separatorDiagnostics)}`);
    }
    await setLogicalWindowSize(860, 760);

    const hunkLayout = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const controls = root.querySelector<HTMLElement>('[data-stella-hunk-controls]')!;
      const content = controls.closest<HTMLElement>('[data-content]')!;
      const controlsRect = controls.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const paneRect = document
        .querySelector<HTMLElement>('.diff-content-pane')!
        .getBoundingClientRect();
      const actionButtons = [...controls.querySelectorAll<HTMLButtonElement>('button')];
      const hunkLabels = [...root.querySelectorAll<HTMLElement>('[data-stella-hunk-label]')];
      const firstLabel = hunkLabels[0]!;
      const firstLabelStyle = getComputedStyle(firstLabel);
      const firstButtonStyle = getComputedStyle(actionButtons[0]!);
      const separatorBackground = getComputedStyle(
        controls.closest('[data-separator-wrapper]')!,
      ).backgroundColor;
      return {
        actionLabels: actionButtons.map((button) => button.textContent),
        hunkLabels: hunkLabels.map((label) => label.textContent),
        bordered: actionButtons.every(
          (button) =>
            getComputedStyle(button).borderRightStyle !== 'none' &&
            Number.parseFloat(getComputedStyle(button).borderRightWidth) > 0,
        ),
        actionsInsidePane: actionButtons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= paneRect.left - 1 && rect.right <= paneRect.right + 1;
        }),
        inContentColumn: controls.closest('[data-gutter]') === null,
        leftIsVisible: controlsRect.left >= contentRect.left - 1,
        labelAtLeft: firstLabel.getBoundingClientRect().left - contentRect.left <= 8,
        labelIsSubtle:
          firstLabelStyle.color !== separatorBackground &&
          firstLabelStyle.color !== firstButtonStyle.color,
        rightGap: contentRect.right - controlsRect.right,
        hasHunkToggle: controls.querySelector('[data-stella-hunk-toggle]') !== null,
        unmodifiedTextVisible: [
          ...root.querySelectorAll<HTMLElement>('[data-unmodified-lines]'),
        ].some((element) => getComputedStyle(element).display !== 'none'),
      };
    });
    expect(hunkLayout).toEqual({
      actionLabels: ['ハンクを編集', 'ハンクをステージ', 'ハンクを破棄'],
      hunkLabels: ['ハンク1 行5–13', 'ハンク2 行21–27'],
      bordered: true,
      actionsInsidePane: true,
      inContentColumn: true,
      leftIsVisible: true,
      labelAtLeft: true,
      labelIsSubtle: true,
      rightGap: expect.any(Number),
      hasHunkToggle: false,
      unmodifiedTextVisible: false,
    });
    expect(hunkLayout.rightGap).toBeGreaterThanOrEqual(0);
    expect(hunkLayout.rightGap).toBeLessThanOrEqual(8);
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const additions = root.querySelectorAll<HTMLElement>(
        "[data-content] [data-line-type='change-addition']",
      );
      additions[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      additions[2]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector<HTMLElement>(
            '.diff-surface diffs-container',
          )?.shadowRoot;
          return root?.querySelectorAll('[data-line][data-selected-line]').length === 3;
        }),
      { timeout: 10_000, timeoutMsg: 'The Shift-clicked diff-line range was not selected.' },
    );
    const selectedLineStyle = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const line = root.querySelector<HTMLElement>('[data-line][data-selected-line]')!;
      const style = getComputedStyle(line);
      const primaryProbe = document.createElement('button');
      primaryProbe.className = 'primary';
      primaryProbe.style.position = 'fixed';
      primaryProbe.style.visibility = 'hidden';
      document.body.append(primaryProbe);
      const interactiveBackgroundColor = getComputedStyle(primaryProbe).backgroundColor;
      primaryProbe.remove();
      const unselectedAddition = [
        ...root.querySelectorAll<HTMLElement>("[data-line][data-line-type='change-addition']"),
      ].find((candidate) => !candidate.hasAttribute('data-selected-line'))!;
      return {
        selectedCount: root.querySelectorAll('[data-line][data-selected-line]').length,
        selectedBackground: style.getPropertyValue('--diffs-computed-selected-line-bg').trim(),
        selectedBackgroundColor: style.backgroundColor,
        interactiveBackgroundColor,
        additionBackgroundColor: getComputedStyle(unselectedAddition).backgroundColor,
        userSelect:
          style.getPropertyValue('user-select') || style.getPropertyValue('-webkit-user-select'),
      };
    });
    expect(selectedLineStyle.selectedCount).toBe(3);
    expect(selectedLineStyle.selectedBackground).not.toBe('');
    expect(selectedLineStyle.selectedBackgroundColor).not.toBe(
      selectedLineStyle.additionBackgroundColor,
    );
    expect(selectedLineStyle.selectedBackgroundColor).not.toBe(
      selectedLineStyle.interactiveBackgroundColor,
    );
    expect(selectedLineStyle.userSelect).toBe('none');
    expect(
      await browser.execute(() => document.activeElement?.matches('.diff-surface') ?? false),
    ).toBe(true);
    await browser.keys(['Meta', 'c']);
    await $('.file-action-notice[role="status"]').waitForDisplayed({ timeout: 10_000 });
    expect(await $('.file-action-notice[role="status"]').getText()).toBe(
      '選択行をコピーしました。',
    );
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>(
        '.diff-surface diffs-container',
      )!.shadowRoot!;
      const line = root.querySelector<HTMLElement>('[data-line][data-selected-line]')!;
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          clientX: rect.left + 8,
          clientY: rect.top + 8,
        }),
      );
    });
    await $('[role="menu"]').waitForDisplayed({ timeout: 10_000 });
    expect(await $$('[role="menuitem"]').map((item) => item.getText())).toEqual([
      '選択した行を編集',
      '選択した行をコピー',
      '選択した行をステージ',
      '選択行を破棄',
    ]);
  });
});
