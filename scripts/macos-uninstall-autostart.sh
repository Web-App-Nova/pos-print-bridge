#!/usr/bin/env bash
set -euo pipefail

LABEL="com.pos.print-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"

echo "Auto-start removed on macOS (${LABEL})."
