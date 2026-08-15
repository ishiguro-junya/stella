<h1 align="center">Stella</h1>

<p align="center">
  <img src="logo.png" alt="Stellaのアイコン" width="128" height="128">
</p>

<p align="center">
  人よりAIがコードを書く時代のシンプルなGitクライアント<br>
  Gitクライアントをほぼレビューでしか使わない人向け
</p>

> [!WARNING]
> このアプリは現在α版です。  
> 将来的に破壊的な変更が入る可能性があります。  
> 操作やバグによって生じた損害について、作者は一切の責任を負いません。  

## ✨ 機能

### 変更

ファイル、ハンク、行単位でファイルの変更を確認し、編集できます。  

![ファイル変更の画面](docs/assets/changes.png)

![ファイル編集の画面](docs/assets/editor.png)

### 履歴

コミット、ブランチ、タグを確認し、検索できます。  

![履歴の画面](docs/assets/history.png)

### 活動

コミット数、コントリビューター数、ブランチ数の推移を閲覧できます。  

![活動の画面](docs/assets/activity.png)

### 設定

言語や外観、文字サイズ、画面用・コード用フォント、差分、ステージの表示などを好みに合わせて設定できます。  

![設定の画面](docs/assets/settings.png)

## 📦 インストール

```sh
brew install --cask ishiguro-junya/tap/stella
```

## 🌱 開発を始める

```sh
mise install
mise run setup
mise run dev
```

開発用リポジトリの`origin`にはローカルのベアリポジトリを使用し、GitHubやネットワークへは接続しません。  
`mise run reset`を実行すると、作業内容とローカルリモートをまとめて初期状態へ戻します。  

## 🧰 コマンド

| コマンド | 内容 |
| --- | --- |
| `mise run setup` | 開発環境をセットアップする。 |
| `mise run dev` | アプリを開発モードで起動する。 |
| `mise run build` | アプリをビルドする。 |
| `mise run install` | アプリをインストールする。 |
| `mise run lint` | コードをリントチェックする。 |
| `mise run format` | コードをフォーマットする。 |
| `mise run test` | 全てのテストを実行する。 |
| `mise run test:unit` | 単体テストを実行する。 |
| `mise run test:integration` | 統合テストを実行する。 |
| `mise run test:e2e` | E2Eテストを実行する。 |
| `mise run reset` | 開発用リポジトリを初期状態へ戻す。 |
| `mise run screenshot` | スクリーンショットを生成する。 |

## 📁 ディレクトリ構成

```text
.
├── src/                    # 画面と操作を実装するReactとTypeScriptのコード
│   ├── adapters/           # Tauriとの通信
│   ├── domain/             # Gitの型とルール
│   ├── features/           # 機能ごとの画面と操作
│   ├── i18n/               # i18nextの設定と翻訳カタログ
│   ├── persistence/        # アプリ設定の保存
│   ├── test/               # ユニットテスト
│   ├── theme/              # 外観テーマの制御
│   └── ui/                 # 共通の画面部品
├── src-tauri/              # Git操作とTauriの設定
├── tests/                  # E2Eテストのコード
├── scripts/                # スクリプト
└── docs/                   # ドキュメント
```

## 📚 ドキュメント

- [AGENTS.md](https://github.com/ishiguro-junya/ai-agent-guideline/blob/main/AGENTS.md)
- [貢献ガイド](CONTRIBUTING.md)
- [デザイン](DESIGN.md)
- [サードパーティーに関する通知](THIRD_PARTY_NOTICES.md)
- [仕様](docs/specification.md)
- [アーキテクチャ](docs/architecture.md)
- [テスト](docs/testing.md)
- [ドキュメントの書き方](docs/writing.md)
- [リリース手順](docs/release.md)

## 🧩 エージェントスキル

- [mattpocock/skills](https://www.skills.sh/mattpocock/skills)
- [ponytail](https://www.skills.sh/dietrichgebert/ponytail/ponytail)
- [natural-japanese](https://www.skills.sh/coji/natural-japanese/natural-japanese)
- [stop-ai-slop-jp](https://www.skills.sh/ikora128/stop-ai-slop-jp/stop-ai-slop-jp)

## 🔗 参考リンク

- [mise](https://mise.jdx.dev/)
- [tsx](https://github.com/privatenumber/tsx)
- [Tauri](https://github.com/tauri-apps/tauri)
- [Oxc](https://oxc.rs/)
- [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2)
- [textlint](https://github.com/textlint/textlint)
- [@textlint-ja/textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing)
- [Lychee](https://github.com/lycheeverse/lychee)
- [Lefthook](https://lefthook.dev/)
- [Homebrew](https://brew.sh/ja/)

## ⚖️ ライセンス

[Sustainable Use License 1.0](LICENSE)
