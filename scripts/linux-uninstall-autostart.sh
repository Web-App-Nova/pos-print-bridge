#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="pos-print-bridge"
UNIT_FILE="$HOME/.config/systemd/user/${UNIT_NAME}.service"

systemctl --user disable "${UNIT_NAME}.service" 2>/dev/null || true
systemctl --user stop "${UNIT_NAME}.service" 2>/dev/null || true
rm -f "$UNIT_FILE"
systemctl --user daemon-reload 2>/dev/null || true

echo "Auto-start removed on Linux (${UNIT_NAME})."
