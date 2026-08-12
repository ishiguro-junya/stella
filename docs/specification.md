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

### 場所の復旧と登録解除

起動時、アプリへ戻ったとき、一覧または切替画面を開いたときに、登録済みの場所が有効なGitリポジトリか確認します。  
場所の消失、Gitリポジトリでなくなった状態、アクセス不能を区別し、一覧へ「場所を確認」「リポジトリを確認」「アクセス権を確認」を表示します。  
一覧表示のためにリモート通信や全体検索は行いません。  

移動先は自動推測せず、Finderから利用者が選び直します。  
新しい場所が有効なGitリポジトリであることを確認した後、以前と新しい場所を並べた確認画面を表示し、同じリポジトリかどうかは自動判定しません。  
表示名、開いている場所、選択中の場所、リモート警告、通常形式とConventional Commits形式の下書きは、一度の設定更新で新しい場所へ移します。  
新しい場所が登録済みの場合は自動で統合せず、登録済みの方を開くか、以前の登録を解除します。  

未保存のファイル編集または競合編集がある場合は、すべての操作を停止し、場所の選び直しまたは編集内容の破棄を求めます。  
新しい場所の対象内容が編集開始時のハッシュと一致する場合だけ下書きを引き継ぎ、一致しない場合は上書きせず、以前の画面に編集内容を保持します。  
登録解除はローカルファイルを削除しません。  
未保存内容は確認後に破棄し、Git操作中は登録解除できません。  

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

### 選択状態

表示／編集などのtab、Changesのfile、HistoryのCommit、Activityの操作、Repository／Branch切替、競合blockは、選択中に決定buttonと同じaccent blueの背景を表示します。  
同じgroupのtabは隙間なく密着させ、外周の枠線を維持したままtab間の仕切り線は表示しません。  
Changesのfile選択背景は行全体の単一surfaceとして即時に切り替え、checkbox、file情報、file menuの間で切り替え時差を設けません。  
選択中の文字、補助情報、状態icon、file menuは白系で表示し、未保存を示す黄色いdotとRepository logoは維持します。  
History graphのlane色は選択状態に左右されません。  
History graphは選択中もlaneごとの色を維持し、1本の接続線が選択境界で途切れて見えないようにします。  
lane 0はaccent blueの選択背景でも識別できるvioletとし、未コミット区間は低彩度のgrayで区別します。  
Dark appearanceのBranchなどのref chipは、muted blueの背景上で読める明るいblueの前景を使用します。  
Dark appearanceでは白い前景とのcontrastを保つため、Light appearanceより明度を抑えたaccent blueを使用します。  
選択を移すとGit状態と操作結果の色は通常の成功、警告、危険色へ戻ります。  
上部navigationの変更差分、操作履歴、アクティビティ、設定は、選択中もグレーの背景と通常の文字色を使用します。  
Diff内の行選択は追加／削除の意味色と共存させるため、Application操作の選択状態とは異なる青系の背景を使用します。  

## Commit

ChangesのCommitからDialogを開き、メッセージへ初期focusします。  
Conventional Commits設定はApplication全体へ適用し、初期値は「使用しない」です。  
使用しない場合はplaceholderのない1行のメッセージ入力だけを表示し、空文字、改行、NULを拒否して前後の空白を除去します。  
使用する場合はメッセージ、型、任意のスコープ、破壊的変更を入力し、Conventional Commits形式として検証します。  
通常形式とConventional形式の下書きはRepositoryごとに分けて保持し、Commit成功時は使用した形式の下書きだけを消去します。  
RepositoryのGit Hookは設定にかかわらず実行し、Hookが要求するメッセージ形式を迂回しません。  

## 差分表示

