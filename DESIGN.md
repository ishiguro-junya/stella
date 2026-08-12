# デザイン

## 検証資料

- 参照UI: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-commit-left-audit-post.png`
- 最終Changes画面: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-workspace-density-v2/01-changes-default.png`
- 最終History画面: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-workspace-density-v2/03-history-default.png`
- 実行時エラーDialog: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-workspace-density-v2/04-error-dialog.png`
- Activity参照画像（案3）: `/Users/ishiguro/.codex/generated_images/019fdfab-f0b3-7273-b559-a0e4acc24a7d/exec-214a9f65-534b-4fd5-821a-594b2d12eb7b.png`
- 最終Activity、1180 x 760: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-activity-v3/activity-1180x760-final.jpeg`
- 最終Activity、860 x 560: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-activity-v3/activity-860x560-final.jpeg`
- 表示領域: 1180 x 760 pixel
- 状態: native release buildで、1件のStaged changeと2件のworktree changeがある状態

## 画面全体の比較

参照画面と最終Changes画面を、1つの比較画像として並べて確認しました。  
ChangesとHistoryはtitlebarではなく、左paneの階層の先頭に配置されています。  

- Commit formは常時縦方向の領域を占有せず、左pane上部のCommitからDialogとして開きます。
- Commit、Pull、Push、Fetchはiconとlabelを付けて左pane上部に常時表示し、CommitをPullの左、Fetchを最後に配置します。
- 操作バーが狭い場合は通常サイズのiconだけを表示し、各操作名はtooltipとアクセシブル名で維持します。
- 操作buttonの下でStagedとUnstagedを上下に等分します。

StagedとUnstagedは常に表示される独立したgroupとして残し、それぞれのfile listを個別にscrollできます。  

## アプリ内の文言

- 説明文、通知、エラーでは、製品名を主語にした「Stellaは〜」「Stellaが〜」ではなく、「アプリは〜」「アプリが〜」と表記します。
  英語でも製品名を主語にせず、`The app`を使用します。
- Window titleやApplication menuの「Stellaについて」「Stellaを隠す」「Stellaを終了」など、製品名そのものを示す表示は対象外です。
- Dialogを含むformでは、表示labelのある入力欄にplaceholderを重ねません。
  表示labelのない検索欄では、検索対象を示すplaceholderを使用できます。

## 操作検証

- ChangesとHistoryでは、矢印、Home、End keyに対応したroving-tab keyboard patternを使用しています。
- Historyは未コミットの変更がある場合、Commit一覧の先頭に対象ファイル数付きの履歴項目を表示し、graphをグレーにして未コミットであることを区別します。
- StagedとUnstagedは固定見出し、独立scroll、file／group checkbox、一括操作、keyboard操作を維持しています。
- StagedとUnstagedが空でも件数0のgroupを表示します。
- Commit DialogはMessageへ初期focusし、CancelまたはEscapeで閉じ、成功時だけ自動で閉じます。
- Conventional Commitsを使用しない場合、Commit Dialogにはplaceholderのないメッセージ入力だけを表示します。
- Conventional Commitsを使用する場合はメッセージ、型、スコープ、破壊的変更を表示し、validation messageが表示されても入力欄の位置を維持します。
- Stageされた変更がない場合はDialog内のCommit buttonを無効にしますが、理由の帯は表示しません。
- 入力途中の下書きはrepositoryとCommit形式ごとに分けて保持します。
- Commitできない状態でもDialogは開き、実行buttonを理由付きで無効にします。
- 実行時エラーはqueueされたmodal dialogで表示し、詳細から元のGit出力と終了statusを確認できます。
- 想定内のfast-forward divergenceはgenericなエラーDialogではなく、MergeまたはRebaseを選ぶinlineの判断として表示します。
- Dialogのfocus trapはstackを考慮し、IME変換中には閉じません。
- 保存していない競合結果がある場合、破壊的な遷移の前にContinue、Skip、Abortをguardします。

## 注目箇所の比較

