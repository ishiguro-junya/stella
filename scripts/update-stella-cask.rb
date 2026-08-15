#!/usr/bin/env ruby

require "pathname"
require "rubygems"

unless ARGV.length == 2
  abort "使用方法: update-stella-cask.rb <version> <sha256>"
end

version, sha256 = ARGV
abort "versionの形式が不正です: #{version}" unless version.match?(/\A\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\z/)
abort "SHA-256の形式が不正です" unless sha256.match?(/\A[0-9a-f]{64}\z/)

cask_path = Pathname(__dir__).join("..", "Casks", "stella.rb").cleanpath
content = cask_path.read
version_match = content.match(/^  version "([^"]+)"$/)
sha256_match = content.match(/^  sha256 "([0-9a-f]{64})"$/)

abort "Caskのversionを一意に特定できません" unless version_match && content.scan(/^  version "/).one?
abort "CaskのSHA-256を一意に特定できません" unless sha256_match && content.scan(/^  sha256 "/).one?

current_version = version_match[1]
current_sha256 = sha256_match[1]

if version == current_version
  abort "同じversionのRelease assetでSHA-256が変わっています。新しいversionを公開してください" if sha256 != current_sha256

  puts "stella #{version}は更新済みです"
  exit 0
end

# 過去のReleaseを手動指定してもCaskをdowngradeしない。
normalized = ->(value) { Gem::Version.new(value.tr("-", ".")) }
if normalized.call(version) <= normalized.call(current_version)
  abort "Caskを#{current_version}から#{version}へdowngradeできません"
end

updated = content
  .sub(/^  version "[^"]+"$/, %(  version "#{version}"))
  .sub(/^  sha256 "[0-9a-f]{64}"$/, %(  sha256 "#{sha256}"))

cask_path.write(updated)
puts "stellaを#{current_version}から#{version}へ更新しました"
