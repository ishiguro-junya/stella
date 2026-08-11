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
