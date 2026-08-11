# 仕様

この文書では、利用者から見えるStellaの動作、制約、対応範囲を定義します。  
内部の実現方法は[アーキテクチャ](architecture.md)に記載します。  

## 対応環境

StellaはApple Siliconを搭載したMacに対応します。  
Intel MacおよびmacOS以外のOSは対応対象外です。  

## Repository

### 登録とOpen

Finderまたは絶対pathで選択した場所から、既存Repositoryのrootを探索して開きます。  
選択した場所が既存Repositoryの配下なら、そのrootを開き、nested Repositoryは作成しません。  
既存Repositoryが見つからない場合に限り、選択したpathへ`main` BranchのRepositoryを作成します。  

登録済み一覧から選択したpathが削除済み、またはGit Repositoryでなくなっている場合は、新規Repositoryとして初期化しません。  
Open、登録済みRepositoryの再Open、Cloneに成功したRepositoryは、canonical rootを登録済み一覧の先頭へ記録します。  
同じpathを再度開いた場合は重複させず先頭へ移動し、Remote／LocalやOpen／Cloneによる分類は行いません。  
旧形式の`recentRepoPaths`は読込時に登録済み一覧へ移行します。  

### ロゴ

登録済みRepositoryの一覧では、Repository内にある画像をロゴとして表示します。  
次の候補を上から順に探索し、最初に見つかったファイルを使用します。  

1. `logo.svg`
2. `logo.png`
3. `logo.webp`
4. `logo.jpg`
5. `logo.jpeg`
6. `.stella/logo.svg`
7. `.stella/logo.png`
8. `.github/logo.svg`
9. `.github/logo.png`
10. `docs/logo.svg`
11. `docs/logo.png`
12. `src-tauri/icons/128x128.png`

### 外部変更の反映

外部で行われたGit操作とファイル変更は、アプリへfocusが戻ったとき、および2秒間隔の更新で検出します。  
HEADが変わらないBranch更新とTag更新もHistoryへ反映します。  
破壊操作のpreview後に対象が変更された場合は、statusやファイルsizeが同じでもexecuteを拒否します。  

## 差分表示

通常diffと競合中のBase↔Current／Base↔Incomingを表示します。  
表示上限によってpatchを切り詰めた場合は「先頭のみ」と明示し、Changesでの行選択を無効にします。  

## 競合編集

競合ResultはStella内で編集できます。  
未保存の編集内容が外部変更と競合した場合は上書きせず、draftを保持したまま再読込またはcopyを選べるようにします。  
編集の基準revisionが不明、または履歴から削除済みの場合は再読込を要求し、現在のblock状態から推測しません。  
Save後は新しいsessionとして扱い、古いUndo／Redo履歴を破棄します。  

whole-file choiceでは選択したsideのexecutable bitを適用し、BothはCurrentを正とします。  
Mark resolved時はworktreeの存在を再確認し、fileはStage、削除結果はGit indexから削除します。  
Stageに失敗した場合は、保存済み・未Stageの部分失敗として通知します。  

LFまたはCRLFのどちらか一方を使うtext fileだけをStella内の編集対象とします。  
次の内容は外部editorで解消します。  

- mixed line ending
- lone CR
- Git attributesでbinaryに指定されたファイル
- NULを含むファイル
- non-UTF-8のファイル
- 上限を超えるファイル
- symlink
- submodule
- rename／directory-file形式の競合

Gitの`conflict-marker-size`を競合blockの解析とMark resolved直前のmarker検査に使用します。  
markerのないtextやbinaryは暗黙にresolvedとせず、Stella内でのSave、whole-file choice、または外部editorで開いた後の内容変更を確認してからMark resolvedを受け付けます。  

## Git操作

Repositoryを変更する操作はRepository単位で順番に実行します。  
Cloneを含む長時間操作は、開始、進捗、完了、失敗、cancelの状態をActivityへ表示します。  
実行中の操作をcancelした場合はGit processを停止し、その後のRepository状態を再取得します。  

merge、rebase、cherry-pick、revert中は、競合解消とContinue／Skip／Abort以外の一般的な変更操作を受け付けません。  
例外として、mergeおよび保留中の構造化Commitに必要なCommitは実行できます。  
Stellaは自動Continueと通常のStage／Unstageを行いません。  

Merge commitをCherry-pickまたはRevertする場合は、Historyでmainline parentを選択します。  
選択時はparent数と選択範囲を検証します。  
previewの影響pathと書き戻し衝突は、選択したparentとの差分を基準にします。  

