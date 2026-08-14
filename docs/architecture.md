# アーキテクチャ

利用者から見える動作、制約、対応範囲は[仕様](specification.md)に定義します。  
画面構成、文言、視覚表現とその検証結果は[デザイン](../DESIGN.md)に定義します。  
この文書では、それらを実現するモジュール境界、状態管理、永続化、検証方式を説明します。  

## モジュール構成

Tauri Core processの`Workspace`をGit操作の境界とします。  
Frontendは型付きのattach、detach、query、preview、execute、cancelだけを利用し、Git command、path解決、出力parse、generation管理、確認token、operation復旧を知りません。  
Repositoryを開く処理は、選択したpathを解決する`Open`、登録済みRepositoryを再接続する`OpenExisting`、Remoteから作成する`Clone`へ分けます。  

`Workspace`内部には起動時に固定したGit toolchain runner、status／patch parser、競合session、operation journalを置きます。  
これらはFrontend interfaceへ公開せず、一時Repositoryとbare remoteを使った統合testを`Workspace` interface越しに行います。  
同じRepositoryを再attachした場合はevent Channelを置き換え、古いwindow sessionへの重複通知を防ぎます。  

`RepositoryAvailability`問い合わせは登録状態を変更せず、場所を`available`、`missing`、`notRepository`、`inaccessible`へ分類します。  
フロントエンドは登録済みの場所を起動、復帰、一覧表示時に検査し、開いているリポジトリは通常更新の失敗後にも再検査します。  
未保存内容がなければ`detach`し、既存の`repositoryRemoved`通知で作業画面から外します。  
未保存内容がある場合は`UnsavedChangesHandle`から種類、相対パス、基準ハッシュ、下書きを取得し、新しいセッションの内容と基準ハッシュが一致した場合だけ保存操作へ渡します。  
場所の付け替えは、登録情報、表示名、選択状態、リモート警告、両形式のコミット下書きを1つの設定更新で移します。  

`Remotes`問い合わせは`git remote`と`git remote get-url --all`からフェッチURLとプッシュURLを型付きで返します。  
`SetRemoteUrl`は変更前URLを対象結合へ含め、プレビューと実行の間に設定が変わった場合は`previewMismatch`で停止します。  
Gitはシェルを介さず固定した引数配列で`remote set-url`を実行し、更新後に設定を読み直します。  
リモート警告の永続化はフロントエンドの設定境界で行い、リモート名、分類、失敗日時以外を保存しません。  
通常のGitエラー詳細は既存の一時的なエラー画面と活動に残します。  

`ToolchainManager`はFrontendの`localStorage`とは独立したnative設定をApplication config directoryへatomic保存します。  
起動時に内蔵またはSystemを一度だけ解決し、`Workspace`はその`GitExecutor`だけを保持します。  
内蔵modeはApplication resource内の`bin`、`libexec/git-core`、templateを`PATH`、`GIT_EXEC_PATH`、`GIT_TEMPLATE_DIR`へ固定し、埋め込んだlock manifestとbundle markerのSHA-256を照合します。  
System modeは選択・検証済みのGit関連componentを優先し、loginかつinteractive modeで起動した利用者のshellから取得した`PATH`、OS標準directoryの順で実行pathを構成します。  
shellのstdoutはmarker間の`PATH`だけを採用して環境変数全体を保持せず、取得が2秒以内に完了しない場合、起動に失敗した場合、または出力が不正な場合は固定のSystem pathへフォールバックします。  
この`PATH`はApplication起動時に一度だけ確定し、すべてのGit操作とGit Hookへ共通して渡します。  
内蔵modeでは利用者のshellを起動せず、Application resource外のtoolchainを混入させません。  

Git Flowは`git_flow` Module内で安全なrequestからargvを組み立てるInterfaceを持ち、任意optionやRepository外のconfig scopeを受け取りません。  
git-flow-next 1.2.0はJSON overview flag導入前のため、JSON取得を試した後に同じoverviewのplain outputを型付き状態へ変換します。  
共有`.gitflow`はlocal configとの比較とatomic exportを行い、sync失敗時はlocal値を復元します。  

通常pollingのgeneration fingerprintはporcelain status、dirtyなtracked fileのindex OID／mode、worktreeのinode／mode／size／mtime／ctime、local／remote ref一覧で作り、regular file本文を開きません。  
破壊操作のpreviewとexecuteでは対象本文をSHA-256で再計算し、operation journalも構造化Commit直前に記録済みの厳密digestと再照合します。  

