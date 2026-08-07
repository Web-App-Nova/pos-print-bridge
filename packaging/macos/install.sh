#!/usr/bin/env bash
# Invisible background install for POS Print Bridge (LaunchAgent).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_SRC="$ROOT/pos-print-bridge"
INSTALL_DIR="${HOME}/Library/Application Support/POS Print Bridge"
LOG_DIR="${HOME}/Library/Logs/pos-print-bridge"
PLIST_DST="${HOME}/Library/LaunchAgents/com.pos.print-bridge.plist"
LABEL="com.pos.print-bridge"

if [[ ! -x "$BIN_SRC" && ! -f "$BIN_SRC" ]]; then
  echo "Missing binary next to install.sh: $BIN_SRC" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$LOG_DIR" "$(dirname "$PLIST_DST")"
cp "$BIN_SRC" "$INSTALL_DIR/pos-print-bridge"
chmod +x "$INSTALL_DIR/pos-print-bridge"

# Stop previous agent if any
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true

sed \
  -e "s|__BRIDGE_BIN__|${INSTALL_DIR}/pos-print-bridge|g" \
  -e "s|__LOG_DIR__|${LOG_DIR}|g" \
  -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
  "$ROOT/com.pos.print-bridge.plist" > "$PLIST_DST"

launchctl bootstrap "gui/$(id -u)" "$PLIST_DST" 2>/dev/null \
  || launchctl load -w "$PLIST_DST"

sleep 1
if curl -sf "http://127.0.0.1:9247/status" >/dev/null; then
  echo "POS Print Bridge installed and running (http://127.0.0.1:9247)."
else
  echo "Installed. If status fails, check logs: $LOG_DIR"
fi
echo "No Dock/Terminal window — runs in background via LaunchAgent."
