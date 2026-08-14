# Design QA

## 比較対象

- Source visual truth:
  - `/Users/ishiguro/Desktop/スクリーンショット 2026-08-11 7.47.27.png`
  - `/Users/ishiguro/Desktop/スクリーンショット 2026-08-11 7.47.58.png`
- Implementation screenshot: `/Users/ishiguro/project/stella/.tmp/visual-qa/implementation-final.png`
- Viewport: `1280 x 720 CSS px`
- Implementation image: `1280 x 720 px`
- Device pixel ratio: `2`
- State: Dark、Historyのコミット詳細、複数ファイルUnified Diff

SourceはDiffとコミット説明の注目領域を切り出した画像、Implementationは同じ内容を実コンポーネントで描画した画面です。  
全画面の単純なpixel overlayではなく、同じDark themeと同じ複数ファイルDiff状態に揃え、注目領域の整列とtoken適用をCSS座標とcomputed colorでも確認しました。  

## Full-view comparison

- コミット説明からDiffへの情報階層は維持されています。
- ファイルヘッダー、変更種別icon、増減数、変更行の色分けはすべて表示されています。
- Diffの横overflowやファイルヘッダーの欠けはありません。

## Focused-region comparison

- ファイル名の開始位置は`56px`、コード本文の開始位置は`56.61px`で、差は`0.61px`です。
- ファイルヘッダーの高さは`32px`です。
- ファイルヘッダーとコミット説明の背景は、どちらも`rgb(29, 30, 34)`です。
- ファイルヘッダーには`rgb(41, 42, 48)`の境界線が入り、コード行との区切りが明確です。

## Required fidelity surfaces

- Fonts and typography: Stella既存のUI fontとDiffのmonospace fontを維持しています。  
  ファイル名のweightやtruncateの挙動は変更していません。
- Spacing and layout rhythm: ファイル名をコード本文の基準線へ揃え、32pxのheader高で複数ファイル間のrhythmを統一しています。
- Colors and visual tokens: ファイルヘッダーはコミット説明と同じ`--surface-raised`、境界線は`--border-subtle`を使っています。
- Image quality and asset fidelity: 新しい画像assetはありません。  
  `@pierre/diffs`の既存iconをそのまま使い、代替assetは追加していません。
- Copy and content: Sourceと同じコミット説明、ファイル名、変更内容で確認しました。

## Comparison history

1. Initial pass
   - Finding: `padding-inline-start: 24px`ではファイル名がコード本文より`8.61px`左にずれていました。
   - Severity: P2
   - Fix: `padding-inline-start`を`32px`へ変更しました。
2. Final pass
   - Post-fix evidence: ファイル名とコード本文の開始位置の差は`0.61px`です。
   - Post-fix evidence: ファイルヘッダーとコミット説明の背景色が一致しています。
   - Console errors: なし。

## Findings

ActionableなP0、P1、P2は残っていません。  

## Follow-up polish

残っているP3はありません。  

final result: passed  

---

## 設定画面の5カテゴリ化

### 設定画面の比較対象

- Source visual truth: `/Users/ishiguro/.codex/generated_images/019fff5a-a7aa-7231-9126-30ee5cd6c13f/exec-d24091d7-f5e9-4397-a739-772d2f4173c5.png`
- Implementation screenshot: `/Users/ishiguro/project/stella/.tmp/settings-design-qa/settings.png`
- Minimum-size screenshot: `/Users/ishiguro/project/stella/.tmp/settings-design-qa/settings-860x560.png`
- Comparison board: `/Users/ishiguro/project/stella/.tmp/settings-design-qa/settings-comparison.png`
- Viewport: `1180 x 760 CSS px`および`860 x 560 CSS px`
- Source image: `1562 x 1007 px`を中央の内容を変えずに`1180 x 760 px`へ正規化しました。
- Implementation image: device pixel ratio 2でcapture後、`1180 x 760 px`および`860 x 560 px`へ正規化しました。
- State: 日本語、Dark、Gitカテゴリを選択、内蔵Gitツールチェーンを表示

### 設定画面のFull-view comparison

- 左側に設定見出しとカテゴリ一覧、右側に選択カテゴリの詳細を置く構成は、参照画像と同じです。
- 計画どおりカテゴリ一覧を幅200pxに固定し、詳細paneだけを縦方向へスクロールできます。
- 参照画像の4カテゴリを今回の分類に合わせて5カテゴリへ増やし、フォント設定を外観へまとめました。
- リポジトリの保存先とGitツールチェーンの操作欄は、説明の下で詳細paneの横幅を使用しています。

### 設定画面のFocused-region comparison

