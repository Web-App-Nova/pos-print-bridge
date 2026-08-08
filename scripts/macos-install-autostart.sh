#!/usr/bin/env bash
# Dev/local auto-start: LaunchAgent pointing at portable runtime OR node+build.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
LABEL="com.pos.print-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/pos-print-bridge"
DATA_DIR="$HOME/Library/Application Support/pos-print-bridge"
UID_NUM="$(id -u)"

mkdir -p "$LOG_DIR" "$DATA_DIR" "$HOME/Library/LaunchAgents"

BIN=""
ARGS=()
WORKDIR="$ROOT"
INSTALL_DIR="$ROOT"

if [[ -x "$ROOT/release/bin/macos-arm64/pos-print-bridge" && "$(uname -m)" == "arm64" ]]; then
  BIN="$ROOT/release/bin/macos-arm64/pos-print-bridge"
  WORKDIR="$ROOT/release/bin/macos-arm64"
  INSTALL_DIR="$WORKDIR"
elif [[ -x "$ROOT/release/bin/macos-x64/pos-print-bridge" ]]; then
  BIN="$ROOT/release/bin/macos-x64/pos-print-bridge"
  WORKDIR="$ROOT/release/bin/macos-x64"
  INSTALL_DIR="$WORKDIR"
elif [[ -x "/usr/local/lib/pos-print-bridge/pos-print-bridge" ]]; then
  BIN="/usr/local/lib/pos-print-bridge/pos-print-bridge"
  WORKDIR="/usr/local/lib/pos-print-bridge"
  INSTALL_DIR="$WORKDIR"
else
  NODE="$(command -v node || true)"
  if [[ -z "$NODE" ]]; then
    echo "Error: node not found. Install Node.js 18+ or run npm run package:macos first."
    exit 1
  fi
  if [[ ! -f "$ROOT/build/index.js" ]]; then
    echo "Building project…"
    (cd "$ROOT" && npm run build)
  fi
  BIN="$NODE"
  ARGS=("$ROOT/build/index.js")
  WORKDIR="$ROOT"
  INSTALL_DIR="$ROOT"
fi

PROGRAM_ARGS="    <string>${BIN}</string>"
for a in "${ARGS[@]+"${ARGS[@]}"}"; do
  PROGRAM_ARGS+="
    <string>${a}</string>"
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${PROGRAM_ARGS}
  </array>
  <key>WorkingDirectory</key>
  <string>${WORKDIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>POS_PRINT_BRIDGE_ENV</key>
    <string>production</string>
    <key>POS_PRINT_BRIDGE_HOST</key>
    <string>127.0.0.1</string>
    <key>POS_PRINT_BRIDGE_PORT</key>
    <string>9247</string>
    <key>POS_PRINT_BRIDGE_DATA_DIR</key>
    <string>${DATA_DIR}</string>
    <key>POS_PRINT_BRIDGE_LOG_DIR</key>
    <string>${LOG_DIR}</string>
    <key>POS_PRINT_BRIDGE_INSTALL_DIR</key>
    <string>${INSTALL_DIR}</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true

echo ""
echo "Auto-start enabled on macOS."
echo "  Service : ${LABEL}"
echo "  Binary  : ${BIN}"
echo "  Logs    : ${LOG_DIR}/"
echo "  URL     : http://127.0.0.1:9247"
echo ""
echo "The agent starts automatically at login (KeepAlive restarts on crash)."
echo "To remove: npm run remove:autostart"
