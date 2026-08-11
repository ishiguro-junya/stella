# アーキテクチャ

利用者から見える動作、制約、対応範囲は[仕様](specification.md)に定義します。  
この文書では、その仕様を実現するモジュール境界、状態管理、検証方式を説明します。  

## モジュール構成

Tauri Core processの`Workspace`をGit操作の境界とします。  
Frontendは型付きのattach、query、preview、execute、cancelだけを利用し、Git command、path解決、出力parse、generation管理、確認token、operation復旧を知りません。  
Repositoryを開く処理は、選択したpathを解決する`Open`、登録済みRepositoryを再接続する`OpenExisting`、Remoteから作成する`Clone`へ分けます。  

`Workspace`内部にはsystem Git runner、status／patch parser、競合session、operation journalを置きます。  
これらはFrontend interfaceへ公開せず、一時Repositoryとbare remoteを使った統合testを`Workspace` interface越しに行います。  
同じRepositoryを再attachした場合はevent Channelを置き換え、古いwindow sessionへの重複通知を防ぎます。  

通常pollingのgeneration fingerprintはporcelain status、dirtyなtracked fileのindex OID／mode、worktreeのinode／mode／size／mtime／ctime、local／remote ref一覧で作り、regular file本文を開きません。  
破壊操作のpreviewとexecuteでは対象本文をSHA-256で再計算し、operation journalも構造化Commit直前に記録済みの厳密digestと再照合します。  

## 差分表示と競合編集

通常diffとBase↔Current／Base↔Incomingの比較表示には`@pierre/diffs@1.3.5`を使います。  
競合Resultの編集にはCodeMirror 6を使い、双方をFrontendの`ConflictSurface` module内へ隠します。  
`@codemirror/merge`とDiffsのexperimental Edit／Conflict機能は使用しません。  

Git indexとworking treeをRust側の正とし、未保存draftだけをFrontendで管理します。  
SaveとMark resolvedは`sessionId`、path単位の`conflictGeneration`、`contentHash`をRustで再検証します。  
Choiceで検証した本文とblock状態はRust sessionにもbounded revisionとして保持します。  

FrontendとRustは、UTF-16 code unitを4 byte、block metadataを固定量として課金する共通96 MiB budgetと100件上限を使い、古いsnapshotから追放します。  
Frontendは現在状態と最新のserver anchorを保持し、Rust snapshotはblockのrangeとstateだけを保存してreplacement本文を複製しません。  
Frontendの各Undo／Redo snapshotは、手動編集を派生させた直近のRust revisionを`baseDocumentRevision`として保持します。  
Rustは既知revisionと本文が完全一致すれば本文とblock状態を一緒に復元し、未知の手動draftは既知のbase revisionへ戻してから差分を同期します。  

## 運用ライフサイクル

Repository mutationはRepository単位で直列化し、operation IDを付けます。  
Cloneを含む長時間operationはChannel eventでstarted、progress、completed、failed、cancelledを通知し、FrontendのActivityへ反映します。  
cancel時はGitのprocess groupを停止し、全mutation終了後はhookの成功・失敗にかかわらずGitの実状態を再取得します。  

merge、rebase、cherry-pick、revertの進行状態はGit markerと最小journalから再構成します。  
Cherry-pick／RevertのjournalはGit実行前の`preparing`と適用結果を厳密digest付きで記録した`applied`をatomicに保存します。  
構造化Commitのhook失敗によってindex／worktreeが変更された場合は、previewで現在状態を再照合するAbort専用phaseへatomicに遷移します。  
hook失敗が状態を変えていなければ`applied`を維持し、phaseを持たない旧journalはdigestの有無から保守的に判定します。  

## 多言語境界

Frontendの固定文言は型付きcatalogへ集約し、日時、件数、複数形、durationは`ja-JP`／`en-US`の`Intl`でformatします。  
言語変更はReactの`I18nProvider`を更新して全画面を再描画し、`html[lang]`とmacOS menuも再起動なしで同期します。  

RustからFrontendへ渡す結果、進捗、preview、Conflict label、errorは、翻訳済み文字列ではなくmessage IDと型付き引数を持つ`LocalizedMessage`とします。  
Activity v2も同じ構造を保存するため、表示中または保存済みの項目を言語変更後に再翻訳できます。  
旧Activity cacheはpre-releaseの30日cacheであり、v1から移行しません。  

## セキュリティ

利用者に対する安全上の保証は[仕様の「安全性」](specification.md#安全性)に定義します。  

- Tauri commandはmain windowだけに許可し、Frontendへshell、filesystem、process pluginを公開しません。
- Local RepositoryとClone先の選択にはTauri Dialog pluginのdirectory open権限だけを許可します。
- Gitは絶対pathとargv配列で起動し、shellを介しません。
- 読取diffではexternal diffとtextconvを無効にします。
- 確認tokenはRepository、generation、Action全体、preview digestへ結合し、短寿命・単回使用にします。
- 書き戻し対象はtarget treeとcurrent indexから列挙し、未追跡内容も含めてpreview digestを作ります。
- system Git runnerは全commandへglobal optionの`--literal-pathspecs`を指定します。
- Activityの永続化境界でcommand出力をredact・truncateし、environmentとstdinを保存対象から外します。
- Git出力のparserは安全判定に使う各結果へ上限を設け、上限超過をerrorとして扱います。
- CSPはremote scriptを許可せず、Diff workerに必要な`worker-src 'self' blob:`だけを追加します。

## 品質gate

Frontend、Rust、TOML、Markdown、link、Commit grammarを独立して確認し、pre-pushでは並列実行します。  
Release確認ではE2E feature付きの非bundle release binaryをWebdriverIO embedded providerで操作した後、test pluginを含まない通常のTauri application bundleを作成します。  
