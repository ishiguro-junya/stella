# frozen_string_literal: true

cask "stella" do
  version "1.0.0-alpha.7"
  sha256 "8b144370eea2fed698567a25fc2b87a72b5502d654cbc3fc57ad0f5c49c9f534"

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
    Developer ID署名とApple公証にまだ対応していません。
    初回起動が拒否された場合は、一度開いてから
    「システム設定」→「プライバシーとセキュリティ」→「このまま開く」を選択してください。
  EOS
end
