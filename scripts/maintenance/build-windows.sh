#!/usr/bin/env bash
# Reproducible Windows build for the pinned 0.3.2 maintenance line.
#
# Runs on a Windows host. Two toolchain layouts are supported:
#   1. MSVC build tools installed (upstream default):
#        cargo build --release -p bsk --locked
#   2. No MSVC available: GNU host toolchain + portable mingw-w64.
#      See MAINTENANCE.md §3 for the one-time bootstrap.
set -euo pipefail
cd "$(dirname "$0")/../.."

BASELINE=75ba2949d9abce07931534f8382a055ddb447b9c
test "$(git rev-parse HEAD)" != "$BASELINE" || echo "warning: HEAD equals the pristine baseline"

# Portable mingw-w64 lives under the user temp dir by default; override with MINGW_BIN.
MINGW_BIN="${MINGW_BIN:-${LOCALAPPDATA:-$HOME/AppData/Local}/Temp/msys64/msys64/mingw64/bin}"
USE_GNU="${USE_GNU:-1}"

if [ "$USE_GNU" = "1" ]; then
  export PATH="$MINGW_BIN:$PATH"
  export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=gcc
  export RUSTFLAGS="-C target-feature=+crt-static"
  export CARGO_INCREMENTAL=0
  # Build outside an endpoint-encrypted folder when one is present: the
  # filter driver can stall rustc while it writes large rlibs.
  TARGET="x86_64-pc-windows-gnu"
  rustup run stable-x86_64-pc-windows-gnu cargo build \
    --release -p bsk --locked --target "$TARGET" -j 6
  CLI="target/$TARGET/release/bsk.exe"
else
  cargo build --release -p bsk --locked
  CLI="target/release/bsk.exe"
fi

pnpm install --frozen-lockfile
pnpm --filter @browser-skill/extension build

EXT="apps/extension/dist/chrome-mv3"
echo "CLI : $CLI  ($(./"$CLI" --version))"
echo "EXT : $EXT  (manifest version $(python -c "import json;print(json.load(open('$EXT/manifest.json'))['version'])" 2>/dev/null || echo '?'))"
