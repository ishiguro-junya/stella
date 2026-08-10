import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { detectLanguage, I18nProvider, translate, useI18n, type Language } from './i18n';
import { MESSAGES } from './messages';

function Probe() {
  const { t, formatDate, formatNumber } = useI18n();
  return (
    <div>
      <span>{t('settingsTitle')}</span>
      <span>{formatNumber(12_345)}</span>
      <time>{formatDate('2026-08-09T03:00:00.000Z', { year: 'numeric', month: 'long' })}</time>
    </div>
  );
}

function renderProbe(language: Language) {
  return render(
    <I18nProvider language={language}>
      <Probe />
    </I18nProvider>,
  );
}

describe('Stella i18n', () => {
  it('selects Japanese only when the first usable macOS/browser language is Japanese', () => {
    expect(detectLanguage(['ja-JP', 'en-US'])).toBe('ja');
    expect(detectLanguage(['en-US', 'ja-JP'])).toBe('en');
    expect(detectLanguage(['fr-FR'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });

  it('keeps every message available in both catalogs', () => {
    for (const translations of Object.values(MESSAGES)) {
      expect(translations.en).toBeDefined();
      expect(translations.ja).toBeDefined();
    }
  });

  it('expands typed arguments and applies English plural forms', () => {
    expect(translate('en', 'changeAllAria', { action: 'Stage', count: 1, area: 'Unstaged' })).toBe(
      'Stage all 1 unstaged file',
    );
    expect(translate('en', 'changeAllAria', { action: 'Stage', count: 2, area: 'Unstaged' })).toBe(
      'Stage all 2 unstaged files',
    );
    expect(translate('ja', 'previewMovePathToTrash', { path: 'src/app.ts' })).toBe(
      'src/app.tsをゴミ箱に入れます',
    );
  });

  it('localizes Japanese navigation and general UI terms while retaining Git terms', () => {
    expect(translate('ja', 'appActivity')).toBe('アクティビティ');
    expect(translate('ja', 'appNavigation')).toBe('アプリのナビゲーション');
    expect(translate('ja', 'changes')).toBe('変更');
    expect(translate('ja', 'history')).toBe('履歴');
    expect(translate('ja', 'activityCommand')).toBe('コマンド');
    expect(translate('ja', 'unified')).toBe('統合');
    expect(translate('ja', 'commit')).toBe('Commit');
    expect(translate('ja', 'stage')).toBe('Stage');
  });

  it('uses the requested Japanese terms for Activity metrics', () => {
    expect(translate('ja', 'activityCommits')).toBe('コミット');
    expect(translate('ja', 'activityContributors')).toBe('コントリビューター');
    expect(translate('ja', 'activityBranches')).toBe('ブランチ');
    expect(
      translate('ja', 'activityCommitsSummary', {
        commits: 8,
        days: 4,
        contributors: 2,
        branches: 3,
      }),
    ).toBe('コミット8件、アクティブ4日、コントリビューター2人、ブランチ3件です。');
  });

  it('keeps the product name out of in-app explanatory copy', () => {
    const copy = [
      translate('en', 'appearanceDescription'),
      translate('en', 'languageDescription'),
      translate('en', 'repositoriesDescription'),
      translate('en', 'errorInternal'),
      translate('ja', 'appearanceDescription'),
      translate('ja', 'languageDescription'),
      translate('ja', 'repositoriesDescription'),
      translate('ja', 'errorInternal'),
    ];
    for (const message of copy) expect(message).not.toContain('Stella');
  });

  it('switches copy, locale formatters, and html lang without remounting', () => {
    const { rerender } = renderProbe('en');
    expect(screen.getByText('Settings')).toBeVisible();
    expect(screen.getByText('12,345')).toBeVisible();
    expect(document.documentElement).toHaveAttribute('lang', 'en');

    rerender(
      <I18nProvider language="ja">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('設定')).toBeVisible();
    expect(screen.getByText('12,345')).toBeVisible();
    expect(screen.getByText('2026年8月')).toBeVisible();
    expect(document.documentElement).toHaveAttribute('lang', 'ja');
  });
});
