export type MessageArgs = Readonly<Record<string, string | number>>;

interface Formatters {
  number: (value: number) => string;
}

type MessageValue = string | ((args: MessageArgs, formatters: Formatters) => string);

interface MessageTranslations {
  en: MessageValue;
  ja: MessageValue;
}

function text(args: MessageArgs, key: string): string {
  const value = args[key];
  return value === undefined ? '' : String(value);
}

function count(args: MessageArgs, key: string): number {
  const value = Number(args[key]);
  return Number.isFinite(value) ? value : 0;
}

export const MESSAGES = {
  appActivity: { en: 'Activity', ja: 'アクティビティ' },
  appSettings: { en: 'Settings', ja: '設定' },
  appNavigation: { en: 'App navigation', ja: 'アプリのナビゲーション' },
  back: { en: 'Back', ja: '戻る' },
  preferences: { en: 'Preferences', ja: '環境設定' },
  settingsTitle: { en: 'Settings', ja: '設定' },
  appearanceTitle: { en: 'Appearance', ja: '外観' },
  appearanceDescription: {
    en: 'Follow the macOS appearance or use a fixed theme.',
    ja: 'macOSの外観に合わせるか、テーマを固定します。',
  },
  appearanceSystem: { en: 'System', ja: 'システム' },
  appearanceLight: { en: 'Light', ja: 'ライト' },
  appearanceDark: { en: 'Dark', ja: 'ダーク' },
  languageTitle: { en: 'Language', ja: '言語' },
  stageDisplayTitle: { en: 'Stage Display', ja: 'ステージの表示' },
  stageDisplayDescription: {
    en: 'Choose whether Staged and Unstaged files are shown separately.',
    ja: 'ステージ済みと未ステージのファイルを分けて表示するか選択します。',
  },
  stageDisplayShow: { en: 'Show', ja: '表示する' },
  stageDisplayHide: { en: 'Hide', ja: '表示しない' },
  conventionalCommitsTitle: { en: 'Conventional Commits', ja: 'Conventional Commits' },
  conventionalCommitsDescription: {
    en: 'Choose whether to compose commit messages in Conventional Commits format. Repository Git Hooks continue to run.',
    ja: 'コミットメッセージをConventional Commits形式で作成するか選択します。RepositoryのGit Hookによる検証は変更しません。',
  },
  conventionalCommitsEnabled: { en: 'Use', ja: '使用する' },
  conventionalCommitsDisabled: { en: "Don't Use", ja: '使用しない' },
  stickyFileHeadersTitle: { en: 'Sticky File Headers', ja: 'ファイルヘッダーの追従' },
  stickyFileHeadersDescription: {
    en: 'Keep file headers visible at the top while scrolling a Diff.',
    ja: 'Diffをスクロールしたときにファイルヘッダーを上部へ固定するか選択します。',
  },
  stickyFileHeadersEnabled: { en: 'On', ja: '追従する' },
  stickyFileHeadersDisabled: { en: 'Off', ja: '追従しない' },
  editorLineWrappingTitle: { en: 'Line Wrapping', ja: '行の折り返し' },
  editorLineWrappingDescription: {
    en: 'Choose whether to wrap long lines.',
    ja: '長い行を折り返して表示するか選択します。',
  },
  editorLineWrappingEnabled: { en: 'Wrap', ja: '折り返す' },
  editorLineWrappingDisabled: { en: "Don't Wrap", ja: '折り返さない' },
  editorWrapColumnTitle: { en: 'Wrap Length', ja: '折り返す文字数' },
  editorWrapColumnDescription: {
    en: 'When line wrapping is enabled, wrap at the specified length.',
    ja: '行の折り返す場合、指定した文字数で折り返します。',
  },
  toolchainTitle: { en: 'Git Toolchain', ja: 'Gitツールチェイン' },
  toolchainDescription: {
    en: 'Choose whether to use the bundled Git toolchain or one installed on this Mac.',
    ja: 'Gitツールチェインが内蔵かこの端末にインストールされたもののどちらを使用するか選択します。',
  },
  toolchainBundled: { en: 'Bundled', ja: '内蔵' },
  toolchainSystem: { en: 'System', ja: 'システム' },
  toolchainCurrentSession: { en: 'Current session', ja: '現在のセッション' },
  toolchainNextLaunch: { en: 'Next launch', ja: '次回起動' },
  toolchainRestartRequired: {
    en: 'Restart the app to apply this change.',
    ja: '変更を反映するにはアプリを再起動してください。',
  },
  toolchainUnavailable: { en: 'Unavailable', ja: '利用できません' },
  toolchainLoadFailed: {
    en: 'The Git toolchain status could not be loaded.',
    ja: 'Gitツールチェインの状態を取得できませんでした。',
  },
  toolchainChangeFailed: {
    en: 'The Git toolchain setting could not be changed.',
    ja: 'Gitツールチェインの設定を変更できませんでした。',
  },
  languageDescription: {
    en: 'Choose the interface language.',
    ja: '表示に使用する言語を選択します。',
  },
  languageJapanese: { en: '日本語', ja: '日本語' },
  languageEnglish: { en: 'English', ja: 'English' },
  loading: { en: 'Loading…', ja: '読み込み中…' },
  modified: { en: 'Modified', ja: '変更あり' },
  detachedHead: { en: 'Detached HEAD', ja: 'Detached HEAD' },
  repositoryView: { en: 'Repository view', ja: 'リポジトリ表示' },
  changes: { en: 'Changes', ja: '変更差分' },
  history: { en: 'History', ja: '操作履歴' },
  conflicted: { en: 'Conflicted', ja: 'Conflict' },
  staged: { en: 'Staged', ja: 'ステージ済み' },
  unstaged: { en: 'Unstaged', ja: '未ステージ' },
  untracked: { en: 'Untracked', ja: 'Untracked' },
  added: { en: 'Added', ja: '追加' },
  deleted: { en: 'Deleted', ja: '削除' },
  renamed: { en: 'Renamed', ja: '名前変更' },
  binary: { en: 'Binary', ja: 'Binary' },
  stage: { en: 'Stage', ja: 'Stage' },
  unstage: { en: 'Unstage', ja: 'Unstage' },
  discard: { en: 'Discard', ja: '破棄' },
  merge: { en: 'Merge', ja: 'マージ' },
  rebase: { en: 'Rebase', ja: 'リベース' },
  tag: { en: 'Tag', ja: 'タグ' },
  squash: { en: 'Squash', ja: 'スカッシュ' },
  fetch: { en: 'Fetch', ja: 'フェッチ' },
  pull: { en: 'Pull', ja: 'プル' },
  push: { en: 'Push', ja: 'プッシュ' },
  changeAllAria: {
    en: (args, { number }) => {
      const total = count(args, 'count');
      return `${text(args, 'action')} all ${number(total)} ${text(args, 'area').toLowerCase()} ${total === 1 ? 'file' : 'files'}`;
    },
    ja: (args, { number }) =>
      `${text(args, 'area')}の${number(count(args, 'count'))}ファイルをすべて${text(args, 'action')}`,
  },
  changeStatusAria: {
    en: (args) => `${text(args, 'status')} ${text(args, 'path')}`,
    ja: (args) => `${text(args, 'status')} ${text(args, 'path')}`,
  },
  moreActionsFor: {
    en: (args) => `More actions for ${text(args, 'path')}`,
    ja: (args) => `${text(args, 'path')}のその他の操作`,
  },
  moreActionsForSelectedFile: {
    en: (args) => `More actions for selected file ${text(args, 'path')}`,
    ja: (args) => `選択中のファイル${text(args, 'path')}のその他の操作`,
  },
  moreActions: { en: 'More actions', ja: 'その他の操作' },
  fileActionsFor: {
    en: (args) => `${text(args, 'path')} actions`,
    ja: (args) => `${text(args, 'path')}の操作`,
  },
  selectedFileActions: {
    en: (args, { number }) => `${number(count(args, 'count'))} selected files actions`,
    ja: (args, { number }) => `選択した${number(count(args, 'count'))}ファイルの操作`,
  },
  openInDefaultApp: { en: 'Open in Default App', ja: 'デフォルトアプリで開く' },
  editFile: { en: 'Edit', ja: '編集' },
  displayFile: { en: 'Display', ja: '表示' },
  fileViewMode: { en: 'File view mode', ja: 'ファイル表示モード' },
  showInFinder: { en: 'Show in Finder', ja: 'Finderで表示' },
  copyPath: { en: 'Copy Path', ja: 'パスをコピー' },
  discardFilesEllipsis: { en: 'Discard Files…', ja: 'ファイルを破棄…' },
  deleteFilesEllipsis: { en: 'Delete Files…', ja: 'ファイルを削除…' },
  resolveConflictsBeforeCommit: {
    en: 'Resolve all conflicts before committing.',
    ja: 'すべてのConflictを解決してからコミットしてください。',
  },
  stageChangesToCommit: {
    en: 'Stage changes to commit.',
    ja: 'コミットする変更をStageしてください。',
  },
  regularCommitUnavailable: {
    en: (args) =>
      `${text(args, 'operation')}. Regular commits are unavailable; use Continue, Skip, or Abort.`,
    ja: (args) =>
      `${text(args, 'operation')}。通常のコミットは利用できません。Continue、Skip、Abortを使用してください。`,
  },
  regularCommitAbortOnly: {
    en: (args) =>
      `${text(args, 'operation')}. Regular commits are unavailable; use Abort to restore the pre-operation state.`,
    ja: (args) =>
      `${text(args, 'operation')}。通常のコミットは利用できません。操作前の状態に戻すにはAbortを使用してください。`,
  },
  operationActionsUnavailable: {
    en: (args) =>
      `${text(args, 'operation')}. Stage, Unstage, Discard, and remote actions are unavailable until you finish or abort the operation.`,
    ja: (args) =>
      `${text(args, 'operation')}。操作を完了またはAbortするまで、Stage、Unstage、破棄、リモート操作は利用できません。`,
  },
  stageUnavailableUnsavedConflict: {
    en: 'Staging cannot change while the conflict result has unsaved edits.',
    ja: 'Conflict結果に未保存の編集がある間はStage状態を変更できません。',
  },
  stageUnavailableUnsavedChanges: {
    en: 'Save or discard the current edits before running Git actions.',
    ja: '現在の編集内容を保存または破棄してからGit操作を実行してください。',
  },
  unsaved: { en: 'Unsaved', ja: '未保存' },
  unsavedChanges: { en: 'Unsaved changes', ja: '未保存の変更' },
  saveOrDiscardBeforeDisplay: {
    en: 'Save or discard the edits before returning to the Diff.',
    ja: 'Diffの表示へ戻る前に、編集内容を保存または破棄してください。',
  },
  displayWithoutSaving: { en: 'Display Without Saving', ja: '保存せずに表示' },
  saveAndDisplay: { en: 'Save and Display', ja: '保存して表示' },
  saveOrDiscardBeforeAction: {
    en: 'Save or discard the edits before running this operation.',
    ja: 'この操作を実行する前に、編集内容を保存または破棄してください。',
  },
  saveOrDiscardBeforeClosing: {
    en: 'Save or discard the edits before closing this window.',
    ja: 'ウインドウを閉じる前に、編集内容を保存または破棄してください。',
  },
  saveAndClose: { en: 'Save and Close', ja: '保存して閉じる' },
  closeWithoutSaving: { en: 'Close Without Saving', ja: '破棄して閉じる' },
  closeWindowFailedTitle: {
    en: 'Could not close the window',
    ja: 'ウインドウを閉じられませんでした',
  },
  closeWindowFailed: {
    en: 'The window could not be closed.',
    ja: 'ウインドウを閉じられませんでした。',
  },
  fileEditorAria: {
    en: (args) => `Edit ${text(args, 'path')}`,
    ja: (args) => `${text(args, 'path')}を編集`,
  },
  fileEditStagedNotice: {
    en: 'Saving creates an Unstaged change. The index is not changed.',
    ja: '保存内容はUnstaged changesになります。Stage済みの内容は変更しません。',
  },
  fileEditExternalTitle: {
    en: 'This file changed outside the editor',
    ja: 'ファイルが外部で変更されました',
  },
  fileEditExternalDescription: {
    en: 'The current draft is preserved. Copy it before reloading if you need to keep it.',
    ja: '現在の下書きは保持されています。必要な場合は再読み込み前にコピーしてください。',
  },
  fileEditExternalDetected: {
    en: 'An external file change was detected. The draft was not overwritten.',
    ja: '外部の変更を検出しました。下書きは上書きされていません。',
  },
  fileEditExternalReloaded: {
    en: 'The external file contents were reloaded.',
    ja: '外部のファイル内容を再読み込みしました。',
  },
  fileEditSaved: {
    en: 'The file was saved to the worktree.',
    ja: 'ファイルをworktreeに保存しました。',
  },
  fileEditSaveFailed: {
    en: 'The file could not be saved.',
    ja: 'ファイルを保存できませんでした。',
  },
  fileEditReloadFailed: {
    en: 'The file could not be reloaded.',
    ja: 'ファイルを再読み込みできませんでした。',
  },
  fileEditDraftCopied: {
    en: 'The draft was copied.',
    ja: '下書きをコピーしました。',
  },
  fileEditCopyFailed: {
    en: 'The draft could not be copied.',
    ja: '下書きをコピーできませんでした。',
  },
  fileEditDiscardTitle: {
    en: 'Discard the current draft?',
    ja: '現在の下書きを破棄しますか？',
  },
  fileEditDiscardDescription: {
    en: 'Reloading discards the current draft and undo history.',
    ja: '再読み込みすると、現在の下書きと取り消し履歴が破棄されます。',
  },
  copyDraft: { en: 'Copy Draft', ja: '下書きをコピー' },
  discardAndReload: { en: 'Discard and Reload', ja: '破棄して再読み込み' },
  externalChange: { en: 'External change', ja: '外部の変更' },
  fileEditLoadFailedTitle: {
    en: 'Could not open the editor',
    ja: 'エディタを開けませんでした',
  },
  fileEditLoadFailed: {
    en: 'The file could not be loaded for editing.',
    ja: 'ファイルを編集用に読み込めませんでした。',
  },
  fileEditUnsupported: {
    en: (args) => {
      const reason = text(args, 'reason');
      const descriptions: Record<string, string> = {
        binary: 'It is marked as binary.',
        conflict: 'Use the conflict editor for this file.',
        deleted: 'It has been deleted from the worktree.',
        gitLfs: 'Git LFS files are not supported.',
        lineEndings: 'It has mixed or unsupported line endings.',
        nonUtf8: 'It is not UTF-8 text.',
        notRegularFile: 'It is not a regular file.',
        nul: 'It contains binary NUL bytes.',
        submodule: 'Submodules are not supported.',
        symlink: 'Symbolic links are not supported.',
        tooLarge: 'It exceeds the size, line count, or line length limit.',
      };
      return descriptions[reason]
        ? `This file cannot be edited in the built-in editor. ${descriptions[reason]}`
        : 'This file cannot be edited in the built-in editor.';
    },
    ja: (args) => {
      const reason = text(args, 'reason');
      const descriptions: Record<string, string> = {
        binary: 'binaryに指定されています。',
        conflict: 'このファイルは競合Editorを使用してください。',
        deleted: 'worktreeから削除されています。',
        gitLfs: 'Git LFS対象fileは対応していません。',
        lineEndings: '改行形式が混在しているか対応外です。',
        nonUtf8: 'UTF-8 textではありません。',
        notRegularFile: '通常fileではありません。',
        nul: 'binaryのNUL byteを含んでいます。',
        submodule: 'submoduleは対応していません。',
        symlink: 'symlinkは対応していません。',
        tooLarge: 'size、行数、または最長行の上限を超えています。',
      };
      return descriptions[reason]
        ? `このファイルは内蔵エディタで編集できません。${descriptions[reason]}`
        : 'このファイルは内蔵エディタで編集できません。';
    },
  },
  fileEditUnavailable: {
    en: 'Only files currently shown in Changes can be edited.',
    ja: '現在Changesに表示されているファイルだけ編集できます。',
  },
  fileEditExternalChange: {
    en: 'The file changed after it was opened. Reload it before saving.',
    ja: 'ファイルを開いた後に外部で変更されました。再読み込みしてから保存してください。',
  },
  loadChangesFailedTitle: { en: 'Could not load changes', ja: '変更を読み込めませんでした' },
  loadChangesFailed: { en: 'Could not load changes.', ja: '変更を読み込めませんでした。' },
  copiedPath: {
    en: (args) => `Copied ${text(args, 'path')}`,
    ja: (args) => `${text(args, 'path')}をコピーしました`,
  },
  copyPathFailedTitle: {
    en: 'Could not copy file path',
    ja: 'ファイルパスをコピーできませんでした',
  },
  copyPathFailed: {
    en: 'Could not copy the file path.',
    ja: 'ファイルパスをコピーできませんでした。',
  },
  setUpstreamBeforePull: {
    en: 'Set an upstream branch before pulling.',
    ja: 'プルする前にupstreamブランチを設定してください。',
  },
  fastForwardUnavailable: { en: 'Fast-forward unavailable', ja: 'Fast-forwardできません' },
  fetchCompleteResolve: {
    en: (args) => `Fetch is complete. Merge or rebase ${text(args, 'target')}.`,
    ja: (args) => `フェッチしました。${text(args, 'target')}をマージまたはリベースしてください。`,
  },
  changedFiles: { en: 'Changed files', ja: '変更されたファイル' },
  changesListWidth: { en: 'Changes list width', ja: '変更一覧の幅' },
  diffLayout: { en: 'Diff layout', ja: 'Diffレイアウト' },
  diffLayoutDescription: {
    en: 'Choose whether file diffs use a unified or split layout.',
    ja: 'ファイルのDiffを統合または分割のどちらで表示するか選択します。',
  },
  unified: { en: 'Unified', ja: '統合' },
  split: { en: 'Split', ja: '分割' },
  binaryWholeFileOnly: {
    en: 'Binary files can be managed only as whole files.',
    ja: 'Binaryファイルはファイル全体のみ操作できます。',
  },
  diffDisplayLimit: {
    en: 'The diff exceeded the display limit, so only the beginning is shown. Line selection is unavailable.',
    ja: 'Diffが表示上限を超えたため、先頭部分のみ表示しています。行選択は利用できません。',
  },
  fileDiffAria: {
    en: (args) => `${text(args, 'path')} diff`,
    ja: (args) => `${text(args, 'path')}のDiff`,
  },
  collapseFileDiff: {
    en: (args) => `Collapse ${text(args, 'path')} diff`,
    ja: (args) => `${text(args, 'path')}のDiffを折りたたむ`,
  },
  collapseChangeGroup: {
    en: (args) => `Collapse ${text(args, 'area')}`,
    ja: (args) => `${text(args, 'area')}を折りたたむ`,
  },
  expandFileDiff: {
    en: (args) => `Expand ${text(args, 'path')} diff`,
    ja: (args) => `${text(args, 'path')}のDiffを展開する`,
  },
  expandChangeGroup: {
    en: (args) => `Expand ${text(args, 'area')}`,
    ja: (args) => `${text(args, 'area')}を展開する`,
  },
  selectedLines: { en: 'Selected lines', ja: '選択した行' },
  hunkNumber: {
    en: (args) => `Hunk ${text(args, 'number')}`,
    ja: (args) => `Hunk ${text(args, 'number')}`,
  },
  hunkRangeLabel: {
    en: (args) => `Hunk ${text(args, 'number')} Lines ${text(args, 'start')}–${text(args, 'end')}`,
    ja: (args) => `ハンク${text(args, 'number')} 行${text(args, 'start')}–${text(args, 'end')}`,
  },
  stageHunk: { en: 'Stage Hunk', ja: 'ハンクをステージ' },
  unstageHunk: { en: 'Unstage Hunk', ja: 'ハンクをアンステージ' },
  discardHunk: { en: 'Discard Hunk', ja: 'ハンクを破棄' },
  editHunk: { en: 'Edit Hunk', ja: 'ハンクを編集' },
  editHunkAria: {
    en: (args) =>
      `Edit hunk ${text(args, 'number')}, lines ${text(args, 'start')}–${text(args, 'end')}`,
    ja: (args) =>
      `ハンク${text(args, 'number')}（${text(args, 'start')}–${text(args, 'end')}行）を編集`,
  },
  stageHunkAria: {
    en: (args) =>
      `Stage hunk ${text(args, 'number')}, lines ${text(args, 'start')}–${text(args, 'end')}`,
    ja: (args) =>
      `Hunk ${text(args, 'number')}（${text(args, 'start')}–${text(args, 'end')}行）をStage`,
  },
  unstageHunkAria: {
    en: (args) =>
      `Unstage hunk ${text(args, 'number')}, lines ${text(args, 'start')}–${text(args, 'end')}`,
    ja: (args) =>
      `Hunk ${text(args, 'number')}（${text(args, 'start')}–${text(args, 'end')}行）をUnstage`,
  },
  discardHunkAria: {
    en: (args) =>
      `Discard hunk ${text(args, 'number')}, lines ${text(args, 'start')}–${text(args, 'end')}`,
    ja: (args) =>
      `ハンク${text(args, 'number')}（${text(args, 'start')}–${text(args, 'end')}行）を破棄`,
  },
  lineRange: {
    en: (args) => `Lines ${text(args, 'start')}–${text(args, 'end')}`,
    ja: (args) => `${text(args, 'start')}–${text(args, 'end')}行`,
  },
  saveOrDiscardBeforeChangingFile: {
    en: 'Save the result to the worktree or discard your edits before changing files.',
    ja: 'ファイルを切り替える前に、結果をworktreeへ保存するか編集を破棄してください。',
  },
  historyActionsUnavailable: {
    en: (args) =>
      `${text(args, 'operation')}. Repository actions are unavailable in History until you finish or abort the operation.`,
    ja: (args) =>
      `${text(args, 'operation')}。操作を完了またはAbortするまで操作履歴のリポジトリ操作は利用できません。`,
  },
  loadCommitDetailsFailedTitle: {
    en: 'Could not load commit details',
    ja: 'Commit詳細を読み込めませんでした',
  },
  loadCommitDetailsFailed: {
    en: 'Could not load commit details.',
    ja: 'Commit詳細を読み込めませんでした。',
  },
  loadMoreHistoryFailedTitle: {
    en: 'Could not load more history',
    ja: '操作履歴を追加で読み込めませんでした',
  },
  loadMoreHistoryFailed: {
    en: 'Could not load more history.',
    ja: '操作履歴を追加で読み込めませんでした。',
  },
  searchHistoryFailedTitle: {
    en: 'Could not search history',
    ja: '操作履歴を検索できませんでした',
  },
  searchHistoryFailed: {
    en: 'Could not search history.',
    ja: '操作履歴を検索できませんでした。',
  },
  actions: { en: 'Actions', ja: '操作' },
  commitHistory: { en: 'Commit history', ja: '操作履歴' },
  searchHistory: { en: 'Search history', ja: '操作履歴を検索' },
  uncommittedChanges: { en: 'Uncommitted changes', ja: '未コミットの変更' },
  uncommittedFileCount: {
    en: (args, { number }) => {
      const value = count(args, 'count');
      return `${number(value)} ${value === 1 ? 'file' : 'files'}`;
    },
    ja: (args, { number }) => `${number(count(args, 'count'))}ファイル`,
  },
  noHistorySearchResults: {
    en: 'No commits match your search.',
    ja: '一致する操作履歴はありません。',
  },
  tagRefLabel: {
    en: (args) => `Tag ${text(args, 'name')}`,
    ja: (args) => `タグ ${text(args, 'name')}`,
  },
  commitParents: {
    en: (args) => `Parents ${text(args, 'parents')}`,
    ja: (args) => `Parent ${text(args, 'parents')}`,
  },
  rootCommit: { en: 'Root commit', ja: '最初のCommit' },
  historyListWidth: { en: 'History list width', ja: '操作履歴一覧の幅' },
  author: { en: 'Author', ja: '作成者' },
  date: { en: 'Date', ja: '日時' },
  commitId: { en: 'Commit ID', ja: 'コミットID' },
  binaryDiffUnavailable: {
    en: 'Binary diffs cannot be displayed as text.',
    ja: 'BinaryのDiffはテキストとして表示できません。',
  },
  diffBeginningOnly: {
    en: 'The diff exceeded the display limit, so only the beginning is shown.',
    ja: 'Diffが表示上限を超えたため、先頭部分のみ表示しています。',
  },
  commitDiffAria: {
    en: (args) => `${text(args, 'oid')} diff`,
    ja: (args) => `${text(args, 'oid')}のDiff`,
  },
  noCommitChanges: {
    en: 'No changes in this commit.',
    ja: 'このCommitに変更はありません。',
  },
  commitDetails: { en: 'Commit details', ja: 'Commit詳細' },
  loadingCommitDetails: { en: 'Loading commit details…', ja: 'Commit詳細を読み込み中…' },
  selectCommit: { en: 'Select a commit.', ja: 'Commitを選択してください。' },
  createBranchFromSelected: {
    en: 'Create branch from selected commit',
    ja: '選択したCommitからブランチを作成',
  },
  createBranch: { en: 'Create branch', ja: 'ブランチを作成' },
  createBranchMenu: { en: 'Create Branch', ja: 'ブランチを作成' },
  createAndCheckoutBranchDescription: {
    en: 'Create a branch from the current commit and switch to it.',
    ja: '現在のCommitからブランチを作成し、そのブランチへ切り替えます。',
  },
  createBranchRequiresCommit: {
    en: 'Create the first commit before creating another branch.',
    ja: '別のブランチを作成する前に最初のCommitを作成してください。',
  },
  branchName: { en: 'Branch name', ja: 'ブランチ名' },
  createTagFromSelected: {
    en: 'Create Tag from selected commit',
    ja: '選択したCommitからタグを作成',
  },
  createTag: { en: 'Create Tag', ja: 'タグを作成' },
  createTagMenu: { en: 'Create Tag', ja: 'タグを作成' },
  tagName: { en: 'Tag name', ja: 'タグ名' },
  localTagHelp: {
    en: 'Creates a lightweight Tag locally. It is not pushed to a remote.',
    ja: '軽量タグをローカルに作成します。RemoteへはPushしません。',
  },
  sourceRef: { en: 'Source ref', ja: '元のref' },
  selectedCommit: { en: 'Selected commit', ja: '選択したCommit' },
  targetCommit: { en: 'Target commit', ja: '対象Commit' },
  reviewImpact: { en: 'Review impact', ja: '影響を確認' },
  mainlineParent: { en: 'Mainline parent', ja: 'メインラインのParent' },
  parentNumber: {
    en: (args) => `Parent ${text(args, 'number')}`,
    ja: (args) => `Parent ${text(args, 'number')}`,
  },
  mainlineHelp: {
    en: 'Select the parent that was the mainline when the merge was created.',
    ja: 'マージの作成時にメインラインだったParentを選択してください。',
  },
  cherryPick: { en: 'Cherry-pick', ja: 'チェリーピック' },
  cherryPickMenu: { en: 'Cherry-pick', ja: 'チェリーピックを実行' },
  revert: { en: 'Revert', ja: 'リバート' },
  revertMenu: { en: 'Revert', ja: 'リバートを実行' },
  reset: { en: 'Reset', ja: 'リセット' },
  resetMenu: { en: 'Reset', ja: 'リセットを実行' },
  resetMode: { en: 'Reset mode', ja: 'リセット方法' },
  mergeMenu: { en: 'Merge', ja: 'マージを実行' },
  rebaseMenu: { en: 'Rebase', ja: 'リベースを実行' },
  soft: { en: 'Soft', ja: 'Soft' },
  mixed: { en: 'Mixed', ja: 'Mixed' },
  hard: { en: 'Hard', ja: 'Hard' },
  commitLowercase: { en: 'commit', ja: 'Commit' },
  resetToTarget: {
    en: (args) => `Reset to ${text(args, 'target')}`,
    ja: (args) => `${text(args, 'target')}へリセット`,
  },
  moreActionsForCommit: {
    en: (args) => `More actions for commit ${text(args, 'oid')}`,
    ja: (args) => `Commit ${text(args, 'oid')}のその他の操作`,
  },
  moreActionsForSelectedCommit: {
    en: (args) => `More actions for selected commit ${text(args, 'oid')}`,
    ja: (args) => `選択中のCommit ${text(args, 'oid')}のその他の操作`,
  },
  commitActionsFor: {
    en: (args) => `${text(args, 'subject')} ${text(args, 'oid')} actions`,
    ja: (args) => `${text(args, 'subject')} ${text(args, 'oid')}の操作`,
  },
  switchRepository: { en: 'Switch Repository', ja: 'リポジトリを切り替える' },
  searchRepositories: { en: 'Search repositories', ja: 'リポジトリを検索' },
  noRepositorySearchResults: {
    en: 'No repositories match your search.',
    ja: '検索に一致するリポジトリはありません。',
  },
  addRepositoryEllipsis: { en: 'Add Repository…', ja: 'リポジトリを追加…' },
  switchBranch: { en: 'Switch Branch', ja: 'ブランチを切り替える' },
  searchBranches: { en: 'Search branches', ja: 'ブランチを検索' },
  noBranchSearchResults: {
    en: 'No local branches match your search.',
    ja: '検索に一致するローカルブランチはありません。',
  },
  finishOperationBeforeSwitchingBranch: {
    en: (args) =>
      `${text(args, 'operation')}. Finish or abort the operation before switching branches.`,
    ja: (args) =>
      `${text(args, 'operation')}。ブランチを切り替える前に操作を完了またはAbortしてください。`,
  },
  commitOrDiscardBeforeSwitchingBranch: {
    en: 'Commit or discard changes before switching branches.',
    ja: 'ブランチを切り替える前に変更をCommitまたは破棄してください。',
  },
  waitBeforeSwitchingBranch: {
    en: 'Wait for the current operation to finish before switching branches.',
    ja: '現在の操作が完了してからブランチを切り替えてください。',
  },
  reload: { en: 'Reload', ja: '再読み込み' },
  available: { en: 'Available', ja: '利用可能' },
  notInitialized: { en: 'Not initialized', ja: '未初期化' },
  enabled: { en: 'Enabled', ja: '有効' },
  disabled: { en: 'Disabled', ja: '無効' },
  running: { en: 'Running…', ja: '実行中…' },
  gitFlowTitle: { en: 'Git Flow', ja: 'Git Flow' },
  gitFlowDescription: {
    en: 'Inspect and operate the repository Git Flow model.',
    ja: 'RepositoryのGit Flow構成を確認し、型付き操作を実行します。',
  },
  gitFlowOverview: { en: 'Repository overview', ja: 'Repository概要' },
  gitFlowHealth: { en: 'Health', ja: '状態' },
  gitFlowBaseBranch: { en: 'Base branch', ja: 'ベースブランチ' },
  gitFlowTopicType: { en: 'Topic type', ja: 'Topic type' },
  gitFlowActiveBranch: { en: 'Active branch', ja: 'アクティブブランチ' },
  gitFlowUnavailable: {
    en: 'Git Flow is unavailable in the active toolchain.',
    ja: '現在のtoolchainではGit Flowを利用できません。',
  },
  gitFlowOperation: { en: 'Operation', ja: '操作' },
  gitFlowCommand: { en: 'Command', ja: 'Command' },
  gitFlowPreset: { en: 'Preset', ja: 'Preset' },
  gitFlowSharedConfig: {
    en: 'Share configuration in .gitflow',
    ja: '設定を.gitflowで共有する',
  },
  gitFlowName: { en: 'Name', ja: '名前' },
  gitFlowNewName: { en: 'New name', ja: '新しい名前' },
  gitFlowParent: { en: 'Parent', ja: 'Parent' },
  gitFlowPrefix: { en: 'Prefix', ja: 'Prefix' },
  gitFlowStartingPoint: { en: 'Starting point', ja: 'Starting point' },
  gitFlowAutoUpdate: { en: 'Auto update', ja: 'Auto update' },
  gitFlowUseDefault: { en: 'Use default', ja: '既定値を使う' },
  gitFlowDeleteRemote: {
    en: 'Also delete the remote branch',
    ja: 'Remoteブランチも削除する',
  },
  gitFlowStrategy: { en: 'Integration strategy', ja: '統合方式' },
  gitFlowUpdateStrategy: { en: 'Update strategy', ja: '更新方式' },
  gitFlowConfiguredStrategy: { en: 'Repository setting', ja: 'Repository設定' },
  gitFlowDownstreamStrategy: { en: 'Update strategy', ja: '更新方式' },
  gitFlowTagName: { en: 'Tag name (optional)', ja: 'タグ名（任意）' },
  gitFlowTagMessage: { en: 'Tag message', ja: 'タグメッセージ' },
  gitFlowSignTag: { en: 'Sign the tag', ja: 'タグへ署名する' },
  gitFlowSigningKey: { en: 'Signing key (optional)', ja: '署名key（任意）' },
  gitFlowKeepBranch: { en: 'Keep the topic branch', ja: 'Topicブランチを保持する' },
  gitFlowPushAfterFinish: { en: 'Push after finishing', ja: 'Finish後にPushする' },
  gitFlowGpgUnavailable: {
    en: 'Signing is disabled because GPG is unavailable.',
    ja: 'GPGを利用できないため署名は無効です。',
  },
  operationResolvingMerge: { en: 'Resolving merge', ja: 'マージを解決中' },
  operationResolvingRebase: { en: 'Resolving rebase', ja: 'リベースを解決中' },
  operationGitFlowInProgress: {
    en: (args) => `Git Flow ${text(args, 'operation')} in progress`,
    ja: (args) => `Git Flow ${text(args, 'operation')}を復旧中`,
  },
  operationResolvingCherryPick: {
    en: 'Resolving cherry-pick',
    ja: 'チェリーピックを解決中',
  },
  operationResolvingRevert: { en: 'Resolving revert', ja: 'リバートを解決中' },
  operationExternalInProgress: {
    en: 'External Git operation in progress',
    ja: '外部のGit操作が進行中',
  },
  operationAwaitingCommit: {
    en: 'Awaiting structured commit',
    ja: '構造化されたCommitを待っています',
  },
  operationRecovering: {
    en: 'Recovering interrupted operation',
    ja: '中断された操作を復旧中',
  },
  actionGitOperation: { en: 'Git operation', ja: 'Git操作' },
  actionStageFiles: { en: 'Stage Files', ja: 'ファイルをStage' },
  actionUnstageFiles: { en: 'Unstage Files', ja: 'ファイルをUnstage' },
  actionDiscardChanges: { en: 'Discard Files', ja: 'ファイルを破棄' },
  actionCopySelectedLines: { en: 'Copy Selected Lines', ja: '選択した行をコピー' },
  actionEditLines: { en: 'Edit Lines', ja: '選択した行を編集' },
  actionStageSelectedLines: { en: 'Stage Selected Lines', ja: '選択した行をステージ' },
  actionUnstageSelectedLines: { en: 'Unstage Selected Lines', ja: '選択行をアンステージ' },
  actionStageHunk: { en: 'Stage Hunk', ja: 'ハンクをステージ' },
  actionUnstageHunk: { en: 'Unstage Hunk', ja: 'ハンクをアンステージ' },
  actionDiscardHunk: { en: 'Discard Hunk', ja: 'ハンクを破棄' },
  actionDiscardSelectedLines: { en: 'Discard Selected Lines', ja: '選択行を破棄' },
  copiedSelectedLines: {
    en: 'Copied the selected lines.',
    ja: '選択行をコピーしました。',
  },
  copySelectedLinesFailedTitle: {
    en: 'Could not copy selected lines',
    ja: '選択行をコピーできませんでした',
  },
  copySelectedLinesFailed: {
    en: 'Could not copy the selected lines.',
    ja: '選択行をコピーできませんでした。',
  },
  actionCommit: { en: 'Commit', ja: 'Commit' },
  actionFetch: { en: 'Fetch', ja: 'フェッチ' },
  actionPull: { en: 'Pull', ja: 'プル' },
  actionPush: { en: 'Push', ja: 'プッシュ' },
  actionCreateBranch: { en: 'Create Branch', ja: 'ブランチを作成' },
  actionCreateTag: { en: 'Create Tag', ja: 'タグを作成' },
  actionGitFlow: { en: 'Git Flow Operation', ja: 'Git Flow操作' },
  actionCheckoutBranch: { en: 'Checkout Branch', ja: 'ブランチをチェックアウト' },
  actionMergeBranch: { en: 'Merge Branch', ja: 'ブランチをマージ' },
  actionRebaseBranch: { en: 'Rebase Branch', ja: 'ブランチをリベース' },
  actionCherryPickCommit: { en: 'Cherry-pick Commit', ja: 'Commitをチェリーピック' },
  actionRevertCommit: { en: 'Revert Commit', ja: 'Commitをリバート' },
  actionResetToCommit: { en: 'Reset to Commit', ja: 'Commitへリセット' },
  actionContinueOperation: { en: 'Continue Operation', ja: '操作をContinue' },
  actionSkipOperation: { en: 'Skip Operation', ja: '操作をSkip' },
  actionAbortOperation: { en: 'Abort Operation', ja: '操作をAbort' },
  actionResolveConflictBlock: {
    en: 'Resolve Conflict Block',
    ja: 'Conflictブロックを解決',
  },
  actionSaveConflictResult: { en: 'Save Conflict Result', ja: 'Conflict結果を保存' },
  actionMarkConflictResolved: {
    en: 'Mark Conflict Resolved',
    ja: 'Conflictを解決済みにする',
  },
  actionApplyConflictSide: {
    en: 'Apply Conflict Side to Result',
    ja: 'Conflict側を結果に適用',
  },
  actionOpenConflictExternally: {
    en: 'Open Conflict Externally',
    ja: 'Conflictを外部で開く',
  },
  actionMoveFileToTrash: { en: 'Delete Files', ja: 'ファイルを削除' },
  actionShowInFinder: { en: 'Show in Finder', ja: 'Finderで表示' },
  actionOpenInDefaultApp: {
    en: 'Open in Default App',
    ja: 'デフォルトアプリで開く',
  },
  actionSaveFile: { en: 'Save File', ja: 'ファイルを保存' },
  actionCloneRepository: { en: 'Clone Repository', ja: 'リポジトリをClone' },
  backendCloneStarted: { en: 'Clone started', ja: 'Cloneを開始しました' },
  backendCloningRepository: { en: 'Cloning repository', ja: 'リポジトリをClone中' },
  backendCloneCompleted: { en: 'Clone completed', ja: 'Cloneが完了しました' },
  backendOperationInProgress: { en: 'Operation in progress', ja: '操作中' },
  backendConflictResultSaved: {
    en: 'Conflict result saved',
    ja: 'Conflict結果を保存しました',
  },
  backendFileSaved: {
    en: (args) => `Saved ${text(args, 'path')}`,
    ja: (args) => `${text(args, 'path')}を保存しました`,
  },
  backendConflictChoiceApplied: {
    en: 'Choice applied to conflict block',
    ja: '選択をConflictブロックに適用しました',
  },
  backendConflictSideApplied: {
    en: 'Conflict side applied to result',
    ja: 'Conflict側を結果に適用しました',
  },
  backendChangesStaged: { en: 'Changes staged', ja: '変更をStageしました' },
  backendChangesUnstaged: { en: 'Changes unstaged', ja: '変更をUnstageしました' },
  backendUnstagedChangesDiscarded: {
    en: 'Unstaged changes discarded',
    ja: 'Unstagedの変更を破棄しました',
  },
  backendUntrackedFilesTrashed: {
    en: 'Untracked files moved to Trash',
    ja: 'Untrackedファイルをゴミ箱に入れました',
  },
  backendCommitCreated: { en: 'Commit created', ja: 'Commitを作成しました' },
  backendFetchCompleted: { en: 'Fetch completed', ja: 'フェッチしました' },
  backendPullCompleted: {
    en: 'Fast-forward pull completed',
    ja: 'Fast-forwardでプルしました',
  },
  backendPushCompleted: { en: 'Push completed', ja: 'プッシュしました' },
  backendBranchCreated: { en: 'Branch created', ja: 'ブランチを作成しました' },
  backendTagCreated: { en: 'Tag created', ja: 'タグを作成しました' },
  backendGitFlowCompleted: { en: 'Git Flow operation completed', ja: 'Git Flow操作が完了しました' },
  backendBranchCheckedOut: {
    en: 'Branch checked out',
    ja: 'ブランチをチェックアウトしました',
  },
  backendMergeCreated: { en: 'Merge result created', ja: 'マージ結果を作成しました' },
  backendRebaseCompleted: { en: 'Rebase completed', ja: 'リベースが完了しました' },
  backendCherryPickCreated: {
    en: 'Cherry-pick changes created',
    ja: 'チェリーピックの変更を作成しました',
  },
  backendRevertCreated: { en: 'Revert changes created', ja: 'リバートの変更を作成しました' },
  backendResetCompleted: {
    en: (args) => `${text(args, 'mode')} reset completed`,
    ja: (args) => `${text(args, 'mode')}リセットが完了しました`,
  },
  backendConflictResolved: {
    en: 'Conflict marked as resolved',
    ja: 'Conflictを解決済みにしました',
  },
  backendExternalEditorOpened: {
    en: 'Opened external editor',
    ja: '外部エディタを開きました',
  },
  backendFilesDeleted: {
    en: (args, { number }) => `${number(count(args, 'count'))} file(s) deleted`,
    ja: (args, { number }) => `${number(count(args, 'count'))}ファイルを削除しました`,
  },
  backendShownInFinder: { en: 'Shown in Finder', ja: 'Finderで表示しました' },
  backendOpenedInDefaultApp: {
    en: 'Opened in default app',
    ja: 'デフォルトアプリで開きました',
  },
  backendRebaseContinued: { en: 'Rebase continued', ja: 'リベースをContinueしました' },
  backendCherryPickReadyToCommit: {
    en: 'Cherry-pick resolution is ready to commit',
    ja: 'チェリーピックの解決結果をCommitできます',
  },
  backendRevertReadyToCommit: {
    en: 'Revert resolution is ready to commit',
    ja: 'リバートの解決結果をCommitできます',
  },
  backendCommitSkipped: { en: 'Current commit skipped', ja: '現在のCommitをSkipしました' },
  backendOperationAborted: { en: 'Operation aborted', ja: '操作をAbortしました' },
  previewFetchRemote: {
    en: (args) => `Update remote-tracking refs from ${text(args, 'remote')}`,
    ja: (args) => `${text(args, 'remote')}からフェッチし、remote-tracking refsを更新します`,
  },
  previewPullRemote: {
    en: (args) => `Fetch from ${text(args, 'remote')}, then fast-forward the local branch`,
    ja: (args) => `${text(args, 'remote')}からフェッチし、ローカルブランチをfast-forwardします`,
  },
  previewPushRemote: {
    en: (args) =>
      `${text(args, 'remote')}: ${text(args, 'localBranch')} → ${text(args, 'remoteBranch')}`,
    ja: (args) =>
      `${text(args, 'remote')}: ${text(args, 'localBranch')} → ${text(args, 'remoteBranch')}`,
  },
  previewGitFlowRemote: {
    en: (args) =>
      `Git Flow ${text(args, 'command')} changes remote state for ${text(args, 'branch')}`,
    ja: (args) =>
      `Git Flow ${text(args, 'command')}が${text(args, 'branch')}のRemote状態を変更します`,
  },
  previewGitFlowRemoteDelete: {
    en: (args) =>
      `Delete remote branch ${text(args, 'branch')}. Other users will no longer be able to fetch it.`,
    ja: (args) =>
      `Remoteブランチ ${text(args, 'branch')}を削除します。他の利用者はこのブランチを取得できなくなります。`,
  },
  previewDiscardPaths: {
    en: (args, { number }) =>
      `Discard ${number(count(args, 'count'))} path(s) from ${text(args, 'target')}`,
    ja: (args, { number }) =>
      `${text(args, 'target')}から${number(count(args, 'count'))}件のパスを破棄します`,
  },
  previewReset: {
    en: (args) => `${text(args, 'mode')} reset HEAD to ${text(args, 'commit')}`,
    ja: (args) => `HEADを${text(args, 'commit')}へ${text(args, 'mode')}リセットします`,
  },
  previewRebase: {
    en: (args) => `Rebase the current branch onto ${text(args, 'onto')}`,
    ja: (args) => `現在のブランチを${text(args, 'onto')}へリベースします`,
  },
  previewAbort: {
    en: 'Restore the state from before the current operation',
    ja: '現在の操作前の状態に復元します',
  },
  previewApplyConflictSide: {
    en: (args) => `Apply the ${text(args, 'choice')} side to the worktree`,
    ja: (args) => `${text(args, 'choice')}側をworktreeに適用します`,
  },
  previewDeleteFiles: {
    en: (args, { number }) =>
      `Delete ${number(count(args, 'count'))} file(s). They can be restored from Trash.`,
    ja: (args, { number }) =>
      `${number(count(args, 'count'))}ファイルを削除します。削除後はゴミ箱から復元できます。`,
  },
  conflictCurrentBranch: { en: 'Current branch', ja: '現在のブランチ' },
  conflictMergedBranch: { en: 'Merged branch', ja: 'マージするブランチ' },
  conflictRebaseDestination: { en: 'Rebase destination', ja: 'リベース先' },
  conflictReplayedCommit: { en: 'Replayed commit', ja: '再適用されるCommit' },
  conflictCherryPickedCommit: { en: 'Cherry-picked commit', ja: 'チェリーピックするCommit' },
  conflictRevertResult: { en: 'Revert result', ja: 'リバート結果' },
  activityNoRepository: { en: 'No repository selected', ja: 'リポジトリが選択されていません' },
  activityRange: { en: 'Activity range', ja: 'アクティビティの期間' },
  activityMetric: { en: 'Activity metric', ja: 'アクティビティの指標' },
  activityDays: {
    en: (args, { number }) => `${number(count(args, 'count'))} days`,
    ja: (args, { number }) => `${number(count(args, 'count'))}日`,
  },
  activityOneYear: { en: '1 year', ja: '1年' },
  activityCommits: { en: 'Commits', ja: 'コミット' },
  activityContributors: { en: 'Contributors', ja: 'コントリビューター' },
  activityBranches: { en: 'Branches', ja: 'ブランチ' },
  activityCommitValue: {
    en: (args, { number }) => {
      const value = count(args, 'count');
      return `${number(value)} ${value === 1 ? 'commit' : 'commits'}`;
    },
    ja: (args, { number }) => `${number(count(args, 'count'))}件`,
  },
  activityContributorValue: {
    en: (args, { number }) => {
      const value = count(args, 'count');
      return `${number(value)} ${value === 1 ? 'contributor' : 'contributors'}`;
    },
    ja: (args, { number }) => `${number(count(args, 'count'))}人`,
  },
  activityBranchValue: {
    en: (args, { number }) => {
      const value = count(args, 'count');
      return `${number(value)} ${value === 1 ? 'branch' : 'branches'}`;
    },
    ja: (args, { number }) => `${number(count(args, 'count'))}件`,
  },
  activityOperations: { en: 'Operations', ja: '操作' },
  activityOperationsWidth: { en: 'Operations width', ja: '操作一覧の幅' },
  activityStatus: { en: 'Status', ja: '状態' },
  activityAction: { en: 'Action', ja: '操作' },
  activitySummary: { en: 'Summary', ja: '概要' },
  activityTimestamp: { en: 'Timestamp', ja: '日時' },
  activityDuration: { en: 'Duration', ja: '所要時間' },
  activityNoOperations: { en: 'No operations yet.', ja: '操作履歴はまだありません。' },
  activityOperationDetail: { en: 'Operation detail', ja: '操作の詳細' },
  activitySelectOperation: {
    en: 'Select an operation to view details.',
    ja: '操作を選択すると詳細を表示します。',
  },
  cancel: { en: 'Cancel', ja: 'キャンセル' },
  activityRepository: { en: 'Repository', ja: 'リポジトリ' },
  activityStarted: { en: 'Started', ja: '開始' },
  activityFinished: { en: 'Finished', ja: '完了' },
  activityExitCode: { en: 'Exit code', ja: '終了コード' },
  activityCommand: { en: 'Command', ja: 'コマンド' },
  activitySummaryOnly: {
    en: 'Command output is only available during the current app session.',
    ja: 'コマンド出力は現在のアプリセッション中のみ表示できます。',
  },
  activityAnalytics: { en: 'Repository analytics', ja: 'リポジトリ分析' },
  activityOpenRepository: {
    en: 'Open a repository to see its commit activity.',
    ja: 'Commitアクティビティを確認するにはリポジトリを開いてください。',
  },
  activityLoading: { en: 'Loading commit activity', ja: 'Commitアクティビティを読み込み中' },
  activityReadingHistory: {
    en: 'Reading commit history for the selected range.',
    ja: '選択期間のCommit履歴を読み込んでいます。',
  },
  activityUnavailable: {
    en: 'Commit activity unavailable',
    ja: 'Commitアクティビティを利用できません',
  },
  activityLoadFailed: {
    en: 'Could not load commit activity.',
    ja: 'Commitアクティビティを読み込めませんでした。',
  },
  retry: { en: 'Retry', ja: '再試行' },
  activityNoCommits: { en: 'No commits in this range', ja: 'この期間にCommitはありません' },
  activityNoCommitsDescription: {
    en: (args, { number }) =>
      `The selected branch history has no commits in the last ${number(count(args, 'days'))} days.`,
    ja: (args, { number }) =>
      `選択したブランチの履歴に、過去${number(count(args, 'days'))}日間のCommitはありません。`,
  },
  activityResultsTruncated: {
    en: (args, { number }) =>
      `Results are truncated after scanning ${number(count(args, 'count'))} commits.`,
    ja: (args, { number }) =>
      `${number(count(args, 'count'))}件のCommitを走査した時点で結果を省略しています。`,
  },
  activityChartDescription: {
    en: 'Selected repository metric over the chosen date range. Exact values are listed below.',
    ja: '選択期間のリポジトリ指標です。正確な値は下の一覧で確認できます。',
  },
  loadingChart: { en: 'Loading chart…', ja: 'チャートを読み込み中…' },
  activityData: { en: 'Activity data', ja: 'アクティビティデータ' },
  activityPeriod: { en: 'Period', ja: '期間' },
  activitySucceeded: { en: 'Succeeded', ja: '成功' },
  activityRunning: { en: 'Running', ja: '実行中' },
  activityFailed: { en: 'Failed', ja: '失敗' },
  activityCancelled: { en: 'Cancelled', ja: 'キャンセル済み' },
  activityInProgress: { en: 'In progress', ja: '進行中' },
  noBranch: { en: 'No branch', ja: 'ブランチなし' },
  workspaceContext: { en: 'Workspace context', ja: 'ワークスペースの情報' },
  switchRepositoryCurrent: {
    en: (args) =>
      `Switch repository. Current repository ${text(args, 'repository')}${text(args, 'state')}`,
    ja: (args) =>
      `リポジトリを切り替えます。現在のリポジトリは${text(args, 'repository')}${text(args, 'state')}`,
  },
  repositoryStateSuffix: {
    en: (args) => `. ${text(args, 'state')}`,
    ja: (args) => `。${text(args, 'state')}`,
  },
  switchBranchCurrent: {
    en: (args) => `Switch branch. Current branch ${text(args, 'branch')}`,
    ja: (args) => `ブランチを切り替えます。現在のブランチは${text(args, 'branch')}`,
  },
  activityOperationRunning: { en: 'Operation running', ja: '操作を実行中' },
  loadingActivity: { en: 'Loading Activity…', ja: 'アクティビティを読み込み中…' },
  gitOperationInProgress: { en: 'Git operation in progress', ja: 'Git操作が進行中' },
  unresolvedCount: {
    en: (args, { number }) => `${number(count(args, 'count'))} unresolved`,
    ja: (args, { number }) => `未解決 ${number(count(args, 'count'))}件`,
  },
  continueAction: { en: 'Continue', ja: 'Continue' },
  skipAction: { en: 'Skip', ja: 'Skip' },
  abortAction: { en: 'Abort', ja: 'Abort' },
  repositoriesTitle: { en: 'Repositories', ja: 'リポジトリ' },
  repositoriesDescription: {
    en: 'Open a repository or add a new one.',
    ja: 'リポジトリを選択するか、新しいリポジトリを追加します。',
  },
  noRegisteredRepositories: {
    en: 'No repositories have been added yet.',
    ja: '追加済みのリポジトリはありません。',
  },
  repositoryMissing: { en: 'Check location', ja: '場所を確認' },
  repositoryNotRepository: { en: 'Check repository', ja: 'リポジトリを確認' },
  repositoryInaccessible: { en: 'Check access', ja: 'アクセス権を確認' },
  repositoryNeedsRemoteCheck: { en: 'Check remote', ja: 'リモートを確認' },
  repositoryNeedsAuthenticationCheck: { en: 'Check authentication', ja: '認証を確認' },
  repositoryNeedsNetworkCheck: { en: 'Check connection', ja: '接続を確認' },
  repositoryCheckFailed: {
    en: 'Could not check the repository location.',
    ja: 'リポジトリの場所を確認できませんでした。',
  },
  repairRepositoryLocation: { en: 'Choose Location', ja: '場所を選び直す' },
  repositoryLocationUnavailableTitle: {
    en: 'Repository location is unavailable',
    ja: 'リポジトリの場所を利用できません',
  },
  repositoryLocationUnavailableDescription: {
    en: 'Choose the repository at its new location, or close this repository.',
    ja: '移動先のリポジトリを選ぶか、このリポジトリを閉じてください。',
  },
  repositoryLocationUnavailableWithDraft: {
    en: 'Editing has stopped to protect unsaved changes. Choose the new location or discard the changes and close the repository.',
    ja: '未保存の編集を保護するため操作を停止しました。新しい場所を選ぶか、編集内容を破棄して閉じてください。',
  },
  discardAndCloseRepository: {
    en: 'Discard Changes and Close',
    ja: '編集内容を破棄して閉じる',
  },
  chooseRelocatedRepository: { en: 'Choose New Repository Location', ja: '新しい場所を選択' },
  confirmRepositoryRelocation: { en: 'Confirm New Location', ja: '新しい場所を確認' },
  repositoryRelocationDescription: {
    en: 'The app does not determine whether these are the same repository. Confirm the locations before replacing the registration.',
    ja: '同じリポジトリかどうかは自動判定しません。登録を付け替える前に両方の場所を確認してください。',
  },
  oldRepositoryLocation: { en: 'Previous location', ja: '以前の場所' },
  newRepositoryLocation: { en: 'New location', ja: '新しい場所' },
  replaceRepositoryLocation: { en: 'Replace Location', ja: '場所を付け替える' },
  repositoryRelocationFailedTitle: {
    en: 'Could not replace repository location',
    ja: 'リポジトリの場所を付け替えられませんでした',
  },
  repositoryRelocationFailed: {
    en: 'The repository remains at its previous registration.',
    ja: '以前の登録と編集内容はそのまま保持されています。',
  },
  relocationDraftChanged: {
    en: 'The file at the new location has changed from the editing base. It was not overwritten.',
    ja: '新しい場所のファイルが編集開始時の状態と異なるため、上書きしませんでした。編集内容は保持されています。',
  },
  repositoryRelocated: {
    en: 'Repository location was replaced.',
    ja: 'リポジトリの場所を付け替えました。',
  },
  repositoryAlreadyRegisteredTitle: {
    en: 'This location is already registered',
    ja: 'この場所は登録済みです',
  },
  repositoryAlreadyRegisteredDescription: {
    en: 'Open the existing registration or remove the previous registration. The registrations will not be merged automatically.',
    ja: '既存の登録を開くか、以前の登録を解除してください。自動では統合しません。',
  },
  openRegisteredRepository: { en: 'Open Registered Repository', ja: '登録済みの方を開く' },
  forgetOldRepository: { en: 'Remove Previous Registration', ja: '以前の登録を解除' },
  forgetRepository: { en: 'Remove', ja: '登録を解除' },
  forgetNamedRepository: {
    en: () => 'Remove repository from the list',
    ja: () => 'リポジトリの登録を解除',
  },
  forgetRepositoryTitle: { en: 'Remove Repository', ja: 'リポジトリの登録を解除' },
  forgetRepositoryDescription: {
    en: (args) =>
      `Remove ${text(args, 'repository')} from the list? Local files will not be deleted.`,
    ja: (args) =>
      `${text(args, 'repository')}を一覧から解除しますか。ローカルファイルは削除しません。`,
  },
  unsavedChangesWillBeDiscarded: {
    en: 'Unsaved editing will be discarded.',
    ja: '未保存の編集内容は破棄されます。',
  },
  forgetRepositoryOperationBlocked: {
    en: 'Complete or abort the Git operation before removing this repository.',
    ja: 'Git操作を完了または中止してから登録を解除してください。',
  },
  forgetRepositoryFailedTitle: {
    en: 'Could not remove repository',
    ja: 'リポジトリの登録を解除できませんでした',
  },
  forgetRepositoryFailed: {
    en: 'The repository registration was not changed.',
    ja: 'リポジトリの登録は変更されていません。',
  },
  manageRemotes: { en: 'Remote URLs', ja: 'リモートURL' },
  manageRemotesDescription: {
    en: 'Review existing fetch and push URLs. Adding, removing, and renaming remotes are not supported.',
    ja: '既存のフェッチURLとプッシュURLを確認・変更できます。リモートの追加・削除・名称変更はできません。',
  },
  fetchUrls: { en: 'Fetch URLs', ja: 'フェッチURL' },
  pushUrls: { en: 'Push URLs', ja: 'プッシュURL' },
  fetchRemote: { en: 'Fetch', ja: 'フェッチ' },
  noRemotes: { en: 'No remotes are configured.', ja: 'リモートが設定されていません。' },
  loadRemotesFailed: {
    en: 'Could not load remote URLs.',
    ja: 'リモートURLを読み込めませんでした。',
  },
  newRemoteUrl: { en: 'New remote URL', ja: '新しいリモートURL' },
  changeRemoteUrl: {
    en: (args) => `Change a URL for ${text(args, 'remote')}`,
    ja: (args) => `${text(args, 'remote')}のURLを変更`,
  },
  reviewRemoteUrlChange: { en: 'Review Change', ja: '変更内容を確認' },
  changeRemoteUrlAction: { en: 'Change URL', ja: 'URLを変更' },
  change: { en: 'Change', ja: '変更' },
  actionSetRemoteUrl: { en: 'Change remote URL', ja: 'リモートURLを変更' },
  previewSetRemoteUrl: {
    en: 'The local Git configuration will be changed after the current URL is checked again.',
    ja: '変更前のURLを再確認してから、ローカルのGit設定を変更します。',
  },
  backendRemoteUrlUpdated: {
    en: 'The remote URL was updated.',
    ja: 'リモートURLを更新しました。',
  },
  addRepository: { en: 'Add Repository', ja: 'リポジトリを追加' },
  repositorySource: { en: 'Repository source', ja: 'リポジトリの追加元' },
  repositoryUrlTab: { en: 'URL', ja: 'URL' },
  repositoryPathTab: { en: 'Path', ja: 'パス' },
  repositoryUrl: { en: 'Repository URL', ja: 'リポジトリURL' },
  repositoryPath: { en: 'Repository path', ja: 'リポジトリのパス' },
  repositoryDisplayName: { en: 'Repository name', ja: 'リポジトリ名' },
  chooseRepositoryDirectory: { en: 'Choose Repository', ja: 'リポジトリを選択' },
  chooseCloneParentDirectory: { en: 'Choose Clone Location', ja: 'Clone先を選択' },
  chooseDirectoryFailed: {
    en: 'Could not open the folder picker.',
    ja: 'フォルダ選択を開けませんでした。',
  },
  invalidRepositoryUrl: {
    en: 'Enter a supported remote URL.',
    ja: '対応するリモートURLを入力してください。',
  },
  invalidRepositoryPath: {
    en: 'Enter an absolute local path.',
    ja: '絶対パスを入力してください。',
  },
  add: { en: 'Add', ja: '追加' },
  hasChanges: { en: 'Has changes', ja: '変更あり' },
  impactPreview: { en: 'Impact preview', ja: '影響のプレビュー' },
  affectedPaths: { en: 'Affected paths', ja: '影響を受けるパス' },
  affectedCommits: { en: 'Affected commits', ja: '影響を受けるCommit' },
  removedCommits: {
    en: 'Commits removed from the current branch',
    ja: '現在のブランチから削除されるCommit',
  },
  typeToConfirm: {
    en: (args) => `Type “${text(args, 'value')}” to confirm`,
    ja: (args) => `確認のため「${text(args, 'value')}」と入力してください`,
  },
  deleteFiles: { en: 'Delete Files', ja: 'ファイルを削除' },
  discardFiles: { en: 'Discard Files', ja: 'ファイルを破棄' },
  run: { en: 'Run', ja: '実行' },
  unsavedResult: { en: 'Unsaved result', ja: '未保存の結果' },
  saveOrDiscardBeforeLeaving: {
    en: 'Save the result to the worktree or discard your edits before leaving.',
    ja: '移動する前に結果をworktreeへ保存するか、編集を破棄してください。',
  },
  leaveWithoutSaving: { en: 'Leave Without Saving', ja: '保存せずに移動' },
  saveAndLeave: { en: 'Save and Leave', ja: '保存して移動' },
  discardBeforeContinue: {
    en: 'Discard the unsaved result before continuing the operation.',
    ja: '操作をContinueする前に未保存の結果を破棄します。',
  },
  discardBeforeSkip: {
    en: 'Discard the unsaved result before skipping this commit.',
    ja: 'このCommitをSkipする前に未保存の結果を破棄します。',
  },
  discardBeforeAbort: {
    en: 'Discard the unsaved result before aborting the operation.',
    ja: '操作をAbortする前に未保存の結果を破棄します。',
  },
  discardAndContinue: { en: 'Discard Result and Continue', ja: '結果を破棄してContinue' },
  discardAndSkip: { en: 'Discard Result and Skip', ja: '結果を破棄してSkip' },
  discardAndAbort: { en: 'Discard Result and Abort', ja: '結果を破棄してAbort' },
  repository: { en: 'Repository', ja: 'リポジトリ' },
  workspaceError: { en: 'Workspace error', ja: 'ワークスペースエラー' },
  workspaceUnavailable: { en: 'Workspace unavailable', ja: 'ワークスペースを利用できません' },
  subscribeWorkspaceFailed: {
    en: 'Could not subscribe to workspace events.',
    ja: 'ワークスペースのイベントを購読できませんでした。',
  },
  openRepositoryFailedTitle: {
    en: 'Could not open repository',
    ja: 'リポジトリを開けませんでした',
  },
  openRepositoryFailed: {
    en: 'Could not open the repository.',
    ja: 'リポジトリを開けませんでした。',
  },
  loadBranchesFailed: { en: 'Could not load branches.', ja: 'ブランチを読み込めませんでした。' },
  operationFailedTitle: { en: 'Operation failed', ja: '操作に失敗しました' },
  operationFailed: { en: 'The operation failed.', ja: '操作に失敗しました。' },
  previewFailedTitle: {
    en: 'Could not preview operation',
    ja: '操作をプレビューできませんでした',
  },
  previewFailed: { en: 'Could not preview the impact.', ja: '影響をプレビューできませんでした。' },
  cancelOperationFailedTitle: {
    en: 'Could not cancel operation',
    ja: '操作をキャンセルできませんでした',
  },
  cancelOperationFailed: {
    en: 'Could not cancel the operation.',
    ja: '操作をキャンセルできませんでした。',
  },
  conflictEyebrow: {
    en: (args) => `${text(args, 'operation')} conflict`,
    ja: (args) => `${text(args, 'operation')} Conflict`,
  },
  conflictLabels: {
    en: (args) => `Current: ${text(args, 'current')} · Incoming: ${text(args, 'incoming')}`,
    ja: (args) => `現在側: ${text(args, 'current')} · 取り込み側: ${text(args, 'incoming')}`,
  },
  conflictExternalChangesDetected: {
    en: 'External changes detected',
    ja: '外部の変更を検出しました',
  },
  conflictExternalChangesPreserved: {
    en: 'Your current result is preserved. Copy it before reloading if you want to keep it.',
    ja: '現在の結果は保持されています。残したい場合は再読み込み前にコピーしてください。',
  },
  conflictCopyResult: { en: 'Copy Result', ja: '結果をコピー' },
  conflictReloadExternalChanges: {
    en: 'Reload External Changes',
    ja: '外部の変更を再読み込み',
  },
  conflictPerformanceMode: {
    en: (args, { number }) =>
      `Performance mode: ${number(count(args, 'kib'))} KiB / ${number(count(args, 'lines'))} lines. Syntax highlighting is reduced.`,
    ja: (args, { number }) =>
      `軽量表示: ${number(count(args, 'kib'))} KiB / ${number(count(args, 'lines'))}行。構文ハイライトを抑えています。`,
  },
  conflictExternalRequired: { en: 'External resolution required', ja: '外部での解決が必要です' },
  conflictCannotEditBuiltIn: {
    en: 'This conflict cannot be edited in the built-in editor',
    ja: 'このConflictは内蔵エディタで編集できません',
  },
  conflictTooLarge: {
    en: (args, { number }) =>
      `This file is ${number(count(args, 'mib'))} MiB and ${number(count(args, 'lines'))} lines. Resolve it in an external editor.`,
    ja: (args, { number }) =>
      `このファイルは${number(count(args, 'mib'))} MiB、${number(count(args, 'lines'))}行です。外部エディタで解決してください。`,
  },
  conflictBinaryExternal: {
    en: 'This file is binary or could not be read as text. Resolve it in an external editor.',
    ja: 'このファイルはBinaryか、テキストとして読み込めません。外部エディタで解決してください。',
  },
  conflictStructureExternal: {
    en: 'Symlink, submodule, and path-structure conflicts must be resolved externally.',
    ja: 'Symlink、submodule、パス構造のConflictは外部で解決してください。',
  },
  conflictCurrent: { en: 'Current', ja: '現在側' },
  conflictIncoming: { en: 'Incoming', ja: '取り込み側' },
  conflictBoth: { en: 'Both', ja: '両方' },
  delete: { en: 'Delete', ja: '削除' },
  conflictOpenExternalEditor: { en: 'Open in External Editor', ja: '外部エディタで開く' },
  conflictReloadGitStatus: { en: 'Reload Git Status', ja: 'Gitの状態を再読み込み' },
  conflictMarkResolved: { en: 'Mark resolved', ja: '解決済みにする' },
  conflictCompareBase: { en: 'Compare with Base', ja: 'Baseと比較' },
  conflictComparisonSide: { en: 'Comparison side', ja: '比較対象' },
  conflictBase: { en: 'Base', ja: 'Base' },
  conflictDiffAria: {
    en: (args) => `Diff between Base and ${text(args, 'side')}`,
    ja: (args) => `Baseと${text(args, 'side')}のDiff`,
  },
  conflictBlocks: { en: 'Conflict blocks', ja: 'Conflictブロック' },
  conflictPosition: {
    en: (args) => `Conflict ${text(args, 'current')}/${text(args, 'total')}`,
    ja: (args) => `Conflict ${text(args, 'current')}/${text(args, 'total')}`,
  },
  conflictPositionOf: {
    en: (args) => `Conflict ${text(args, 'current')} of ${text(args, 'total')}`,
    ja: (args) => `Conflict ${text(args, 'current')}/${text(args, 'total')}`,
  },
  conflictUnresolved: { en: 'Unresolved', ja: '未解決' },
  conflictUsedCurrent: { en: 'Used Current', ja: '現在側を使用' },
  conflictUsedIncoming: { en: 'Used Incoming', ja: '取り込み側を使用' },
  conflictUsedBoth: { en: 'Used Both', ja: '両方を使用' },
  conflictManuallyEdited: { en: 'Manually edited', ja: '手動編集' },
  conflictResult: { en: 'Result', ja: '結果' },
  conflictUnsaved: { en: 'Unsaved', ja: '未保存' },
  conflictSaved: { en: 'Saved', ja: '保存済み' },
  undo: { en: 'Undo', ja: '元に戻す' },
  redo: { en: 'Redo', ja: 'やり直す' },
  save: { en: 'Save', ja: '保存' },
  conflictResolutionOptions: {
    en: (args) => `Resolution options for conflict ${text(args, 'index')}`,
    ja: (args) => `Conflict ${text(args, 'index')}の解決方法`,
  },
  conflictApplyChoice: {
    en: (args) => `Apply ${text(args, 'choice')} to conflict ${text(args, 'index')}`,
    ja: (args) => `Conflict ${text(args, 'index')}に${text(args, 'choice')}を適用`,
  },
  conflictUseCurrent: { en: 'Use Current', ja: '現在側を使用' },
  conflictUseIncoming: { en: 'Use Incoming', ja: '取り込み側を使用' },
  conflictUseBoth: { en: 'Use Both', ja: '両方を使用' },
  conflictMarkCondition: {
    en: 'Available only after the result is saved and all conflict blocks are resolved.',
    ja: '結果を保存し、すべてのConflictブロックを解決すると利用できます。',
  },
  conflictResultEditor: { en: 'Conflict result', ja: 'Conflict結果' },
  conflictDiscardUnsaved: { en: 'Discard the unsaved result?', ja: '未保存の結果を破棄しますか？' },
  conflictReloadDiscardDescription: {
    en: 'Reloading external content discards the current result and undo history.',
    ja: '外部の内容を再読み込みすると、現在の結果と取り消し履歴が破棄されます。',
  },
  conflictDiscardReload: { en: 'Discard and Reload', ja: '破棄して再読み込み' },
  conflictExternalDetectedAnnouncement: {
    en: 'External changes detected. The result was not overwritten.',
    ja: '外部の変更を検出しました。結果は上書きされていません。',
  },
  conflictExternalReloadedAnnouncement: {
    en: 'External changes reloaded.',
    ja: '外部の変更を再読み込みしました。',
  },
  conflictNoneUnresolved: { en: 'No unresolved conflicts.', ja: '未解決のConflictはありません。' },
  conflictOutdatedChoice: {
    en: 'Discarded an outdated choice response received while editing.',
    ja: '編集中に受信した古い選択結果を破棄しました。',
  },
  conflictChoiceAppliedNext: {
    en: (args) => `Applied ${text(args, 'choice')}. Moving to the next unresolved conflict.`,
    ja: (args) => `${text(args, 'choice')}を適用しました。次の未解決Conflictに移動します。`,
  },
  conflictChoiceAppliedSave: {
    en: (args) => `Applied ${text(args, 'choice')}. Save the result.`,
    ja: (args) => `${text(args, 'choice')}を適用しました。結果を保存してください。`,
  },
  conflictApplyFailedTitle: {
    en: 'Could not apply conflict choice',
    ja: 'Conflictの選択を適用できませんでした',
  },
  conflictApplyFailed: { en: 'Could not apply the choice.', ja: '選択を適用できませんでした。' },
  conflictOutdatedSave: {
    en: 'Discarded an outdated save response received while editing.',
    ja: '編集中に受信した古い保存結果を破棄しました。',
  },
  conflictSavedAnnouncement: {
    en: 'Saved the result to the worktree. It has not been staged.',
    ja: '結果をworktreeに保存しました。まだStageされていません。',
  },
  conflictSaveFailedTitle: {
    en: 'Could not save conflict result',
    ja: 'Conflict結果を保存できませんでした',
  },
  conflictSaveFailed: { en: 'Could not save the result.', ja: '結果を保存できませんでした。' },
  conflictMarkedResolvedAnnouncement: {
    en: 'Marked this file as resolved. Continue has not been run.',
    ja: 'このファイルを解決済みにしました。Continueはまだ実行されていません。',
  },
  conflictMarkFailedTitle: {
    en: 'Could not mark conflict resolved',
    ja: 'Conflictを解決済みにできませんでした',
  },
  conflictMarkFailed: {
    en: 'Could not mark the file as resolved.',
    ja: 'ファイルを解決済みにできませんでした。',
  },
  conflictReloadFailedTitle: {
    en: 'Could not reload conflict',
    ja: 'Conflictを再読み込みできませんでした',
  },
  conflictReloadFailed: {
    en: 'Could not reload external changes.',
    ja: '外部の変更を再読み込みできませんでした。',
  },
  conflictCopiedAnnouncement: {
    en: 'Copied the result to the clipboard.',
    ja: '結果をクリップボードにコピーしました。',
  },
  conflictCopyFailedTitle: {
    en: 'Could not copy conflict result',
    ja: 'Conflict結果をコピーできませんでした',
  },
  conflictCopyFailed: {
    en: 'Could not copy the result to the clipboard.',
    ja: '結果をクリップボードにコピーできませんでした。',
  },
  conflictOpenedExternalAnnouncement: {
    en: 'Opened the external editor. Git status will be checked when you return.',
    ja: '外部エディタを開きました。戻ったときにGitの状態を確認します。',
  },
  conflictOpenExternalFailedTitle: {
    en: 'Could not open external editor',
    ja: '外部エディタを開けませんでした',
  },
  conflictOpenExternalFailed: {
    en: 'Could not open the external editor.',
    ja: '外部エディタを開けませんでした。',
  },
  conflictPreviewAppliedAnnouncement: {
    en: (args) => `Previewed the impact of applying ${text(args, 'choice')} to the result.`,
    ja: (args) => `${text(args, 'choice')}を結果に適用する影響をプレビューしました。`,
  },
  conflictWholeFileFailedTitle: {
    en: 'Could not apply whole-file choice',
    ja: 'ファイル全体の選択を適用できませんでした',
  },
  conflictWholeFileFailed: {
    en: 'Could not apply the whole-file choice.',
    ja: 'ファイル全体の選択を適用できませんでした。',
  },
  commit: { en: 'Commit', ja: 'コミット' },
  commitFailed: { en: 'Commit failed', ja: 'コミットに失敗しました' },
  commitFailedDescription: { en: 'Commit failed.', ja: 'コミットに失敗しました。' },
  description: { en: 'Message', ja: 'メッセージ' },
  type: { en: 'Type', ja: '型' },
  scope: { en: 'Scope', ja: 'スコープ' },
  breakingChange: { en: 'Breaking Change', ja: '破壊的変更' },
  committing: { en: 'Committing…', ja: 'コミット中…' },
  commitTypeLowercase: {
    en: 'Type must contain lowercase letters only.',
    ja: '型には小文字の英字のみ使用できます。',
  },
  commitScopeInvalid: {
    en: 'Scope cannot contain parentheses or line breaks.',
    ja: 'スコープには括弧や改行を使用できません。',
  },
  commitDescriptionRequired: { en: 'Enter a message.', ja: 'メッセージを入力してください。' },
  commitMessageSingleLine: {
    en: 'The message must be a single line.',
    ja: 'メッセージは1行で入力してください。',
  },
  commitBodyLf: {
    en: 'Body must use LF line endings.',
    ja: 'Bodyの改行コードにはLFを使用してください。',
  },
  commitFooterLf: {
    en: 'Footer must use LF line endings.',
    ja: 'Footerの改行コードにはLFを使用してください。',
  },
  commitFooterFormat: {
    en: 'Footer must use the `Token: value` format.',
    ja: 'Footerは`Token: value`形式で入力してください。',
  },
  diff: { en: 'Diff', ja: 'Diff' },
  diffFallback: {
    en: 'The formatted diff could not be loaded. Showing plain text instead.',
    ja: '整形されたDiffを読み込めなかったため、プレーンテキストで表示します。',
  },
  close: { en: 'Close', ja: '閉じる' },
  exitCode: {
    en: (args) => `Exit code: ${text(args, 'code')}`,
    ja: (args) => `終了コード: ${text(args, 'code')}`,
  },
  errorInvalidRequest: {
    en: 'The request could not be completed because it is not valid.',
    ja: 'リクエストの内容が正しくないため、操作を完了できませんでした。',
  },
  developmentBuildUpdated: {
    en: 'An update is available. Restart the app.',
    ja: '更新があります。アプリを再起動してください。',
  },
  errorRepoNotFound: {
    en: 'The repository is no longer available in this workspace.',
    ja: 'このワークスペースでリポジトリを利用できません。',
  },
  errorUnsupportedRepository: {
    en: 'This repository is not supported.',
    ja: 'このリポジトリはサポートされていません。',
  },
  errorStaleGeneration: {
    en: 'The repository changed. Reload it and try again.',
    ja: 'リポジトリの状態が変更されました。再読み込みしてからもう一度実行してください。',
  },
  errorStaleDiff: {
    en: 'The Diff changed. Reload it and try again.',
    ja: 'Diffの内容が変更されました。再読み込みしてからもう一度実行してください。',
  },
  errorPreviewRequired: {
    en: 'Review the impact preview before running this operation.',
    ja: '操作を実行する前に影響のプレビューを確認してください。',
  },
  errorPreviewExpired: {
    en: 'The impact preview expired. Review it again.',
    ja: '影響のプレビューが期限切れになりました。もう一度確認してください。',
  },
  errorPreviewMismatch: {
    en: 'The operation target changed after the preview. Review it again.',
    ja: 'プレビュー後に操作対象が変更されました。もう一度確認してください。',
  },
  errorOperationInProgress: {
    en: 'Complete or abort the Git operation in progress.',
    ja: '進行中のGit操作を完了またはAbortしてください。',
  },
  errorConflictStateChanged: {
    en: 'The Conflict changed. Reload it and try again.',
    ja: 'Conflictの状態が変更されました。再読み込みしてからもう一度実行してください。',
  },
  errorGitFailed: {
    en: 'Git could not complete the operation.',
    ja: 'Git操作を完了できませんでした。',
  },
  errorPullDiverged: {
    en: 'The local and remote branches have diverged.',
    ja: 'ローカルブランチとリモートブランチが分岐しています。',
  },
  errorHookFailed: {
    en: 'A Git Hook rejected the operation.',
    ja: 'Git Hookによって操作が拒否されました。',
  },
  errorAuthenticationFailed: {
    en: 'Git authentication failed.',
    ja: 'Gitの認証に失敗しました。',
  },
  errorRemoteUnavailable: {
    en: 'The remote repository is unavailable.',
    ja: 'リモートリポジトリを利用できません。',
  },
  errorNetworkFailed: {
    en: 'Could not connect to the remote repository.',
    ja: 'リモートリポジトリへ接続できませんでした。',
  },
  errorIo: {
    en: 'A required file or system resource could not be accessed.',
    ja: '必要なファイルまたはシステムリソースにアクセスできませんでした。',
  },
  errorCancelled: { en: 'The operation was cancelled.', ja: '操作はキャンセルされました。' },
  errorInternal: {
    en: 'An unexpected error occurred.',
    ja: '予期しないエラーが発生しました。',
  },
  errorUnknown: {
    en: 'The workspace operation failed.',
    ja: 'ワークスペースの操作に失敗しました。',
  },
} as const satisfies Record<string, MessageTranslations>;

export type MessageKey = keyof typeof MESSAGES;

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && Object.hasOwn(MESSAGES, value);
}
