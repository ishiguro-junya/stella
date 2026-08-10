# アーキテクチャ

## Module構成

Tauri Core processの`Workspace`をGit操作の境界とします。  
Frontendは型付きのattach、query、preview、execute、cancelだけを利用し、Git command、path解決、出力parse、generation管理、確認token、operation復旧を知りません。  
`Open`のattachはFinderまたは絶対pathで選択したpathから既存Repositoryのrootを探索し、見つからない場合だけそのpathへ`main` BranchのRepositoryを作成します。  
既存Repository配下のpathを選んだ場合は既存rootを開き、nested Repositoryを作りません。  
登録済み一覧からの選択には別variantの`OpenExisting`を使い、削除済みpathやGit Repositoryでなくなったpathを新規Repositoryとして初期化しません。  
`Open`、`OpenExisting`、`Clone`の成功時にRustが返したcanonical rootを分類なしのMRU一覧へ記録し、同じpathを再度開いた場合は重複させず先頭へ移動します。  
既存の`recentRepoPaths`は読込時にこの登録一覧へ移行し、Remote／LocalやOpen／Cloneの由来は保存しません。  

`Workspace`内部にはsystem Git runner、status／patch parser、競合session、operation journalを置きます。  
これらはFrontend interfaceへ公開せず、一時repositoryとbare remoteを使った統合testを`Workspace` interface越しに行います。  
外部変更はFrontendがfocus復帰時と2秒間隔でqueryし、generation差分を検出します。  
同じRepoを再attachした場合はevent Channelを置き換え、古いwindow sessionへ重複通知しません。  

通常pollingのgeneration fingerprintはporcelain status、dirtyなtracked fileのindex OID／mode、worktreeのinode／mode／size／mtime／ctime、local／remote ref一覧で作り、regular file本文を開きません。  
これにより、HEADが不変でも外部Gitによるbranch更新をHistoryへ反映します。  
破壊操作のpreviewとexecuteでは対象本文をSHA-256で再計算し、同じstatusや同じsizeの外部変更もpreview mismatchとして拒否します。  
operation journalも通常pollingでは軽量fingerprintを使い、構造化Commit直前に記録済みの厳密digestと再照合します。  

## Diffと競合編集

通常diffとBase↔Current／Base↔Incomingの比較表示には`@pierre/diffs@1.3.5`を使います。  
表示上限でpatchを切った場合は「先頭のみ」と明示し、Changesの行選択を無効にします。  
競合Resultの編集にはCodeMirror 6を使い、双方をFrontendの`ConflictSurface` module内へ隠します。  

`@codemirror/merge`とDiffsのexperimental Edit／Conflict機能は初版では使いません。  
2つのdiff engineが競合状態を別々に管理することを避け、Git indexとworking treeの正をRust、未保存draftだけをFrontendに置きます。  

SaveとMark resolvedは`sessionId`、path単位の`conflictGeneration`、`contentHash`をRustで再検証します。  
Choiceで検証した本文とblock状態はRust sessionにもbounded revisionとして保持します。  
FrontendとRustは、UTF-16 code unitを4 byte、block metadataを固定量として課金する共通96 MiB budgetと100件上限を使い、古いsnapshotから追放します。  
Frontendは現在状態と最新のserver anchorを保持し、Rust snapshotはblockのrangeとstateだけを保存してreplacement本文を複製しません。  
Frontendの各Undo／Redo snapshotは、手動編集を派生させた直近のRust revisionを`baseDocumentRevision`として保持します。  
Rustは既知revisionと本文が完全一致すれば本文とblock状態を一緒に復元し、未知の手動draftは既知のbase revisionへ戻してから差分を同期します。  
baseが未知または履歴から追放済みなら再読込を要求し、現在のblock状態から推測しません。  
Save後は新しいsessionになるため古いUndo／Redo履歴を破棄します。  
staleなdraftは上書きせず、Frontendに保持したまま再読込またはcopyを選べるようにします。  
whole-file choiceは選択sideのexecutable bitを適用し、Bothは本文と同じくCurrentを正とします。  
Mark resolvedではworktreeの存在をRustが再確認し、fileは`git add -- path`、削除結果は`git rm -- path`を選びます。  
stageが失敗した場合は保存済み・未stageの部分失敗として返します。  

LF／CRLFの一方だけをin-app編集対象とし、mixed line endingとlone CRは外部解消へ送ります。  
Git attributesでbinary指定されたfile、NUL、non-UTF-8、上限超過、symlink、submodule、rename／directory-file系も内部editorへ渡しません。  
`conflict-marker-size`はsystem Gitから取得し、block解析とMark resolved直前のmarker走査へ同じ値を使います。  
markerのないtextやbinaryは暗黙にresolvedとせず、内部Save、whole-file choice、または外部editorで開いた後の内容変更をRustが確認してからMark resolvedを受け付けます。  