## Commit入力

FrontendからRustへ渡すCommit入力は、1行の`plain`メッセージと構造化した`conventional`のtagged unionです。  
Rustは`plain`の空文字、改行、NULと、`conventional`の型、スコープ、メッセージ、Footerを形式別に最終検証します。  
検証後はどちらもRepository内の一時message fileへ書き込み、同じGit CommitとGit Hookの経路を使用します。  
PreferencesはApplication全体の形式設定と、Repositoryごとに分離した両形式の下書きを保持します。  
旧形式の構造化下書きはConventional側へ移行し、設定値がない場合は通常形式を選択します。  

## 差分表示とファイル編集

通常diffとBase↔Current／Base↔Incomingの比較表示には`@pierre/diffs@1.3.5`を使います。  
通常fileと競合Resultの編集にはCodeMirror 6を使い、検索、行番号、syntax highlight、Undo／Redo、`Command-S`、大規模file用設定をFrontendの`TextEditor`へ集約します。  
競合固有のChoice、Mark resolved、revision同期は`ConflictSurface`のwrapperに残します。  
`@codemirror/merge`とDiffsのexperimental Edit／Conflict機能は使用しません。  

Changesは左paneの選択keyを単一選択と複数選択で共有し、複数選択時は各path／areaのDiffを並列取得してRepository上の表示順で右paneへ並べます。  
ChangesのHunk操作はDiffsの標準Hunk separatorへ配置し、左端へハンク番号と行範囲、右端へ操作buttonを追加して、`unmodified lines`の文言は表示しません。  
差分行本体の左クリックまたは行番号の直接選択で行を選び、Shiftクリックで同じsideの範囲へ選択を広げます。  
選択中の行は追加行の緑と区別できる青系の背景で表示します。  
行操作は右クリックメニューへ集約します。  
選択行の本文コピーも右クリックメニューから行い、Diff上のドラッグによる文字選択は無効にします。  
FrontendからRustへ渡す部分選択は、連続行を表す`lines`とDiff内の順序を表す`hunk`のtagged unionです。  
RustはRepository generationとDiff revisionを再検証し、選択したHunkのheaderと本文、または選択行から再構成したzero-context patchを`git apply --check`後にindexへ適用します。  
HunkのUnstageは同じpatchをindexへreverse適用し、Hunkの破棄はworktreeへreverse適用します。  
いずれも追加行と削除行を1つの操作として扱います。  
ファイルheaderの追従設定はPreferencesに保存し、Changesでは外側のscroll container、HistoryではDiffsのsticky header機能へ反映します。  
設定が無効な場合はheaderとDiff本文を同じscroll flowに置き、有効な場合だけheaderを上部へ固定します。  

Git indexとworking treeをRust側の正とし、未保存draftだけをFrontendで管理します。  
通常fileの読込には`FileContents` queryを使い、text、line ending、UTF-8 BOM、content hash、Repository generationを受け取ります。  
`SaveFile` Actionは読込時のcontent hashを必須とし、保存直前に現在内容を再読込して外部変更を拒否します。  
既存のline endingとUTF-8 BOM、file modeを維持し、Repository内pathの検証後に同じdirectoryの一時fileからatomic renameします。  
通常fileと競合Resultは共通の`UnsavedChangesHandle`をAppへ公開し、画面、Branch、Repository、windowの離脱確認を同じ契約で処理します。  
Repository generationの更新時は編集中fileのhashを再確認し、未編集なら再読込し、編集中ならdraftを置き換えず外部変更状態へ移します。  

通常fileはChanges snapshotに存在するpathだけを対象とし、UTF-8、line ending、NUL、Git attributes、Git LFS、file type、size、行数、最長行をRustで検証します。  
保存はworktreeだけを書き換えるため、Staged fileを編集してもindexは維持されます。  

SaveとMark resolvedは`sessionId`、path単位の`conflictGeneration`、`contentHash`をRustで再検証します。  
Choiceで検証した本文とblock状態はRust sessionにもbounded revisionとして保持します。  

