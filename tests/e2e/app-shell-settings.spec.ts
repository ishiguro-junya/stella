import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import { resetApp, selectSetting } from './support/app.js';

describe('App shell and Settings', () => {
  beforeEach(async () => {
    await resetApp({ language: 'ja' });
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
    expect(await browser.tauri.execute(() => document.title)).toBe('Stella');
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

    const conventionalCommits = $('select[name="conventional-commits"]');
    await expect(conventionalCommits).toHaveValue('disabled');
    const conventionalCommitOptions = conventionalCommits.$$('option');
    expect(await conventionalCommitOptions.map((option) => option.getText())).toEqual([
      'Use',
      "Don't Use",
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

    await selectSetting('language', 'ja');
    await expect($('h1=設定')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'ja',
      { timeoutMsg: 'The document language did not change to Japanese.' },
    );
    await expect($('#toolchain-description')).toHaveText(
      '内蔵のGitツールチェーンまたはこの端末にインストールされたものを選択します。',
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => JSON.parse(localStorage.getItem('stella.preferences.v1') ?? '{}').language,
        )) === 'ja',
      { timeoutMsg: 'The Japanese language preference was not saved.' },
    );

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