## Operation lifecycle

Repository mutationはRepo単位で直列化し、operation IDを付けます。  
Cloneを含む長時間operationはChannel eventでstarted、progress、completed、failed、cancelledを通知し、FrontendのActivityへ反映します。  
cancel時はGitのprocess groupを停止します。  
全mutation終了後はhookの成功・失敗にかかわらずGit実状態を再取得します。  

merge、rebase、cherry-pick、revert中は競合解消とContinue／Skip／Abort以外のgeneric mutationを拒否します。  
例外はmerge／pending structured commitの構造化Commitだけで、自動Continueや通常Stage／Unstageは行いません。  

Merge commitのCherry-pick／RevertはHistoryでmainline parentを選択させ、Rustがparent数と選択範囲を検証します。  
previewの影響pathと書き戻し衝突も選択したparentとの差分を正とします。  

再起動時はmerge、rebase、cherry-pick、revertのGit markerと最小journalから状態を再構成し、自動continueやlock fileの自動削除は行いません。  
Cherry-pick／RevertのjournalはGit実行前の`preparing`と適用結果を厳密digest付きで記録した`applied`をatomicに保存します。  
`preparing`のまま再起動した場合や、構造化Commitのhook失敗がindex／worktreeを変更した場合は任意Commitを許可せず、previewで現在状態を再照合するAbort専用phaseへatomicに遷移します。  
hook失敗が状態を変えていなければ`applied`を維持します。  
phaseを持たない旧journalはdigestの有無から保守的に判定します。  
cancelは実行中operationへ通知し、Git processを停止した後でrepository状態を再取得します。  

## 多言語境界

対応言語は日本語と英語です。  
初回起動ではmacOSの優先言語が日本語なら`ja`、それ以外は`en`を選び、以後は`StellaPreferences.language`を優先します。  
言語変更はReactの`I18nProvider`を更新して全画面を再描画し、`html[lang]`とmacOS menuも再起動なしで同期します。  

Frontendの固定文言は型付きcatalogへ集約し、日時、件数、複数形、durationは`ja-JP`／`en-US`の`Intl`でformatします。  
RustからFrontendへ渡す結果、進捗、preview、Conflict label、errorは、翻訳済み文字列ではなくmessage IDと型付き引数を持つ`LocalizedMessage`とします。  
Activity v2も同じ構造を保存するため、表示中または保存済みの項目を言語変更後に再翻訳できます。  
旧Activity cacheはpre-releaseの30日cacheであり、v1から移行しません。  

Repository名、path、Branch名、Commit本文、Gitのstdout／stderrなど、Git／OSまたは利用者が作成したdataは翻訳しません。  
日本語catalogでもGit、Changes、Commit、Stage、Diff、Branch、HEADなどのGit用語は英語表記を維持します。  

## Security

- Tauri commandはmain windowだけに許可し、Frontendへshell、filesystem、process pluginを公開しません。
- Local RepositoryとClone先の選択にはTauri Dialog pluginのdirectory open権限だけを許可します。
- Gitは絶対pathとargv配列で起動し、shellを介しません。
- 読取diffではexternal diffとtextconvを無効にします。
- 確認tokenはRepo、generation、Action全体、preview digestへ結合し、短寿命・単回使用にします。
- Reset、Discard、Merge、Rebase、Cherry-pick、Revert、Abortが書き戻すpathはtarget treeとcurrent indexから列挙し、未追跡内容はpreview digestへ含めます。
  statusへ現れないignored内容や未検証のdirectory／file衝突はGit実行前に拒否し、Checkout／Switchには`--no-overwrite-ignore`も指定します。
- 全てのsystem Git実行へglobal optionの`--literal-pathspecs`を指定し、`*`、`[`、`?`、`:(glob)`を含む正当なファイル名を別pathへ展開しません。
  Stage／Unstage／Discard／Mark resolvedは特殊名を使う実repository testで境界を固定します。
- Activityにはenvironmentやstdinを保存せず、command出力をredact・truncateします。
- status、index、ref、影響pathなど安全判定に使うGit出力が上限を超えた場合は、部分結果を使用せずoperationを拒否します。
- CSPはremote scriptを許可せず、Diff workerに必要な`worker-src 'self' blob:`だけを追加します。

## 品質gate

Frontend、Rust、TOML、Markdown、link、Commit grammarを独立して確認し、pre-pushでは並列実行します。  
Release確認ではE2E feature付きの非bundle release binaryをWebdriverIO embedded providerで操作した後、test pluginを含まない通常のTauri application bundleを作成します。  
