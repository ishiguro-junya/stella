import { $, browser, expect } from '@wdio/globals';
import { mkdir } from 'node:fs/promises';

type Language = 'en' | 'ja';
type Appearance = 'system' | 'light' | 'dark';

interface ResetAppOptions {
  language?: Language;
  appearance?: Appearance;
  automaticUpdateChecks?: boolean;
  splitStageView?: boolean;
  useConventionalCommits?: boolean;
  stickyFileHeaders?: boolean;
  editorLineWrapping?: boolean;
  editorWrapColumn?: number;
  registeredRepoPaths?: string[];
}

export async function setLogicalWindowSize(width: number, height: number): Promise<number> {
  const scaleFactor = await browser.tauri.execute(() => window.devicePixelRatio);
  await browser.setWindowSize(Math.round(width * scaleFactor), Math.round(height * scaleFactor));
  return scaleFactor;
}

export async function resetApp(options: ResetAppOptions = {}): Promise<void> {
  const preferences = {
    version: 1,
    appearance: options.appearance ?? 'system',
    language: options.language ?? 'ja',
    automaticUpdateChecks: options.automaticUpdateChecks ?? true,
    diffStyle: 'unified',
    splitStageView: options.splitStageView ?? false,
    useConventionalCommits: options.useConventionalCommits ?? false,
    stickyFileHeaders: options.stickyFileHeaders ?? false,
    editorLineWrapping: options.editorLineWrapping ?? false,
    editorWrapColumn: options.editorWrapColumn ?? 120,
    registeredRepoPaths: options.registeredRepoPaths ?? [],
    repositoryNames: {},
    openRepoPaths: [],
    view: 'changes',
    paneWidths: {
      changes: { left: 320, right: 336 },
      history: { left: 320 },
      activity: { left: 560 },
    },
    commitDrafts: {},
  };

  await browser.execute((nextPreferences) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('stella.preferences.v1', JSON.stringify(nextPreferences));
  }, preferences);
  await browser.refresh();
  await setLogicalWindowSize(1180, 760);
  await $('[data-testid="app-shell"]').waitForDisplayed({ timeout: 10_000 });
}

