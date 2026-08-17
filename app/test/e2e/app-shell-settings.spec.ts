import { $, browser, expect } from '@wdio/globals';
import '@wdio/tauri-service';

import {
  debugAt,
  expectInteractiveSelectedColors,
  resetApp,
  selectSetting,
  setLogicalWindowSize,
} from './support/app.js';

type SettingsCategory = 'general' | 'permissions' | 'appearance' | 'diff' | 'editor' | 'git';

async function openSettingsCategory(category: SettingsCategory): Promise<void> {
  const button = $(`button[data-settings-category="${category}"]`);
  await button.click();
  await expect(button).toBeFocused();
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
    const windowStates = await browser.tauri.execute(({ core }) =>
      core.invoke('plugin:wdio|get_window_states'),
    );
    const headless = process.env.STELLA_E2E_HEADLESS !== 'false';
    expect(windowStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'main',
          is_visible: !headless,
          is_focused: !headless,
        }),
      ]),
    );
    await debugAt('app-shell');
    const headerButtonLabels = await browser.tauri.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('.titlebar-actions button')].map(
        (button) => button.ariaLabel,
      ),
    );
    expect(headerButtonLabels).toHaveLength(5);
    expect(['Diff', '差分']).toContain(headerButtonLabels[0]);
    expect(['History', '履歴']).toContain(headerButtonLabels[1]);
    expect(['Activity', '活動']).toContain(headerButtonLabels[2]);
    expect(['Repository', '一覧']).toContain(headerButtonLabels[3]);
    expect(['Settings', '設定']).toContain(headerButtonLabels[4]);
    expect(
      await browser.tauri.execute(() =>
        [...document.querySelectorAll<HTMLButtonElement>('.titlebar-actions button')]
          .filter((button) => button.ariaCurrent === 'page')
          .map((button) => button.ariaLabel),
      ),
    ).toEqual([headerButtonLabels[3]]);
    expect(
      await browser.tauri.execute(() =>
        [...document.querySelectorAll<HTMLButtonElement>('.titlebar-actions button')]
          .slice(0, 3)
          .every((button) => button.disabled),
      ),
    ).toBe(true);
    await expect($('.app-header')).toHaveAttribute('data-tauri-drag-region', 'deep');
  });

  it('exposes the Tauri execute API in the E2E-only build', async () => {
    expect(await browser.tauri.execute(() => document.title)).toBe('Stella');
  });

  it('suppresses Settings hover while moving categories with arrow keys', async () => {
    await $('.titlebar-actions button:last-child').click();
    const navigation = $('.settings-category-navigation');
    const permissions = $('button[data-settings-category="permissions"]');

    await browser.keys(['ArrowDown']);
    await expect(navigation).toHaveElementClass('is-keyboard-navigating');
    await expect(permissions).toBeFocused();

    await browser.tauri.execute(() => {
      document
        .querySelector<HTMLElement>('.settings-category-navigation')
        ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    });
    await expect(navigation).not.toHaveElementClass('is-keyboard-navigating');
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
    await expect($('button[data-settings-category="general"]')).toBeFocused();
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
    await browser.execute(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await expectInteractiveSelectedColors('.titlebar-menu-button[aria-current="page"]', {
      palette: 'accent',
    });
    await expect(settings).toHaveText('Settings');
    expect(
      await browser.execute(() =>
        [...document.querySelectorAll<HTMLButtonElement>('.titlebar-actions button')].map(
          (button) => button.innerText.trim(),
        ),
      ),
    ).toEqual(['Diff', 'History', 'Activity', 'Repository', 'Settings']);
    await expect($('button[aria-label="Repository"]')).toBeDisplayed();
    await expect($('.titlebar-actions button[aria-label="Diff"]')).toBeDisabled();
    await expect($('.titlebar-actions button[aria-label="History"]')).toBeDisabled();
    await expect($('.titlebar-actions button[aria-label="Activity"]')).toBeDisabled();
    await expect($('.window-header-leading .sidebar-toggle-button')).not.toExist();
    await expect($('.repository-toggle')).not.toExist();
    await expect($('.branch-toggle')).not.toExist();
    await expect($('.settings-content > .pane-resizer')).not.toExist();
    expect(
      await browser.execute(() => {
        const style = getComputedStyle(document.querySelector<HTMLElement>('.settings-sidebar')!);
        return { width: style.borderRightWidth, style: style.borderRightStyle };
      }),
    ).toEqual({ width: '1px', style: 'solid' });

    await openSettingsCategory('diff');
    const diffFileListDisplay = $('select[name="diff-file-list-display"]');
    await expect(diffFileListDisplay).toHaveValue('nameAndPath');
    expect(await diffFileListDisplay.$$('option').map((option) => option.getText())).toEqual([
      'File Name and Path',
      'Full Path',
      'Tree',
    ]);

    await openSettingsCategory('appearance');
    await $('button=Reset').click();
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

    await openSettingsCategory('diff');
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
    expect(toolchainLayout.text).toContain('In use');
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
      await expect(toolchain).toHaveText(expect.stringContaining('2.0.0'));
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
    await setLogicalWindowSize(860, 560);
    await openSettingsCategory('git');
    const toolchainDescription = $('#toolchain-description');
    await expect(toolchainDescription).toHaveText(
      '内蔵のGitツールチェーンと、このMacにインストール済みのGitツールチェーンから選択します。\n変更は再起動後に反映されます。',
    );
    expect((await toolchainDescription.getCSSProperty('white-space')).value).toBe('pre-line');
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
    await openSettingsCategory('git');
    await expect($('#toolchain-description')).toHaveText(
      'Choose the bundled Git toolchain or one installed on this Mac.\nChanges take effect after restart.',
    );
    expect(
      await browser.execute(() => {
        const detail = document.querySelector<HTMLElement>('.settings-detail');
        return detail ? detail.scrollWidth <= detail.clientWidth : false;
      }),
    ).toBe(true);
    await openSettingsCategory('general');
    await selectSetting('language', 'ja');
    await expect($('h1=設定')).toBeDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.lang)) === 'ja',
      { timeoutMsg: 'The document language did not return to Japanese.' },
    );

    await openSettingsCategory('diff');
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
    await expect($('button[aria-label="リポジトリ"]')).not.toExist();
    await expect($('h1=設定')).toBeDisplayed();
  });
});
