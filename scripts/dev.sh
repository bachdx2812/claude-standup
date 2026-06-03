#!/usr/bin/env bash
# Run Claude Monitor in dev mode (vite + tauri).
#
# Why this wrapper: the Homebrew rustc (1.86) is too old for Tauri v2 deps
# (need >= 1.88). This prepends the rustup `stable` toolchain (1.96+) to PATH
# so the inner `cargo build` invoked by the Tauri CLI uses the right compiler.
set -euo pipefail

STABLE_BIN="$(dirname "$(rustup which --toolchain stable cargo)")"
export PATH="$STABLE_BIN:$PATH"

cd "$(dirname "$0")/.."
echo "Using rustc: $(rustc --version)"
exec pnpm tauri dev "$@"
