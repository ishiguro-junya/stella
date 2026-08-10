# デザインQA

## 検証資料

- 参照UI: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-commit-left-audit-post.png`
- 最終Changes画面: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-workspace-density-v2/01-changes-default.png`
- Commit展開時: `/Users/ishiguro/.codex/visualizations/2026/08/08/019fdfab-f0b3-7273-b559-a0e4acc24a7d/stella-workspace-density-v2/02-commit-expanded.png`
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
Commit formは常時縦方向の領域を占有せず、初期状態では閉じ、必要な場合にだけその場で展開します。  
Pull、Push、Fetchはiconとlabelを付けて左pane上部に常時表示し、Fetchを最後に配置します。  
Commitはremote actionの直下に固定し、その下でStagedとUnstagedを上下に等分します。  
StagedとUnstagedは常に表示される独立したgroupとして残し、それぞれのfile listを個別にscrollできます。  

## 操作検証

- ChangesとHistoryでは、矢印、Home、End keyに対応したroving-tab keyboard patternを使用しています。
- StagedとUnstagedは折りたたみheaderを使わず、固定見出し、独立scroll、group checkbox、一括操作、drag and drop、keyboard操作を維持しています。
- StagedとUnstagedが空でも件数0のgroupを表示し、有効な内部dropを引き続き受け付けます。
- CommitはRepo単位で初期状態では閉じ、validationまたは非同期処理の失敗で注意が必要な場合に再度開きます。
- 実行時エラーはqueueされたmodal dialogで表示し、詳細から元のGit出力と終了statusを確認できます。
- 想定内のfast-forward divergenceはgenericなエラーDialogではなく、MergeまたはRebaseを選ぶinlineの判断として表示します。
- Dialogのfocus trapはstackを考慮し、IME変換中には閉じません。
- 保存していない競合結果がある場合、破壊的な遷移の前にContinue、Skip、Abortをguardします。

## 注目箇所の比較

最終layoutでは、常時展開されていたCommit formとtitlebarの重複した画面navigationを削除しました。  
compactな左sidebarにnavigation、change group、file row、折りたたんだCommitをまとめています。  
diffは以前の右pane全体の幅を使えるようになりました。  
Commitを展開してもmain diffを隠さずに操作でき、Historyにもactive viewの見出しを重複表示しません。  

## 再現性が必要な要素

- 階層: repository contextはtitlebarに置き、画面navigationとchange操作は左paneに置きます。
- 密度: 通常状態ではchange group、file、選択中のpath、diffだけを表示します。
- 操作性: Commitの開閉chevronは、閉じた状態では右、開いた状態では下を一貫して示します。  
  StagedとUnstagedは固定見出しです。
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
また、最終利用時刻のlabelとshortcut記号は表示せず、Changes／Historyは既存のsegmented designを維持します。  

- Repository検索の対象はname、path、branchです。  
  開いているrepositoryは現在の順序を維持し、重複を除いた登録pathをMRU順で後ろに並べます。
- Branch検索の対象はlocal branch名です。  
  変更中または処理中のrepositoryでは他のbranchを無効にして理由をDialog内に表示し、現在のbranchは選択可能なままにします。
- 矢印、Home、End、Enter、Escape、Tabのfocus trap、triggerへのfocus復元をcomponent testで確認しました。
- native footerの「Add Repository…」から、Remote URL入力とFinderのLocal選択を同じSheetで開始できます。  
  非表示のCommand-Shift-OでもRepository Dialogを開けますが、shortcutは画面上に表示しません。
- Repository DialogとBranch Dialogは、1180 x 760および最小sizeの860 x 560で全体を表示できます。  
  長いpathは行内で省略し、footerのlabelは欠けません。
- 対応が必要なvisual上のP0、P1、P2、P3の検出事項は残っていません。

## Activity画面の検証

選択した案3の参照画像と最終nativeの1180 x 760 Activity画面を、1つの比較画像として並べて確認しました。  
実際のrepository dataを使用しながら、同じcompactなheader、4つのmetricを並べた領域、2:1の操作一覧とchartの分割、選択中の操作行、詳細領域、期間control、Darkのsemantic paletteを維持しています。  

