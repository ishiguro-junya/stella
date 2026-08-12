# リリース手順

この文書では、Stellaのバージョン更新、GitHub Release、自動更新用ファイル、Homebrew Caskを手動で公開する手順を定義します。  
StellaはApple Silicon向けに配布します。  
Developer ID署名とApple公証は行いませんが、自動更新用ファイルにはTauri Updaterの署名を付けます。  

## 前提

次の権限とcommandを使用できる状態にします。  

- `ishiguro-junya/stella`の`main` BranchとReleaseへの書込権限
- `ishiguro-junya/homebrew-tap`の`main` Branchへの書込権限
- GitHub CLIの認証
- Homebrew
- mise
- `/Users/ishiguro/.tauri/stella-updater.key`にある自動更新用の秘密鍵
- macOSのキーチェーンに保存した`com.emuni.stella.updater`のパスワード

すべてのcommandはStella Repositoryのrootから同じshellで実行します。  

```sh
mise install
mise run setup
```

秘密鍵を紛失すると、既存のStellaへ新しい更新を配布できなくなります。  
秘密鍵とキーチェーンのパスワードは、リポジトリ外の安全な場所へバックアップします。  

自動更新用の固定Releaseは初回だけ作成します。  
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

## 1. Release versionを決める

先頭の`v`を含まないversionと、Release Tagを環境変数へ設定します。  

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

既存のReleaseと重複していないことを確認します。  

```sh
git fetch origin --tags
git tag --list "$STELLA_TAG"
gh release view "$STELLA_TAG" --repo ishiguro-junya/stella
```

TagまたはReleaseが見つかった場合は、公開済みversionを上書きせず、新しいversionを決めます。  

## 2. Versionを更新する

最新の`main`からRelease作業用Branchを作成します。  

```sh
git switch main
git pull --ff-only origin main
git status --short
git switch -c "chore/release-${STELLA_TAG}"
```

`git status --short`に何も表示されないことを確認してから進めます。  
次の4ファイルを同じversionへ更新します。  

- `package.json`の`version`
- `src-tauri/Cargo.toml`の`version`
- `src-tauri/tauri.conf.json`の`version`
- `Cargo.lock`にある`stella` Packageの`version`

更新後、4ファイルのversionが一致していることを確認します。  

```sh
rg -nF "$STELLA_VERSION" \
  package.json \
  src-tauri/Cargo.toml \
  src-tauri/tauri.conf.json \
  Cargo.lock
```

Version更新だけをCommitし、`main`へMergeします。  

```sh
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json Cargo.lock
git commit -m "chore(release): ${STELLA_TAG}へ更新"
git push -u origin "chore/release-${STELLA_TAG}"
```

## 3. 検証してbuildする

Version更新を`main`へMergeした後、最新の`main`を取得して検証します。  

```sh
git switch main
git pull --ff-only origin main
git status --short
mise run lint
mise run typecheck
mise run test
mise run test:e2e
export TAURI_SIGNING_PRIVATE_KEY="/Users/ishiguro/.tauri/stella-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password \
  -a ishiguro \
  -s com.emuni.stella.updater \
  -w \
  /Users/ishiguro/Library/Keychains/login.keychain-db)"
pnpm exec tauri build --config src-tauri/tauri.updater.conf.json
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

生成したApplicationのversion、Bundle ID、architectureを確認します。  

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
toolchainのrelease gateでは、Git 2.55.0、Git LFS 3.7.1、git-flow-next 1.2.0のversionとarm64 architecture、checksum、helper／template、動的link先を検証します。  

## 4. Release assetを作成する

Release用の一時ファイルは`.tmp/`配下へ作成します。  

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

`$STELLA_RELEASE_DIR/release-notes.md`へ、利用者向けのRelease noteを日本語で作成します。  
次の項目を含めます。  

- Releaseの概要
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

## 5. TagとGitHub Releaseを公開する

Release対象のCommitが`origin/main`と一致することを確認します。  

```sh
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short
```

注釈付きTagを作成してPushします。  

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

Releaseとassetを確認します。  

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

Homebrew Tapを初回だけ`.tmp/homebrew-tap`へCloneします。  
すでにClone済みの場合は、このcommandを省略します。  

```sh
git clone git@github.com:ishiguro-junya/homebrew-tap.git .tmp/homebrew-tap
```

Tapの`main`を最新化し、Release assetのversionとSHA-256をCaskへ反映します。  

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

Caskの`version`と`sha256`だけが変更されていることを確認してCommitします。  

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

新規環境では次のcommandでインストールできます。  

```sh
brew install --cask ishiguro-junya/tap/stella
```

インストール済みの環境では次のcommandで更新できます。  

```sh
brew upgrade --cask ishiguro-junya/tap/stella
```
