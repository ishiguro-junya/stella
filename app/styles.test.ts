/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'app/styles.css'), 'utf8');

describe('global scroll behavior', () => {
  it('contains overscroll at the app and History scroll boundaries', () => {
    expect(styles).not.toMatch(/\*\s*\{[^}]*overscroll-behavior:/u);
    expect(styles).toMatch(/html,\s*body,\s*#root\s*\{[^}]*overscroll-behavior:\s*none;/u);
    expect(styles).toMatch(/\.commit-list\s*\{[^}]*overscroll-behavior:\s*none;/u);
    expect(styles).toMatch(/\.commit-detail-pane\s*\{[^}]*overscroll-behavior:\s*none;/u);
  });

  it('disables native text selection throughout the app', () => {
    expect(styles).toMatch(/\*\s*\{[^}]*-webkit-user-select:\s*none;[^}]*user-select:\s*none;/u);
    expect(styles.match(/^\s*(?:-webkit-)?user-select:\s*none;/gmu)).toHaveLength(2);
  });
});

describe('changes file selection', () => {
  it('uses neutral list selection with a one-pixel accent focus ring', () => {
    expect(styles).toMatch(
      /\.change-item\.is-selected,\s*\.change-item\.is-current\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*color:\s*var\(--text-primary\);/u,
    );
    expect(styles).toMatch(
      /\.history-commit-item\.is-current\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*color:\s*var\(--text-primary\);/u,
    );
    expect(styles).toMatch(
      /\.activity-list tbody tr\[aria-selected='true'\]\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*color:\s*var\(--text-primary\);/u,
    );
    expect(styles).toMatch(
      /\.change-item:has\(> \.change-row:focus\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.history-commit-item:has\(> \.commit-row:focus\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.activity-list tbody tr:focus > \*\s*\{[^}]*inset 0 1px 0 var\(--focus\),[^}]*inset 0 -1px 0 var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.settings-category-navigation \.settings-category-button:focus\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.segmented button:is\(\[aria-selected='true'\], \[aria-pressed='true'\]\):focus\s*\{[^}]*outline-color:\s*var\(--interactive-selected-foreground\);/u,
    );
    expect(styles).toMatch(
      /button\.toggle-button\s*\{[^}]*grid-template-columns:\s*repeat\(2, 29px\);[^}]*width:\s*64px;[^}]*height:\s*34px;[^}]*border-radius:\s*999px;[^}]*background:\s*var\(--surface-sunken\);/u,
    );
    expect(styles).toMatch(
      /\.toggle-button-thumb\s*\{[^}]*background:\s*var\(--interactive-selected-surface\);[^}]*box-shadow:\s*var\(--shadow-control\);[^}]*color:\s*var\(--interactive-selected-foreground\);[^}]*transition:\s*transform 160ms ease;/u,
    );
    expect(styles).toMatch(
      /\.toggle-button-option\.is-selected\s*\{[^}]*color:\s*var\(--interactive-selected-foreground\);/u,
    );
    expect(styles).toMatch(
      /button\.toggle-button\[aria-pressed='true'\] \.toggle-button-thumb\s*\{[^}]*transform:\s*translateX\(29px\);/u,
    );
    expect(styles).toMatch(
      /button\.toggle-button\[data-reverse-icons\]\[aria-pressed='true'\] \.toggle-button-thumb\s*\{[^}]*transform:\s*none;/u,
    );
    expect(styles).not.toContain('data-animate-on-mount');
    expect(styles).not.toContain('toggle-button-thumb-to-');
    expect(styles).toMatch(
      /button\.toggle-button:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--surface-sunken\);/u,
    );
  });

  it('uses the same surface and dimensions for regular and image file headers', () => {
    expect(styles).toMatch(/--diff-file-header-surface:\s*light-dark\(/u);
    expect(styles).toMatch(
      /\.diff-file-standalone-header\s*\{[^}]*box-sizing:\s*border-box;[^}]*min-height:\s*32px;[^}]*padding-inline:\s*8px 16px;[^}]*background-color:\s*var\(--diff-file-header-surface\);/u,
    );
    expect(styles).toMatch(
      /\.diff-file-standalone-header button\.toggle-button\s*\{[^}]*height:\s*30px;[^}]*min-height:\s*30px;[^}]*padding-block:\s*1px;/u,
    );
  });

  it('places the stage group collapse toggle between the checkbox and label', () => {
    expect(styles).toMatch(
      /\.change-group-header\.is-collapsible\s*\{[^}]*grid-template-columns:\s*28px 24px minmax\(0, 1fr\);/u,
    );
  });

  it('lays out split image previews side by side', () => {
    expect(styles).toMatch(
      /\.image-diff-preview\[data-layout='split'\]\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u,
    );
    expect(styles).toMatch(
      /\.image-diff-preview\[data-single-side='true'\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(
      /\.image-diff-preview\[data-single-side='true'\] \.image-diff-side\[data-side\]\s*\{[^}]*grid-column:\s*1;/u,
    );
  });

  it('uses semantic black and white surfaces for adaptive image contrast', () => {
    expect(styles).toMatch(/--image-preview-light-surface:\s*#ffffff;/u);
    expect(styles).toMatch(/--image-preview-dark-surface:\s*#000000;/u);
    expect(styles).toMatch(/--image-preview-light-checker:\s*#d9d9d9;/u);
    expect(styles).toMatch(/--image-preview-dark-checker:\s*#303030;/u);
    expect(styles).toMatch(
      /\.image-diff-canvas\s*\{[^}]*padding:\s*16px;[^}]*background-color:\s*var\(--image-preview-checker-base\);[^}]*background-image:\s*[^}]*linear-gradient/u,
    );
    expect(styles).toMatch(
      /\.image-diff-canvas\[data-image-background='light'\]\s*\{[^}]*--image-preview-checker-base:\s*var\(--image-preview-light-surface\);/u,
    );
    expect(styles).toMatch(
      /\.image-diff-canvas\[data-image-background='dark'\]\s*\{[^}]*--image-preview-checker-base:\s*var\(--image-preview-dark-surface\);/u,
    );
    expect(styles).toMatch(
      /\.image-diff-image-surface\s*\{[^}]*place-self:\s*center;[^}]*place-items:\s*center;/u,
    );
    expect(styles).toMatch(
      /\.image-diff-canvas img\s*\{[^}]*margin:\s*auto;[^}]*object-position:\s*center center;/u,
    );
  });
});

