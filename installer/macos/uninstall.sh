#!/usr/bin/env bash
# Clean uninstall of YourPOS Printer Agent (macOS)
set -euo pipefail

LABEL="com.pos.print-bridge"
INSTALL_DIR="/usr/local/lib/pos-print-bridge"
WRAPPER="/usr/local/bin/pos-print-bridge"
UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

echo "Stopping LaunchAgent…"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"

echo "Removing application files…"
sudo rm -rf "$INSTALL_DIR"
sudo rm -f "$WRAPPER"

# Optional: leave config/logs unless --purge
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$HOME/Library/Application Support/pos-print-bridge"
  rm -rf "$HOME/Library/Logs/pos-print-bridge"
  echo "Removed config and logs."
else
  echo "Kept config/logs. Pass --purge to remove them too."
fi

# Forget pkg receipt if present
sudo pkgutil --forget "$LABEL" 2>/dev/null || true

echo "YourPOS Printer Agent uninstalled."
