import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import { dragChangeToArea, openRepository, resetApp, setLogicalWindowSize } from './support/app.js';
import {
  configureRepository,
  createEmptyRepository,
  removeFixture,
  runGit,
  writeRepositoryFile,
} from './support/fixtures.js';

describe('Changes', () => {
  let repositoryPath = '';

  beforeEach(async () => {
    repositoryPath = await createEmptyRepository('changes');
    await resetApp({ language: 'ja' });
    await openRepository(repositoryPath);
    await configureRepository(repositoryPath);
    await writeRepositoryFile(repositoryPath, 'README.md', '# Stella E2E\n');
    await browser.execute(() => window.dispatchEvent(new Event('focus')));
    await $('input[aria-label="Stage README.md"]').waitForClickable({ timeout: 20_000 });
  });

  afterEach(async () => {
    await removeFixture(repositoryPath);
    repositoryPath = '';
  });

  it('shows, stages, drags, and commits a working tree change', async () => {
    const commitTrigger = $('.changes-action-bar .changes-action-button[aria-label="コミット"]');
    await expect(commitTrigger).toHaveAttribute('aria-expanded', 'false');
    const actionButtons = $$('.changes-action-bar .changes-action-button');
    expect(await actionButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'コミット',
      'プル',
      'プッシュ',
      'フェッチ',
    ]);
    expect(await actionButtons.map((button) => button.getAttribute('title'))).toEqual([
      'コミット',
      'プル',
      'プッシュ',
      'フェッチ',
    ]);
    await expect($('[role="dialog"] [data-commit-field="description"]')).not.toExist();

    await $('button=操作履歴').click();
    await expect($('.history-view')).toBeDisplayed();
    const uncommittedChanges = $('.history-working-tree-entry');
    await expect(uncommittedChanges).toBeDisplayed();
    await expect(uncommittedChanges).toHaveText(expect.stringContaining('未コミットの変更'));
    await expect(uncommittedChanges).toHaveText(expect.stringContaining('1ファイル'));
    await expect($('.history-working-tree-graph')).toHaveAttribute(
      'style',
      expect.stringContaining('--history-lane-color: var(--text-muted)'),
    );
    await uncommittedChanges.click();
    await expect($('button[aria-label="変更差分"]')).toHaveAttribute('aria-current', 'page');

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

    const stage = $('input[aria-label="Stage README.md"]');
    await stage.waitForClickable();
    const changesPaneLayout = await browser.execute(() => {
      const sidebar = document.querySelector<HTMLElement>('.changes-sidebar-pane')!;
      const actionSection = sidebar.querySelector<HTMLElement>('.changes-action-section')!;
      const actionButtonElements = [
        ...actionSection.querySelectorAll<HTMLElement>('.changes-action-button'),
      ];
      const filesRegion = sidebar.querySelector<HTMLElement>('.changes-files-scroll-region')!;
      const staged = sidebar.querySelector<HTMLElement>('.change-group-staged')!;
      const unstaged = sidebar.querySelector<HTMLElement>('.change-group-worktree')!;
      const stagedContent = staged.querySelector<HTMLElement>('.change-group-content')!;
      const unstagedContent = unstaged.querySelector<HTMLElement>('.change-group-content')!;
      const actionRect = actionSection.getBoundingClientRect();
      const filesRect = filesRegion.getBoundingClientRect();
      const stagedRect = staged.getBoundingClientRect();
      const unstagedRect = unstaged.getBoundingClientRect();
      const actionGrid = getComputedStyle(actionSection.querySelector('.changes-action-bar')!);
      return {
        actionsBeforeFiles: actionRect.bottom <= filesRect.top + 1,
        actionColumns: actionGrid.gridTemplateColumns.split(' ').length,
        actionLabelsVisible: actionButtonElements.every(
          (button) => getComputedStyle(button.querySelector('span')!).display !== 'none',
        ),
        actionIconsUseCurrentSize: actionButtonElements.every((button) => {
          const icon = button.querySelector<SVGElement>('.lucide')!;
          return (
            getComputedStyle(icon).width === '16px' && getComputedStyle(icon).height === '16px'
          );
        }),
        groupsMeetAtMiddle: Math.abs(stagedRect.bottom - unstagedRect.top) <= 1,
        groupHeightDifference: Math.abs(stagedRect.height - unstagedRect.height),
        stagedOverflow: getComputedStyle(stagedContent).overflowY,
        unstagedOverflow: getComputedStyle(unstagedContent).overflowY,
      };
    });
    expect(changesPaneLayout).toEqual({
      actionsBeforeFiles: true,
      actionColumns: 4,
      actionLabelsVisible: true,
      actionIconsUseCurrentSize: true,
      groupsMeetAtMiddle: true,
      groupHeightDifference: 0,
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
    expect(
      await browser.execute(() => document.activeElement?.classList.contains('change-row')),
    ).toBe(true);
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
    await expect($('input[aria-label="Unstage README.md"]')).toBeDisplayed();
    expect(await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).toBe('README.md\n');
    await $('input[aria-label="Unstage README.md"]').click();
    await expect($('input[aria-label="Stage README.md"]')).toBeDisplayed();
    expect(await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).toBe('');
    await dragChangeToArea(
      'section[aria-labelledby="area-worktree"] .change-row',
      'section[aria-labelledby="area-staged"]',
    );
    await expect($('input[aria-label="Unstage README.md"]')).toBeDisplayed();
    expect(await runGit(repositoryPath, ['diff', '--cached', '--name-only'])).toBe('README.md\n');

    const activeCommitTrigger = $(
      '.changes-action-bar .changes-action-button[aria-label="コミット"]',
    );
    await activeCommitTrigger.waitForClickable();
    await activeCommitTrigger.click();
    await expect(activeCommitTrigger).toHaveAttribute('aria-expanded', 'true');
    const commitDialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
    await expect(commitDialog).toBeDisplayed();
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
    await commitDialog.$('[data-commit-field="type"]').setValue('Ss');
    await expect(commitDialog.$('#commit-type-error')).toBeDisplayed();
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
    await commitDialog.$('[data-commit-field="type"]').setValue('feat');
    await expect(commitDialog.$('#commit-type-error')).not.toBeDisplayed();
    await setLogicalWindowSize(1180, 760);
    await commitDialog.$('[data-commit-field="description"]').setValue('E2Eリポジトリを初期化する');
    const commit = commitDialog.$('.commit-form button[type="submit"]');
    await commit.waitForClickable();
    await commit.click();
    await expect(commitDialog).not.toExist();
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
});
