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

describe('repository switcher icons', () => {
  it('gives the fallback repository icon the same box as a custom logo', () => {
    expect(styles).toMatch(
      /\.switcher-option-icon\s*>\s*\.repository-logo-fallback\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*padding:\s*3px;/u,
    );
  });
});
