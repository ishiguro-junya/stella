<h1 align="center">Stella</h1>

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Stellaのアイコン">
</p>

Stellaは、シンプルなGitクライアントアプリです。  
日常的なGit操作をコンパクトな画面にまとめ、必要なGitの詳細だけを確認できるようにします。  

> [!WARNING]
> このアプリは現在アルファ版です。
> 将来的に破壊的な変更が入る可能性があります。

## ✨ 機能

- 変更内容の確認、Stage/Unstage、行単位の部分Stage
- Conventional Commitsに沿ったCommit作成
- Branchの切り替えとCommit履歴の確認
- 登録Repositoryの一覧、FinderでのLocal追加、Remote URLからのCloneを1つの入口で操作
- Finderで選んだpathがGit Repositoryでなければ、新しいRepositoryとして作成
- Merge、Rebase、Cherry-pick、Revertなどの履歴操作
- 競合内容の比較、編集、解消
- Repository操作とCommit傾向を確認できるActivity
- System/Light/Darkの外観切り替え
- 日本語/Englishの言語切り替え

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

## 🌱 クイックスタート

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

- [アーキテクチャ](docs/architecture.md) — Module境界、Git操作、安全方針、品質gate
- [デザインQA](DESIGN.md) — UI比較、操作確認、検証結果
- [サードパーティーに関する通知](THIRD_PARTY_NOTICES.md) — 利用ライブラリの著作権とライセンス

## 📝 備考

- 動作環境はMacのApple Siliconのみ対応しています。
- 初回表示はmacOSの言語が日本語なら日本語、それ以外は英語です。  
  以後は設定画面で選んだ言語を保持します。
- UIとStella由来の通知・エラーは日本語/英語に対応し、Git出力、path、Branch名、Commit本文は原文のまま表示します。
- App Sandbox、Developer ID署名、公証、自動更新、Mac App Store配布を扱っていません。
- GitHub/GitLab固有連携、認証管理、stash、tag、remote管理、interactive rebase、force push、submodule、LFS、worktree管理は対象外です。
- GUIアプリはshellの初期化ファイルから`PATH`を継承しないため、Git backendは`/usr/bin/git`を利用します。
