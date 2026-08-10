import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const visualQaDirectory = process.env.STELLA_VISUAL_QA_DIR;

async function createVisualRepository(root: string, name: string, dirty = false): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await run('/usr/bin/git', ['-C', path, 'init', '-b', 'main']);
  await run('/usr/bin/git', ['-C', path, 'config', 'user.name', 'Stella Visual QA']);
  await run('/usr/bin/git', [
    '-C',
    path,
    'config',
    'user.email',
    'stella-visual-qa@example.invalid',
  ]);
  await run('/usr/bin/git', ['-C', path, 'config', 'commit.gpgsign', 'false']);
  await writeFile(join(path, 'README.md'), `# ${name}\n`, 'utf8');
  await run('/usr/bin/git', ['-C', path, 'add', 'README.md']);
  await run('/usr/bin/git', ['-C', path, 'commit', '-m', 'Initial commit']);
  if (dirty)
    await writeFile(join(path, 'README.md'), `# ${name}\n\nModified for visual QA.\n`, 'utf8');
  return realpath(path);
}

async function openRepositoryFromSwitcher(path: string): Promise<void> {
  await $('.repository-toggle').click();
  const switcher = $('[role="dialog"]');
  await expect(switcher).toBeDisplayed();
  await switcher.$('button=Add Repository…').click();
  const attachDialog = $('[role="alertdialog"]');
  await expect(attachDialog).toBeDisplayed();
  await attachDialog.$('input').setValue(path);
  await attachDialog.$('button=Add').click();
  await $(`.repository-toggle[title="${path}"]`).waitForDisplayed({ timeout: 10_000 });
}

async function setLogicalWindowSize(width: number, height: number): Promise<number> {
  const scaleFactor = await browser.tauri.execute(() => window.devicePixelRatio);
  await browser.setWindowSize(Math.round(width * scaleFactor), Math.round(height * scaleFactor));
  return scaleFactor;
}

async function saveLogicalScreenshot(path: string, width: number, height: number): Promise<void> {
  const scaleFactor = await setLogicalWindowSize(width, height);
  await browser.saveScreenshot(path);
  if (scaleFactor !== 1) {
    await run('/usr/bin/sips', ['-z', String(height), String(width), path]);
  }
}

async function waitForChangesOrThrow(): Promise<void> {
  const runtimeErrorSelector = '[role="alertdialog"][aria-labelledby="runtime-error-title"]';
  await browser.waitUntil(
    async () =>
      (await $('.changes-view').isExisting()) || (await $(runtimeErrorSelector).isExisting()),
    {
      timeout: 10_000,
      timeoutMsg: 'Neither the Changes view nor an error dialog appeared.',
    },
  );

  const error = $(runtimeErrorSelector);
  if (await error.isExisting()) {
    throw new Error(`Adding the repository failed: ${await error.getText()}`);
  }
}

async function dragChangeToArea(sourceSelector: string, targetSelector: string): Promise<void> {
  const dragStarted = await browser.execute((source) => {
    const sourceElement = document.querySelector<HTMLElement>(source);
    if (!sourceElement) return false;

    const dataTransfer = new DataTransfer();
    sourceElement.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
    );
    const hasStellaToken = dataTransfer.types.includes('application/x-stella-change');
    (window as Window & { stellaE2eDrag?: DataTransfer }).stellaE2eDrag = dataTransfer;
    return hasStellaToken;
  }, sourceSelector);
  expect(dragStarted).toBe(true);

  await browser.waitUntil(async () => $(targetSelector).isExisting(), {
    timeout: 2_000,
    timeoutMsg: 'The empty drag target did not appear.',
  });

  const dropped = await browser.execute(
    (source, target) => {
      const sourceElement = document.querySelector<HTMLElement>(source);
      const targetElement = document.querySelector<HTMLElement>(target);
      const dragWindow = window as Window & { stellaE2eDrag?: DataTransfer };
      const dataTransfer = dragWindow.stellaE2eDrag;
      if (!sourceElement || !targetElement || !dataTransfer) return false;
      for (const type of ['dragover', 'drop']) {
        targetElement.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
        );
      }
      sourceElement.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }),
      );
      delete dragWindow.stellaE2eDrag;
      return true;
    },
    sourceSelector,
    targetSelector,
  );
  expect(dropped).toBe(true);
}

