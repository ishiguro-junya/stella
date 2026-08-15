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
    expect(styles).toMatch(/\.changes-files-scroll-region\s*\{[^}]*user-select:\s*none;/u);
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
      /\.file-view-mode-tabs button\[aria-selected='true'\]\s*\{[^}]*background:\s*var\(--list-selection-surface\);[^}]*color:\s*var\(--text-primary\);/u,
    );
    expect(styles).toMatch(
      /\.file-view-mode-tabs button\[aria-selected='true'\]:focus-visible\s*\{[^}]*outline-color:\s*var\(--focus\);/u,
    );
  });
});

describe('history action placement', () => {
  it('uses the application accent for the main History lane', () => {
    expect(styles).toMatch(/--history-lane-0:\s*var\(--accent\);/u);
  });

  it('keeps Changes and History row actions visible', () => {
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

  it('adds trailing space in the list and top-aligns the detail action', () => {
    expect(styles).toMatch(
      /\.commit-list \.history-commit-item\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 34px;/u,
    );
    expect(styles).toMatch(
      /\.history-commit-item \.history-action-trigger\s*\{[^}]*margin-right:\s*8px;/u,
    );
    expect(styles).toMatch(
      /\.commit-detail-actions > \.history-action-trigger\s*\{[^}]*align-self:\s*flex-start;/u,
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
    expect(styles).toMatch(
      /\.app-header > \.sidebar-toggle-button\s*\{[^}]*bottom:\s*10px;[^}]*left:\s*3px;/u,
    );
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

  it('keeps a wide drag target without a contrasting pane line', () => {
    expect(styles).toMatch(/\.pane-resizer\s*\{[^}]*width:\s*5px;[^}]*background:\s*transparent;/u);
    expect(styles).toMatch(
      /\.pane-resizer::before\s*\{[^}]*width:\s*1px;[^}]*background:\s*var\(--surface-raised\);/u,
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
  it('uses fixed pulse geometry inside fixed loading regions', () => {
    expect(styles).toMatch(
      /\.loading-pulse\s*\{[^}]*width:\s*72px;[^}]*height:\s*8px;[^}]*animation:\s*loading-pulse/u,
    );
    expect(styles).toMatch(/\.activity-state\s*\{[^}]*min-height:\s*150px;/u);
    expect(styles).toMatch(/\.activity-chart\s*\{[^}]*height:\s*240px;/u);
    expect(styles).toMatch(/\.settings-toolchain-components dd\s*\{[^}]*min-height:\s*36px;/u);
    expect(styles).toMatch(/\.settings-toolchain-modes\s*\{[^}]*min-height:\s*35px;/u);
    expect(styles).toMatch(/\.settings-toolchain-components\s*\{[^}]*min-height:\s*120px;/u);
    expect(styles).toMatch(
      /\.button-loading-icon\s*\{[^}]*animation:\s*activity-status-spin 1s linear infinite;/u,
    );
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