最終layoutでは、常時展開されていたCommit formとtitlebarの重複した画面navigationを削除しました。  

- compactな左sidebarにnavigation、change group、file row、4つの操作buttonをまとめています。
- diffは以前の右pane全体の幅を使えるようになりました。
- CommitはDialogで入力し、Historyにもactive viewの見出しを重複表示しません。

## 再現性が必要な要素

- 階層: repository contextはtitlebarに置き、画面navigationとchange操作は左paneに置きます。
- 密度: 通常状態ではchange group、file、選択中のpath、diffだけを表示します。
- 操作性: Commit Dialogはfocus trap、focus復帰、IME変換中のEscape抑止を共通Dialogと揃えます。
  StagedとUnstagedは固定見出しとし、件数は右端ではなく各ラベル直後のbadgeに表示します。
- accessibility: status名、開閉状態、group選択、modalの詳細、focus復元を明示します。
- 安全性: warningとrecovery状態は残し、実行時エラーはmodal、想定内の判断状態はinlineで表示します。
- responsive対応: ChangesとHistoryは最小window sizeの860 x 560でも利用可能な高さ全体を使います。

## 検出事項

対応が必要なP0、P1、P2、P3の検出事項は残っていません。  

## Repository／Branch切り替えの検証

- 参照switcher: `/Users/ishiguro/.codex/generated_images/019fe4c2-fc9c-7222-ab86-bd3c158a6242/exec-861b462e-c2fd-4def-9f1a-0bee9680f10c.png`
- Repository switcher、1180 x 760: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe4c2-fc9c-7222-ab86-bd3c158a6242/repository-switcher-1180x760.png`
- Repository switcher、860 x 560: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe4c2-fc9c-7222-ab86-bd3c158a6242/repository-switcher-860x560.png`
- Branch switcher、1180 x 760: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe4c2-fc9c-7222-ab86-bd3c158a6242/branch-switcher-1180x760.png`
- Branch switcher、860 x 560: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe4c2-fc9c-7222-ab86-bd3c158a6242/branch-switcher-860x560.png`
- 状態: 4つの開いたrepository、3つのlocal branch、変更のある現在のrepositoryを表示したnativeのDark appearance

選択した参照画像と最終native Repository switcherを、1つの比較画像として並べて確認しました。  
実装では、上部中央のmodal配置、暗くしたworkspace、検索を先頭にした階層、選択行の表現、常に表示する操作footerを維持しています。  
mockとの差異は承認済みの方針に従ったものです。  
RepositoryとBranchはtitlebarの独立したcontrolとし、repository一覧はOpenやRecentの見出しがないflatな構成にしています。  

- Branch controlは約400pxまでbranch名を省略せずに表示し、それを超える場合は末尾を省略します。
- Branch controlのfocus ringはcontrol内側へ表示し、titlebar端で欠けないようにします。
- titlebarは左右のmenuを含む空き領域をwindowのdrag regionとし、操作button自体はno-dragにしてclick操作を維持します。
- 最終利用時刻のlabelとshortcut記号は表示せず、Changes／Historyは既存のsegmented designを維持します。

- Repository検索の対象はname、path、branchです。  
  開いているrepositoryは現在の順序を維持し、重複を除いた登録pathをMRU順で後ろに並べます。
- Branch検索の対象はlocal branch名です。  
  変更中または処理中のrepositoryでは他のbranchを無効にして理由をDialog内に表示し、現在のbranchは選択可能なままにします。
- Branch Dialogのfooterから、現在のCommitを起点にブランチを作成できます。  
  影響previewを確認して作成し、そのブランチへ切り替えます。  
  Git Flow導線は表示しません。
- HistoryのCommit Diffは各file headerにpathを表示し、省略した未変更行数の文言は表示しません。  
  変更差分と操作履歴の右paneでは、header左端の矢印からfile単位でDiffを開閉できます。