describe('history action placement', () => {
  it('uses the application accent for the main History lane', () => {
    expect(styles).toMatch(/--history-lane-0:\s*var\(--accent\);/u);
  });

  it('keeps Diff and History row actions visible', () => {
    expect(styles).toMatch(
      /\.change-item \.row-action-trigger,\s*\.history-commit-item \.row-action-trigger,\s*\.row-action-trigger\.is-persistent/u,
    );
  });

  it('suppresses list hover surfaces during arrow-key navigation', () => {
    expect(styles).toMatch(
      /\.commit-list\.is-keyboard-navigating \.history-commit-item:hover,\s*\.commit-list\.is-keyboard-navigating \.commit-row:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.commit-list\.is-keyboard-navigating \.history-commit-item\.is-current:hover\s*\{[^}]*background:\s*var\(--list-selection-surface\);/u,
    );
    expect(styles).toMatch(
      /\.change-groups\.is-keyboard-navigating \.change-item:hover\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.activity-list\.is-keyboard-navigating tbody tr\[tabindex\]:hover\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.registered-repositories\.is-keyboard-navigating\s*\.switcher-option-row:hover:not\(\.is-disabled\)\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.switcher-list\.is-keyboard-navigating \.switcher-option-row:hover:not\(\.is-disabled\)\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.settings-category-navigation\.is-keyboard-navigating \.settings-category-button:hover\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(/\.commit-list\s*\{[^}]*will-change:\s*scroll-position;/u);
    expect(styles).not.toMatch(
      /\.commit-list\[aria-busy=['"]true['"]\]\s*\{[^}]*overflow:\s*hidden;/u,
    );
  });

  it('adds trailing space in the list and sizes the detail action like a toggle', () => {
    expect(styles).toMatch(
      /\.commit-list \.history-commit-item\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 34px;/u,
    );
    expect(styles).toMatch(
      /\.history-commit-item \.history-action-trigger\s*\{[^}]*margin-right:\s*8px;/u,
    );
    expect(styles).toMatch(
      /\.commit-detail-actions > \.history-action-trigger\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*align-self:\s*flex-start;/u,
    );
  });
});

describe('workspace pane resizing', () => {
  it('uses one full-width header and a fixed footer inside the History left pane', () => {
    expect(styles).toMatch(
      /\.app-header\s*\{[^}]*height:\s*64px;[^}]*border-bottom:\s*1px solid var\(--border-subtle\);/u,
    );
    expect(styles).toMatch(
      /\.window-header-content\s*\{[^}]*height:\s*100%;[^}]*padding:\s*0 10px 0 84px;/u,
    );
    expect(styles).toMatch(/\.window-header-leading\s*\{[^}]*gap:\s*12px;/u);
    expect(styles).toMatch(/\.titlebar-context\s*\{[^}]*gap:\s*8px;/u);
    expect(styles).not.toMatch(/\.titlebar-left-actions/u);
    expect(styles).toMatch(
      /\.history-list-footer\s*\{[^}]*height:\s*38px;[^}]*gap:\s*4px;[^}]*border-top:\s*1px solid var\(--border-subtle\);/u,
    );
    expect(styles).not.toMatch(/\.history-pane-toolbar/u);
    expect(styles).not.toMatch(/\.titlebar-context-toggle\.branch-toggle\.is-focused/u);
    expect(styles).toMatch(/\.titlebar-context-toggle\.branch-toggle:focus-visible/u);
    expect(styles).toMatch(/\.titlebar-context-toggle\s*\{[^}]*color:\s*var\(--text-secondary\);/u);
    expect(styles).not.toMatch(/\.titlebar-context-toggle\.repository-toggle\s*\{[^}]*color:/u);
    expect(styles).not.toMatch(/\.titlebar-brand/u);
    expect(styles).toMatch(
      /\.titlebar-menu-button\[aria-current='page'\]\s*\{[^}]*background:\s*var\(--interactive-selected-surface\);[^}]*color:\s*var\(--interactive-selected-foreground\);/u,
    );
    expect(styles).toMatch(/\.sidebar-toggle-button\s*\{[^}]*flex:\s*none;/u);
    // 埋め込みWebDriverのキーボードフォーカス判定はフレーキーなため、線の配置はCSSで固定する。
    expect(styles).toMatch(
      /\.sidebar-toggle-button:focus-visible,\s*\.titlebar-context-toggle:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\);[^}]*outline-offset:\s*-2px;/u,
    );
    expect(styles).toMatch(/\.diff-action-button\s*\{[^}]*width:\s*28px;[^}]*min-height:\s*28px;/u);
    expect(styles).toMatch(
      /\.diff-action-button > \.lucide\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/u,
    );
    expect(styles).toMatch(
      /\.history-search input\.app-input\s*\{[^}]*height:\s*24px;[^}]*min-height:\s*24px;/u,
    );
  });

  it('shows ten repository rows before scrolling the landing list', () => {
    expect(styles).toMatch(
      /\.repository-landing-card\.has-repositories\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/u,
    );
    expect(styles).not.toMatch(
      /\.repository-landing-card\.has-repositories\s*\{[^}]*(?:min-height:\s*0|flex:\s*1);/u,
    );
    expect(styles).toMatch(/\.repository-landing\s*\{[^}]*padding:\s*28px 32px 32px;/u);
    expect(styles).toMatch(
      /\.repository-landing-summary\s*\{[^}]*gap:\s*8px;[^}]*font-size:\s*0\.875rem;/u,
    );
    expect(styles).toMatch(
      /\.repository-landing-summary > svg\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/u,
    );
    expect(styles).toMatch(
      /\.registered-repositories\s*\{[^}]*max-height:\s*calc\(56px \* 10 \+ 11px\);[^}]*padding:\s*0;[^}]*overflow-y:\s*auto;[^}]*border-radius:\s*0;[^}]*scrollbar-gutter:\s*stable;/u,
    );
    expect(styles).toMatch(
      /\.registered-repositories \.switcher-option,\s*\.registered-repositories \.switcher-option:hover:not\(:disabled\)\s*\{[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*20px 24px minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).not.toMatch(
      /\.registered-repositories \.switcher-option-row\.is-selected\s*\{[^}]*box-shadow:/u,
    );
    expect(styles).toMatch(
      /\.registered-repositories \.switcher-option-row:focus-within\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.registered-repositories::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--border-strong\);/u,
    );
  });

  it('keeps workspace pane resizers and a fixed Settings category width', () => {
    expect(styles).not.toMatch(/\.three-pane\s*>\s*\.pane-resizer\s*\{[^}]*display:\s*none;/u);
    expect(styles).not.toMatch(
      /\.three-pane\s*\{[^}]*grid-template-columns:\s*minmax\(240px,\s*30%\)/u,
    );
    expect(styles).toMatch(
      /\.settings-content\s*\{[^}]*grid-template-columns:\s*200px minmax\(0, 1fr\);/u,
    );
    expect(styles).not.toMatch(/\.settings-content\s*>\s*\.pane-resizer/u);
  });

  it('keeps a wide drag target with a visible pane line', () => {
    expect(styles).toMatch(/\.pane-resizer\s*\{[^}]*width:\s*5px;[^}]*background:\s*transparent;/u);
    expect(styles).toMatch(
      /\.pane-resizer::before\s*\{[^}]*width:\s*1px;[^}]*background:\s*var\(--border-subtle\);/u,
    );
    expect(styles).not.toMatch(/\.pane-resizer:(?:hover|active)[^{]*\{[^}]*background:/u);
  });
});

