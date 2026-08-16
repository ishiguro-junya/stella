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

### 差分

ファイル、ハンク、行単位でファイルの差分の確認と編集ができます。  

![ファイル差分の画面](docs/assets/diff.png)

![ファイル編集の画面](docs/assets/editor.png)

### 履歴

コミット、ブランチ、タグを確認し、検索できます。  

![履歴の画面](docs/assets/history.png)

### 活動

コミット数、コントリビューター数、ブランチ数の推移を閲覧できます。  

![活動の画面](docs/assets/activity.png)

### 設定

言語や外観、文字サイズ、レイアウト、ステージの表示などを好みに合わせて設定できます。  

![設定の画面](docs/assets/settings.png)

## 📦 インストール

```sh
brew tap ishiguro-junya/stella https://github.com/ishiguro-junya/stella
brew install --cask ishiguro-junya/stella/stella
```

## 🌱 開発を始める

```sh
mise install
mise run setup
mise run dev
```

## 🧰 コマンド

| コマンド | 内容 |
| --- | --- |
| `mise run setup` | 開発環境をセットアップする。 |
| `mise run reset` | 開発用リポジトリを初期状態へ戻す。 |
| `mise run dev` | アプリを開発モードで起動する。 |
| `mise run build` | アプリをビルドする。 |
| `mise run install` | アプリをインストールする。 |
| `mise run lint` | コードをリントチェックする。 |
| `mise run format` | コードをフォーマットする。 |
| `mise run test` | 全てのテストを実行する。 |
| `mise run test:unit` | 単体テストを実行する。 |
| `mise run test:integration` | 統合テストを実行する。 |
| `mise run test:e2e` | E2Eテストを実行する。 |
| `mise run screenshot` | スクリーンショットを生成する。 |

## 📁 ディレクトリ構成

```text
.
├── Casks/                  # Homebrew Cask
├── app/                    # アプリの実装
│   ├── adapters/           # Tauriとの通信
│   ├── domain/             # Gitの型とルール
│   ├── features/           # 機能ごとの画面と操作
│   ├── fixtures/           # フロントエンドとRustで共有するテストデータ
│   ├── i18n/               # i18nextの設定と翻訳カタログ
│   ├── native/             # Git操作とTauriの設定
│   ├── persistence/        # アプリ設定の保存
│   ├── test/               # ユニットテスト
│   ├── theme/              # 外観テーマの制御
│   └── ui/                 # 共通の画面部品
├── tests/                  # E2Eテストのコード
├── scripts/                # スクリプト
└── docs/                   # ドキュメント
```

## 🗺️ 画面遷移図

```text
アプリ起動
└── リポジトリ一覧ページ
    ├── リポジトリを追加ダイアログ
    ├── リポジトリ情報を変更ダイアログ
    ├── リポジトリを削除ダイアログ
    ├── リポジトリの場所を復旧ダイアログ
    ├── 設定ページ
    └── リポジトリを開く
        ├── 差分ページ
        │   ├── コミットダイアログ
        │   ├── プルダイアログ
        │   ├── プッシュダイアログ
        │   ├── ファイル編集
        │   └── 変更の破棄・未保存内容の確認ダイアログ
        ├── 履歴ページ
        │   ├── ブランチ作成ダイアログ
        │   ├── タグ作成ダイアログ
        │   ├── マージダイアログ
        │   ├── リベースダイアログ
        │   ├── チェリーピックダイアログ
        │   ├── リバートダイアログ
        │   └── リセットダイアログ
        ├── 活動ページ
        ├── リポジトリ切り替えダイアログ
        │   ├── リポジトリを追加ダイアログ
        │   ├── リポジトリ情報を変更ダイアログ
        │   └── リポジトリを削除ダイアログ
        ├── ブランチ切り替えダイアログ
        │   ├── ブランチ作成ダイアログ
        │   └── ブランチ削除の確認ダイアログ
        ├── リポジトリ一覧ページ
        └── 設定ページ
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
- [vercel-react-best-practices](https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices)
- [frontend-design](https://www.skills.sh/anthropics/skills/frontend-design)

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
