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

  it('uses natural Japanese for navigation, Git operations, and general UI terms', () => {
    expect(translate('en', 'appActivity')).toBe('Activity');
    expect(translate('ja', 'appActivity')).toBe('活動');
    expect(translate('ja', 'appNavigation')).toBe('アプリのナビゲーション');
    expect(translate('ja', 'changes')).toBe('変更');
    expect(translate('ja', 'history')).toBe('履歴');
    expect(translate('ja', 'staged')).toBe('ステージ済み');
    expect(translate('ja', 'unstaged')).toBe('未ステージ');
    expect(translate('ja', 'uncommittedChanges')).toBe('未コミットの変更');
    expect(translate('ja', 'activityCommand')).toBe('コマンド');
    expect(translate('ja', 'diffLayout')).toBe('差分レイアウト');
    expect(translate('ja', 'unified')).toBe('インライン');
    expect(translate('ja', 'split')).toBe('左右に分割');
    expect(translate('ja', 'commit')).toBe('コミット');
    expect(translate('ja', 'description')).toBe('メッセージ');
    expect(translate('ja', 'type')).toBe('型');
    expect(translate('ja', 'scope')).toBe('スコープ');
    expect(translate('ja', 'breakingChange')).toBe('破壊的変更');
    expect(translate('ja', 'commitTypeLowercase')).toBe('型には小文字の英字のみ使用できます。');
    expect(translate('ja', 'commitScopeInvalid')).toBe('スコープには括弧や改行を使用できません。');
    expect(translate('ja', 'commitDescriptionRequired')).toBe('メッセージを入力してください。');
    expect(translate('ja', 'commitMessageSingleLine')).toBe('メッセージは1行で入力してください。');
    expect(translate('ja', 'conventionalCommitsTitle')).toBe('コミットメッセージの形式');
    expect(translate('ja', 'conventionalCommitsEnabled')).toBe('Conventional Commits形式');
    expect(translate('ja', 'conventionalCommitsDisabled')).toBe('通常形式');
    expect(translate('ja', 'stage')).toBe('ステージ');
    expect(translate('ja', 'unstage')).toBe('ステージ解除');
    expect(translate('ja', 'diff')).toBe('差分');
    expect(translate('ja', 'conflicted')).toBe('競合');
    expect(translate('ja', 'pull')).toBe('プル');
    expect(translate('ja', 'push')).toBe('プッシュ');
    expect(translate('ja', 'fetch')).toBe('フェッチ');
    expect(translate('ja', 'actionEditLines')).toBe('選択した行を編集');
    expect(translate('ja', 'actionCopySelectedLines')).toBe('選択した行をコピー');
    expect(translate('ja', 'actionStageSelectedLines')).toBe('選択した行をステージ');
    expect(translate('ja', 'createBranchMenu')).toBe('ブランチを作成');
    expect(translate('ja', 'createTagMenu')).toBe('タグを作成');
    expect(translate('ja', 'mergeMenu')).toBe('マージを実行');
    expect(translate('ja', 'rebaseMenu')).toBe('リベースを実行');
    expect(translate('ja', 'cherryPickMenu')).toBe('チェリーピックを実行');
    expect(translate('ja', 'revertMenu')).toBe('リバートを実行');
    expect(translate('ja', 'resetMenu')).toBe('リセットを実行');
    expect(translate('ja', 'resetMode')).toBe('リセット方法');
    expect(translate('ja', 'actionCheckoutBranch')).toBe('ブランチをチェックアウト');
    expect(translate('ja', 'actionContinueOperation')).toBe('操作を続行');
    expect(translate('ja', 'actionSkipOperation')).toBe('操作をスキップ');
    expect(translate('ja', 'actionAbortOperation')).toBe('操作を中止');
    expect(translate('ja', 'actionCloneRepository')).toBe('リポジトリをクローン');
    expect(translate('ja', 'searchRepositories')).toBe('リポジトリ名で検索');
    expect(translate('ja', 'searchBranches')).toBe('ブランチ名で検索');
    expect(translate('ja', 'forgetRepositoryDescription', { repository: 'xxxx' })).toBe(
      'リポジトリ「xxxx」の登録だけ解除するか、ローカルファイルをゴミ箱へ移動するか選択してください。',
    );
  });

  it('uses natural Japanese for Activity actions and summaries', () => {
    expect(translate('ja', 'actionStageFiles')).toBe('ファイルをステージ');
    expect(translate('ja', 'actionUnstageFiles')).toBe('ファイルのステージを解除');
    expect(translate('ja', 'backendChangesStaged')).toBe('変更をステージしました');
    expect(translate('ja', 'backendChangesUnstaged')).toBe('変更のステージを解除しました');
    expect(translate('ja', 'actionCommit')).toBe('コミット');
    expect(translate('ja', 'backendCommitCreated')).toBe('コミットを作成しました');
  });

  it('uses the requested Japanese terms for Activity metrics', () => {
    expect(translate('ja', 'activityCommits')).toBe('コミット');
    expect(translate('ja', 'activityContributors')).toBe('コントリビューター');
    expect(translate('ja', 'activityBranches')).toBe('ブランチ');
    expect(translate('ja', 'activityCommitValue', { count: 8 })).toBe('8件');
    expect(translate('ja', 'activityContributorValue', { count: 2 })).toBe('2人');
    expect(translate('ja', 'activityBranchValue', { count: 3 })).toBe('3件');
  });

  it('keeps the product name out of localized application copy', () => {
    for (const translations of Object.values(MESSAGES)) {
      expect(String(translations.en)).not.toContain('Stella');
      expect(String(translations.ja)).not.toContain('Stella');
    }
  });

  it('uses the requested Japanese Git toolchain copy', () => {
    expect(translate('ja', 'toolchainTitle')).toBe('Gitツールチェーン');
    expect(translate('ja', 'toolchainDescription')).toBe(
      '内蔵のGitツールチェーンまたはこの端末にインストールされたものを選択します。',
    );
    expect(translate('ja', 'toolchainRestartRequired')).toBe(
      '変更を反映するにはアプリを再起動してください。',
    );
    expect(translate('ja', 'errorHookFailed')).toBe('Gitフックによって操作が拒否されました。');
  });

  it('uses localized Stage display copy without mixing Git terms', () => {
    expect(translate('en', 'stageDisplayTitle')).toBe('Stage Display');
    expect(translate('en', 'stageDisplayDescription')).toBe(
      'Choose whether Staged and Unstaged files are shown separately.',
    );
    expect(translate('ja', 'stageDisplayTitle')).toBe('ステージの表示');
    expect(translate('ja', 'stageDisplayDescription')).toBe(
      'ステージ済みと未ステージのファイルを分けて表示するか選択します。',
    );
    expect(translate('en', 'stageDisplayShow')).toBe('Show');
    expect(translate('en', 'stageDisplayHide')).toBe('Hide');
    expect(translate('ja', 'stageDisplayShow')).toBe('表示する');
    expect(translate('ja', 'stageDisplayHide')).toBe('表示しない');
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