通常diffと競合中のBase↔Current／Base↔Incomingを表示します。  
表示上限によってpatchを切り詰めた場合は「先頭のみ」と明示し、Changesでの行選択を無効にします。  
Changesの左paneで複数fileを選択した場合は、選択中のすべてのDiffを右paneへ一覧表示します。  
file全体のStage／Unstageは、左paneのfileまたはgroup checkboxから行います。  
file行をStagedとUnstagedの間でdrag and dropして移動する操作は提供しません。  
Changesの右paneでは、各Hunkの`unmodified lines`行の右端からHunk全体をStage、Unstage、または破棄できます。  
各Hunkのheader左端には、ハンク番号と対象行範囲を控えめな色で表示します。  
`unmodified lines`の文言と差分行の`+`／`-`記号は表示しません。  
差分行本体を左クリックするか行番号を直接選択し、Shiftクリックすると同じsideの範囲を複数行選択できます。  
選択行は追加行の緑と区別できる青系の背景で表示します。  
右クリックメニューから、選択した連続行をStage、Unstage、または破棄できます。  
同じメニューから選択行の本文をコピーできます。  
Diff上のドラッグによる文字選択とコピーはできません。  
Hunk操作は追加行と削除行をまとめて適用し、行操作は同じsideの連続した変更行だけを対象とします。  
binary、rename／copy、mode変更、symlink、submodule、競合、Git LFS対象file、複数fileを含むDiff、および表示上限を超えたDiffはfile全体で操作します。  

## Changes内のファイル編集

Changesに表示されているfileは、Diff headerの鉛筆アイコンまたはfile行のメニューにある「編集」からStella内で編集できます。  
鉛筆アイコンには「編集」のTooltipを表示します。  
各Hunkの「ハンクを編集」と、選択行の右クリックメニューにある「選択した行を編集」からも同じEditorを開けます。  
Hunkまたは行から開いた場合は、対象Hunkまたは選択行の開始位置をEditor上端から25%の位置へ配置し、入力focusを持たせた初期状態でfile全体のEditorを表示します。  
編集時はDiffではなくworktree上のfile全体を右paneへ表示し、複数選択中は編集を実行した1件だけへ選択を絞ります。  
Editorの読込中は現在のDiffを維持し、読込完了後に表示を切り替えます。  
Repository全体を探索するfile browserは設けません。  

DiffとEditorのheaderには鍵と鉛筆のアイコンタブを表示し、鍵をDiff表示、鉛筆をfile編集として扱います。  
Diffでは鍵、Editorでは鉛筆を選択状態にし、どちらのheaderにもfile menuを表示します。  
Editor headerに「キャンセル」と「保存する」は表示しません。  
未保存中は「未保存」の文字を表示せず、左paneと右paneのfile名の右へ黄色いdotを表示します。  
Editorに残ったまま保存する操作は`Command-S`だけで行い、自動保存、自動Stage、保存とStageの一括操作は行いません。  
未保存で鍵タブを選んだ場合は「キャンセル」、「保存せずに表示」、「保存して表示」から選択します。  
保存成功後はEditorに残り、保存によって対象がChangesから消えた場合だけEditorを閉じます。  
保存失敗時はdraftを維持してerrorを表示します。  

Staged fileの保存先もworktreeだけであり、Git indexは変更しません。  
保存後に生じたUnstaged changesへ選択を移します。  
未保存中はStage／Unstage、Hunk／行操作、Discard、Commit、Pull、Push、Fetch、外部appで開く操作を無効にします。  
Editorのfile menuでは、未保存中もpathのcopyとFinder表示を利用できます。  

「キャンセル」はdraftを破棄して表示へ戻ります。  
別fileまたは別画面へ移動する、BranchまたはRepositoryを切り替える場合は、保存、破棄、cancelを選択します。  
windowを閉じる場合も未保存内容があることを確認します。  
外部変更を検出した場合は強制上書きを許可せず、draftを維持してcopyまたは再読込を選択します。  

通常編集の対象は、UTF-8、LFまたはCRLFのどちらか一方、5 MiB以下、10万行以下、最長行256 KiB以下の通常fileです。  
Untracked、Unstaged、Staged、Rename後の現在pathを編集できます。  
次のfileは編集できない理由を表示し、既存の競合fileは競合Editorで扱います。  

- binaryまたはNULを含むfile
- non-UTF-8、mixed line ending、lone CRのfile
- Git LFS対象file
- symlink、submodule、削除済みfile
- size、行数、最長行の上限を超えるfile

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
各Commitのメタ情報は、左右paneともCommit ID、作成者、日時の順に表示します。  
History先頭の未コミットの変更を選択すると、Changesへ切り替えます。  

Historyで選択したCommitから、軽量Tagをローカルに作成できます。  
同名のTagは上書きせず、作成したTagはRemoteへ自動でPushしません。  