- 画面名は日本語でChangesを「変更差分」、Historyを「操作履歴」と表示します。
- 操作履歴はlocal Branchに加えてoriginを含むremote-tracking BranchのCommitを同じgraphに表示し、一覧末尾が近づくと次のpageを自動で読み込みます。
- 手動の「さらに読み込む」は表示しません。
- 左paneの検索欄はCommit件名、Author、hash、refを読込済みに限らず全履歴から検索し、Command-Fでfocusします。
- 矢印、Home、End、Enter、Escape、Tabのfocus trap、triggerへのfocus復元をcomponent testで確認しました。
- native footerの「Add Repository…」から、Remote URL入力とFinderのLocal選択を同じSheetで開始できます。  
  非表示のCommand-Shift-OでもRepository Dialogを開けますが、shortcutは画面上に表示しません。
- Repository DialogとBranch Dialogは、1180 x 760および最小sizeの860 x 560で全体を表示できます。  
  長いpathは行内で省略し、footerのlabelは欠けません。
- 対応が必要なvisual上のP0、P1、P2、P3の検出事項は残っていません。

## Activity画面の検証

選択した案3の参照画像と最終nativeの1180 x 760 Activity画面を、1つの比較画像として並べて確認しました。  

- ActivityとSettingsは隣接した独立画面で、Activityを先に配置し、Workspace Log drawerは設けていません。
- Settingsは言語を先頭、外観をその次に表示し、すべての設定項目をselectで選択します。
- 上部のCommit、Active、Contributor、Branchのsummary領域は表示しません。
- 全体の操作tableにはStatus、Action、Summary、Timestamp、Durationを表示し、行全体をpointerとkeyboardで選択できます。
- 操作tableのStatus列と下部の詳細領域には、内容がpane端へ密着しない余白を設けます。
- 現在のsessionの操作にはcommand、終了code、stdout、stderrを表示します。  
  復元した30日間の項目はsummaryだけを表示します。
- 選択したrepositoryについて、7日、30日、90日、180日、1年のCommit、Contributor、local Branch tip分析、empty、loading、error、truncatedの各状態を表示します。
  指標select、期間selectの順で隣接して表示し、視覚的な見出しは表示しません。
- chart data tableは常時表示して内部をscroll可能にし、開閉toggleは設けません。
  Period、Commits、Contributors、Branchesを固定列として単位付きで日別表示します。
  table左右端のセルは14pxの余白を確保します。
  chartは90日を週単位、180日と1年を月単位で集約し、Contributorは重複加算を避けるため日単位で表示します。
- nativeの860 x 560 captureでも2 columnの分割を維持します。  
  操作一覧と分析の間はpointerとkeyboardでresizeでき、各領域は内部でscrollします。
- Changes、History、Activityのpane幅は画面別の値として保存し、他画面のresizeでは変更しません。
- LightとDarkの明示指定、macOSのliveなSystem appearance、semantic AX table構造、increased-contrast用のborder tokenを確認しました。
- Activity画面とRecharts chartを別々のlazy chunkとして読み込み、workspace bundleではRechartsを先読みしません。

## 比較履歴

- 1回目: ChangesとHistoryを左pane上部へ移動し、Commitを初期状態で閉じたdisclosureにしました。
- 2回目: checkboxを維持し、StagedとUnstagedを分離しました。
- 3回目: 重複したCommitとHistoryの見出しを削除し、disclosureの規則を揃え、compactなHistory gridを緩和しました。
- 4回目: 実行時エラーを共通modal queueへ移し、重複または想定内のエラーDialogを削除しました。
- 5回目: 保存していない競合状態からの遷移をguardしました。
- 6回目: Workspace Logを独立したActivity画面とCommit分析へ置き換えました。
- 7回目: 操作行にあったWebKitのwindow全体を覆うhover overlayを削除し、keyboard focus可能なtable semanticsにしました。
- 8回目: System appearanceをmacOS color-scheme media queryで明示的に解決するようにしました。
- 9回目: repository tabを独立したRepository／Branch controlに置き換え、承認済みの参照画像に対して両方のswitcher Dialogを検証しました。
- 10回目: 件数が0でもStagedとUnstagedを表示し、折りたたみcontrolを削除しました。
- 11回目: file行のdrag and dropによるStage／Unstageを削除し、checkbox操作へ集約しました。

