# frozen_string_literal: true

cask "stella" do
  version "1.0.0-alpha.8"
  sha256 "071fe08d404d3001b89e754513fd0547e8d6e540f27eab41ab00f6a7bf273bc0"

  url "https://github.com/ishiguro-junya/stella/releases/download/v#{version}/Stella_#{version}_arm64.zip",
      verified: "github.com/ishiguro-junya/stella/"
  name "Stella"
  desc "日常的なGit操作をコンパクトに扱うmacOS用Gitクライアント"
  homepage "https://github.com/ishiguro-junya/stella"

  conflicts_with cask: "stella-app"
  depends_on macos: :tahoe
  depends_on arch: :arm64

  app "Stella.app"

  uninstall quit: "com.emuni.stella"

  zap trash: [
    "~/Library/Caches/com.emuni.stella",
    "~/Library/Preferences/com.emuni.stella.plist",
    "~/Library/Saved Application State/com.emuni.stella.savedState",
    "~/Library/WebKit/com.emuni.stella",
  ]

  caveats <<~EOS
    このアプリはアドホック署名で配布しており、署名者の本人性は保証されません。
    Developer ID署名とApple公証ではありません。
    初回起動時にmacOSの警告が表示された場合や起動が拒否された場合は、一度開いてから
    「システム設定」→「プライバシーとセキュリティ」→「このまま開く」を選択してください。
  EOS
end