describe('common dialog layout', () => {
  it('keeps the 580px shell fixed while only the body scrolls', () => {
    expect(styles).toMatch(
      /\.confirmation-sheet\s*\{[^}]*width:\s*min\(580px, 100%\);[^}]*overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(/\.dialog-body\s*\{[^}]*overflow:\s*auto;/u);
    expect(styles).toMatch(
      /\.dialog-footer\s*\{[^}]*flex:\s*none;[^}]*justify-content:\s*flex-end;/u,
    );
  });
});

describe('translated sentence layout', () => {
  it('preserves sentence breaks in explanatory copy and notices', () => {
    expect(styles).toMatch(
      /\.settings-row-copy p,[^}]*\.dialog-header p,[^}]*\.global-notice,[^}]*#create-tag-help\s*\{[^}]*white-space:\s*pre-line;/u,
    );
  });
});

describe('toast placement', () => {
  it('places every toast at the center of the header', () => {
    expect(styles).toMatch(
      /\.global-notice\.info,\s*\.file-action-notice\.info\s*\{[^}]*position:\s*fixed;[^}]*top:\s*32px;[^}]*left:\s*50%;[^}]*transform:\s*translate\(-50%,\s*-50%\);/u,
    );
    expect(styles).not.toMatch(/\.file-action-notice\.info\s*\{[^}]*(?:right|bottom):/u);
  });
});