## 検証checklist

- [x] 参照画像と最終native Changes画面を並べて比較する。
- [x] nativeのChanges、History、Commit、エラーDialogの状態を確認する。
- [x] Frontend、Rust、設定、文書、Commitに関する全品質gateを実行する。
- [x] checkboxによるStageを含む、embedded WebKit workflowを実行する。
- [x] 最終的なApple Silicon用macOS application bundleをbuildする。
- [x] 選択したActivity参照画像と最終native Activity画面を1つの比較画像で確認する。
- [x] Activityを1180 x 760および最小window sizeの860 x 560で確認する。
- [x] native Activityのnavigation、操作詳細、Commit metric、期間切り替え、chart SVG、table fallbackを確認する。
- [x] Repository switcherの参照画像と最終nativeの1180 x 760 captureを並べて比較する。
- [x] Repository switcherとBranch switcherを1180 x 760および最小window sizeの860 x 560で確認する。
- [x] flatなrepository順序、検索とkeyboard操作、checkoutを無効にする理由、操作footerを確認する。

## Segmented controlの選択状態検証

- 視覚的な正: `/Users/ishiguro/Desktop/スクリーンショット 2026-08-09 15.51.27.png`
- 元画像: Retina解像度の376 x 106 pixel。  
  標準化したcontrol sizeは約188 x 53 CSS pixelです。
