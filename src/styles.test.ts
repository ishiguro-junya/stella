/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('global scroll behavior', () => {
  it('disables elastic overscroll for every scroll container', () => {
    expect(styles).toMatch(/\*\s*\{[^}]*overscroll-behavior:\s*none;/u);
  });
});

describe('changes file selection', () => {
  it('prevents native text selection from spanning the Diff and file list panes', () => {
    expect(styles).toMatch(/\.diff-files-scroll-region\s*\{[^}]*user-select:\s*none;/u);
    expect(styles).toMatch(
      /\.diff-pane\s*\{[^}]*-webkit-user-select:\s*none;[^}]*user-select:\s*none;/u,
    );
  });

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
      /\.change-item:has\(> \.change-row:focus-visible\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.history-commit-item:has\(> \.commit-row:focus-visible\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /\.activity-list tbody tr:focus-visible > \*\s*\{[^}]*inset 0 1px 0 var\(--focus\),[^}]*inset 0 -1px 0 var\(--focus\);/u,
    );
    expect(styles).toMatch(
      /button\.toggle-button\s*\{[^}]*grid-template-columns:\s*repeat\(2, 29px\);[^}]*width:\s*64px;[^}]*height:\s*34px;[^}]*border-radius:\s*999px;[^}]*background:\s*var\(--surface-sunken\);/u,
    );
    expect(styles).toMatch(
      /\.toggle-button-thumb\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*box-shadow:\s*var\(--shadow-control\);[^}]*transition:\s*transform 160ms ease;/u,
    );
    expect(styles).toMatch(
      /button\.toggle-button\[aria-pressed='true'\] \.toggle-button-thumb\s*\{[^}]*transform:\s*translateX\(29px\);/u,
    );
    expect(styles).toMatch(
      /button\.toggle-button\[data-reverse-icons\]\[aria-pressed='true'\] \.toggle-button-thumb\s*\{[^}]*transform:\s*none;/u,
    );
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

  it('suppresses History hover surfaces during arrow-key navigation', () => {
    expect(styles).toMatch(
      /\.commit-list\.is-keyboard-navigating \.history-commit-item:hover,\s*\.commit-list\.is-keyboard-navigating \.commit-row:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.commit-list\.is-keyboard-navigating \.history-commit-item\.is-current:hover\s*\{[^}]*background:\s*var\(--list-selection-surface\);/u,
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
  it('uses one full-width header and a separated toolbar inside the left pane', () => {
    expect(styles).toMatch(
      /\.app-header\s*\{[^}]*height:\s*64px;[^}]*border-bottom:\s*1px solid var\(--border-subtle\);/u,
    );
    expect(styles).toMatch(
      /\.window-header-content\s*\{[^}]*height:\s*100%;[^}]*padding:\s*0 10px 0 76px;/u,
    );
    expect(styles).toMatch(/\.titlebar-left-actions\s*\{[^}]*bottom:\s*10px;[^}]*left:\s*3px;/u);
    expect(styles).toMatch(
      /\.left-pane-toolbar\s*\{[^}]*min-height:\s*56px;[^}]*border-bottom:\s*1px solid var\(--border-subtle\);/u,
    );
    expect(styles).not.toMatch(/\.titlebar-context-toggle\.branch-toggle\.is-focused/u);
    expect(styles).toMatch(/\.titlebar-context-toggle\.branch-toggle:focus-visible/u);
  });

  it('keeps pane resizers and configured pane widths at narrow window sizes', () => {
    expect(styles).not.toMatch(/\.three-pane\s*>\s*\.pane-resizer\s*\{[^}]*display:\s*none;/u);
    expect(styles).not.toMatch(
      /\.three-pane\s*\{[^}]*grid-template-columns:\s*minmax\(240px,\s*30%\)/u,
    );
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

  it('uses a neutral switcher selection with an accent focus ring', () => {
    expect(styles).toMatch(
      /\.switcher-option-row\.is-selected\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*color:\s*var\(--text-primary\);/u,
    );
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
  it('keeps the Git toolchain select at the standard settings width', () => {
    expect(styles).toMatch(/\.settings-select\s*\{[^}]*width:\s*220px;/u);
    expect(styles).not.toMatch(/\.settings-wide-row \.settings-select/u);
  });

  it('limits only the repository location control in Permissions', () => {
    expect(styles).toMatch(
      /\.settings-permission-row \.settings-path-control\s*\{[^}]*max-width:\s*560px;/u,
    );
    expect(styles).not.toMatch(/\.directory-input-control\s*\{[^}]*max-width:/u);
  });
});