describe('Stella app shell', () => {
  let repositoryPath = '';

  before(async () => {
    repositoryPath = await realpath(await mkdtemp(join(tmpdir(), 'stella-e2e-')));
  });

  after(async () => {
    if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true });
  });

  it('launches the native app', async () => {
    await expect(browser).toHaveTitle('Stella');
    await expect($('[data-testid="app-shell"]')).toBeDisplayed();
    const titlebarButtonLabels = await browser.tauri.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('.titlebar button')].map(
        (button) => button.ariaLabel,
      ),
    );
    expect(titlebarButtonLabels).toHaveLength(1);
    expect(['Settings', '設定']).toContain(titlebarButtonLabels[0]);
  });

  it('exposes the Tauri execute API in the E2E-only build', async () => {
    const title = await browser.tauri.execute(() => document.title);

    expect(title).toBe('Stella');
  });

  it('opens Settings from the titlebar and applies each appearance immediately', async () => {
    const settings = $('.titlebar-actions button:last-child');
    await settings.waitForClickable();
    await settings.click();
    expect(['Settings', '設定']).toContain(
      await browser.execute(() => document.activeElement?.getAttribute('aria-label')),
    );
    await $('label*=English').click();
    await expect($('h1=Settings')).toBeDisplayed();
    await expect($('.titlebar-actions')).toHaveAttribute('aria-label', 'App navigation');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(settings).toHaveText('Settings');
    expect(
      await browser.execute(
        () => document.querySelectorAll<HTMLButtonElement>('.titlebar-actions button').length,
      ),
    ).toBe(2);
    await expect($('button[aria-label="Repositories"]')).toHaveText('Repositories');
    await $('label*=Dark').click();
    expect(
      await browser.tauri.execute(() => ({
        theme: document.documentElement.dataset.theme,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      })),
    ).toEqual({ theme: 'dark', colorScheme: 'dark' });

    await $('label*=Light').click();
    expect(
      await browser.tauri.execute(() => ({
        theme: document.documentElement.dataset.theme,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      })),
    ).toEqual({ theme: 'light', colorScheme: 'light' });

    await $('label*=System').click();
    const systemAppearance = await browser.tauri.execute(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      preferred: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }));
    expect(systemAppearance.theme).toBeNull();
    expect(systemAppearance.colorScheme).toBe(systemAppearance.preferred);

    await $('label*=日本語').click();
    await expect($('h1=設定')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'ja',
      { timeoutMsg: 'The document language did not change to Japanese.' },
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').language,
        )) === 'ja',
      { timeoutMsg: 'The Japanese language preference was not saved.' },
    );

    await $('label*=English').click();
    await expect($('h1=Settings')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'en',
      { timeoutMsg: 'The document language did not change to English.' },
    );

    await $('button[aria-label="Repositories"]').click();
    await expect($('[data-testid="app-shell"]')).toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.id)).toBe('repositories-title');
  });

  it('opens a path, creates a repository when needed, and shows Changes and History', async () => {
    await expect($('[data-testid="app-shell"]')).toBeDisplayed();
    await $('button=Add Repository').click();

    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toBeDisplayed();
    await dialog.$('input').setValue(repositoryPath);
    await dialog.$('button=Add').click();

    await waitForChangesOrThrow();
    await expect($('.changes-view')).toBeDisplayed();
    await expect($('.repository-view-tabs')).not.toExist();
    const titlebarDestinations = $$('.titlebar-actions .titlebar-menu-button');
    expect(await titlebarDestinations.map((button) => button.getText())).toEqual([
      'Changes',
      'History',
      'Activity',
      'Settings',
    ]);
    expect(
      await browser.tauri.execute(() =>
        [...document.querySelectorAll('.titlebar-context, .titlebar-actions')].every((element) =>
          element.hasAttribute('data-tauri-drag-region'),
        ),
      ),
    ).toBe(true);
    await expect($('button[aria-label="Changes"]')).toHaveAttribute('aria-current', 'page');
    const commitTrigger = $('.changes-action-bar .changes-action-button[aria-label="Commit"]');
    await expect(commitTrigger).toHaveAttribute('aria-expanded', 'false');
    const actionButtons = $$('.changes-action-bar .changes-action-button');
    expect(await actionButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Commit',
      'Pull',
      'Push',
      'Fetch',
    ]);
    expect(await actionButtons.map((button) => button.getAttribute('title'))).toEqual([
      'Commit',
      'Pull',
      'Push',
      'Fetch',
    ]);
    await expect($('[role="dialog"] [data-commit-field="description"]')).not.toExist();
    const repositoryToggle = $(`.repository-toggle[title="${repositoryPath}"]`);
    await expect(repositoryToggle).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText('main');
    const longBranchFits = await browser.execute(() => {
      const toggle = document.querySelector<HTMLButtonElement>('.branch-toggle');
      const label = toggle?.querySelector<HTMLSpanElement>('span');
      if (!label) return false;

      const currentLabel = label.textContent;
      label.textContent = 'feature/keep-a-branch-name-this-long-visible';
      const fits = label.scrollWidth <= label.clientWidth;
      label.textContent = currentLabel;
      return fits;
    });
    expect(longBranchFits).toBe(true);

    await repositoryToggle.click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toBeDisplayed();
    expect(await switcher.getText()).not.toMatch(/Open repositories|Recent|[⌘⇧]/u);
    await browser.keys(['Escape']);

    const branchToggle = $('.branch-toggle');
    await branchToggle.click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toHaveText(
      expect.stringContaining('main'),
    );
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

    await run('/usr/bin/git', ['-C', repositoryPath, 'config', 'user.name', 'Stella E2E']);
    await run('/usr/bin/git', [
      '-C',
      repositoryPath,
      'config',
      'user.email',
      'stella-e2e@example.invalid',
    ]);
    await run('/usr/bin/git', ['-C', repositoryPath, 'config', 'commit.gpgsign', 'false']);
    await writeFile(join(repositoryPath, 'README.md'), '# Stella E2E\n', 'utf8');

    await $('input[aria-label="Stage README.md"]').waitForClickable();
    await $('button=History').click();
    const uncommittedChanges = $('.history-working-tree-entry');
    await expect(uncommittedChanges).toBeDisplayed();
    await expect(uncommittedChanges).toHaveText(expect.stringContaining('Uncommitted changes'));
    await expect(uncommittedChanges).toHaveText(expect.stringContaining('1 file'));
    await expect($('.history-working-tree-graph')).toHaveAttribute(
      'style',
      expect.stringContaining('--history-lane-color: var(--text-muted)'),
    );
    await $('button=Changes').click();
    const stagedGroup = $('section[aria-labelledby="area-staged"]');
    const unstagedGroup = $('section[aria-labelledby="area-worktree"]');
    await expect(stagedGroup).toBeDisplayed();
    await expect(unstagedGroup).toBeDisplayed();
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

      return {
        actionsBeforeFiles: actionRect.bottom <= filesRect.top + 1,
        actionLabelsHidden: actionButtonElements.every(
          (button) => getComputedStyle(button.querySelector('span')!).display === 'none',
        ),
        actionIconsKeepNormalSize: actionButtonElements.every((button) => {
          const icon = button.querySelector<SVGElement>('.lucide')!;
          return (
            getComputedStyle(icon).width === '13px' && getComputedStyle(icon).height === '13px'
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
      actionLabelsHidden: true,
      actionIconsKeepNormalSize: true,
      groupsMeetAtMiddle: true,
      groupHeightDifference: 0,
      stagedOverflow: 'auto',
      unstagedOverflow: 'auto',
    });
    const expandedActionLayout = await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>('.changes-view')!;
      const originalLeftPane = workspace.style.getPropertyValue('--left-pane');
      workspace.style.setProperty('--left-pane', '360px');
      workspace.getBoundingClientRect();
      const buttons = [...workspace.querySelectorAll<HTMLElement>('.changes-action-button')];
      const result = {
        labelsVisible: buttons.every(
          (button) => getComputedStyle(button.querySelector('span')!).display !== 'none',
        ),
        textKeepsNormalSize: buttons.every(
          (button) => getComputedStyle(button).fontSize === '11px',
        ),
        iconsKeepNormalSize: buttons.every((button) => {
          const icon = button.querySelector<SVGElement>('.lucide')!;
          return (
            getComputedStyle(icon).width === '13px' && getComputedStyle(icon).height === '13px'
          );
        }),
      };
      workspace.style.setProperty('--left-pane', originalLeftPane);
      return result;
    });
    expect(expandedActionLayout).toEqual({
      labelsVisible: true,
      textKeepsNormalSize: true,
      iconsKeepNormalSize: true,
    });

    await $('button.change-row').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
          return Boolean(host?.shadowRoot?.querySelector('[data-line-type]'));
        }),
      {
        timeout: 10_000,
        timeoutMsg: 'Selecting a changed file did not render any diff lines.',
      },
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
    await expect(stagedGroup).toBeDisplayed();
    expect(
      (await run('/usr/bin/git', ['-C', repositoryPath, 'diff', '--cached', '--name-only'])).stdout,
    ).toBe('README.md\n');

    await $('input[aria-label="Unstage README.md"]').click();
    await expect($('input[aria-label="Stage README.md"]')).toBeDisplayed();
    expect(
      (await run('/usr/bin/git', ['-C', repositoryPath, 'diff', '--cached', '--name-only'])).stdout,
    ).toBe('');
    await dragChangeToArea(
      'section[aria-labelledby="area-worktree"] .change-row',
      'section[aria-labelledby="area-staged"]',
    );
    await expect($('input[aria-label="Unstage README.md"]')).toBeDisplayed();
    expect(
      (await run('/usr/bin/git', ['-C', repositoryPath, 'diff', '--cached', '--name-only'])).stdout,
    ).toBe('README.md\n');

    const activeCommitTrigger = $(
      '.changes-action-bar .changes-action-button[aria-label="Commit"]',
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
        const commitDialogElement = document.querySelector<HTMLElement>('[role="dialog"]');
        if (!commitDialogElement) return false;
        const rect = commitDialogElement.getBoundingClientRect();
        return (
          rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
        );
      }),
    ).toBe(true);
    const dialogHeightBeforeValidation = await browser.execute(
      () =>
        document.querySelector<HTMLElement>('[role="dialog"]')?.getBoundingClientRect().height ?? 0,
    );
    await commitDialog.$('[data-commit-field="type"]').setValue('Ss');
    await expect(commitDialog.$('#commit-type-error')).toBeDisplayed();
    const validationLayout = await browser.execute(() => {
      const commitDialogElement = document.querySelector<HTMLElement>('[role="dialog"]');
      const type = document.querySelector<HTMLElement>('[data-commit-field="type"]');
      const scope = document.querySelector<HTMLElement>('[data-commit-field="scope"]');
      if (!commitDialogElement || !type || !scope) return undefined;
      return {
        dialogHeight: commitDialogElement.getBoundingClientRect().height,
        fieldsAligned: Math.abs(
          type.getBoundingClientRect().top - scope.getBoundingClientRect().top,
        ),
      };
    });
    expect(
      Math.abs((validationLayout?.dialogHeight ?? 0) - dialogHeightBeforeValidation),
    ).toBeLessThanOrEqual(1);
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

    const activity = $('button[aria-label="Activity"]');
    await expect(activity).toHaveText('Activity');
    await expect($('button[aria-label="Settings"]')).toHaveText('Settings');
    await activity.click();
    await expect($('.activity-view')).toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'Activity',
    );
    await expect(activity).toHaveAttribute('aria-current', 'page');
    await expect(repositoryToggle).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText('main');
    await activity.click();
    await expect($('.activity-view')).toBeDisplayed();
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector<HTMLElement>('button[aria-label="Activity"]')!,
        ).getPropertyValue('box-shadow'),
      ),
    ).toBe('none');
    await expect($('#activity-title')).toHaveText('Activity');
    const activityPanelHeader = $('.activity-panel-header');
    await expect(activityPanelHeader).toBeDisplayed();
    await expect($('#commit-activity-title')).toHaveText('Repository analytics');
    await expect($('#commit-activity-title')).toHaveElementClass('sr-only');
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLElement>('.activity-panel-header')?.getBoundingClientRect()
            .height,
      ),
    ).toBeLessThanOrEqual(48);
    const activityRange = $('select[aria-label="Activity range"]');
    expect(await activityRange.getValue()).toBe('30d');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>(
            'select[aria-label="Activity range"] option',
          ),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['7 days', '30 days', '90 days', '180 days', '1 year']);
    const activityMetric = $('select[aria-label="Activity metric"]');
    expect(await activityMetric.getValue()).toBe('commits');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>(
            'select[aria-label="Activity metric"] option',
          ),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['Commits', 'Contributors', 'Branches']);
    expect(
      await browser.execute(() => {
        const metric = document.querySelector('select[aria-label="Activity metric"]');
        const range = document.querySelector('select[aria-label="Activity range"]');
        return Boolean(
          metric &&
          range &&
          metric.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    const operationHeaders = $$('.activity-operation-table thead th');
    const operationHeaderTexts = await operationHeaders.map((header) => header.getText());
    expect(operationHeaderTexts).toEqual(['Status', 'Action', 'Summary', 'Timestamp', 'Duration']);
    await expect($('.activity-list')).toHaveText(expect.stringContaining('Commit'));
    expect(
      await browser.execute(() => {
        const status = document.querySelector<HTMLElement>('.activity-list tbody td:first-child');
        const details = document.querySelector<HTMLElement>('.activity-details');
        return {
          statusPaddingLeft: status ? Number.parseFloat(getComputedStyle(status).paddingLeft) : 0,
          detailPaddingLeft: details ? Number.parseFloat(getComputedStyle(details).paddingLeft) : 0,
        };
      }),
    ).toEqual({ statusPaddingLeft: 14, detailPaddingLeft: 18 });
    await browser.waitUntil(
      async () => (await $('.activity-chart-data').getText()).includes('1 commit'),
      {
        timeout: 10_000,
        timeoutMsg: 'Commit activity data did not load.',
      },
    );
    await expect($('.activity-metrics')).not.toExist();
    await expect($('.activity-analytics-summary')).not.toExist();
    await expect($('.activity-chart-data table')).toBeDisplayed();
    expect(await $$('.activity-chart-data thead th').map((header) => header.getText())).toEqual([
      'Period',
      'Commits',
      'Contributors',
      'Branches',
    ]);
    const activityResizer = $('[role="separator"][aria-label="Operations width"]');
    await expect(activityResizer).toHaveAttribute('aria-valuenow', '560');
    await activityResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(activityResizer).toHaveAttribute('aria-valuenow', '552');
    expect(
      await browser.execute(() => {
        const container = document.querySelector<HTMLElement>('.activity-chart-data > div');
        return {
          overflowY: container ? getComputedStyle(container).overflowY : '',
          scrollable: Boolean(container && container.scrollHeight > container.clientHeight),
        };
      }),
    ).toEqual({ overflowY: 'auto', scrollable: true });
    const setActivityMetric = async (value: 'commits' | 'contributors' | 'branches') => {
      await browser.execute((nextValue) => {
        const select = document.querySelector<HTMLSelectElement>(
          'select[aria-label="Activity metric"]',
        );
        if (!select) throw new Error('Activity metric select was not found.');

        select.value = nextValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await browser.waitUntil(async () => (await activityMetric.getValue()) === value, {
        timeout: 10_000,
        timeoutMsg: `Activity metric did not change to ${value}.`,
      });
    };
    await setActivityMetric('contributors');
    await setActivityMetric('branches');
    await setActivityMetric('commits');
    await browser.execute(() => {
      const select = document.querySelector<HTMLSelectElement>(
        'select[aria-label="Activity range"]',
      );
      if (!select) throw new Error('Activity range select was not found.');

      select.value = '7d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await activityRange.getValue()) === '7d', {
      timeout: 10_000,
      timeoutMsg: 'Activity range did not change to seven days.',
    });
    await browser.waitUntil(
      async () => (await $('.activity-chart-data').getText()).includes('1 commit'),
      {
        timeout: 10_000,
        timeoutMsg: 'Seven-day commit activity did not settle.',
      },
    );
    await expect($('.activity-chart .recharts-wrapper svg.recharts-surface')).toBeDisplayed();
    await expect($('.activity-chart-data table')).toBeDisplayed();

    const settings = $('button[aria-label="Settings"]');
    await settings.click();
    await expect($('#settings-title')).toHaveText('Settings');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await activity.click();
    await expect($('#activity-title')).toHaveText('Activity');
    await expect(activity).toHaveAttribute('aria-current', 'page');
    await expect($('[role="separator"][aria-label="Operations width"]')).toHaveAttribute(
      'aria-valuenow',
      '552',
    );

    await browser.keys(['Escape']);
    await expect($('.activity-view')).toBeDisplayed();
    await expect(activity).toHaveAttribute('aria-current', 'page');
    const changes = $('button[aria-label="Changes"]');
    await changes.click();
    await expect($('.changes-view')).toBeDisplayed();
    await expect(activity).not.toHaveAttribute('aria-current');
    expect(
      await browser.execute(
        (selector) => document.activeElement === document.querySelector(selector),
        'button[aria-label="Changes"]',
      ),
    ).toBe(true);
    const changesResizer = $('[role="separator"][aria-label="Changes list width"]');
    await expect(changesResizer).toHaveAttribute('aria-valuenow', '244');
    await changesResizer.click();
    await browser.keys(['ArrowRight']);
    await expect(changesResizer).toHaveAttribute('aria-valuenow', '252');

    await $('button=History').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('button[aria-label="History"]')).toHaveAttribute('aria-current', 'page');
    await expect($('.repository-view-tabs')).not.toExist();
    const historyResizer = $('[role="separator"][aria-label="History list width"]');
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '244');
    await historyResizer.click();
    await browser.keys(['ArrowLeft']);
    await expect(historyResizer).toHaveAttribute('aria-valuenow', '236');
    await activity.click();
    await expect($('[role="separator"][aria-label="Operations width"]')).toHaveAttribute(
      'aria-valuenow',
      '552',
    );
    await $('button=History').click();
    await expect($('[role="separator"][aria-label="History list width"]')).toHaveAttribute(
      'aria-valuenow',
      '236',
    );
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: E2Eリポジトリを初期化する'),
    );
    const historySearch = $('input[aria-label="Search history"]');
    await expect(historySearch).toBeDisplayed();
    await historySearch.setValue('E2Eリポジトリ');
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: E2Eリポジトリを初期化する'),
    );
    await historySearch.setValue('一致しない検索');
    await expect($('.history-search-empty')).toHaveText('No commits match your search.');
    await historySearch.setValue('');
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const host = document.querySelector<HTMLElement>('.diff-surface diffs-container');
          return host?.shadowRoot?.textContent?.includes('README.md') ?? false;
        }),
      {
        timeout: 10_000,
        timeoutMsg: 'The History diff did not display its file name.',
      },
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

    const historyActions = $('button=Actions');
    await historyActions.click();
    const historyActionsDialog = $('[role="dialog"][aria-labelledby="history-actions-title"]');
    await expect(historyActionsDialog).toBeDisplayed();
    expect(
      await browser.execute(
        () =>
          document.activeElement ===
          document.querySelector('#history-actions-dialog input[data-dialog-initial-focus]'),
      ),
    ).toBe(true);
    await browser.keys(['Escape']);
    await expect(historyActionsDialog).not.toExist();
    expect(
      await browser.execute(
        (selector) => document.activeElement === document.querySelector(selector),
        '.history-actions-toggle',
      ),
    ).toBe(true);

    await $('button=Changes').click();
    await expect($('.changes-view')).toBeDisplayed();
  });

  it('captures repository and branch switcher visual QA states when requested', async function () {
    this.timeout(180_000);
    if (!visualQaDirectory) return;

    const visualRoot = await realpath(await mkdtemp(join(tmpdir(), 'stella-switcher-qa-')));
    try {
      await mkdir(visualQaDirectory, { recursive: true });
      const currentPath = await createVisualRepository(visualRoot, 'stella-visual-qa', true);
      const conflictPath = await createVisualRepository(visualRoot, 'stella-conflict', true);
      const manualPath = await createVisualRepository(visualRoot, 'stella-manual');
      await run('/usr/bin/git', ['-C', currentPath, 'branch', 'feature/search']);
      await run('/usr/bin/git', ['-C', currentPath, 'branch', 'release']);

      await openRepositoryFromSwitcher(currentPath);
      await openRepositoryFromSwitcher(conflictPath);
      await openRepositoryFromSwitcher(manualPath);

      let repositoryToggle = $('.repository-toggle');
      await repositoryToggle.click();
      let switcher = $('[role="dialog"]');
      const repositoryOptions = switcher.$$('[role="option"]');
      const repositoryOptionTexts = await repositoryOptions.map((option) => option.getText());
      const currentOption =
        repositoryOptions[repositoryOptionTexts.findIndex((text) => text.includes(currentPath))];
      if (!currentOption) throw new Error('The visual QA repository was not in the switcher.');
      await currentOption.click();
      repositoryToggle = $(`.repository-toggle[title="${currentPath}"]`);
      await repositoryToggle.waitForDisplayed({ timeout: 10_000 });

      await setLogicalWindowSize(1180, 760);
      const diffLayout = $('fieldset[aria-label="Diff layout"]');
      const unified = diffLayout.$('button=Unified');
      await expect(unified).toHaveAttribute('aria-pressed', 'true');
      await saveLogicalScreenshot(
        join(visualQaDirectory, 'segmented-changes-unified-1180x760.png'),
        1180,
        760,
      );
      const split = diffLayout.$('button=Split');
      await split.click();
      await expect(split).toHaveAttribute('aria-pressed', 'true');
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
      await $('button=Changes').click();
      await expect($('.changes-view')).toBeDisplayed();

      await repositoryToggle.click();
      switcher = $('[role="dialog"]');
      await expect($('[role="dialog"] .switcher-list')).toBeDisplayed();
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

      const settings = $('.titlebar-actions button:last-child');
      await settings.click();
      await $('input[type="radio"][value="en"]').click();
      await $('label*=Light').click();
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

      await $('label*=日本語').click();
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
      await $('button[aria-label="変更差分"]').click();
      await saveLogicalScreenshot(join(visualQaDirectory, 'changes-ja-1180x760.png'), 1180, 760);
      await saveLogicalScreenshot(join(visualQaDirectory, 'changes-ja-860x560.png'), 860, 560);
      await settings.click();
      await $('label*=English').click();
      await $('label*=Dark').click();
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
      await expect($('button[aria-label="30 days"]')).toHaveAttribute('aria-pressed', 'true');
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
      await $('label*=Light').click();
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
      await $('[role="alertdialog"]').$('button=Cancel').click();

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
      await rm(visualRoot, { recursive: true, force: true });
    }
  });
});