- 選択中のGitカテゴリは既存の中立色tokenを使い、`aria-current="page"`と見た目を一致させました。
- 見出し、説明、入力欄、区切り線の順序と左右の開始位置は、参照画像の情報階層に合わせています。
- Gitツールチェーンは既存仕様のGit、Git LFS、Git Flowを維持し、参照画像だけにある設定項目やcomponentは追加していません。
- `860 x 560`でも左側の幅を維持し、横スクロールや入力欄の欠けはありません。  
  縦に収まらないcomponent情報は詳細pane内でスクロールできます。

### 設定画面のRequired fidelity surfaces

- Fonts and typography: 既存の画面用フォント、文字サイズ、見出しweight、code fontを維持しています。
- Spacing and layout rhythm: 左側は200px、詳細paneの左右余白は24px以上、通常行の説明とselectの間隔は28pxです。
- Colors and visual tokens: 背景、border、選択状態、文字色は既存のsemantic tokenだけを使用しています。
- Image quality and asset fidelity: 新しい画像assetはなく、既存のLucide iconを使用しています。
- Copy and content: 日本語と英語のカテゴリ名を追加し、既存15項目の文言と保存内容は変更していません。

### 設定画面のComparison history

1. Initial implementation
   - 既存の1列表示では設定項目が同じpaneに連続し、path入力に使える横幅も680pxのpanel内に限られていました。
2. Five-category implementation
   - 一般、外観、変更、エディタ、Gitの5カテゴリへ再分類し、左側のカテゴリ一覧と右側の詳細paneへ分けました。
   - Gitの2項目は操作欄を説明の下へ移し、詳細paneの横幅を使う配置へ変更しました。
3. Native comparison and polish
   - 参照画像とImplementationを同じcomparison boardで確認し、カテゴリの選択状態、詳細paneの開始位置、入力欄の幅、区切り線を確認しました。
   - `1180 x 760`と`860 x 560`のnative captureで、横スクロールと表示切れがないことを確認しました。

### 設定画面のFindings

ActionableなP0、P1、P2、P3は残っていません。  

### 設定画面のInteraction and regression checks

- 単体testで初期表示、5カテゴリの切り替え、選択状態、全15項目の所属を確認しました。
- Native E2Eで言語、外観、フォント、変更、エディタ、Gitの設定変更と保存を確認しました。
- Native E2Eは4件、README画像のcaptureは1件が通過しました。
- Application由来のconsole errorはありませんでした。

### 設定画面のFollow-up polish

残っているP3はありません。  

final result: passed  

---

## History graphの角張った分岐線

### History graphの比較対象

- Source visual truth: `/Users/ishiguro/Desktop/スクリーンショット 2026-08-14 12.45.31.png`
- Implementation render: `/Users/ishiguro/project/stella/.tmp/design-qa/history-graph-angular-implementation.svg.png`
- Comparison board: `/Users/ishiguro/project/stella/.tmp/design-qa/history-graph-angular-comparison.png`
- Focused region: `138 x 232 px`、Dark、2 lane間の分岐

### History graphのFocused-region comparison

- Bezier曲線を、本線のnodeから右斜めへ分岐して縦に伸びる折れ線へ変更しました。
- 既存のlane間隔、行高、node位置を維持し、分岐線の形状だけを変更しました。
- 参照画像とImplementationを同じcomparison boardで開き、丸い曲線が残っていないことを確認しました。

### History graphのRequired fidelity surfaces

- Fonts and typography: 変更していません。
- Spacing and layout rhythm: lane間隔、行高、node位置を変更していません。
- Colors and visual tokens: 既存のlane color tokenを維持しています。
- Image quality and asset fidelity: Productionへ画像assetは追加していません。
- Copy and content: 変更していません。

### History graphのComparison history

1. Initial source finding
   - Severity: P2
   - Finding: laneをまたぐ接続線がBezier曲線で、参照画像より滑らかに見えていました。
2. Final implementation pass
   - Fix: 50-50をmerge commitとし、第一子のbranchへ右斜めに出てから縦へ伸びる実際のGit履歴へ変更しました。
   - Post-fix evidence: Unit testで折れ位置を含むpath全体を確認し、E2E testにも同じ検査を追加しました。
   - Post-fix evidence: Comparison boardで角張った接続形状を確認しました。

### History graphのFindings

ActionableなP0、P1、P2は残っていません。  

final result: passed  

---

## 密着型tabの共通デザイン

### 密着型tabの比較対象

- Source visual truth:
  - `/Users/ishiguro/Desktop/スクリーンショット 2026-08-12 18.10.01.png`
  - `/Users/ishiguro/Desktop/スクリーンショット 2026-08-12 18.11.03.png`
