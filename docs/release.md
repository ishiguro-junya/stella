# リリース手順

このドキュメントでは、Stellaのバージョンの更新から、GitHub Release、自動更新用ファイル、Homebrew Caskの公開までを手動で行う手順を定義します。  
StellaはApple Silicon向けに配布します。  
Developer ID署名とApple公証は行いませんが、自動更新用ファイルにはTauri Updaterの署名を付けます。  

## 前提

次の権限とコマンドを使用できる状態にします。  

- `ishiguro-junya/stella`の`main`ブランチとGitHub Releaseへの書き込み権限
- `ishiguro-junya/homebrew-tap`の`main`ブランチへの書き込み権限
- GitHub CLIの認証
- Homebrew
- mise
- 自動更新用の秘密鍵と、そのパスを示す`STELLA_UPDATER_KEY`環境変数
- macOSのキーチェーンに保存した`com.emuni.stella.updater`のパスワード

すべてのコマンドはStellaリポジトリのルートから同じシェルで実行します。  

```sh
mise install
mise run setup
```

秘密鍵を紛失すると、既存のStellaへ新しい更新を配布できなくなります。  
秘密鍵とキーチェーンのパスワードは、リポジトリ外の安全な場所へバックアップします。  

### 初回だけ行う設定

プレリリース用と安定版用の固定GitHub Releaseは初回だけ作成します。  
どちらも配布一覧上はプレリリースとして扱い、`latest.json`だけを更新します。  

```sh
gh release create updater-prerelease \
  --repo ishiguro-junya/stella \
  --title "Stella prerelease update feed" \
  --notes "Stellaのプレリリース向け自動更新情報です。" \
  --prerelease
gh release create updater-stable \
  --repo ishiguro-junya/stella \
  --title "Stella stable update feed" \
  --notes "Stellaの安定版向け自動更新情報です。" \
  --prerelease
```

## 1. リリースバージョンを決める

先頭の`v`を含まないバージョンと、リリースタグを環境変数へ設定します。  

```sh
STELLA_VERSION="1.0.0-alpha.5"
STELLA_TAG="v${STELLA_VERSION}"
STELLA_RELEASE_DIR=".tmp/release-${STELLA_VERSION}"
STELLA_ARCHIVE="${STELLA_RELEASE_DIR}/Stella_${STELLA_VERSION}_arm64.zip"
STELLA_UPDATER_ARCHIVE="${STELLA_RELEASE_DIR}/Stella_${STELLA_VERSION}_aarch64.app.tar.gz"
STELLA_UPDATER_SIGNATURE="${STELLA_UPDATER_ARCHIVE}.sig"
STELLA_UPDATER_MANIFEST="${STELLA_RELEASE_DIR}/latest.json"
STELLA_GIT_SOURCE="${STELLA_RELEASE_DIR}/git-2.55.0.tar.xz"
if [[ "$STELLA_VERSION" == *-* ]]; then
  STELLA_RELEASE_FLAGS=(--prerelease)
else
  STELLA_RELEASE_FLAGS=()
fi
```

既存のGitHub Releaseと重複していないことを確認します。  

```sh
git fetch origin --tags
git tag --list "$STELLA_TAG"
gh release view "$STELLA_TAG" --repo ishiguro-junya/stella
```

タグまたはGitHub Releaseが見つかった場合は、公開済みバージョンを上書きせず、新しいバージョンを決めます。  

## 2. バージョンを更新する

最新の`main`からリリース作業用ブランチを作成します。  

```sh
git switch main
git pull --ff-only origin main
git status --short
git switch -c "chore/release-${STELLA_TAG}"
```

`git status --short`に何も表示されないことを確認してから進めます。  
次の4ファイルを同じバージョンへ更新します。  

- `package.json`の`version`
- `src-tauri/Cargo.toml`の`version`
- `src-tauri/tauri.conf.json`の`version`
- `Cargo.lock`にある`stella`パッケージの`version`