- ActivityとSettingsは隣接した独立画面で、Activityを先に配置し、Workspace Log drawerは設けていません。
- 全体の操作tableにはStatus、Action、Summary、Timestamp、Durationを表示し、行全体をpointerとkeyboardで選択できます。
- 現在のsessionの操作にはcommand、終了code、stdout、stderrを表示します。  
  復元した30日間の項目はsummaryだけを表示します。
- 選択したrepositoryについて、7日、30日、90日、180日、1年のCommit分析、contributor数、local branch数、empty、loading、error、truncatedの各状態、accessibilityに配慮したchart data tableを表示します。
  期間はCommitアクティビティ見出し右端のselectで切り替え、90日は週単位、180日と1年は月単位で集約します。
- nativeの860 x 560 captureでも2 columnの分割を維持します。  
  操作一覧と詳細領域は内部でscrollし、chartの位置を動かしません。
- LightとDarkの明示指定、macOSのliveなSystem appearance、semantic AX table構造、increased-contrast用のborder tokenを確認しました。
- Activity画面とRecharts chartを別々のlazy chunkとして読み込み、workspace bundleではRechartsを先読みしません。

## 比較履歴

- 1回目: ChangesとHistoryを左pane上部へ移動し、Commitを初期状態で閉じたdisclosureにしました。
- 2回目: checkboxやdragのworkflowを削除せず、StagedとUnstagedを分離しました。
- 3回目: 重複したCommitとHistoryの見出しを削除し、disclosureの規則を揃え、compactなHistory gridを緩和しました。
- 4回目: 実行時エラーを共通modal queueへ移し、重複または想定内のエラーDialogを削除しました。
- 5回目: 保存していない競合状態からの遷移をguardし、native WebKitのprotected modeにおけるdrag処理を修正しました。
- 6回目: Workspace Logを独立したActivity画面とCommit分析へ置き換えました。
- 7回目: 操作行にあったWebKitのwindow全体を覆うhover overlayを削除し、keyboard focus可能なtable semanticsにしました。
- 8回目: System appearanceをmacOS color-scheme media queryで明示的に解決するようにしました。
- 9回目: repository tabを独立したRepository／Branch controlに置き換え、承認済みの参照画像に対して両方のswitcher Dialogを検証しました。
- 10回目: 件数が0でもStagedとUnstagedを表示し、折りたたみcontrolを削除しました。

## 検証checklist

- [x] 参照画像と最終native Changes画面を並べて比較する。
- [x] nativeのChanges、History、Commit、エラーDialogの状態を確認する。
- [x] Frontend、Rust、設定、文書、Commitに関する全品質gateを実行する。
- [x] checkboxおよびdragによるStageを含む、4つのembedded WebKit workflowを実行する。
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
最終controlでは視覚的な階層を逆転させ、選択中の項目に浮き上がったsurface、primary text、control shadowを使用し、非選択項目はくぼんだgroup surface上で背景を透明にしています。  
nativeの画面全体のcaptureから、Changes toolbarと左paneのrepository navigationでもcompactさとalignmentが維持されていることを確認できます。  

この状態差は1180 x 760の画面全体だけでは確実に判断できないため、注目箇所の比較が必要でした。  
このcontrolにはraster、logo、illustrationなど、他に画像assetの再現性を確認すべき要素はありません。  

### Segmented controlで再現性が必要な要素

- fontとtypography: 既存のsystem UI font、label size、weight、line height、icon scaleは変更していません。
- spacingとlayout rhythm: compactな高さを維持したまま、groupに2 pixelのinset、外側に9 pixelのradius、segmentに6 pixelのradiusを追加しました。
- colorとtoken: 選択中の項目は`--surface-raised`と`--text-primary`、非選択項目は`--surface-sunken`上で透明な背景と`--text-secondary`を使います。
- 画像品質とasset: 既存のLucide iconはvectorのまま描画し、変更していません。  
  新しい画像assetも追加していません。