- Implementation screenshots:
  - `/Users/ishiguro/project/stella/.tmp/tab-qa/segmented-changes-unified-1180x760.png`
  - `/Users/ishiguro/project/stella/.tmp/tab-qa/add-repository-sheet-dark-1180x760.png`
  - `/Users/ishiguro/project/stella/.tmp/tab-qa/add-repository-sheet-light-1180x760.png`
- Focused implementation crop: `/Users/ishiguro/project/stella/.tmp/tab-qa/file-tabs-attached-light.png`
- Comparison board: `/Users/ishiguro/project/stella/.tmp/tab-qa/attached-tabs-comparison.png`
- Viewport: `1180 x 760 CSS px`
- Source images: `160 x 108 px`と`474 x 207 px`。  
  元のCSS寸法とdensityは不明です。
- Implementation image: device pixel ratio 2でcapture後、`1180 x 760 px`へ正規化しました。
- State: Light／Dark、表示tabを選択したChanges、URL tabを選択したRepository追加Dialog

### 密着型tabのFull-view comparison

- Changesのfile headerとRepository追加Dialogのtab groupを実画面で確認しました。
- tab以外のheader高、Dialog幅、余白、icon、選択色には変更がありません。
- Light／Darkとも既存の外周borderとgroup背景が維持されています。

### 密着型tabのFocused-region comparison

- 提供画像と実装cropを1枚のcomparison boardへ並べ、隣接するtabの境界に隙間がないことを確認しました。
- containerの`gap`は`0px`で、隣接tabのbounding boxは誤差`0.5px`以内で接しています。
- 先頭tabの右側radiusと末尾tabの左側radiusは`0px`、group外側のradiusは`6px`です。
- tab自身のborderは透明で、tab間の仕切り線はありません。
- containerの外周borderは既存どおり`1px`です。

### 密着型tabのRequired fidelity surfaces

- Fonts and typography: 既存のsystem UI font、label size、weight、icon sizeを変更していません。
- Spacing and layout rhythm: groupの2px inset、外周1px border、9px radiusを維持し、tab同士だけをgap 0で密着させました。
- Colors and visual tokens: 選択中の`--interactive-selected-surface`、未選択の透明背景、groupの`--surface-sunken`を維持しています。
- Image quality and asset fidelity: 新しい画像assetはありません。  
  表示／編集は既存のLucide iconを維持しています。
- Copy and content: 表示／編集、URL／Path、Current／Incomingの文言とアクセシブル名を変更していません。

### 密着型tabのComparison history

1. Initial source finding
   - Severity: P2
   - Finding: 各tabが四隅にradiusを持つため、gap 0でも独立したbuttonのように離れて見えていました。
2. Final implementation pass
   - Fix: group外側の角だけradiusを残し、隣接側の角を0へ変更しました。
   - Fix: 外周borderと2px insetを維持し、tab間のborderは透明のままにしました。
   - Post-fix evidence: 表示／編集、Repository追加方法、Conflict比較の3種類をnative E2Eで測定し、同じ密着条件を満たすことを確認しました。
   - Post-fix evidence: SourceとImplementationを同じcomparison boardで開き、密着した形と仕切り線がないことを確認しました。

### 密着型tabのFindings

ActionableなP0、P1、P2は残っていません。  

### Interaction and regression checks

- 表示／編集tabの切り替えとConflict比較tabの選択を含むChanges Native E2Eは8件すべて通過しました。
- Repository追加方法の切り替えを含むRepository Native E2Eは1件通過しました。
- Visual QA Native E2Eは1件通過し、Application由来のconsole errorはありませんでした。

### 密着型tabのFollow-up polish

残っているP3はありません。  

final result: passed  

---

## History graphとBranch refのLight／Dark配色

### History配色の比較対象

- Source visual truth:
  - `/Users/ishiguro/Desktop/スクリーンショット 2026-08-12 17.13.59.png`
  - `/Users/ishiguro/Desktop/スクリーンショット 2026-08-12 17.14.04.png`
- Implementation screenshots:
  - `/Users/ishiguro/project/stella/.tmp/history-color-qa/history-graph-and-branch-dark-1180x760.png`
  - `/Users/ishiguro/project/stella/.tmp/history-color-qa/history-graph-and-branch-light-1180x760.png`
- Comparison board: `/Users/ishiguro/project/stella/.tmp/history-color-qa/history-color-comparison.png`
- Viewport: `1180 x 760 CSS px`
- Source image: `966 x 270 px`と`494 x 122 px`の提供済みcrop。
  元のCSS寸法とdensityは不明のため、pixel単位のlayout一致には使用していません。
