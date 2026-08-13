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

describe('workspace pane resizing', () => {
  it('keeps pane resizers and configured pane widths at narrow window sizes', () => {
    expect(styles).not.toMatch(/\.three-pane\s*>\s*\.pane-resizer\s*\{[^}]*display:\s*none;/u);
    expect(styles).not.toMatch(
      /\.three-pane\s*\{[^}]*grid-template-columns:\s*minmax\(240px,\s*30%\)/u,
    );
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
      /\.switcher-list\s*\{[^}]*flex:\s*none;[^}]*height:\s*calc\(56px \* 5\);[^}]*overflow:\s*auto;/u,
    );
  });

  it('presents footer actions as right-aligned standard buttons', () => {
    expect(styles).toMatch(
      /\.switcher-footer\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;[^}]*gap:\s*8px;[^}]*padding:\s*10px 12px;/u,
    );
    expect(styles).toMatch(
      /\.switcher-footer button\s*\{[^}]*min-height:\s*32px;[^}]*white-space:\s*nowrap;/u,
    );
    expect(styles).not.toMatch(/\.switcher-footer button\s*\{[^}]*border:\s*0;/u);
  });
});