- 文言とcontent: Unified、Split、Changes、History、Current、Incoming、Open、Cloneのlabelは変更していません。

### 操作とconsoleの検証

- native appでUnifiedとSplitを選択し、浮き上がったvisual状態とともに`aria-pressed`が移動することを確認しました。
- native appでChangesとHistoryを選択し、同じ浮き上がったvisual状態とともに`aria-selected`が移動することを確認しました。
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
- 修正: くぼんだsegmented group、透明な非選択button、浮き上がった選択buttonを共通化しました。  
  既存のsemanticsを維持したまま、repository tabとActivityの期間controlへ適用しました。
- 修正後の資料: nativeの両diff layout状態、native History状態、browser Activity状態、元画像との注目箇所比較のいずれでも、実際の選択値に浮き上がったsurfaceが追従しています。

## 選択highlightの検証

- 視覚的な正: `/Users/ishiguro/Desktop/スクリーンショット 2026-08-09 16.08.26.png`
- 元画像: Retina解像度の140 x 148 pixel。  
  注目領域はlogical sizeで約70 x 74 CSS pixelです。
- native実装: `/Users/ishiguro/.codex/visualizations/2026/08/09/019fe4c2-fc9c-7222-ab86-bd3c158a6242/selection-highlight/segmented-changes-unified-1180x760.png`
- 実装画像と表示領域: nativeのdevice scale factor 2から1180 x 760 logical viewportへ標準化した1180 x 760 pixel
- 状態: Dark appearance、Unstagedで1行選択、行にkeyboard focus ringなし

元画像のcropとnative実装を、1つの比較画像として並べて確認しました。  
元画像では、青いinset railが丸みのある選択背景の左端に沿っています。  
修正後の実装では、同じradius、spacing、typography、icon、status color、muted blueの選択surfaceを維持しながら、accent railを削除しました。  
変更対象がその状態表現だけに限られるため、layoutの確認には画面全体のcaptureを使い、選択行を注目箇所として確認しました。  

- fontとtypography: 既存のsystem UI font、weight、size、truncation、階層は変更していません。
- spacingとlayout rhythm: 行の寸法、padding、icon alignment、radius、周囲のgroup spacingは変更していません。
- colorとvisual token: 選択状態では引き続き`--selection-muted`を使い、選択中のchange、Commit、Activity、競合、titlebar destinationから装飾用の`--accent` inset shadowを削除しました。
- 画像品質とasset: rasterや独自の画像assetは対象外です。  
  既存のvector iconは変更していません。
- 文言とcontent: 変更していません。
- 操作検証: native E2Eで、選択中のchange行、選択中のHistory Commit、activeなActivity destinationのcomputed `box-shadow: none`を確認しました。  
  残りの競合とActivity行の選択状態には共通CSSが適用されます。  
  keyboard focus ringとdrag target borderは操作feedbackとして維持しています。

対応が必要なP0、P1、P2、P3の検出事項は残っていません。  

### 選択highlightの比較履歴

- 1回目の検出事項: 丸みのある選択surfaceの左端に青いinsetがあり、radiusと視覚的に競合していました。
- 修正: 背景highlightを維持したまま、共通の左端selection railとtitlebar destinationのunderlineを削除しました。
- 修正後の資料: native Changes captureでは、選択中のREADME行が途切れのない1つの丸いsurfaceとして表示されています。  
  E2Eのcomputed style assertionから、他の共通選択状態でもshadowが表示されないことを確認できます。

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
- colorとvisual token: 選択行は引き続き`--selection-muted`、hoverは既存の6% text mixを使います。
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
- toolbarと日時: 操作buttonは現在のbranch名と同じtoolbarの右端に配置します。  
  各Commitは日付に加えて時刻も表示します。
- 自動検証: Historyの全ref、Tag表示、曲線pathを含むfrontend test、typecheck、lint、frontend 283件、Rust 142件のtestが合格しています。

最終結果: 合格  
