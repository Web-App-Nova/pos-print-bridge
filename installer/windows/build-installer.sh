#!/usr/bin/env bash
# Prepare Windows installer payload when building on macOS/Linux.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WIN_BIN="$ROOT/release/bin/win-x64"
OUT="$ROOT/release/windows"
mkdir -p "$OUT"

if [[ ! -f "$WIN_BIN/node.exe" || ! -f "$WIN_BIN/app/build/index.js" ]]; then
  echo "Missing portable Windows runtime — run: npm run package:windows"
  exit 1
fi

STAGE="$OUT/payload"
rm -rf "$STAGE"
mkdir -p "$STAGE"

cp -R "$WIN_BIN/." "$STAGE/"
cp "$ROOT/installer/windows/install-service.ps1" "$STAGE/"
cp "$ROOT/installer/windows/uninstall-service.ps1" "$STAGE/"
cp "$ROOT/installer/windows/setup.iss" "$OUT/"
cp "$ROOT/installer/windows/build-installer.ps1" "$OUT/"

mkdir -p "$STAGE/vendor"
if [[ -f "$ROOT/installer/windows/vendor/nssm.exe" ]]; then
  cp "$ROOT/installer/windows/vendor/nssm.exe" "$STAGE/"
  cp "$ROOT/installer/windows/vendor/nssm.exe" "$STAGE/vendor/"
else
  echo "NOTE: Place nssm.exe in installer/windows/vendor/ before building Setup.exe"
  cat > "$STAGE/vendor/README.txt" <<'EOF'
Download NSSM (https://nssm.cc/download), copy win64/nssm.exe to
installer/windows/vendor/nssm.exe, then run build-installer.ps1 on Windows.
EOF
fi

cat > "$OUT/README.txt" <<EOF
YourPOS Printer Agent — Windows release payload
==============================================

On a Windows build machine:
1. npm run package:windows
2. Place nssm.exe in installer/windows/vendor/
3. Install Inno Setup 6
4. powershell -ExecutionPolicy Bypass -File installer\\windows\\build-installer.ps1

Output: release\\windows\\YourPOS-Printer-Agent-Setup.exe
EOF

echo "Windows payload staged at $STAGE"
echo "Final Setup.exe must be compiled on Windows with Inno Setup."
