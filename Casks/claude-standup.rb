# Homebrew cask for Claude StandUp.
#
# This expects a GitHub Release whose asset is named
#   ClaudeStandUp_<version>_aarch64.dmg
# Tauri builds it as "Claude StandUp_<version>_aarch64.dmg" (with a space) under
# src-tauri/target/release/bundle/dmg/ — rename it (drop the space) when you upload
# the release, or edit the `url` below. Then set `sha256` to the real checksum
# (`shasum -a 256 <file>`).
#
# Install (after a release exists):
#   brew tap bachdx2812/tap            # if hosted in a tap repo
#   brew install --cask claude-standup
# or, straight from this file:
#   brew install --cask ./Casks/claude-standup.rb
cask "claude-standup" do
  version "0.1.0"
  sha256 :no_check # TODO: replace with the release .dmg checksum once published

  url "https://github.com/bachdx2812/claude-standup/releases/download/v#{version}/ClaudeStandUp_#{version}_aarch64.dmg"
  name "Claude StandUp"
  desc "Watch your Claude Code sessions as a lively office"
  homepage "https://github.com/bachdx2812/claude-standup"

  depends_on macos: ">= :catalina"

  app "Claude StandUp.app"

  # The app is unsigned (open source, no Apple Developer account) — clear the
  # quarantine flag so Gatekeeper allows launch.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Claude StandUp.app"]
  end

  zap trash: [
    "~/Library/Application Support/com.bachdx.claude-monitor",
    "~/Library/Preferences/com.bachdx.claude-monitor.plist",
    "~/Library/Saved Application State/com.bachdx.claude-monitor.savedState",
  ]
end
