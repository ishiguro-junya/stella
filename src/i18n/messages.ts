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
  appError: { en: 'Error', ja: 'エラー' },
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
  changes: { en: 'Changes', ja: '変更' },
  history: { en: 'History', ja: '履歴' },
  conflicted: { en: 'Conflicted', ja: 'Conflict' },
  staged: { en: 'Staged', ja: 'Staged' },
  unstaged: { en: 'Unstaged', ja: 'Unstaged' },
  untracked: { en: 'Untracked', ja: 'Untracked' },
  added: { en: 'Added', ja: '追加' },
  deleted: { en: 'Deleted', ja: '削除' },
  renamed: { en: 'Renamed', ja: '名前変更' },
  binary: { en: 'Binary', ja: 'Binary' },
  stage: { en: 'Stage', ja: 'Stage' },
  unstage: { en: 'Unstage', ja: 'Unstage' },
  discard: { en: 'Discard', ja: '破棄' },
  merge: { en: 'Merge', ja: 'Merge' },
  rebase: { en: 'Rebase', ja: 'Rebase' },
  fetch: { en: 'Fetch', ja: 'Fetch' },
  pull: { en: 'Pull', ja: 'Pull' },
  push: { en: 'Push', ja: 'Push' },
  changeDragHelp: {
    en: 'Use the checkboxes to stage or unstage files. You can also drag file rows between Staged and Unstaged.',
    ja: 'チェックボックスでファイルをStageまたはUnstageできます。ファイル行をStagedとUnstagedの間でドラッグすることもできます。',
  },
  changeDragAnnouncement: {
    en: (args) => `${text(args, 'path')} is being moved. Drop it in ${text(args, 'destination')}.`,
    ja: (args) =>
      `${text(args, 'path')}を移動中です。${text(args, 'destination')}にドロップしてください。`,
  },
  dropToStage: { en: 'Drop to Stage', ja: 'ドロップしてStage' },
  dropToUnstage: { en: 'Drop to Unstage', ja: 'ドロップしてUnstage' },
  dropHereToStage: { en: 'Drop here to stage', ja: 'ここにドロップしてStage' },
  dropHereToUnstage: { en: 'Drop here to unstage', ja: 'ここにドロップしてUnstage' },
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
  moreActions: { en: 'More actions', ja: 'その他の操作' },
  fileActionsFor: {
    en: (args) => `${text(args, 'path')} actions`,
    ja: (args) => `${text(args, 'path')}の操作`,
  },
  openInDefaultApp: { en: 'Open in Default App', ja: 'デフォルトアプリで開く' },
  showInFinder: { en: 'Show in Finder', ja: 'Finderで表示' },
  copyPath: { en: 'Copy Path', ja: 'パスをコピー' },
  moveToTrashEllipsis: { en: 'Move to Trash…', ja: 'ゴミ箱に入れる…' },
  resolveConflictsBeforeCommit: {
    en: 'Resolve all conflicts before committing.',
    ja: 'すべてのConflictを解決してからCommitしてください。',
  },
  stageChangesToCommit: {
    en: 'Stage changes to commit.',
    ja: 'Commitする変更をStageしてください。',
  },
  regularCommitUnavailable: {
    en: (args) =>
      `${text(args, 'operation')}. Regular commits are unavailable; use Continue, Skip, or Abort.`,
    ja: (args) =>
      `${text(args, 'operation')}。通常のCommitは利用できません。Continue、Skip、Abortを使用してください。`,
  },
  regularCommitAbortOnly: {
    en: (args) =>
      `${text(args, 'operation')}. Regular commits are unavailable; use Abort to restore the pre-operation state.`,
    ja: (args) =>
      `${text(args, 'operation')}。通常のCommitは利用できません。操作前の状態に戻すにはAbortを使用してください。`,
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
    ja: 'Pullする前にupstream Branchを設定してください。',
  },
  fastForwardUnavailable: { en: 'Fast-forward unavailable', ja: 'Fast-forwardできません' },
  fetchCompleteResolve: {
    en: (args) => `Fetch is complete. Merge or rebase ${text(args, 'target')}.`,
    ja: (args) => `Fetchが完了しました。${text(args, 'target')}をMergeまたはRebaseしてください。`,
  },
  changedFiles: { en: 'Changed files', ja: '変更されたファイル' },
  changesListWidth: { en: 'Changes list width', ja: '変更一覧の幅' },
  diffLayout: { en: 'Diff layout', ja: 'Diffレイアウト' },
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
  selectedLines: { en: 'Selected lines', ja: '選択した行' },
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
      `${text(args, 'operation')}。操作を完了またはAbortするまで履歴のリポジトリ操作は利用できません。`,
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
    ja: '履歴を追加で読み込めませんでした',
  },
  loadMoreHistoryFailed: {
    en: 'Could not load more history.',
    ja: '履歴を追加で読み込めませんでした。',
  },
  actions: { en: 'Actions', ja: '操作' },
  commitHistory: { en: 'Commit history', ja: 'Commit履歴' },
  tagRefLabel: {
    en: (args) => `Tag ${text(args, 'name')}`,
    ja: (args) => `Tag ${text(args, 'name')}`,
  },
  commitParents: {
    en: (args) => `Parents ${text(args, 'parents')}`,
    ja: (args) => `Parent ${text(args, 'parents')}`,
  },
  rootCommit: { en: 'Root commit', ja: '最初のCommit' },
  loadMore: { en: 'Load more', ja: 'さらに読み込む' },
  historyListWidth: { en: 'History list width', ja: '履歴一覧の幅' },
  author: { en: 'Author', ja: '作成者' },
  date: { en: 'Date', ja: '日時' },
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
  historyActionsWidth: { en: 'History actions width', ja: '履歴操作の幅' },
  createBranchFromSelected: {
    en: 'Create branch from selected commit',
    ja: '選択したCommitからBranchを作成',
  },
  createBranch: { en: 'Create branch', ja: 'Branchを作成' },
  sourceRef: { en: 'Source ref', ja: '元のref' },
  branchNamePlaceholder: { en: 'feature/name', ja: 'feature/name' },
  selectedCommit: { en: 'Selected commit', ja: '選択したCommit' },
  mainlineParent: { en: 'Mainline parent', ja: 'メインラインのParent' },
  parentNumber: {
    en: (args) => `Parent ${text(args, 'number')}`,
    ja: (args) => `Parent ${text(args, 'number')}`,
  },
  mainlineHelp: {
    en: 'Select the parent that was the mainline when the merge was created.',
    ja: 'Mergeの作成時にメインラインだったParentを選択してください。',
  },
  cherryPick: { en: 'Cherry-pick', ja: 'Cherry-pick' },
  revert: { en: 'Revert', ja: 'Revert' },
  reset: { en: 'Reset', ja: 'Reset' },
  soft: { en: 'Soft', ja: 'Soft' },
  mixed: { en: 'Mixed', ja: 'Mixed' },
  hard: { en: 'Hard', ja: 'Hard' },
  commitLowercase: { en: 'commit', ja: 'Commit' },
  resetToTarget: {
    en: (args) => `Reset to ${text(args, 'target')}`,
    ja: (args) => `${text(args, 'target')}へReset`,
  },
  switchRepository: { en: 'Switch Repository', ja: 'リポジトリを切り替える' },
  searchRepositories: { en: 'Search repositories', ja: 'リポジトリを検索' },
  noRepositorySearchResults: {
    en: 'No repositories match your search.',
    ja: '検索に一致するリポジトリはありません。',
  },
  addRepositoryEllipsis: { en: 'Add Repository…', ja: 'リポジトリを追加…' },
  switchBranch: { en: 'Switch Branch', ja: 'Branchを切り替える' },
  searchBranches: { en: 'Search branches', ja: 'Branchを検索' },
  noBranchSearchResults: {
    en: 'No local branches match your search.',
    ja: '検索に一致するローカルBranchはありません。',
  },
  finishOperationBeforeSwitchingBranch: {
    en: (args) =>
      `${text(args, 'operation')}. Finish or abort the operation before switching branches.`,
    ja: (args) =>
      `${text(args, 'operation')}。Branchを切り替える前に操作を完了またはAbortしてください。`,
  },
  commitOrDiscardBeforeSwitchingBranch: {
    en: 'Commit or discard changes before switching branches.',
    ja: 'Branchを切り替える前に変更をCommitまたは破棄してください。',
  },
  waitBeforeSwitchingBranch: {
    en: 'Wait for the current operation to finish before switching branches.',
    ja: '現在の操作が完了してからBranchを切り替えてください。',
  },
  operationResolvingMerge: { en: 'Resolving merge', ja: 'Mergeを解決中' },
  operationResolvingRebase: { en: 'Resolving rebase', ja: 'Rebaseを解決中' },
  operationResolvingCherryPick: {
    en: 'Resolving cherry-pick',
    ja: 'Cherry-pickを解決中',
  },
  operationResolvingRevert: { en: 'Resolving revert', ja: 'Revertを解決中' },
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
  actionDiscardChanges: { en: 'Discard Changes', ja: '変更を破棄' },
  actionStageSelectedLines: { en: 'Stage Selected Lines', ja: '選択行をStage' },
  actionUnstageSelectedLines: { en: 'Unstage Selected Lines', ja: '選択行をUnstage' },
  actionDiscardSelectedLines: { en: 'Discard Selected Lines', ja: '選択行を破棄' },
  actionCommit: { en: 'Commit', ja: 'Commit' },
  actionFetch: { en: 'Fetch', ja: 'Fetch' },
  actionPull: { en: 'Pull', ja: 'Pull' },
  actionPush: { en: 'Push', ja: 'Push' },
  actionCreateBranch: { en: 'Create Branch', ja: 'Branchを作成' },
  actionCheckoutBranch: { en: 'Checkout Branch', ja: 'BranchをCheckout' },
  actionMergeBranch: { en: 'Merge Branch', ja: 'BranchをMerge' },
  actionRebaseBranch: { en: 'Rebase Branch', ja: 'BranchをRebase' },
  actionCherryPickCommit: { en: 'Cherry-pick Commit', ja: 'CommitをCherry-pick' },
  actionRevertCommit: { en: 'Revert Commit', ja: 'CommitをRevert' },
  actionResetToCommit: { en: 'Reset to Commit', ja: 'CommitへReset' },
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
  actionMoveFileToTrash: { en: 'Move File to Trash', ja: 'ファイルをゴミ箱に入れる' },
  actionShowInFinder: { en: 'Show in Finder', ja: 'Finderで表示' },
  actionOpenInDefaultApp: {
    en: 'Open in Default App',
    ja: 'デフォルトアプリで開く',
  },
  actionCloneRepository: { en: 'Clone Repository', ja: 'リポジトリをClone' },
  backendCloneStarted: { en: 'Clone started', ja: 'Cloneを開始しました' },
  backendCloningRepository: { en: 'Cloning repository', ja: 'リポジトリをClone中' },
  backendCloneCompleted: { en: 'Clone completed', ja: 'Cloneが完了しました' },
  backendOperationInProgress: { en: 'Operation in progress', ja: '操作中' },
  backendConflictResultSaved: {
    en: 'Conflict result saved',
    ja: 'Conflict結果を保存しました',
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
  backendFetchCompleted: { en: 'Fetch completed', ja: 'Fetchが完了しました' },
  backendPullCompleted: {
    en: 'Fast-forward pull completed',
    ja: 'Fast-forward Pullが完了しました',
  },
  backendPushCompleted: { en: 'Push completed', ja: 'Pushが完了しました' },
  backendBranchCreated: { en: 'Branch created', ja: 'Branchを作成しました' },
  backendBranchCheckedOut: {
    en: 'Branch checked out',
    ja: 'BranchをCheckoutしました',
  },
  backendMergeCreated: { en: 'Merge result created', ja: 'Merge結果を作成しました' },
  backendRebaseCompleted: { en: 'Rebase completed', ja: 'Rebaseが完了しました' },
  backendCherryPickCreated: {
    en: 'Cherry-pick changes created',
    ja: 'Cherry-pickの変更を作成しました',
  },
  backendRevertCreated: { en: 'Revert changes created', ja: 'Revertの変更を作成しました' },
  backendResetCompleted: {
    en: (args) => `${text(args, 'mode')} reset completed`,
    ja: (args) => `${text(args, 'mode')} Resetが完了しました`,
  },
  backendConflictResolved: {
    en: 'Conflict marked as resolved',
    ja: 'Conflictを解決済みにしました',
  },
  backendExternalEditorOpened: {
    en: 'Opened external editor',
    ja: '外部エディタを開きました',
  },
  backendFileTrashed: { en: 'File moved to Trash', ja: 'ファイルをゴミ箱に入れました' },
  backendShownInFinder: { en: 'Shown in Finder', ja: 'Finderで表示しました' },
  backendOpenedInDefaultApp: {
    en: 'Opened in default app',
    ja: 'デフォルトアプリで開きました',
  },
  backendRebaseContinued: { en: 'Rebase continued', ja: 'RebaseをContinueしました' },
  backendCherryPickReadyToCommit: {
    en: 'Cherry-pick resolution is ready to commit',
    ja: 'Cherry-pickの解決結果をCommitできます',
  },
  backendRevertReadyToCommit: {
    en: 'Revert resolution is ready to commit',
    ja: 'Revertの解決結果をCommitできます',
  },
  backendCommitSkipped: { en: 'Current commit skipped', ja: '現在のCommitをSkipしました' },
  backendOperationAborted: { en: 'Operation aborted', ja: '操作をAbortしました' },
  previewFetchRemote: {
    en: (args) => `Update remote-tracking refs from ${text(args, 'remote')}`,
    ja: (args) => `${text(args, 'remote')}からremote-tracking refsを更新します`,
  },
  previewPullRemote: {
    en: (args) => `Fetch from ${text(args, 'remote')}, then fast-forward the local branch`,
    ja: (args) => `${text(args, 'remote')}からFetchし、ローカルBranchをfast-forwardします`,
  },
  previewPushRemote: {
    en: (args) =>
      `${text(args, 'remote')}: ${text(args, 'localBranch')} → ${text(args, 'remoteBranch')}`,
    ja: (args) =>
      `${text(args, 'remote')}: ${text(args, 'localBranch')} → ${text(args, 'remoteBranch')}`,
  },
  previewDiscardPaths: {
    en: (args, { number }) =>
      `Discard ${number(count(args, 'count'))} path(s) from ${text(args, 'target')}`,
    ja: (args, { number }) =>
      `${text(args, 'target')}から${number(count(args, 'count'))}件のパスを破棄します`,
  },
  previewReset: {
    en: (args) => `${text(args, 'mode')} reset HEAD to ${text(args, 'commit')}`,
    ja: (args) => `HEADを${text(args, 'commit')}へ${text(args, 'mode')} Resetします`,
  },
  previewRebase: {
    en: (args) => `Rebase the current branch onto ${text(args, 'onto')}`,
    ja: (args) => `現在のBranchを${text(args, 'onto')}へRebaseします`,
  },
  previewAbort: {
    en: 'Restore the state from before the current operation',
    ja: '現在の操作前の状態に復元します',
  },
  previewApplyConflictSide: {
    en: (args) => `Apply the ${text(args, 'choice')} side to the worktree`,
    ja: (args) => `${text(args, 'choice')}側をworktreeに適用します`,
  },
  previewMovePathToTrash: {
    en: (args) => `Move ${text(args, 'path')} to Trash`,
    ja: (args) => `${text(args, 'path')}をゴミ箱に入れます`,
  },
  conflictCurrentBranch: { en: 'Current branch', ja: '現在のBranch' },
  conflictMergedBranch: { en: 'Merged branch', ja: 'MergeするBranch' },
  conflictRebaseDestination: { en: 'Rebase destination', ja: 'Rebase先' },
  conflictReplayedCommit: { en: 'Replayed commit', ja: '再適用されるCommit' },
  conflictCherryPickedCommit: { en: 'Cherry-picked commit', ja: 'Cherry-pickするCommit' },
  conflictRevertResult: { en: 'Revert result', ja: 'Revert結果' },
  activityNoRepository: { en: 'No repository selected', ja: 'リポジトリが選択されていません' },
  activityRange: { en: 'Commit activity range', ja: 'Commitアクティビティの期間' },
  activityDays: {
    en: (args, { number }) => `${number(count(args, 'count'))} days`,
    ja: (args, { number }) => `${number(count(args, 'count'))}日`,
  },
  activityOneYear: { en: '1 year', ja: '1年' },
  activityCommits: { en: 'Commits', ja: 'コミット' },
  activityActiveDays: { en: 'Active days', ja: 'アクティブ日数' },
  activityContributors: { en: 'Contributors', ja: 'コントリビューター' },
  activityBranches: { en: 'Branches', ja: 'ブランチ' },
  activitySummaryLabel: { en: 'Commit activity summary', ja: 'Commitアクティビティの概要' },
  activityOperations: { en: 'Operations', ja: '操作' },
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
  activityCommitActivity: { en: 'Commit activity', ja: 'Commitアクティビティ' },
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
      `選択したBranchの履歴に、過去${number(count(args, 'days'))}日間のCommitはありません。`,
  },
  activityResultsTruncated: {
    en: (args, { number }) =>
      `Results are truncated after scanning ${number(count(args, 'count'))} commits.`,
    ja: (args, { number }) =>
      `${number(count(args, 'count'))}件のCommitを走査した時点で結果を省略しています。`,
  },
  activityChartDescription: {
    en: 'Commit count over the selected date range. Use View chart data for exact values.',
    ja: '選択期間のCommit数です。正確な値は「チャートデータを表示」で確認できます。',
  },
  loadingChart: { en: 'Loading chart…', ja: 'チャートを読み込み中…' },
  activityViewChartData: { en: 'View chart data', ja: 'チャートデータを表示' },
  activityData: { en: 'Commit activity data', ja: 'Commitアクティビティデータ' },
  activityPeriod: { en: 'Period', ja: '期間' },
  activitySucceeded: { en: 'Succeeded', ja: '成功' },
  activityRunning: { en: 'Running', ja: '実行中' },
  activityFailed: { en: 'Failed', ja: '失敗' },
  activityCancelled: { en: 'Cancelled', ja: 'キャンセル済み' },
  activityInProgress: { en: 'In progress', ja: '進行中' },
  noBranch: { en: 'No branch', ja: 'Branchなし' },
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
    ja: (args) => `Branchを切り替えます。現在のBranchは${text(args, 'branch')}`,
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
  addRepository: { en: 'Add Repository', ja: 'リポジトリを追加' },
  addRepositoryDescription: {
    en: 'Enter a remote URL or choose a local folder in Finder.',
    ja: 'リモートURLを入力するか、Finderからローカルフォルダを選択します。',
  },
  repositoryLocation: {
    en: 'Repository URL or path',
    ja: 'リポジトリURLまたはパス',
  },
  repositoryLocationPlaceholder: {
    en: 'https://… or /Users/…',
    ja: 'https://… または /Users/…',
  },
  chooseRepositoryInFinder: { en: 'Choose in Finder…', ja: 'Finderから選択…' },
  chooseRepositoryDirectory: { en: 'Choose Repository', ja: 'リポジトリを選択' },
  chooseCloneParentDirectory: { en: 'Choose Clone Location', ja: 'Clone先を選択' },
  chooseDirectoryFailed: {
    en: 'Could not open the folder picker.',
    ja: 'フォルダ選択を開けませんでした。',
  },
  invalidRepositoryLocation: {
    en: 'Enter a supported remote URL or an absolute local path.',
    ja: '対応するリモートURLまたは絶対パスを入力してください。',
  },
  add: { en: 'Add', ja: '追加' },
  hasChanges: { en: 'Has changes', ja: '変更あり' },
  impactPreview: { en: 'Impact preview', ja: '影響のプレビュー' },
  affectedPaths: { en: 'Affected paths', ja: '影響を受けるパス' },
  affectedCommits: { en: 'Affected commits', ja: '影響を受けるCommit' },
  removedCommits: {
    en: 'Commits removed from the current branch',
    ja: '現在のBranchから削除されるCommit',
  },
  typeToConfirm: {
    en: (args) => `Type “${text(args, 'value')}” to confirm`,
    ja: (args) => `確認のため「${text(args, 'value')}」と入力してください`,
  },
  moveToTrash: { en: 'Move to Trash', ja: 'ゴミ箱に入れる' },
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
  loadBranchesFailed: { en: 'Could not load branches.', ja: 'Branchを読み込めませんでした。' },
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
  commit: { en: 'Commit', ja: 'Commit' },
  commitFailed: { en: 'Commit failed', ja: 'Commitに失敗しました' },
  commitFailedDescription: { en: 'Commit failed.', ja: 'Commitに失敗しました。' },
  description: { en: 'Description', ja: '説明' },
  commitDescriptionPlaceholder: {
    en: 'Briefly describe your changes',
    ja: '変更内容を簡潔に入力',
  },
  type: { en: 'Type', ja: 'Type' },
  breakingChange: { en: 'Breaking Change', ja: 'Breaking Change' },
  committing: { en: 'Committing…', ja: 'Commit中…' },
  commitTypeLowercase: {
    en: 'Type must contain lowercase letters only.',
    ja: 'Typeには小文字の英字のみ使用できます。',
  },
  commitScopeInvalid: {
    en: 'Scope cannot contain parentheses or line breaks.',
    ja: 'Scopeには括弧や改行を使用できません。',
  },
  commitDescriptionRequired: { en: 'Enter a description.', ja: '説明を入力してください。' },
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
  showGitOutput: { en: 'Show Git output', ja: 'Git出力を表示' },
  exitCode: {
    en: (args) => `Exit code: ${text(args, 'code')}`,
    ja: (args) => `終了コード: ${text(args, 'code')}`,
  },
  errorInvalidRequest: {
    en: 'The request could not be completed because it is not valid.',
    ja: 'リクエストの内容が正しくないため、操作を完了できませんでした。',
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
    ja: 'ローカルBranchとリモートBranchが分岐しています。',
  },
  errorHookFailed: {
    en: 'A Git hook rejected the operation.',
    ja: 'Git hookによって操作が拒否されました。',
  },
  errorAuthenticationFailed: {
    en: 'Git authentication failed.',
    ja: 'Gitの認証に失敗しました。',
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
  activityCommitsSummary: {
    en: (args, { number }) => {
      const commits = count(args, 'commits');
      const days = count(args, 'days');
      const contributors = count(args, 'contributors');
      const branches = count(args, 'branches');
      return `${number(commits)} ${commits === 1 ? 'commit' : 'commits'} across ${number(days)} active ${days === 1 ? 'day' : 'days'} by ${number(contributors)} ${contributors === 1 ? 'contributor' : 'contributors'} on ${number(branches)} ${branches === 1 ? 'branch' : 'branches'}.`;
    },
    ja: (args, { number }) =>
      `コミット${number(count(args, 'commits'))}件、アクティブ${number(count(args, 'days'))}日、コントリビューター${number(count(args, 'contributors'))}人、ブランチ${number(count(args, 'branches'))}件です。`,
  },
} as const satisfies Record<string, MessageTranslations>;

export type MessageKey = keyof typeof MESSAGES;

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && Object.hasOwn(MESSAGES, value);
}