FrontendとRustは、UTF-16 code unitを4 byte、block metadataを固定量として課金する共通96 MiB budgetと100件上限を使い、古いsnapshotから追放します。  
Frontendは現在状態と最新のserver anchorを保持し、Rust snapshotはblockのrangeとstateだけを保存してreplacement本文を複製しません。  
Frontendの各Undo／Redo snapshotは、手動編集を派生させた直近のRust revisionを`baseDocumentRevision`として保持します。  
Rustは既知revisionと本文が完全一致すれば本文とblock状態を一緒に復元し、未知の手動draftは既知のbase revisionへ戻してから差分を同期します。  

## アプリの更新

Rust側の`app_update`モジュールがTauri Updaterを所有し、更新の確認、署名検証、ダウンロード、インストール、再起動を行います。  
フロントエンドへUpdaterプラグインの権限は公開せず、`app_update_check`と`app_update_install`だけをTauri commandとして公開します。  
確認済みの更新情報はRust側で保持し、インストール時に任意のURLや署名をフロントエンドから受け取りません。  

実行中のバージョンにプレリリース識別子があればプレリリース用の固定`latest.json`を、なければ安定版用を参照します。  
自動確認の時刻管理と表示状態はフロントエンドが担い、macOSメニューの「更新を確認…」も同じ確認処理へ通知します。  

通常のビルドでは更新用ファイルを作りません。  
リリース時だけ`tauri.updater.conf.json`を重ね、リポジトリ外の秘密鍵で`.app.tar.gz`へ署名します。  
固定の更新情報はバージョン別GitHub ReleaseのURLと署名を参照し、対象ファイルの公開が完了してから置き換えます。  

## 運用ライフサイクル

Repository mutationはRepository単位で直列化し、operation IDを付けます。  
Cloneを含む長時間operationはChannel eventでstarted、progress、completed、failed、cancelledを通知し、FrontendのActivityへ反映します。  
cancel時はGitのprocess groupを停止し、全mutation終了後はhookの成功・失敗にかかわらずGitの実状態を再取得します。  
活動は現在のセッションの詳細と、直近1年分の復元済み要約を分けて永続化します。  
復元済み要約には件数上限を設けません。  
活動画面とRechartsのグラフは別々の遅延読込み単位とし、ワークスペース用のバンドルではRechartsを先読みしません。  
開発buildでは起動時のnative実行fileのdevice、inode、size、mtimeを保持し、executeの直前に現在の実行fileと照合します。  
再buildによって実行fileが変わっている場合は古いCore processで操作を続けず、Applicationの再起動を求めます。  
release buildにはこの照合を含めません。  

merge、rebase、cherry-pick、revertの進行状態はGit markerと最小journalから再構成します。  
Cherry-pick／RevertのjournalはGit実行前の`preparing`と適用結果を厳密digest付きで記録した`applied`をatomicに保存します。  
構造化Commitのhook失敗によってindex／worktreeが変更された場合は、previewで現在状態を再照合するAbort専用phaseへatomicに遷移します。  
hook失敗が状態を変えていなければ`applied`を維持し、phaseを持たない旧journalはdigestの有無から保守的に判定します。  

## 多言語境界

フロントエンドの固定文言はi18nextの言語別JSONカタログへ集約し、react-i18nextを通して表示します。  
日時と数値は`ja-JP`／`en-US`の`Intl`で整形し、複数形はi18nextへ委ねます。  
選択中の言語に文言がない場合でも別の言語へ切り替えません。  
言語変更はReactの`I18nProvider`を更新して全画面を再描画し、`html[lang]`とmacOSメニューも再起動なしで同期します。  
macOSメニューはフロントエンドと同じJSONカタログを読み込みます。  

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
- 利用者由来pathを受けるGit commandはglobal optionの`--literal-pathspecs`を指定します。
- Activityの永続化境界でcommand出力をredact・truncateし、environmentとstdinを保存対象から外します。
- Git出力のparserは安全判定に使う各結果へ上限を設け、上限超過をerrorとして扱います。
- CSPはremote scriptを許可せず、Diff workerに必要な`worker-src 'self' blob:`だけを追加します。

## 品質gate

pre-pushではlint、test、test-e2eの3 laneを並列実行します。  
test-e2e laneでは、E2E feature付きの非bundle release binaryをWebdriverIO embedded providerで操作します。  
通常bundleでは3 componentのversion、arm64 architecture、checksum、HTTPS helper、template、credential helper、動的link先をrelease gateで確認します。  