describe('repository switcher icons', () => {
  it('gives the fallback repository icon the same box as a custom logo', () => {
    expect(styles).toMatch(
      /\.switcher-option-icon\s*>\s*\.repository-logo-fallback\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*padding:\s*3px;/u,
    );
  });
});

describe('switcher layout', () => {
  it('reserves five rows so loading more items does not resize the dialog', () => {
    expect(styles).toMatch(
      /\.switcher-list\s*\{[^}]*position:\s*relative;[^}]*flex:\s*none;[^}]*height:\s*calc\(56px \* 5\);[^}]*overflow:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.switcher-loading\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/u,
    );
  });

  it('presents footer actions as right-aligned standard buttons', () => {
    expect(styles).toMatch(
      /\.switcher-footer\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;[^}]*gap:\s*8px;[^}]*padding:\s*10px 12px;/u,
    );
    expect(styles).toMatch(/\.app-button\s*\{[^}]*min-height:\s*var\(--control-height\);/u);
    expect(styles).toMatch(/\.switcher-footer button\s*\{[^}]*white-space:\s*nowrap;/u);
    expect(styles).not.toMatch(/\.switcher-footer button\s*\{[^}]*border:\s*0;/u);
  });

  it('uses a neutral switcher selection and the standard focus ring', () => {
    expect(styles).toMatch(
      /\.switcher-option-row\.is-selected\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*color:\s*var\(--text-primary\);/u,
    );
    expect(styles).not.toMatch(/(?:^|\n)\.switcher-option-row\.is-selected\s*\{[^}]*box-shadow:/u);
    expect(styles).toMatch(
      /\.switcher-option-row:focus-within,\s*\.switcher-option-row\.is-focused\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--focus\);/u,
    );
  });
});

