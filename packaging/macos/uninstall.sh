#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/Library/Application Support/POS Print Bridge"
LOG_DIR="${HOME}/Library/Logs/pos-print-bridge"
PLIST_DST="${HOME}/Library/LaunchAgents/com.pos.print-bridge.plist"
LABEL="com.pos.print-bridge"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
rm -rf "$INSTALL_DIR"
# Keep logs unless user wants them gone:
# rm -rf "$LOG_DIR"

pkill -f "$INSTALL_DIR/pos-print-bridge" 2>/dev/null || true
echo "POS Print Bridge removed."