- native Unified状態: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe54a-921a-75b0-ab7a-c3743d9c5c49/segmented-controls/segmented-changes-unified-1180x760.png`
- native Split状態: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe54a-921a-75b0-ab7a-c3743d9c5c49/segmented-controls/segmented-changes-split-1180x760.png`
- native History状態: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe54a-921a-75b0-ab7a-c3743d9c5c49/segmented-controls/segmented-history-1180x760.png`
- browserで描画したActivity状態: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe54a-921a-75b0-ab7a-c3743d9c5c49/segmented-controls/activity-range-browser.png`
- 元画像と実装の注目箇所比較: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe54a-921a-75b0-ab7a-c3743d9c5c49/segmented-controls/segmented-control-comparison.png`
- native表示領域: device scale factor 2の1180 x 760 logical pixelで、1180 x 760のcaptureへ標準化
- browser表示領域: device scale factor 1の1280 x 720 CSS pixel
- 状態: Dark appearance、focus ringなし。  
  Unified、Split、Historyをそれぞれ選択した別画面で取得

### 画面全体と注目箇所の比較

元画像と最終Unified controlを、1つの752 x 106の比較画像として並べました。  
以前の元画像では非選択のSplit側が浮き出て見え、選択中のUnified側がoutlineまたはくぼんだ選択肢のように見えます。  
最終controlでは選択中の項目に決定buttonと同じaccent blue、白い前景、control shadowを使用し、非選択項目はくぼんだgroup surface上で背景を透明にしています。  
nativeの画面全体のcaptureから、Changes toolbarと左paneのrepository navigationでもcompactさとalignmentが維持されていることを確認できます。  

この状態差は1180 x 760の画面全体だけでは確実に判断できないため、注目箇所の比較が必要でした。  
このcontrolにはraster、logo、illustrationなど、他に画像assetの再現性を確認すべき要素はありません。  

### Segmented controlで再現性が必要な要素

- fontとtypography: 既存のsystem UI font、label size、weight、line height、icon scaleは変更していません。
- spacingとlayout rhythm: compactな高さとgroupの2 pixel inset、外周の1 pixel border、9 pixel radiusを維持しています。  
  各tabはgap 0で密着させ、group外側の角だけを6 pixel radiusにし、内側の角と仕切り線は設けません。
- colorとtoken: 選択中の項目は`--interactive-selected-surface`と`--interactive-selected-foreground`、非選択項目は`--surface-sunken`上で透明な背景と`--text-secondary`を使います。
- 画像品質とasset: 既存のLucide iconはvectorのまま描画し、変更していません。  
  新しい画像assetも追加していません。
- 文言とcontent: Unified、Split、Changes、History、Current、Incoming、Open、Cloneのlabelは変更していません。

### 操作とconsoleの検証

- native appでsegmented controlを選択し、accent blueのvisual状態とともに`aria-selected`または`aria-pressed`が移動することを確認しました。
- native appでChanges、History、Activity、Settingsを選択し、グレーの選択背景とともに`aria-current`が移動することを確認しました。
- in-app browserでActivityの期間selectを30日から90日へ変更し、Commit分析が選択期間に追従することを確認しました。
- Repository操作のOpenとCloneは同じ共通segmented containerを使っています。  
  OpenしたpathがGit Repositoryでなければ、そのpathに新しいRepositoryを作成します。  
  in-app browserでOpenが選択されていることを確認しました。
- CurrentとIncomingの比較tabは同じ共通styleを継承し、既存のroving-tab操作を維持しています。
- browser consoleのerrorとwarning: なし

### Segmented controlの検出事項

対応が必要なP0、P1、P2の差異は残っていません。  
P3の追加対応も不要です。  

### Segmented controlの比較履歴

- 1回目の検出事項: active stateと視覚的に浮き上がったstateが反対の選択肢に見え、tab状のcontrol間で選択表現が統一されていませんでした。
- 1回目の修正: くぼんだsegmented group、透明な非選択button、浮き上がった選択buttonを共通化しました。  
  既存のsemanticsを維持したまま、同じ目的のsegmented controlへ適用しました。
- 2回目の修正: 選択buttonの背景を決定buttonと同じaccent blueへ変更し、前景とfocus ringを白系へ統一しました。
- 修正後の確認: native E2Eでprimary buttonと各選択stateのcomputed backgroundおよびforegroundが一致することを確認しました。

## 選択highlightの検証

- 視覚的な正: `/Users/ishiguro/Desktop/スクリーンショット 2026-08-09 16.08.26.png`
- 元画像: Retina解像度の140 x 148 pixel。  
  注目領域はlogical sizeで約70 x 74 CSS pixelです。
- native実装: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe4c2-fc9c-7222-ab86-bd3c158a6242/selection-highlight/segmented-changes-unified-1180x760.png`
- 実装画像と表示領域: nativeのdevice scale factor 2から1180 x 760 logical viewportへ標準化した1180 x 760 pixel
- 状態: Dark appearance、Unstagedで1行選択、行にkeyboard focus ringなし

元画像のcropとnative実装を、1つの比較画像として並べて確認しました。  
元画像では、青いinset railが丸みのある選択背景の左端に沿っています。  
修正後の実装では、同じradius、spacing、typographyを維持しながら、選択surfaceをaccent blueへ変更し、文字とiconを白系へ統一してaccent railを削除しました。  
変更対象がその状態表現だけに限られるため、layoutの確認には画面全体のcaptureを使い、選択行を注目箇所として確認しました。  

- fontとtypography: 既存のsystem UI font、weight、size、truncation、階層は変更していません。
- spacingとlayout rhythm: 行の寸法、padding、icon alignment、radius、周囲のgroup spacingは変更していません。
- colorとvisual token: Application操作の選択状態は`--interactive-selected-surface`と白系の前景を使います。  
  Dark appearanceのaccent blueはLightより明度を抑え、白い前景とのcontrastを確保します。  
  上部navigationはグレーの選択背景と通常の前景を維持します。  
  Diff行選択用の`--diff-selection-surface`、未保存の黄色いdot、Repository logoは変更しません。  
  History graphのlane colorは選択状態の前景色に置き換えません。  
  History graphは選択中もlane colorを維持し、lane 0には選択背景でも識別できるvioletの`--history-lane-0`、未コミット区間には低彩度の`--history-working-tree`を使います。  
  Darkのref chipには`--history-ref-foreground`を使います。
