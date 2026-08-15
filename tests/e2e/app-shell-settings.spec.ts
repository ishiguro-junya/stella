import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import { resetApp, selectSetting, setLogicalWindowSize } from './support/app.js';

const execFileAsync = promisify(execFile);

type SettingsCategory = 'general' | 'permissions' | 'appearance' | 'changes' | 'editor' | 'git';

async function openSettingsCategory(category: SettingsCategory): Promise<void> {
  const button = $(`button[data-settings-category="${category}"]`);
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect($(`#settings-category-${category}`)).toBeDisplayed();
}

describe('App shell and Settings', () => {
  beforeEach(async () => {
    await resetApp({ language: 'ja' });
  });

  it('launches the native app', async () => {
    await expect(browser).toHaveTitle('Stella');
    await expect($('[data-testid="app-shell"]')).toBeDisplayed();
    const { stdout: launchServices } = await execFileAsync('/usr/bin/lsappinfo', ['-all', 'list']);
    const app = launchServices
      .split('\n---')
      .find((entry) => entry.includes('/target/release/Stella (TEST)'));
    expect(app).toContain('"LSDisplayName"="Stella (TEST)"');
    const headerButtonLabels = await browser.tauri.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('.app-header button')].map(
        (button) => button.ariaLabel,
      ),
    );
    expect(headerButtonLabels).toHaveLength(1);
    expect(['Settings', '設定']).toContain(headerButtonLabels[0]);
    await expect($('.app-header')).toHaveAttribute('data-tauri-drag-region', 'deep');
  });

  it('exposes the Tauri execute API in the E2E-only build', async () => {
    expect(await browser.tauri.execute(() => document.title)).toBe('Stella');
  });

  it('applies and persists the selected text size and fonts', async () => {
    await $('.titlebar-actions button:last-child').click();
    await openSettingsCategory('appearance');
    await selectSetting('font-size', '120');
    await selectSetting('ui-font', 'avenirNext');
    await selectSetting('code-font', 'menlo');

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const value: unknown = JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}');
          return (
            typeof value === 'object' &&
            value !== null &&
            'fontSize' in value &&
            value.fontSize === 120 &&
            'uiFont' in value &&
            value.uiFont === 'avenirNext' &&
            'codeFont' in value &&
            value.codeFont === 'menlo'
          );
        }),
      { timeoutMsg: 'The typography settings were not saved.' },
    );

    const typography = await browser.execute(() => {
      const code = document.createElement('code');
      code.hidden = true;
      document.body.append(code);
      const result = {
        fontSize: document.documentElement.dataset.fontSize,
        uiFont: document.documentElement.dataset.uiFont,
        codeFont: document.documentElement.dataset.codeFont,
        rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        bodyFontFamily: getComputedStyle(document.body).fontFamily,
        codeFontFamily: getComputedStyle(code).fontFamily,
      };
      code.remove();
      return result;
    });
    expect(typography).toMatchObject({
      fontSize: '120',
      uiFont: 'avenirNext',
      codeFont: 'menlo',
    });
    expect(typography.rootFontSize).toBeCloseTo(19.2);
    expect(typography.bodyFontFamily).toContain('Avenir Next');
    expect(typography.codeFontFamily).toContain('Menlo');

    await browser.refresh();
    await $('[data-testid="app-shell"]').waitForDisplayed({ timeout: 10_000 });
    await $('.titlebar-actions button:last-child').click();
    await openSettingsCategory('appearance');
    await expect($('select[name="font-size"]')).toHaveValue('120');
    await expect($('select[name="ui-font"]')).toHaveValue('avenirNext');
    await expect($('select[name="code-font"]')).toHaveValue('menlo');

    await openSettingsCategory('git');
    await setLogicalWindowSize(860, 560);
    expect(
      await browser.execute(() => {
        const view = document.querySelector<HTMLElement>('.settings-view');
        const detail = document.querySelector<HTMLElement>('.settings-detail');
        return Boolean(
          view &&
          detail &&
          view.scrollWidth <= view.clientWidth &&
          detail.scrollWidth <= detail.clientWidth,
        );
      }),
    ).toBe(true);
  });

  it('opens Settings and applies language, appearance, Commit, stage, and toolchain settings', async () => {
    const settings = $('.titlebar-actions button:last-child');
    await settings.waitForClickable();
    await settings.click();
    expect(['Settings', '設定']).toContain(
      await browser.execute(() => document.activeElement?.getAttribute('aria-label')),
    );
    await selectSetting('language', 'en');
    await expect($('h1=Settings')).toBeDisplayed();
    await expect($('button[data-settings-category="general"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await browser.execute(
        () => document.querySelector('select[name="language"]')?.getBoundingClientRect().height,
      ),
    ).toBe(36);
    await openSettingsCategory('editor');
    expect(
      await browser.execute(
        () =>
          document.querySelector('input[name="editor-wrap-column"]')?.getBoundingClientRect()
            .height,
      ),
    ).toBe(36);
    await openSettingsCategory('permissions');
    const repositoryBasePath = $('input[name="repository-base-path"]');
    await browser.waitUntil(
      async () => /\/Documents\/?$/u.test(await repositoryBasePath.getValue()),
      { timeoutMsg: 'The default repository base path was not resolved to Documents.' },
    );
    await repositoryBasePath.click();
    await repositoryBasePath.setValue('/tmp/stella-repositories');
    await browser.keys('Enter');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').repositoryBasePath,
        )) === '/tmp/stella-repositories',
      { timeoutMsg: 'The absolute repository base path was not saved.' },
    );
    await repositoryBasePath.click();
    await repositoryBasePath.setValue('relative/path');
    await browser.keys('Enter');
    await expect($('#repository-base-path-error')).toBeDisplayed();
    expect(
      await browser.execute(
        () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').repositoryBasePath,
      ),
    ).toBe('/tmp/stella-repositories');
    await expect($('.titlebar-actions')).toHaveAttribute('aria-label', 'App navigation');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    const selectedNavigationColors = await browser.execute(() => {
      const navigation = document.querySelector<HTMLElement>(
        '.titlebar-menu-button[aria-current="page"]',
      );
      const primary = document.createElement('button');
      primary.className = 'primary';
      primary.hidden = true;
      document.body.append(primary);
      const colors = {
        navigation: navigation ? getComputedStyle(navigation).backgroundColor : '',
        primary: getComputedStyle(primary).backgroundColor,
      };
      primary.remove();
      return colors;
    });
    expect(selectedNavigationColors.navigation).not.toBe('rgba(0, 0, 0, 0)');
    expect(selectedNavigationColors.navigation).not.toBe(selectedNavigationColors.primary);
    await expect(settings).toHaveText('Settings');
    expect(
      await browser.execute(
        () => document.querySelectorAll<HTMLButtonElement>('.titlebar-actions button').length,
      ),
    ).toBe(2);
    await expect($('button[aria-label="Repositories"]')).toHaveText('Repositories');

    await openSettingsCategory('changes');
    const changeListDisplay = $('select[name="change-list-display"]');
    await expect(changeListDisplay).toHaveValue('fullPath');
    expect(await changeListDisplay.$$('option').map((option) => option.getText())).toEqual([
      'Full Path',
      'Tree',
      'File Name and Path',
    ]);

    await openSettingsCategory('appearance');
    await selectSetting('appearance', 'dark');
    expect(
      await browser.tauri.execute(() => ({
        theme: document.documentElement.dataset.theme,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      })),
    ).toEqual({ theme: 'dark', colorScheme: 'dark' });
    expect(
      await browser.tauri.execute(() => {
        const primary = document.createElement('button');
        primary.className = 'primary';
        primary.hidden = true;
        document.body.append(primary);
        const background = getComputedStyle(primary).backgroundColor;
        primary.remove();
        return background;
      }),
    ).toBe('rgb(20, 115, 230)');
    await selectSetting('appearance', 'light');
    expect(
      await browser.tauri.execute(() => ({
        theme: document.documentElement.dataset.theme,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      })),
    ).toEqual({ theme: 'light', colorScheme: 'light' });
    expect(
      await browser.tauri.execute(() => {
        const primary = document.createElement('button');
        primary.className = 'primary';
        primary.hidden = true;
        document.body.append(primary);
        const background = getComputedStyle(primary).backgroundColor;
        primary.remove();
        return background;
      }),
    ).toBe('rgb(8, 127, 245)');
    await selectSetting('appearance', 'system');
    const systemAppearance = await browser.tauri.execute(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      preferred: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }));
    expect(systemAppearance.theme).toBeNull();
    expect(systemAppearance.colorScheme).toBe(systemAppearance.preferred);

    await openSettingsCategory('general');
    const automaticUpdates = $('select[name="automatic-update-checks"]');
    await expect(automaticUpdates).toHaveValue('enabled');
    await selectSetting('automatic-update-checks', 'disabled');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').automaticUpdateChecks,
        )) === false,
      { timeoutMsg: 'The automatic update setting was not saved.' },
    );
    await selectSetting('automatic-update-checks', 'enabled');

    await openSettingsCategory('editor');
    await selectSetting('editor-line-wrapping', 'enabled');
    const wrapColumn = $('input[name="editor-wrap-column"]');
    await wrapColumn.waitForEnabled();
    await wrapColumn.setValue('100');
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const value: unknown = JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}');
          return (
            typeof value === 'object' &&
            value !== null &&
            'editorLineWrapping' in value &&
            value.editorLineWrapping === true &&
            'editorWrapColumn' in value &&
            value.editorWrapColumn === 100
          );
        }),
      { timeoutMsg: 'The editor line wrapping settings were not saved.' },
    );

    await openSettingsCategory('changes');
    const conventionalCommits = $('select[name="conventional-commits"]');
    await expect(conventionalCommits).toHaveValue('disabled');
    const conventionalCommitOptions = conventionalCommits.$$('option');
    expect(await conventionalCommitOptions.map((option) => option.getText())).toEqual([
      "Don't Use",
      'Use',
    ]);
    await selectSetting('conventional-commits', 'enabled');
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const value: unknown = JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}');
          return (
            typeof value === 'object' &&
            value !== null &&
            'useConventionalCommits' in value &&
            value.useConventionalCommits === true
          );
        }),
      { timeoutMsg: 'The Conventional Commits setting was not saved.' },
    );

    await openSettingsCategory('git');
    const toolchain = $('section[aria-labelledby="toolchain-title"]');
    await expect(toolchain).toBeDisplayed();
    await browser.waitUntil(
      async () => (await toolchain.$$('.settings-toolchain-components dd').length) === 3,
      { timeoutMsg: 'The Git toolchain status did not load.' },
    );
    const toolchainLayout = await browser.execute(() => {
      const copyLeft = document
        .querySelector<HTMLElement>('.settings-toolchain-row .settings-row-copy')
        ?.getBoundingClientRect().left;
      const componentLefts = [
        ...document.querySelectorAll<HTMLElement>('.settings-toolchain-components dt'),
      ].map((component) => component.getBoundingClientRect().left);
      const modes = document.querySelector<HTMLElement>('.settings-toolchain-modes');
      const components = document.querySelector<HTMLElement>('.settings-toolchain-components');
      const text = document.querySelector<HTMLElement>('.settings-toolchain-row')?.innerText ?? '';
      return {
        copyLeft,
        componentLefts,
        modeLeft: modes?.getBoundingClientRect().left,
        modeBottom: modes?.getBoundingClientRect().bottom,
        componentTop: components?.getBoundingClientRect().top,
        text,
      };
    });
    expect(toolchainLayout.componentLefts).toHaveLength(3);
    expect(
      toolchainLayout.copyLeft !== undefined &&
        toolchainLayout.componentLefts.every(
          (componentLeft) => Math.abs(componentLeft - toolchainLayout.copyLeft!) <= 0.5,
        ),
    ).toBe(true);
    expect(toolchainLayout.modeLeft).toBe(toolchainLayout.copyLeft);
    expect(
      toolchainLayout.modeBottom !== undefined &&
        toolchainLayout.componentTop !== undefined &&
        toolchainLayout.modeBottom <= toolchainLayout.componentTop,
    ).toBe(true);
    expect(toolchainLayout.text).toContain('Current session');
    expect(toolchainLayout.text).toContain('Next launch');

    const toolchainControl = toolchain.$('.settings-toolchain-control');
    const activeModeValue = await toolchainControl.getAttribute('data-active-mode');
    if (activeModeValue !== 'bundled' && activeModeValue !== 'system') {
      throw new Error(`Unexpected active toolchain mode: ${activeModeValue}`);
    }
    const activeMode = activeModeValue;
    const selectedModeValue = await toolchainControl.getAttribute('data-selected-mode');
    if (selectedModeValue !== 'bundled' && selectedModeValue !== 'system') {
      throw new Error(`Unexpected selected toolchain mode: ${selectedModeValue}`);
    }
    const startingSelectedMode = selectedModeValue;
    const selectToolchainMode = async (mode: 'bundled' | 'system'): Promise<void> => {
      await selectSetting('toolchain', mode);
      await browser.waitUntil(
        async () => (await toolchainControl.getAttribute('data-selected-mode')) === mode,
        { timeoutMsg: `The ${mode} toolchain setting was not saved.` },
      );
    };

    try {
      await selectToolchainMode('bundled');
      await expect(toolchain).toHaveText(expect.stringContaining('git version 2.55.0'));
      await expect(toolchain).toHaveText(expect.stringContaining('git-lfs/3.7.1'));
      await expect(toolchain).toHaveText(expect.stringContaining('1.2.0'));
      const pendingMode = activeMode === 'bundled' ? 'system' : 'bundled';
      await selectToolchainMode(pendingMode);
      await expect(toolchain.$('.settings-restart-notice')).toBeDisplayed();
      const modeLabels = await toolchain
        .$$('.settings-toolchain-modes dd')
        .map((item) => item.getText());
      expect(modeLabels).toEqual([
        activeMode === 'bundled' ? 'Bundled' : 'System',
        pendingMode === 'bundled' ? 'Bundled' : 'System',
      ]);
    } finally {
      await selectToolchainMode(startingSelectedMode);
    }
    if (startingSelectedMode === activeMode) {
      await expect(toolchain.$('.settings-restart-notice')).not.toExist();
    } else {
      await expect(toolchain.$('.settings-restart-notice')).toBeDisplayed();
    }

    await openSettingsCategory('general');
    await selectSetting('language', 'ja');
    await expect($('h1=設定')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'ja',
      { timeoutMsg: 'The document language did not change to Japanese.' },
    );
    await openSettingsCategory('git');
    await expect($('#toolchain-description')).toHaveText(
      'Gitツールチェーンを内蔵のまたはこの端末にインストールされたもののどちらを使用するか選択します。選択は再起動で反映されます。',
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').language,
        )) === 'ja',
      { timeoutMsg: 'The Japanese language preference was not saved.' },
    );

    await openSettingsCategory('general');
    await selectSetting('language', 'en');
    await expect($('h1=Settings')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'en',
      { timeoutMsg: 'The document language did not change to English.' },
    );
    await selectSetting('language', 'ja');
    await expect($('h1=設定')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'ja',
      { timeoutMsg: 'The document language did not return to Japanese.' },
    );

    await openSettingsCategory('changes');
    const stageDisplay = $('select[name="stage-display"]');
    await expect(stageDisplay).toHaveValue('hide');
    expect(
      await browser.execute(() =>
        [
          ...document.querySelectorAll<HTMLOptionElement>('select[name="stage-display"] option'),
        ].map((option) => option.textContent),
      ),
    ).toEqual(['表示する', '表示しない']);
    await selectSetting('stage-display', 'show');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').splitStageView,
        )) === true,
      { timeoutMsg: 'The separate stage display preference was not saved.' },
    );
    await selectSetting('stage-display', 'hide');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').splitStageView,
        )) === false,
      { timeoutMsg: 'The hidden stage display preference was not saved.' },
    );
    await openSettingsCategory('editor');
    await expect($('select[name="sticky-file-headers"]')).toHaveValue('disabled');
    await selectSetting('sticky-file-headers', 'enabled');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').stickyFileHeaders,
        )) === true,
      { timeoutMsg: 'The sticky file header preference was not saved.' },
    );
    await selectSetting('sticky-file-headers', 'disabled');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').stickyFileHeaders,
        )) === false,
      { timeoutMsg: 'The non-sticky file header preference was not saved.' },
    );
    await $('button[aria-label="リポジトリ"]').click();
    await expect($('[data-testid="app-shell"]')).toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.id)).toBe('repositories-title');
  });
});
