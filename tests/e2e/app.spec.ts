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
    await expect($('button[aria-label="Changes"]')).toHaveAttribute('aria-current', 'page');
    const commitToggle = $('.commit-disclosure-toggle');
    await expect(commitToggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      await $$('.remote-action-bar .remote-action-button').map((button) => button.getText()),
    ).toEqual(['Pull', 'Push', 'Fetch']);
    await expect($('[data-commit-field="description"]')).not.toBeDisplayed();
    const repositoryToggle = $(`.repository-toggle[title="${repositoryPath}"]`);
    await expect(repositoryToggle).toBeDisplayed();
    await expect($('.branch-toggle')).toHaveText('main');

    await repositoryToggle.click();
    let switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toBeDisplayed();
    expect(await switcher.getText()).not.toMatch(/Open repositories|Recent|[⌘⇧]/u);
    await browser.keys(['Escape']);

    await $('.branch-toggle').click();
    switcher = $('[role="dialog"][aria-labelledby]');
    await expect(switcher).toBeDisplayed();
    await expect(switcher.$('[role="option"][aria-current="true"]')).toHaveText(
      expect.stringContaining('main'),
    );
    await browser.keys(['Escape']);

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

    const stagedGroup = $('section[aria-labelledby="area-staged"]');
    const unstagedGroup = $('section[aria-labelledby="area-worktree"]');
    await expect(stagedGroup).toBeDisplayed();
    await expect(unstagedGroup).toBeDisplayed();

    const stage = $('input[aria-label="Stage README.md"]');
    await stage.waitForClickable();
    const changesPaneLayout = await browser.execute(() => {
      const sidebar = document.querySelector<HTMLElement>('.changes-sidebar-pane')!;
      const commitSection = sidebar.querySelector<HTMLElement>('.changes-commit-section')!;
      const filesRegion = sidebar.querySelector<HTMLElement>('.changes-files-scroll-region')!;
      const staged = sidebar.querySelector<HTMLElement>('.change-group-staged')!;
      const unstaged = sidebar.querySelector<HTMLElement>('.change-group-worktree')!;
      const stagedContent = staged.querySelector<HTMLElement>('.change-group-content')!;
      const unstagedContent = unstaged.querySelector<HTMLElement>('.change-group-content')!;
      const commitRect = commitSection.getBoundingClientRect();
      const filesRect = filesRegion.getBoundingClientRect();
      const stagedRect = staged.getBoundingClientRect();
      const unstagedRect = unstaged.getBoundingClientRect();

      return {
        commitBeforeFiles: commitRect.bottom <= filesRect.top + 1,
        groupsMeetAtMiddle: Math.abs(stagedRect.bottom - unstagedRect.top) <= 1,
        groupHeightDifference: Math.abs(stagedRect.height - unstagedRect.height),
        stagedOverflow: getComputedStyle(stagedContent).overflowY,
        unstagedOverflow: getComputedStyle(unstagedContent).overflowY,
      };
    });
    expect(changesPaneLayout).toEqual({
      commitBeforeFiles: true,
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

    await commitToggle.waitForClickable();
    await commitToggle.click();
    await expect(commitToggle).toHaveAttribute('aria-expanded', 'true');
    await $('[data-commit-field="description"]').setValue('E2Eリポジトリを初期化する');
    const commit = $('.commit-form button[type="submit"]');
    await commit.waitForClickable();
    await commit.click();
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
    await expect($('#commit-activity-title')).toHaveText('Commit activity');
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLElement>('.activity-panel-header')?.getBoundingClientRect()
            .height,
      ),
    ).toBeLessThanOrEqual(48);
    const activityRange = $('select[aria-label="Commit activity range"]');
    expect(await activityRange.getValue()).toBe('30d');
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLOptionElement>(
            'select[aria-label="Commit activity range"] option',
          ),
          (option) => option.textContent,
        ),
      ),
    ).toEqual(['7 days', '30 days', '90 days', '180 days', '1 year']);
    const operationHeaders = $$('.activity-operation-table thead th');
    const operationHeaderTexts = await operationHeaders.map((header) => header.getText());
    expect(operationHeaderTexts).toEqual(['Status', 'Action', 'Summary', 'Timestamp', 'Duration']);
    await expect($('.activity-list')).toHaveText(expect.stringContaining('Commit'));
    await browser.waitUntil(async () => (await $('.activity-metrics').getText()).includes('1'), {
      timeout: 10_000,
      timeoutMsg: 'Commit activity metrics did not load.',
    });
    await browser.execute(() => {
      const select = document.querySelector<HTMLSelectElement>(
        'select[aria-label="Commit activity range"]',
      );
      if (!select) throw new Error('Commit activity range select was not found.');

      select.value = '7d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await activityRange.getValue()) === '7d', {
      timeout: 10_000,
      timeoutMsg: 'Commit activity range did not change to seven days.',
    });
    await browser.waitUntil(
      async () =>
        (await $('.activity-analytics-summary').isDisplayed()) &&
        (await $('.activity-analytics-summary').getText()).includes('1 commit'),
      {
        timeout: 10_000,
        timeoutMsg: 'Seven-day commit activity did not settle.',
      },
    );
    await expect($('.activity-chart .recharts-wrapper svg.recharts-surface')).toBeDisplayed();
    const chartData = $('.activity-chart-data > summary');
    await expect(chartData).toHaveText('View chart data');
    await chartData.click();
    await expect($('.activity-chart-data table')).toBeDisplayed();

    const settings = $('button[aria-label="Settings"]');
    await settings.click();
    await expect($('#settings-title')).toHaveText('Settings');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await activity.click();
    await expect($('#activity-title')).toHaveText('Activity');
    await expect(activity).toHaveAttribute('aria-current', 'page');

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

    await $('button=History').click();
    await expect($('.history-view')).toBeDisplayed();
    await expect($('button[aria-label="History"]')).toHaveAttribute('aria-current', 'page');
    await expect($('.repository-view-tabs')).not.toExist();
    await expect($('.commit-list')).toHaveText(
      expect.stringContaining('feat: E2Eリポジトリを初期化する'),
    );
    expect(
      await browser.execute(() =>
        getComputedStyle(
          document.querySelector<HTMLElement>('.commit-row[aria-current="true"]')!,
        ).getPropertyValue('box-shadow'),
      ),
    ).toBe('none');

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
      await $('button[aria-label="変更"]').click();
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