更新後、4ファイルのバージョンが一致していることを確認します。  

```sh
rg -nF "$STELLA_VERSION" \
  package.json \
  src-tauri/Cargo.toml \
  src-tauri/tauri.conf.json \
  Cargo.lock
```

バージョン更新だけをコミットし、`main`へマージします。  

```sh
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json Cargo.lock
git commit -m "chore(release): ${STELLA_TAG}へ更新"
git push -u origin "chore/release-${STELLA_TAG}"
```

プルリクエストを作成し、検証に成功した変更を`main`へマージします。  

## 3. 検証してビルドする

バージョン更新を`main`へマージした後、最新の`main`を取得して検証します。  

```sh
git switch main
git pull --ff-only origin main
git status --short
mise run lint
mise run typecheck
mise run test
: "${STELLA_UPDATER_KEY:?自動更新用の秘密鍵のパスを設定してください}"
export TAURI_SIGNING_PRIVATE_KEY="$STELLA_UPDATER_KEY"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password \
  -a ishiguro \
  -s com.emuni.stella.updater \
  -w)"
pnpm exec tauri build --config src-tauri/tauri.updater.conf.json
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

生成したアプリのバージョン、バンドルID、アーキテクチャを確認します。  

```sh
/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleShortVersionString' \
  target/release/bundle/macos/Stella.app/Contents/Info.plist
/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleIdentifier' \
  target/release/bundle/macos/Stella.app/Contents/Info.plist
file target/release/bundle/macos/Stella.app/Contents/MacOS/stella
node --import tsx scripts/toolchain.mts release-gate \
  target/release/bundle/macos/Stella.app
```

出力がそれぞれ`$STELLA_VERSION`、`com.emuni.stella`、`arm64`であることを確認します。  
ツールチェーンのリリース検査では、Git 2.55.0、Git LFS 3.7.1、git-flow-next 1.2.0のバージョン、arm64アーキテクチャ、チェックサム、ヘルパー、テンプレート、動的リンク先を検証します。  

## 4. リリース成果物を作成する

リリース用の一時ファイルは`.tmp/`配下へ作成します。  

```sh
mkdir -p "$STELLA_RELEASE_DIR"
ditto -c -k --keepParent \
  target/release/bundle/macos/Stella.app \
  "$STELLA_ARCHIVE"
cp target/release/bundle/macos/Stella.app.tar.gz \
  "$STELLA_UPDATER_ARCHIVE"
cp target/release/bundle/macos/Stella.app.tar.gz.sig \
  "$STELLA_UPDATER_SIGNATURE"
cp .tmp/toolchain/downloads/git-2.55.0.tar.xz "$STELLA_GIT_SOURCE"
STELLA_SHA256="$(shasum -a 256 "$STELLA_ARCHIVE" | awk '{print $1}')"
shasum -a 256 "$STELLA_ARCHIVE"
shasum -a 256 "$STELLA_GIT_SOURCE"
```

`$STELLA_RELEASE_DIR/release-notes.md`へ、利用者向けのリリースノートを日本語で作成します。  
次の項目を含めます。  

- リリースの概要
- 変更内容
- 動作環境
- プレリリースの場合は、アルファ版、ベータ版、またはリリース候補版であること
- Developer ID未署名、Apple未公証であること

リリースノートと署名から自動更新用の`latest.json`を作成します。  

```sh
node --import tsx scripts/create-updater-manifest.mts \
  "$STELLA_VERSION" \
  "${STELLA_RELEASE_DIR}/release-notes.md" \
  "$STELLA_UPDATER_ARCHIVE" \
  "$STELLA_UPDATER_SIGNATURE" \
  "$STELLA_UPDATER_MANIFEST"