export async function selectSetting(name: string, value: string): Promise<void> {
  const changed = await browser.execute(
    ({ settingName, settingValue }) => {
      const select = document.querySelector<HTMLSelectElement>(`select[name="${settingName}"]`);
      if (!select) return false;
      if (![...select.options].some((option) => option.value === settingValue)) return false;
      select.value = settingValue;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { settingName: name, settingValue: value },
  );
  expect(changed).toBe(true);
}

export async function expectInteractiveSelectedColors(
  selector: string,
  options: {
    foreground?: readonly string[];
    mutedForeground?: readonly string[];
  } = {},
): Promise<void> {
  const result = await browser.execute(
    ({ targetSelector, foregroundSelectors, mutedForegroundSelectors }) => {
      const target = document.querySelector<HTMLElement>(targetSelector);
      if (!target) return { missing: [targetSelector] };

      const primaryProbe = document.createElement('button');
      primaryProbe.className = 'primary';
      primaryProbe.style.position = 'fixed';
      primaryProbe.style.visibility = 'hidden';
      const mutedProbe = document.createElement('span');
      mutedProbe.style.color = 'var(--interactive-selected-muted-foreground)';
      primaryProbe.append(mutedProbe);
      document.body.append(primaryProbe);

      const targetStyle = getComputedStyle(target);
      const primaryStyle = getComputedStyle(primaryProbe);
      const expectedMutedForeground = getComputedStyle(mutedProbe).color;
      const foreground = foregroundSelectors.map((childSelector) => {
        const child = target.querySelector<HTMLElement>(childSelector);
        return [childSelector, child ? getComputedStyle(child).color : undefined] as const;
      });
      const mutedForeground = mutedForegroundSelectors.map((childSelector) => {
        const child = target.querySelector<HTMLElement>(childSelector);
        return [childSelector, child ? getComputedStyle(child).color : undefined] as const;
      });
      const computed = {
        missing: [...foreground, ...mutedForeground]
          .filter(([, color]) => color === undefined)
          .map(([childSelector]) => childSelector),
        background: targetStyle.backgroundColor,
        selectedForeground: targetStyle.color,
        expectedBackground: primaryStyle.backgroundColor,
        expectedForeground: primaryStyle.color,
        expectedMutedForeground,
        foregroundChildren: foreground.map(
          ([childSelector, color]) => [childSelector, color] as const,
        ),
        mutedForegroundChildren: mutedForeground.map(
          ([childSelector, color]) => [childSelector, color] as const,
        ),
      };
      primaryProbe.remove();
      return computed;
    },
    {
      targetSelector: selector,
      foregroundSelectors: options.foreground ?? [],
      mutedForegroundSelectors: options.mutedForeground ?? [],
    },
  );

  expect(result.missing).toEqual([]);
  if (!('expectedBackground' in result)) throw new Error(`Selected element not found: ${selector}`);
  expect(result.background).toBe(result.expectedBackground);
  expect(result.selectedForeground).toBe(result.expectedForeground);
  expect(result.foregroundChildren.every(([, color]) => color === result.expectedForeground)).toBe(
    true,
  );
  expect(
    result.mutedForegroundChildren.every(([, color]) => color === result.expectedMutedForeground),
  ).toBe(true);
}

export async function expectAttachedTabs(selector: string): Promise<void> {
  const result = await browser.execute((containerSelector) => {
    const container = document.querySelector<HTMLElement>(containerSelector);
    if (!container) return { missing: true };
    const tabs = [...container.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.getAttribute('role') === 'tab',
    );
    if (tabs.length < 2) return { missing: true };

    const containerStyle = getComputedStyle(container);
    const first = tabs[0];
    const last = tabs.at(-1);
    if (!first || !last) return { missing: true };
    const firstStyle = getComputedStyle(first);
    const lastStyle = getComputedStyle(last);
    const rects = tabs.map((tab) => tab.getBoundingClientRect());
    return {
      missing: false,
      gap: containerStyle.gap,
      outerBorderWidth: containerStyle.borderTopWidth,
      outerBorderColor: containerStyle.borderTopColor,
      attached: rects.slice(1).every((rect, index) => {
        const previous = rects[index];
        return previous ? Math.abs(previous.right - rect.left) <= 0.5 : false;
      }),
      firstRadii: [firstStyle.borderTopLeftRadius, firstStyle.borderTopRightRadius],
      lastRadii: [lastStyle.borderTopLeftRadius, lastStyle.borderTopRightRadius],
      innerBordersTransparent: tabs.every(
        (tab) => getComputedStyle(tab).borderRightColor === 'rgba(0, 0, 0, 0)',
      ),
    };
  }, selector);

  expect(result.missing).toBe(false);
  if (result.missing) throw new Error(`Tab group not found: ${selector}`);
  expect(result.gap).toBe('0px');
  expect(result.outerBorderWidth).toBe('1px');
  expect(result.outerBorderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(result.attached).toBe(true);
  expect(result.firstRadii).toEqual(['6px', '0px']);
  expect(result.lastRadii).toEqual(['0px', '6px']);
  expect(result.innerBordersTransparent).toBe(true);
}

export async function expectHistoryCommitLayout(width: number, height: number): Promise<void> {
  await setLogicalWindowSize(width, height);
  const layout = await browser.execute(() => {
    const selectors = {
      graph: '.history-commit-item.is-current .history-graph',
      oid: '.history-commit-item.is-current .commit-oid',
      ref: '.history-commit-item.is-current .ref-chip',
      time: '.history-commit-item.is-current time',
      menu: '.history-commit-item.is-current .history-action-trigger',
    };
    const entries = Object.entries(selectors).map(
      ([name, selector]) =>
        [name, document.querySelector<HTMLElement>(selector)?.getBoundingClientRect()] as const,
    );
    const missing = entries.filter(([, rect]) => !rect).map(([name]) => name);
    const overlaps: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const [leftName, leftRect] = entries[index]!;
      if (!leftRect) continue;
      for (let other = index + 1; other < entries.length; other += 1) {
        const [rightName, rightRect] = entries[other]!;
        if (!rightRect) continue;
        if (
          leftRect.left < rightRect.right &&
          leftRect.right > rightRect.left &&
          leftRect.top < rightRect.bottom &&
          leftRect.bottom > rightRect.top
        ) {
          overlaps.push(`${leftName}:${rightName}`);
        }
      }
    }
    return { missing, overlaps };
  });
  expect(layout.missing).toEqual([]);
  expect(layout.overlaps).toEqual([]);
}

export async function waitForChangesOrThrow(): Promise<void> {
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

export async function openRepository(
  path: string,
  options: { language?: Language; inspectDialog?: boolean } = {},
): Promise<void> {
  const language = options.language ?? 'ja';
  await $(`button=${language === 'ja' ? 'リポジトリを追加' : 'Add Repository'}`).click();
  const dialog = $('[role="alertdialog"]');
  await expect(dialog).toBeDisplayed();
  if (options.inspectDialog) {
    await expect(dialog.$('button=URL')).toHaveAttribute('aria-selected', 'true');
    await expectAttachedTabs('[role="alertdialog"] .add-repository-source');
    await expectInteractiveSelectedColors(
      '[role="alertdialog"] .add-repository-source [aria-selected="true"]',
    );
    await expect(dialog.$('#repository-display-name')).toExist();
  }
  await dialog.$(`button=${language === 'ja' ? 'パス' : 'Path'}`).click();
  await dialog.$('#repository-location').setValue(path);
  await dialog.$(`button=${language === 'ja' ? '追加' : 'Add'}`).click();
  await waitForChangesOrThrow();
}

export async function openRepositoryFromSwitcher(path: string, language: Language): Promise<void> {
  await $('.repository-toggle').click();
  const switcher = $('[role="dialog"]');
  await expect(switcher).toBeDisplayed();
  await switcher.$(`button=${language === 'ja' ? 'リポジトリを追加…' : 'Add Repository…'}`).click();
  const dialog = $('[role="alertdialog"]');
  await expect(dialog).toBeDisplayed();
  await dialog.$(`button=${language === 'ja' ? 'パス' : 'Path'}`).click();
  await dialog.$('#repository-location').setValue(path);
  await dialog.$(`button=${language === 'ja' ? '追加' : 'Add'}`).click();
  await $(`.repository-toggle[title="${path}"]`).waitForDisplayed({ timeout: 10_000 });
}

export async function commitCurrentChange(description: string): Promise<void> {
  const stage = $('input[aria-label^="ステージ "]');
  await stage.waitForClickable({ timeout: 20_000 });
  await stage.click();
  await $('input[aria-label^="ステージ解除 "]').waitForDisplayed({ timeout: 10_000 });
  const trigger = $('.changes-action-bar .changes-action-button[aria-label="コミット"]');
  await trigger.waitForClickable();
  await trigger.click();
  const dialog = $('[role="dialog"][aria-labelledby="commit-dialog-title"]');
  const type = dialog.$('[data-commit-field="type"]');
  if (await type.isExisting()) await type.setValue('feat');
  await dialog.$('[data-commit-field="description"]').setValue(description);
  const submit = dialog.$('.commit-form button[type="submit"]');
  await submit.waitForClickable();
  await submit.click();
  await expect(dialog).not.toExist();
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => document.querySelectorAll('.change-row').length)) === 0,
    { timeout: 10_000, timeoutMsg: 'Committed changes did not disappear from the change list.' },
  );
}

export async function dispatchDoubleClick(selector: string): Promise<void> {
  // embedded Tauri WebDriverはdetail=0のclickを2回送るため、dblclickを補います。
  const dispatched = await browser.execute((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) return false;
    target.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        detail: 2,
        view: window,
      }),
    );
    return true;
  }, selector);
  expect(dispatched).toBe(true);
}

export async function saveLogicalScreenshot(
  path: string,
  width: number,
  height: number,
): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  const scaleFactor = await setLogicalWindowSize(width, height);
  await browser.saveScreenshot(path);
  if (scaleFactor !== 1) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)('/usr/bin/sips', ['-z', String(height), String(width), path]);
  }
}