- 画像品質とasset: rasterや独自の画像assetは対象外です。  
  既存のvector iconは変更していません。
- 文言とcontent: 変更していません。
- 操作検証: native E2Eで、選択中のchange、History Commit、Activity行、switcher、競合、segmented controlがprimary buttonと同じ背景を使うことを確認しました。  
  titlebar destinationはprimary buttonと異なるグレー背景を使うことを確認しました。  
  選択中の補助文字、状態icon、3点リーダーは白系へ切り替え、keyboard focus ringは白で表示します。  
  Stage／Unstageはfile／group checkboxから行い、file行はdrag sourceにしません。

対応が必要なP0、P1、P2、P3の検出事項は残っていません。  

### 選択highlightの比較履歴

- 1回目の検出事項: 丸みのある選択surfaceの左端に青いinsetがあり、radiusと視覚的に競合していました。
- 1回目の修正: 背景highlightを維持したまま、共通の左端selection railとtitlebar destinationのunderlineを削除しました。
- 2回目の修正: 選択highlightを決定buttonと同じaccent blueへ変更し、選択中の前景とfocus ringを白系へ揃えました。
- 修正後の確認: native E2Eで各選択stateとprimary buttonのcomputed colorを比較し、Diff行選択が別tokenのまま維持されることを確認しました。

最終結果: 合格  

## Repository選択ページの検証

- Empty、Light、1180 x 760: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe628-44a2-78c3-8b9c-332d9fe9360d/repository-selection-redesign/repository-list-empty-light-1180x760.png`
- Empty、Light、860 x 560: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe628-44a2-78c3-8b9c-332d9fe9360d/repository-selection-redesign/repository-list-empty-light-860x560.png`
- 一覧あり、Dark、1180 x 760: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe628-44a2-78c3-8b9c-332d9fe9360d/repository-selection-redesign/repository-list-populated-dark-1180x760.png`
- 一覧あり、Dark、860 x 560: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe628-44a2-78c3-8b9c-332d9fe9360d/repository-selection-redesign/repository-list-populated-dark-860x560.png`
- Add Sheet、Light、860 x 560: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe628-44a2-78c3-8b9c-332d9fe9360d/repository-selection-redesign/add-repository-sheet-light-860x560.png`
- Add Sheet、Dark、1180 x 760: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe628-44a2-78c3-8b9c-332d9fe9360d/repository-selection-redesign/add-repository-sheet-dark-1180x760.png`

最初のページはRepository一覧とAdd Repositoryだけに整理し、Remote／Local、Open／Cloneの選択肢を表示していません。  
各行はRepository名とcanonical local pathを同じ階層で表示し、860 x 560でもpathが画面外へはみ出さないことを確認しました。  
共通SheetはRemote URL入力とFinder選択を1つの入口にまとめ、Light／Darkの両方でfocus、button、backdrop、text contrastを確認しました。  
native E2Eでは主要flow、言語とappearance、Repository初期化、Changes／Historyへの遷移がすべて合格しています。  

対応が必要なP0、P1、P2、P3の検出事項は残っていません。  

最終結果: 合格  

## History graph形状と全幅highlightの検証

- 視覚的な正: `/Users/ishiguro/Desktop/スクリーンショット 2026-08-09 16.09.37.png`
- 元画像: Retina解像度の730 x 1214 pixel。  
  365 x 607 CSS pixelへ標準化