- Implementation image: device pixel ratio 2でcapture後、`1180 x 760 px`へ正規化しました。
- State: Light／Dark、未コミット変更あり、最新Commitを選択、Branch ref表示

### History配色のFull-view comparison

- 選択中のCommit行、未選択の次Commit、先頭の未コミット変更を同じ画面に表示し、接続線の連続性を確認しました。
- Commit laneは選択行の前後とも同じvioletで続き、選択境界だけで色が変わる状態はありません。
- 未コミット区間だけは低彩度のgrayで表示され、最新Commitのnodeから下に続くCommit laneと区別できます。
- 右paneのBranch refはDarkのmuted blue背景上でも視認できます。

### History配色のFocused-region comparison

- DarkではCommit lane全体がvivid violetの`rgb(182, 109, 226)`、Lightではsaturated violetの`rgb(123, 44, 191)`で続くことを確認しました。
- 未コミット区間の線とnodeはDarkで`rgb(119, 120, 129)`、Lightで`rgb(115, 115, 123)`となり、Commit laneとは色相と明度を分けています。
- Light／Darkとも中間明度と高い彩度を使い、通常背景、選択背景、未コミットのgrayに対してvioletの色相が残ることを確認しました。
- Comparison board下段で、Branch refの前景`#64b1ff`と背景`#173652`が`5.50:1`のcontrastを持つことを確認しました。

### History配色のRequired fidelity surfaces

- Fonts and typography: Branch refは左右paneとも12px、iconは11pxに揃え、既存のsystem UI font、weight、line height、truncateを維持しています。
- Spacing and layout rhythm: Historyの行高、graph位置、node寸法、detail headerの配置は変更していません。
- Colors and visual tokens: lane 0は`--history-lane-0`、未コミット区間は`--history-working-tree`、Branch refは`--history-ref-foreground`へ役割を分離しました。
- Image quality and asset fidelity: 新しい画像assetはありません。
  既存のSVG graphとLucide iconを維持しています。
- Copy and content: E2E fixtureのCommit文言以外は構造と情報量を維持しています。
  配色確認に影響する文言変更はありません。

### History配色のComparison history

1. Initial source finding
   - Severity: P2
   - Finding: lane 0と選択背景が同じAccent Blueで、選択中のCommit区間の線が見えませんでした。
   - Finding: DarkのBranch refは前景と背景が近く、Branch名が読みづらい状態でした。
2. First implementation pass
   - Fix: 選択中のCommit区間だけ線とnodeを白へ切り替え、Branch refを明るくしました。
   - Remaining P2: 1本のCommit laneが選択境界だけで変色し、未コミット区間とも区別しづらくなりました。
3. Final implementation pass
   - Fix: 選択行だけのgraph上書きを削除し、lane 0全体を選択背景でも見える色へ変更しました。
   - Fix: 未コミット区間を専用の低彩度grayへ分離しました。
   - Fix: Branch refの文字を左右paneとも12px、iconを11pxへ拡大しました。
   - Post-fix evidence: Native E2Eで選択中と次のCommitの線・nodeが同じ色であることと、未コミット線との区別を確認しました。
   - Post-fix evidence: 左右paneのBranch refがcomputed styleでともに12pxであることを確認しました。
   - Post-fix evidence: SourceとImplementationを同じcomparison boardで開き、線の連続性、未コミット境界、Branch refの視認性を確認しました。
4. Light／Dark color polish
   - Finding: 青系のlane 0はLight／Darkとも選択状態のAccent Blueと色相が近く、独立したCommit laneとして見えづらい状態でした。
   - Fix: lane 0をLightではdeep violet、Darkではlavenderへ変更し、未コミットのgrayと色相でも区別しました。
   - Post-fix evidence: Native E2Eと両appearanceのスクリーンショットで、選択行の前後に同色の線が続くことを確認しました。
5. Violet tone polish
   - Finding: Lightのdeep violetは黒に、Darkのlavenderは白に近く見え、violetとして中途半端でした。
   - Fix: 両appearanceとも中間明度かつ高彩度のvioletへ寄せ、LightとDarkの明度差を縮めました。
   - Post-fix evidence: Native E2Eと両appearanceのスクリーンショットで、紫の色相が明確に見えることを確認しました。

### History配色のFindings

ActionableなP0、P1、P2は残っていません。  

### History配色のInteraction and regression checks

- Native E2EでHistoryのCommit選択、detail表示、Branch ref、未コミット項目、検索、Diff表示を確認しました。
- History Native E2Eは3件すべて通過しました。
- Application由来のconsole errorはありませんでした。

### History配色のFollow-up polish

残っているP3はありません。  

final result: passed  