describe('loading layout stability', () => {
  it('shows only the shared spinner after a one-second delay in fixed loading regions', () => {
    expect(styles).toMatch(
      /\.delayed-loading-icon,\s*\.loading-indicator\s*>\s*svg\s*\{[^}]*opacity:\s*0;[^}]*animation:\s*delayed-loading-spin 1s linear 1s infinite forwards;/u,
    );
    expect(styles).not.toMatch(/\.loading-pulse/u);
    expect(styles).toMatch(/\.activity-state\s*\{[^}]*min-height:\s*150px;/u);
    expect(styles).toMatch(/\.activity-chart\s*\{[^}]*height:\s*240px;/u);
    expect(styles).toMatch(/\.settings-toolchain-loading\s*\{[^}]*min-height:\s*167px;/u);
    expect(styles).toMatch(/\.git-flow-overview-loading\s*\{[^}]*min-height:\s*88px;/u);
  });
});

describe('settings control widths', () => {
  it('uses full-width square category rows', () => {
    expect(styles).toMatch(/\.settings-sidebar-body\s*\{[^}]*padding:\s*28px 0;/u);
    expect(styles).toMatch(/\.settings-category-navigation\s*\{[^}]*gap:\s*0;/u);
    expect(styles).toMatch(
      /\.settings-category-navigation \.settings-category-button\s*\{[^}]*min-height:\s*46px;[^}]*border-radius:\s*0;/u,
    );
  });

  it('keeps the Git toolchain select at the standard settings width', () => {
    expect(styles).toMatch(/\.settings-select\s*\{[^}]*width:\s*220px;/u);
    expect(styles).not.toMatch(/\.settings-wide-row \.settings-select/u);
  });

  it('limits only the repository location control in Permissions', () => {
    expect(styles).toMatch(
      /\.settings-permission-row \.settings-path-control\s*\{[^}]*max-width:\s*560px;/u,
    );
    expect(styles).not.toMatch(/\.directory-input-control\s*\{[^}]*max-width:/u);
    expect(styles).toMatch(
      /\.dialog-form-field\s*>\s*span:not\(\.directory-input-control\)\s*\{[^}]*font-size:\s*0\.6875rem;/u,
    );
  });
});