HistoryのCommit操作は、対象行の右クリックまたは3点リーダーから選択します。  
Commit行をダブルクリックした場合は、そのCommitを指すローカルブランチのうち、現在のブランチ以外が一意ならチェックアウトします。  
候補が複数ある場合は、対象のブランチチップをダブルクリックします。  
操作別Dialogで入力と対象Commitを確認し、影響previewを経て実行します。  
各Commitの日時は、Commit IDの直後に表示します。  
History先頭の未コミットの変更を選択すると、Changesへ切り替えます。  

Historyで選択したCommitから、軽量Tagをローカルに作成できます。  
同名のTagは上書きせず、作成したTagはRemoteへ自動でPushしません。  

変更差分と操作履歴の右ペインでは、ファイル名と変更行数を表示するheaderの左端から、ファイル単位でDiffを折りたたみ、再展開できます。  

ブランチ切り替え画面ではローカルブランチを選択でき、footerから現在のCommitを起点にブランチを作成できます。  
ブランチ作成は影響previewを確認して実行し、作成後はそのブランチへ切り替えます。  
未コミット変更または進行中のGit操作がある場合は、作成と切り替えを利用できません。  
この画面にGit Flow導線は表示しません。  

再起動時はmerge、rebase、cherry-pick、revertの進行状態を復元し、自動Continueやlock fileの自動削除は行いません。  
Git操作の開始記録だけが残っている場合や、構造化Commitのhook失敗によってindex／worktreeが変更された場合は任意Commitを許可せず、Abortだけを受け付けます。  

## 安全性

Reset、Discard、Merge、Rebase、Cherry-pick、Revert、Abortでは、書き戻すpathと未追跡内容をpreviewの検証対象に含めます。  
statusへ現れないignored内容や未検証のdirectory／file衝突がある場合は、Git操作を実行しません。  
Checkout／Switchではignored内容を上書きしません。  

`*`、`[`、`?`、`:(glob)`を含むファイル名はpath patternとして展開せず、対象のファイル名として扱います。  
Activityにはenvironmentとstdinを保存せず、command出力は機密情報を除去して上限内に切り詰めます。  
status、index、ref、影響pathなど安全判定に使うGit出力が上限を超えた場合は、部分結果で続行せず操作を拒否します。  

## 表示言語

UIおよびStellaが生成する通知とエラーは、日本語と英語に対応します。  
初回起動時はmacOSの優先言語が日本語なら日本語を選び、それ以外の場合は英語を選びます。  
設定画面で言語を変更した後は、選択した言語を保持します。  
言語、外観、Stage表示、Gitツールチェインは、すべてselectで選択します。  

Repository名、path、Branch名、Commit本文、Gitのstdout／stderrなど、Git、OSまたは利用者が生成した内容は翻訳せず原文のまま表示します。  
日本語表示でもGit、Changes、Commit、Stage、Diff、Branch、HEADなどのGit用語は英語表記を維持します。  

## Git実行環境

既定ではApplicationに同梱したGit 2.55.0、Git LFS 3.7.1、git-flow-next 1.2.0を使用します。  
設定で内蔵またはSystemを選択でき、変更は保存後の次回起動からRepository操作へ反映します。  
設定には選択中と次回起動時のmode、各componentのversion、path、検証結果を表示します。  

Systemは`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`の順でGit、Git LFS、Git Flowを個別に検出します。  
Gitがないmodeは選択できません。  
Git LFSまたはGit Flowだけがない場合は、そのcomponentを必要とする機能だけを停止します。  
内蔵toolchainのchecksum不一致または欠損があってもApplicationは起動し、Repository操作を停止した状態でSystemへ切り替えられます。  

### Git Flow

Git Flow操作UIは現在公開しません。  

### Git LFS

`.gitattributes`の`filter=lfs`を検出し、Clone、Checkout、Merge、Rebase、Pull、Stage、Commitで選択中toolchainのGit LFS filterを透過的に使用します。  
Git LFS対象fileのStage／Unstageはfilterを確実に適用するためfile全体で行い、行単位操作は利用できません。  
通常Pushでは、Git refを送る前に対象refのLFS objectをuploadします。  
利用者のglobal Git設定とhookは変更しません。  
SystemにGit LFSがないLFS Repositoryはpointer fileのまま操作を続けず、必要componentを示して停止します。  
track、untrack、lock、migrateの専用UIは設けません。  

## 対象外

次のGit機能およびホスティングサービス固有の機能は対象外です。  

- GitHubまたはGitLab固有の連携
- 認証情報の管理
- stash
- 注釈付きTag、Tagの削除、TagのPush
- remote管理
- interactive rebase
- force push
- submodule
- worktree管理

次の配布および運用機能は対象外です。  

- App Sandbox
- Developer ID署名
- 公証
- 自動更新
- Mac App Storeでの配布
