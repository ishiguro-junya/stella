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
    expect(translate('ja', 'previewDeleteFiles', { count: 2 })).toBe(
      '2ファイルを削除します。削除後はゴミ箱から復元できます。',
    );
    expect(translate('en', 'uncommittedFileCount', { count: 1 })).toBe('1 file');
    expect(translate('en', 'uncommittedFileCount', { count: 2 })).toBe('2 files');
    expect(translate('ja', 'uncommittedFileCount', { count: 2 })).toBe('2ファイル');
  });

  it('localizes Japanese navigation, Commit form terms, and general UI terms', () => {
    expect(translate('ja', 'appActivity')).toBe('アクティビティ');
    expect(translate('ja', 'appNavigation')).toBe('アプリのナビゲーション');
    expect(translate('ja', 'changes')).toBe('変更差分');
    expect(translate('ja', 'history')).toBe('操作履歴');
    expect(translate('ja', 'staged')).toBe('ステージ済み');
    expect(translate('ja', 'unstaged')).toBe('未ステージ');
    expect(translate('ja', 'uncommittedChanges')).toBe('未コミットの変更');
    expect(translate('ja', 'activityCommand')).toBe('コマンド');
    expect(translate('ja', 'unified')).toBe('統合');
    expect(translate('ja', 'commit')).toBe('コミット');
    expect(translate('ja', 'description')).toBe('メッセージ');
    expect(translate('ja', 'type')).toBe('型');
    expect(translate('ja', 'scope')).toBe('スコープ');
    expect(translate('ja', 'breakingChange')).toBe('破壊的変更');
    expect(translate('ja', 'commitTypeLowercase')).toBe('型には小文字の英字のみ使用できます。');
    expect(translate('ja', 'commitScopeInvalid')).toBe('スコープには括弧や改行を使用できません。');
    expect(translate('ja', 'commitDescriptionRequired')).toBe('メッセージを入力してください。');
    expect(translate('ja', 'stage')).toBe('Stage');
    expect(translate('ja', 'pull')).toBe('プル');
    expect(translate('ja', 'push')).toBe('プッシュ');
    expect(translate('ja', 'fetch')).toBe('フェッチ');
    expect(translate('ja', 'createBranchMenu')).toBe('ブランチを作成');
    expect(translate('ja', 'createTagMenu')).toBe('タグを作成');
    expect(translate('ja', 'mergeMenu')).toBe('マージを実行');
    expect(translate('ja', 'rebaseMenu')).toBe('リベースを実行');
    expect(translate('ja', 'cherryPickMenu')).toBe('チェリーピックを実行');
    expect(translate('ja', 'revertMenu')).toBe('リバートを実行');
    expect(translate('ja', 'resetMenu')).toBe('リセットを実行');
    expect(translate('ja', 'resetMode')).toBe('リセット方法');
    expect(translate('ja', 'actionCheckoutBranch')).toBe('ブランチをチェックアウト');
  });

  it('uses the requested Japanese terms for Activity metrics', () => {
    expect(translate('ja', 'activityCommits')).toBe('コミット');
    expect(translate('ja', 'activityContributors')).toBe('コントリビューター');
    expect(translate('ja', 'activityBranches')).toBe('ブランチ');
    expect(translate('ja', 'activityCommitValue', { count: 8 })).toBe('8件');
    expect(translate('ja', 'activityContributorValue', { count: 2 })).toBe('2人');
    expect(translate('ja', 'activityBranchValue', { count: 3 })).toBe('3件');
  });

  it('keeps the product name out of in-app explanatory copy', () => {
    const copy = [
      translate('en', 'appearanceDescription'),
      translate('en', 'languageDescription'),
      translate('en', 'toolchainDescription'),
      translate('en', 'repositoriesDescription'),
      translate('en', 'errorInternal'),
      translate('ja', 'appearanceDescription'),
      translate('ja', 'languageDescription'),
      translate('ja', 'toolchainDescription'),
      translate('ja', 'repositoriesDescription'),
      translate('ja', 'errorInternal'),
    ];
    for (const message of copy) expect(message).not.toContain('Stella');
  });

  it('uses the requested Japanese Git toolchain copy', () => {
    expect(translate('ja', 'toolchainTitle')).toBe('Gitツールチェイン');
    expect(translate('ja', 'toolchainDescription')).toBe(
      'Gitツールチェインが内蔵かこの端末にインストールされたもののどちらを使用するか選択します。',
    );
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
