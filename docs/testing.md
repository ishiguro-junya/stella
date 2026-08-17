# テスト

このドキュメントは、変更内容に応じて実行するテストと、再現可能な検証手順を定義します。  
画面の見た目は[デザイン](../DESIGN.md)、利用者から見える動作は[仕様](specification.md)、内部構造は[アーキテクチャ](architecture.md)を参照してください。  

## 基本方針

テストは、開発者やAIエージェントによる変更で、意図しない破壊や仕様からの逸脱を防ぐガードレールです。  
まず変更箇所に近いテストを実行し、完了前にその変更を含む範囲まで検証を広げます。  
ドキュメントを変更した場合も`mise run lint`を実行し、Markdownの書式、文章、リンクを確認します。  
フレーキーなテストには、分かっている再現条件と修正方針をコードコメントで残します。  

GitHub Actionsの実行コストを抑えるため、テスト用のCIワークフローは追加しません。  
代わりにLefthookのプッシュ前フックで`mise run lint`と`mise run test`を実行し、単体テスト、統合テスト、E2Eテストをローカルで確認します。  
配布物固有の検証は[リリース手順](release.md)に従います。  

## 変更内容に合う最小の検証から始める

| 変更内容 | コマンド | 確認対象 |
| --- | --- | --- |
| ReactまたはRustのロジック | `mise run test:unit` | ReactとRustの単体テスト |
| `Workspace`を介したGit操作 | `mise run test:integration` | 一時リポジトリを使うRustの統合テスト |
| TypeScriptの型 | `mise run typecheck` | TypeScript全体の型整合性 |
| コード、設定、ドキュメント | `mise run lint` | 書式、静的解析、未使用コードと依存関係、設定、Markdown、文章、リンク |
| ネイティブ画面とGit操作 | `mise run test:e2e` | Tauriアプリを使ったE2Eテスト |
| 全てのテスト | `mise run test` | 単体テスト、統合テスト、E2Eテスト |
| READMEの画面画像 | `mise run screenshot` | `screenshots`に置くREADME用画像 |

## 各テスト層の責務

### Reactの単体テスト

VitestとTesting Libraryを使い、状態遷移、表示条件、キーボード操作、ARIA属性、永続化の境界を確認します。  
見た目の細部を文字列化したスナップショットへ固定せず、利用者が認識または操作する状態を検証します。  

### Rustの単体・統合テスト

Rustの単体テストでは、Git出力の解析、入力検証、安全判定、ファイル操作を確認します。  
統合テストでは一時リポジトリとローカルのベアリモートを使い、`Workspace`の公開境界からGit操作を確認します。  
`Workspace`の統合テストは`workspace::tests`モジュールに置き、`mise run test:integration`で実行します。  

### ネイティブE2Eテスト

`mise run test:e2e`はE2E機能を有効にしたネイティブ実行ファイルをビルドし、WebdriverIOの組み込みプロバイダーで操作します。  
実リポジトリや外部ネットワークは使いません。  
開発用の隔離されたリポジトリだけを操作します。  
画面移動、主要なGit操作、ダイアログ、キーボード操作、永続化がフロントエンドからRustとGitまで正しく動くことを確認します。  

開発アプリはViteの`1420`番ポート、HMRの`1421`番ポート、`target/debug/Stella (DEV)`を使います。  
E2Eは組み込みWebDriverの`4445`番ポートと`target/release/Stella (TEST)`を使い、Viteの開発サーバーを起動しません。  
バンドルIDも`com.emuni.stella.dev`と`com.emuni.stella.e2e`に分かれているため、開発アプリを起動したままE2Eを実行できます。  

機能または画面単位では`--spec`、個別テストまたはダイアログ単位では`--mochaOpts.grep`を使います。  

```sh
mise run test:e2e -- --spec app/test/e2e/history.spec.ts
mise run test:e2e -- \
  --spec app/test/e2e/diff.spec.ts \
  --mochaOpts.grep 'opens the Pull dialog'
```

指定した画面で停止する場合は、名前付き停止点を指定して標準入出力を端末へ接続します。  
停止中はWebdriverIOの対話操作を利用でき、`.exit`でテストを再開します。  
利用できる停止点名は`rg "debugAt\\(" app/test/e2e`で確認できます。  

```sh
STELLA_E2E_BREAKPOINT=pull-dialog \
  mise run --raw test:e2e -- \
  --spec app/test/e2e/diff.spec.ts \
  --mochaOpts.grep 'opens the Pull dialog'
```

## 視覚変更は実画面で比較する

視覚変更は単体テストだけで完了としません。  
ネイティブ画面を次の順序で確認します。  

1. 対象の画面、言語、外観、リポジトリ状態を固定します。
2. 通常サイズの1180×760と最小サイズの860×560で表示します。
3. 配色に関わる変更は、ライトとダークの両方を確認します。
4. 画面全体で情報階層、欠け、重なり、横スクロールを確認します。
5. 必要な場合だけ対象部分を拡大し、余白、位置、色、状態の差を確認します。
6. ポインターとキーボードで操作し、見た目とARIA属性が同じ状態を示すことを確認します。
7. アプリに由来するコンソールエラーがないことを確認します。

リポジトリ一覧ページを変更した場合は、上余白、表示件数、10行目の完全表示、11件目以降へのスクロール、行全体のホバーと選択、文字の欠けを確認します。  
画面全体から判断できる場合は、拡大画像や比較画像を追加しません。  
ピクセル差だけで判断せず、用途別トークン、ブラウザーが算出したスタイル、要素の位置関係も確認します。  

README画像はテスト名で1画面だけ生成できます。  
追加の視覚確認は`visual-qa.spec.ts`から対象を選び、README参照画像以外はGit管理外の`screenshots/`へ保存します。  

```sh
mise run screenshot -- --mochaOpts.grep '履歴を撮影する'
mise run screenshot -- \
  --spec app/test/e2e/visual-qa.spec.ts \
  --mochaOpts.grep 'リポジトリ追加ダイアログ'
```

## 検証用データと画像を製品データから分離する

- E2Eと視覚検証では、テストが作成したリポジトリとローカルのベアリモートだけを使います。
- スクリーンショットは画面遷移に沿って`screenshots/changes`、`history`、`activity`、`settings`、`repositories`、`branches`へ分けます。
- READMEへ掲載する5画像だけをGit管理し、それ以外のスクリーンショット、切り出し画像、比較画像はGit管理外とします。
- ローカルの絶対パス、テスト件数、実行日時、過去の合格結果はドキュメントへ記録しません。
- 個別の実行結果は、コミットまたはプルリクエストの説明へ残します。