```

`latest.json`の`version`、`darwin-aarch64`のURL、署名が対象ファイルと一致することを確認します。  

## 5. タグとGitHub Releaseを公開する

リリース対象のコミットが`origin/main`と一致することを確認します。  

```sh
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short
```

注釈付きタグを作成してプッシュします。  

```sh
git tag -a "$STELLA_TAG" -m "Stella ${STELLA_VERSION}"
git push origin "$STELLA_TAG"
```

プレリリースはGitHub Releaseでもプレリリースとして公開し、安定版ではプレリリース指定を外します。  

```sh
gh release create "$STELLA_TAG" \
  "$STELLA_ARCHIVE" \
  "$STELLA_UPDATER_ARCHIVE" \
  "$STELLA_UPDATER_SIGNATURE" \
  "$STELLA_GIT_SOURCE" \
  --repo ishiguro-junya/stella \
  --title "Stella ${STELLA_VERSION}" \
  --notes-file "${STELLA_RELEASE_DIR}/release-notes.md" \
  "${STELLA_RELEASE_FLAGS[@]}" \
  --verify-tag
```

GitHub Releaseと成果物を確認します。  

```sh
gh release view "$STELLA_TAG" \
  --repo ishiguro-junya/stella \
  --json tagName,name,isPrerelease,assets,url
```

`alpha`、`beta`、`rc`を含むプレリリースでは、プレリリース用の更新情報だけを置き換えます。  
安定版では両方を置き換え、プレリリース利用者も安定版へ更新できるようにします。  

```sh
gh release upload updater-prerelease \
  "$STELLA_UPDATER_MANIFEST" \
  --repo ishiguro-junya/stella \
  --clobber

if [[ "$STELLA_VERSION" != *-* ]]; then
  gh release upload updater-stable \
    "$STELLA_UPDATER_MANIFEST" \
    --repo ishiguro-junya/stella \
    --clobber
fi
```

更新情報は、対象バージョンのGitHub Releaseとすべてのファイルが公開された後に置き換えます。  

## 6. Homebrew Caskを更新する

Homebrew Tapを初回だけ`.tmp/homebrew-tap`へクローンします。  
すでにクローン済みの場合は、このコマンドを省略します。  

```sh
git clone git@github.com:ishiguro-junya/homebrew-tap.git .tmp/homebrew-tap
```

Tapの`main`を最新の状態に更新し、リリース成果物のバージョンとSHA-256をCaskへ反映します。  

```sh
git -C .tmp/homebrew-tap switch main
git -C .tmp/homebrew-tap pull --ff-only origin main
ruby .tmp/homebrew-tap/scripts/update-stella-cask.rb \
  "$STELLA_VERSION" \
  "$STELLA_SHA256"
ruby -c .tmp/homebrew-tap/scripts/update-stella-cask.rb
brew style .tmp/homebrew-tap/Casks/stella.rb
git -C .tmp/homebrew-tap diff --check
git -C .tmp/homebrew-tap diff -- Casks/stella.rb
```

Caskの`version`と`sha256`だけが変更されていることを確認してコミットします。  

```sh
git -C .tmp/homebrew-tap add Casks/stella.rb
git -C .tmp/homebrew-tap commit \
  -m "chore(cask): Stella ${STELLA_TAG}へ更新"
git -C .tmp/homebrew-tap push origin main
```

TapのGitHub Actionsが成功するまで待ちます。  

```sh
STELLA_TAP_RUN_ID="$(gh run list \
  --repo ishiguro-junya/homebrew-tap \
  --workflow test.yml \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')"
gh run watch "$STELLA_TAP_RUN_ID" \
  --repo ishiguro-junya/homebrew-tap \
  --exit-status
```

## 7. 配布結果を確認する

Homebrewが新しいCaskを取得できることを確認します。  

```sh
brew update
brew info --cask ishiguro-junya/tap/stella
```

新規環境では次のコマンドでインストールできます。  

```sh
brew install --cask ishiguro-junya/tap/stella
```

インストール済みの環境では次のコマンドで更新できます。  

```sh
brew upgrade --cask ishiguro-junya/tap/stella
```
