<h1 align="center">Stella</h1>

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Stellaのアイコン" width="128" height="128" style="border-radius: 22%;">
</p>

<p align="center">
  AIでコードを書く時代のシンプルなGitクライアント
</p>

> [!WARNING]
> このアプリは現在アルファ版です。
> 将来的に破壊的な変更が入る可能性があります。

## 📦 インストール

```sh
brew install --cask ishiguro-junya/tap/stella
```

## 🌱 はじめる

```sh
mise install
mise run setup
mise run dev
```

## 🧰 コマンド

| コマンド | 内容 |
| --- | --- |
| `mise run setup` | 開発環境をセットアップする。 |
| `mise run dev` | アプリを開発モードで起動する。 |
| `mise run build` | アプリをビルドする。 |
| `mise run install:app` | アプリをビルドしてインストールする。 |
| `mise run lint` | コードをリントチェックする。 |
| `mise run format` | コードをフォーマットする。 |
| `mise run typecheck` | コードの型チェックを実行する。 |
| `mise run test` | ユニットテストを実行する。 |
| `mise run test:e2e` | E2Eテストを実行する。 |

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
├── scripts/                # スクリプト
└── docs/                   # ドキュメント
```

## 📚 ドキュメント

- [仕様](docs/specification.md)
- [アーキテクチャ](docs/architecture.md)
- [デザイン](DESIGN.md)
- [サードパーティーに関する通知](THIRD_PARTY_NOTICES.md)
- [リリース手順](docs/release.md)

## 🔗 参考リンク

- [mise](https://mise.jdx.dev/)
- [Tauri](https://github.com/tauri-apps/tauri)
- [Oxc](https://oxc.rs/)
- [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2)
- [Lychee](https://github.com/lycheeverse/lychee)
- [Lefthook](https://lefthook.dev/)
- [Homebrew](https://brew.sh/ja/)

## ライセンス

[Sustainable Use License 1.0](LICENSE)
