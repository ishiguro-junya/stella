#!/usr/bin/env ruby

require "pathname"
require "rubygems"

unless ARGV.length == 2
  abort "Usage: update-stella-cask.rb <version> <sha256>"
end

version, sha256 = ARGV
abort "Invalid version format: #{version}" unless version.match?(/\A\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\z/)
abort "Invalid SHA-256 format" unless sha256.match?(/\A[0-9a-f]{64}\z/)

cask_path = Pathname(__dir__).join("..", "Casks", "stella.rb").cleanpath
content = cask_path.read
version_match = content.match(/^  version "([^"]+)"$/)
sha256_match = content.match(/^  sha256 "([0-9a-f]{64})"$/)

abort "Could not uniquely locate the Cask version" unless version_match && content.scan(/^  version "/).one?
abort "Could not uniquely locate the Cask SHA-256" unless sha256_match && content.scan(/^  sha256 "/).one?

current_version = version_match[1]
current_sha256 = sha256_match[1]

if version == current_version
  abort "The SHA-256 changed for an existing release asset. Publish a new version." if sha256 != current_sha256

  puts "stella #{version} is already up to date"
  exit 0
end

# 過去のReleaseを手動指定してもCaskをdowngradeしない。
normalized = ->(value) { Gem::Version.new(value.tr("-", ".")) }
if normalized.call(version) <= normalized.call(current_version)
  abort "Cannot downgrade the Cask from #{current_version} to #{version}"
end

updated = content
  .sub(/^  version "[^"]+"$/, %(  version "#{version}"))
  .sub(/^  sha256 "[0-9a-f]{64}"$/, %(  sha256 "#{sha256}"))

cask_path.write(updated)
puts "Updated stella from #{current_version} to #{version}"
