import i18next from 'i18next';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { detectLanguage, I18nProvider, translate, useI18n, type Language } from './i18n';
import { isMessageKey, resources } from './messages';

function interpolationVariables(value: string) {
  return [...value.matchAll(/\{\{([^,}]+)/gu)]
    .flatMap((match) => (match[1] ? [match[1]] : []))
    .toSorted((left, right) => left.localeCompare(right));
}

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
    expect(Object.keys(resources.en.translation).toSorted()).toEqual(
      Object.keys(resources.ja.translation).toSorted(),
    );
  });

  it('keeps interpolation variables and sentence breaks aligned between catalogs', () => {
    for (const id of Object.keys(resources.en.translation)) {
      if (!isMessageKey(id)) throw new Error(`Unknown translation key: ${id}`);
      const english = resources.en.translation[id];
      const japanese = resources.ja.translation[id];
      expect({ id, variables: interpolationVariables(japanese) }).toEqual({
        id,
        variables: interpolationVariables(english),
      });
      expect({ id, lines: japanese.split('\n').length }).toEqual({
        id,
        lines: english.split('\n').length,
      });
    }
  });

  it('starts each sentence on a new line', () => {
    for (const translation of Object.values(resources.ja.translation)) {
      expect(translation).not.toMatch(/[。！？](?=.)/u);
    }
    for (const translation of Object.values(resources.en.translation)) {
      expect(translation).not.toMatch(/[.!?] (?=[A-Z{])/u);
    }
  });

  it('does not fall back to English when the selected catalog has no message', () => {
    i18next.removeResourceBundle('ja', 'translation');
    try {
      expect(translate('ja', 'settingsTitle')).toBe('settingsTitle');
    } finally {
      i18next.addResourceBundle('ja', 'translation', structuredClone(resources.ja.translation));
    }
  });

  it('expands typed arguments and applies English plural forms', () => {
    expect(
      translate('en', 'changeAllAria', {
        action: 'Stage',
        count: 1,
        context: 'unstaged',
      }),
    ).toBe('Stage all 1 unstaged file');
    expect(
      translate('en', 'changeAllAria', {
        action: 'Stage',
        count: 2,
        context: 'unstaged',
      }),
    ).toBe('Stage all 2 unstaged files');
    expect(translate('ja', 'previewDeleteFiles', { count: 2 })).toBe(
      '2ファイルをゴミ箱へ移動します。\nゴミ箱から復元できます。',
    );
    expect(translate('en', 'uncommittedFileCount', { count: 1 })).toBe('1 file');
    expect(translate('en', 'uncommittedFileCount', { count: 2 })).toBe('2 files');
    expect(translate('ja', 'uncommittedFileCount', { count: 2 })).toBe('2ファイル');
  });

  it('uses natural Japanese for navigation, Git operations, and general UI terms', () => {
    expect(translate('en', 'appActivity')).toBe('Activity');
    expect(translate('en', 'copy')).toBe('Copy');
    expect(translate('en', 'create')).toBe('Create');
    expect(translate('en', 'clone')).toBe('Clone');
    expect(translate('en', 'switch')).toBe('Switch');
    expect(translate('en', 'merge')).toBe('Merge');
    expect(translate('en', 'rebase')).toBe('Rebase');
    expect(translate('en', 'cherryPick')).toBe('Cherry-pick');
    expect(translate('en', 'revert')).toBe('Revert');
    expect(translate('en', 'reset')).toBe('Reset');
    expect(translate('en', 'actionCopySelectedLines')).toBe('Copy Selected Lines');
    expect(translate('en', 'actionCloneRepository')).toBe('Clone Repository');
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
    expect(translate('ja', 'changeListDisplayTitle')).toBe('ファイルの表示形式');
    expect(translate('ja', 'changeListDisplayDescription')).toBe(
      '変更されたファイルの表示形式を選択します。',
    );
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
    expect(translate('ja', 'copy')).toBe('コピー');
    expect(translate('ja', 'create')).toBe('作成');
    expect(translate('ja', 'clone')).toBe('クローン');
    expect(translate('ja', 'switch')).toBe('切り替え');
    expect(translate('ja', 'createBranchMenu')).toBe('ブランチを作成');
    expect(translate('ja', 'createTagMenu')).toBe('タグを作成');
    expect(translate('ja', 'merge')).toBe('マージ');
    expect(translate('ja', 'rebase')).toBe('リベース');
    expect(translate('ja', 'cherryPick')).toBe('チェリーピック');
    expect(translate('ja', 'revert')).toBe('リバート');
    expect(translate('ja', 'reset')).toBe('リセット');
    expect(translate('ja', 'resetMode')).toBe('リセット方法');
    expect(translate('ja', 'actionCheckoutBranch')).toBe('ブランチをチェックアウト');
    expect(translate('ja', 'actionContinueOperation')).toBe('操作を続行');
    expect(translate('ja', 'actionSkipOperation')).toBe('操作をスキップ');
    expect(translate('ja', 'actionAbortOperation')).toBe('操作を中止');
    expect(translate('ja', 'actionCloneRepository')).toBe('リポジトリをクローン');
    expect(translate('ja', 'searchRepositories')).toBe('リポジトリを検索');
    expect(translate('ja', 'searchBranches')).toBe('ブランチを検索');
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
    for (const catalog of [resources.en.translation, resources.ja.translation]) {
      for (const [id, translation] of Object.entries(catalog)) {
        if (id.startsWith('nativeMenu')) continue;
        expect(translation).not.toContain('Stella');
      }
    }
  });

  it('uses the requested global ignore list copy in both languages', () => {
    expect(translate('en', 'ignorePatternsTitle')).toBe('Global Ignore List');
    expect(translate('en', 'ignorePatternsDescription')).toBe(
      'Enter one pattern per line using .gitignore syntax.\nThis applies to every repository opened in the app without affecting Terminal or other Git clients.\nExisting global Git ignore rules continue to apply.',
    );
    expect(translate('en', 'ignorePatternsChangeFailed')).toBe(
      'The global ignore list could not be changed.',
    );
    expect(translate('ja', 'ignorePatternsTitle')).toBe('グローバル無視リスト');
    expect(translate('ja', 'ignorePatternsDescription')).toBe(
      '1行に1つ、.gitignoreと同じ書式で入力します。\nこのアプリで開くすべてのリポジトリに適用し、ターミナルや他のGitクライアントには影響しません。\n既存のGitの共通無視設定も引き続き適用されます。',
    );
    expect(translate('ja', 'ignorePatternsChangeFailed')).toBe(
      'グローバル無視リストを変更できませんでした。',
    );
  });

  it('uses the requested Japanese Git toolchain copy', () => {
    expect(translate('ja', 'appearanceDescription')).toBe(
      'macOSの外観に合わせるか、ライトまたはダークに固定します。',
    );
    expect(translate('ja', 'toolchainTitle')).toBe('Gitツールチェーン');
    expect(translate('ja', 'toolchainDescription')).toBe(
      '内蔵のGitツールチェーンと、このMacにインストール済みのGitツールチェーンから選択します。\n変更は再起動後に反映されます。',
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