- browserで描画した実装: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe55b-e5f9-70d2-8795-a7c8b4664d5c/stella-history-shape-fix/history-full-1180x760.png`
- 実装の注目箇所crop: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe55b-e5f9-70d2-8795-a7c8b4664d5c/stella-history-shape-fix/history-selected-365x607.png`
- 左右比較: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe55b-e5f9-70d2-8795-a7c8b4664d5c/stella-history-shape-fix/history-reference-comparison.png`（左が参照、右が実装）
- 表示領域: device scale factor 1の1180 x 760 CSS pixel。  
  History paneは365 CSS pixel幅
- 状態: Dark appearance、現在のHEADを選択、Commit refを表示、元画像と同じfixture content

画面全体の実装と元画像のcropを同じ365 x 607のlogical領域へ標準化し、1つの比較画像として並べました。  
node形状と行端の表現はapplication全体の画面では確実に判断できないため、注目箇所の比較が必要でした。  

- fontとtypography: 既存のsystem font、weight、size、line height、truncation、日付formatは変更していません。
- spacingとlayout rhythm: Commit contentのinsetは変更せず、選択行とhover行の背景を`border-radius: 0`で365 pixelのlist全幅へ広げました。
- colorとvisual token: 選択行は`--interactive-selected-surface`と白系の前景、選択中のhoverは`--interactive-selected-hover`を使います。  
  非選択行のhoverは既存の6% text mixを維持します。
- graphのlane 0は青、lane 1以降は紫・橙・緑・桃・青緑を循環させます。
- lane 0のgraphは選択行をまたいでも同じblueを維持し、未コミット区間だけを低彩度のgrayへ切り替えます。
- 画像品質とasset: rasterや生成assetは対象外です。  
  browser上の形状計測では、sampleしたすべてのSVG Commit nodeが8 x 8 CSS pixelで、以前の縦方向の伸びがなくなっています。
- 文言とcontent: 変更していません。
- 操作検証: 別のCommitを選択すると`aria-current`と全幅の選択背景がその行へ移り、非選択行をhoverすると同じく全幅で角の丸くないhighlightが表示されました。
- browser consoleのerrorとwarning: なし

対応が必要なP0、P1、P2、P3の検出事項は残っていません。  

### History形状の比較履歴

- 1回目の検出事項: `preserveAspectRatio="none"`によりCommitのcircleが可変の行高に合わせて伸び、list itemのpaddingと7 pixelのradiusにより選択行とhover行がinset cardのように見えていました。
- 修正: graph座標系を均一なscaleで維持し、固定view boxの外までedge pathを伸ばしてlineの連続性を保ちました。  
  以前の外側spacingは、角の丸くない全幅の行の内側へ移しました。
- 修正後の資料: sampleしたnodeはすべて8 x 8 CSS pixelで、選択行とhover行はいずれも365 pixel幅、listも365 pixel幅、radiusは0 pixelです。
- 2回目の検出事項: branchをまたぐ斜線が直線で折れ、ref表示によって行高が変わると上下の接続が不自然に見えていました。
- 修正: edgeを各行の上端から下端まで描く3次Bezier曲線へ変更し、行のpaddingを含めて隣接行と接続しました。  
  親子接続の上半分と下半分には同じaccent colorを使い、1本の線として連続させます。  
  Commit nodeは伸縮するSVGの外へ分離し、可変行高でも10 x 10 CSS pixelの円を維持します。
- ref表示: Historyは全refを常時表示し、表示切替は設けません。  
  Tag、local branch、remote branchを個別のchipとして表示し、Tagを専用iconとcolorで区別します。
- 操作導線: History上部にはbranch名と共通操作buttonを表示せず、各Commit行の末尾にChangesと同じ3点リーダーを配置します。  
  右クリックと3点リーダーは同じmenuを開き、操作別Dialogで入力した後に影響previewを表示します。  
  menu項目は末尾に省略記号を付けず、Git用語をカタカナの操作表現へ統一します。  
  Commit行のダブルクリックは、そのCommitを指す現在以外のローカルブランチが一意な場合にチェックアウトします。  
  menuとDialogを閉じた場合は対象Commit行へfocusを戻します。
  先頭の未コミットの変更を選択した場合はChangesへ切り替えます。
  各Commitのメタ情報は、左右paneともCommit ID、Author、日時の順に表示します。
- responsive: 1180 x 760と860 x 560で、日時、ref chip、graph、3点リーダーが重ならないことをnative E2Eで確認します。
- 自動検証: Historyの全ref、Tag表示、曲線pathを含むfrontend test、typecheck、lint、frontend 334件、Rust 175件、native E2E 8件が合格しています。

最終結果: 合格  
