# Homebrew cask for Claude StandUp.
#
# The release workflow (.github/workflows/release.yml) publishes a universal .dmg
# named "Claude StandUp_<version>_universal.dmg" — this cask points at it (the URL
# escapes the space as %20). `sha256 :no_check` is used because the artifact is
# rebuilt per tag; pin a real checksum if you prefer.
#
# Install (after a tag has been released):
#   brew tap bachdx2812/tap            # if hosted in a tap repo
#   brew install --cask claude-standup
# or, straight from this file:
#   brew install --cask ./Casks/claude-standup.rb
cask "claude-standup" do
  version "1.2.0"
  sha256 :no_check

  url "https://github.com/bachdx2812/claude-standup/releases/download/v#{version}/Claude%20StandUp_#{version}_universal.dmg"
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
    "~/Library/Application Support/com.bachdx.claude-standup",
    "~/Library/Preferences/com.bachdx.claude-standup.plist",
    "~/Library/Saved Application State/com.bachdx.claude-standup.savedState",
  ]
end
