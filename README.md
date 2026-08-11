<h1 align="center">Stella</h1>

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Stellaのアイコン" width="128" height="128" style="border-radius: 22%;">
</p>

<p align="center">
  AIがコードを書く時代の<br>
  差分を見るためのシンプルなGitクライアント
</p>

> [!WARNING]
> このアプリは現在アルファ版です。
> 将来的に破壊的な変更が入る可能性があります。

## 📁 ディレクトリ構成

```text
.
├── src/                    # 画面と操作を実装するReact / TypeScriptコード
│   ├── adapters/           # Tauriとの通信
│   ├── domain/             # Gitの型とルール
│   ├── features/           # 機能ごとの画面と操作
│   ├── i18n/               # 多言語の制御
│   ├── persistence/        # アプリ設定の保存
│   ├── test/               # ユニットテスト
│   ├── theme/              # 外観テーマの制御
│   └── ui/                 # 共通UIコンポーネント
├── src-tauri/              # Git操作とTauriの設定
├── tests/                  # E2Eテストのコード
├── scripts/                # 検証用のスクリプト
└── docs/                   # ドキュメント
```

## 🌱 はじめる

```sh
mise install
mise run setup
mise run dev
```

## 🧰 コマンド

| Command | 内容 |
| --- | --- |
| `mise run setup` | 開発環境をセットアップする。 |
| `mise run dev` | アプリを開発モードで起動する。 |
| `mise run build` | アプリをビルドする。 |
| `mise run lint` | TypeScript、Rust、Markdownのコードをリントチェックする。 |
| `mise run format` | TypeScript、Rustのコードをフォーマットする。 |
| `mise run typecheck` | 型チェックを実行する。 |
| `mise run test` | ユニットテストを実行する。 |
| `mise run test:e2e` | E2Eテストを実行する。 |

## 📚 ドキュメント

- [仕様](docs/specification.md) — 対応環境、表示言語、リポジトリ表示、対象範囲
- [アーキテクチャ](docs/architecture.md) — モジュール境界、Git操作、安全方針、品質ゲート
- [デザインQA](DESIGN.md) — UI比較、操作確認、検証結果
- [サードパーティーに関する通知](THIRD_PARTY_NOTICES.md) — 利用ライブラリの著作権とライセンス

## 🔗 参考リンク

- [mise](https://mise.jdx.dev/)
- [Tauri](https://github.com/tauri-apps/tauri)
- [Oxc](https://oxc.rs/)
- [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2)
- [Lychee](https://github.com/lycheeverse/lychee)
- [Lefthook](https://lefthook.dev/)

## ライセンス

[Sustainable Use License 1.0](LICENSE)
