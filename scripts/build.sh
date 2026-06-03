#!/usr/bin/env bash
# Build Claude Monitor as a local macOS .app/.dmg (unsigned in dev).
#
# Pins the rustup `stable` toolchain (1.96+) — the Homebrew rustc (1.86) is too
# old for Tauri v2 deps. Code-signing/notarization is deferred (phase 07): if
# APPLE_SIGNING_IDENTITY is set, the Tauri CLI will sign automatically.
set -euo pipefail

STABLE_BIN="$(dirname "$(rustup which --toolchain stable cargo)")"
export PATH="$STABLE_BIN:$PATH"

cd "$(dirname "$0")/.."
echo "Using rustc: $(rustc --version)"
exec pnpm tauri build "$@"