変更差分の右paneでは、複数fileを選択している場合だけfile header左端へトグルを表示し、file単位でDiffを折りたたみ、再展開できます。  
単一選択時は折りたたみトグルを表示しません。  
操作履歴の右paneでは、file header左端のトグルからfile単位でDiffを折りたたみ、再展開できます。  
設定の「ファイルヘッダーの追従」を有効にすると、Diffのスクロール中もファイルheaderを右ペイン上部へ固定します。  
この設定の初期値は無効です。  

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
エラーにGitの終了コード、stderr、stdoutがある場合は折りたたまず常に表示し、出力は最大5行の領域内でスクロールできます。  
初回起動時はmacOSの優先言語が日本語なら日本語を選び、それ以外の場合は英語を選びます。  
設定画面で言語を変更した後は、選択した言語を保持します。  
言語、外観、ステージ表示、Conventional Commits、Gitツールチェインは、すべてselectで選択します。  
ステージ表示は「分割」と「なし」から選択し、「なし」では変更差分のステージ移動用チェックボックスと行メニューのステージ移動操作を表示しません。  
Conventional Commitsは「使用する」、「使用しない」の順に表示し、変更を即時にCommit Dialogへ反映します。  
行の折り返しは初期状態では無効とし、設定から有効にできます。  
この設定はChangesのDiffとEditor、競合比較とEditor、および操作履歴の右paneに適用します。  
折り返しを有効にした場合の初期値は120文字とし、指定した文字数で折り返します。  
設定の肯定／否定を選ぶselectは、肯定の選択肢を先に表示します。  

Repository名、path、Branch名、Commit本文、Gitのstdout／stderrなど、Git、OSまたは利用者が生成した内容は翻訳せず原文のまま表示します。  
日本語表示でもGit、Changes、Commit、Stage、Diff、Branch、HEADなどのGit用語は英語表記を維持します。  

## Git実行環境

既定ではApplicationに同梱したGit 2.55.0、Git LFS 3.7.1、git-flow-next 1.2.0を使用します。  
設定で内蔵またはSystemを選択でき、変更は保存後の次回起動からRepository操作へ反映します。  
設定には選択中と次回起動時のmode、各componentのversion、path、検証結果を表示します。  

Systemは`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`の順でGit、Git LFS、Git Flowを個別に検出します。  
SystemでGitを実行するときは、検出済みcomponentのdirectoryを先頭に置いたうえで、利用者のlogin shellから取得した`PATH`をGit Hookとhelperにも使用します。  
`PATH`の取得はApplication起動時に一度だけ行い、2秒以内に取得できない場合は`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`/bin`、`/usr/sbin`の固定pathで操作を継続します。  
変更を反映するにはApplicationを再起動します。  
開発起動中にnative backendが再buildされた場合、古いbackendは次の操作を実行せず「更新があります。アプリを再起動してください。」と表示します。  
製品buildではこの開発用判定を行いません。  
内蔵modeは利用者のshellを参照せず、同梱したtoolchainとOS標準commandだけを使用します。  
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

### リモートURLの復旧

フェッチ、プル、プッシュの失敗は、リモート不在、認証失敗、接続失敗、その他のGit失敗へ分類します。  
確実に分類できる前3種類だけを一覧の「リモートを確認」「認証を確認」「接続を確認」へ反映し、リモート名、原因、失敗日時だけを場所ごとに保存します。  
URL、Git出力、認証情報は警告として保存せず、同じリモートへの対応操作が成功したときだけ警告を解除します。  

開いているリポジトリの切替画面と警告行から、既存リモートのすべてのフェッチURLとプッシュURLを確認できます。  
URL変更はリモート名、URLの用途、変更前URL、変更後URLを確認し、実行直前に変更前URLを再照合します。  
更新後もGit設定を読み直して結果を確認します。  
フェッチURLを変更した場合は、そのリモートへのフェッチを別操作として続けます。  
フェッチ失敗時も新しいURLを保持して警告を残します。  
プッシュURL変更後は自動でプッシュせず、次の明示的なプッシュ成功まで警告を残します。  
リモートURLの変更はローカルGit設定だけを変更し、リモート側の状態は変更しません。  

## 対象外

次のGit機能およびホスティングサービス固有の機能は対象外です。  

- GitHubまたはGitLab固有の連携
- 認証情報の管理
- stash
- 注釈付きTag、Tagの削除、TagのPush
- リモートの追加、削除、名称変更
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
