#!/usr/bin/env bash
set -euo pipefail
# Optional Windows -> WSL adapter. Native Linux/macOS never execute this file.
# Preserve the caller's PATH (Homebrew/nvm/custom uv locations included).
export PATH="$HOME/.local/share/goa2-node/bin:$HOME/.local/bin:$PATH"
tool=${GOA2_LAB_TOOL:?Missing comparison tool path}
# Registration during cache preparation must identify an owned process group,
# just like service-runner's detached children once the service is running.
exec setsid --wait node "$tool/wsl-cache.mjs" "$@"
