#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "Error: node not found in PATH. Install Node.js 18+ first."
  exit 1
fi

UNIT_NAME="pos-print-bridge"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/${UNIT_NAME}.service"
LOG_DIR="$HOME/.local/share/pos-print-bridge/logs"

mkdir -p "$UNIT_DIR" "$LOG_DIR"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=POS Print Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${NODE} ${ROOT}/build/index.js
Restart=always
RestartSec=3
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "${UNIT_NAME}.service"
systemctl --user restart "${UNIT_NAME}.service"

echo ""
echo "Auto-start enabled on Linux (systemd user service)."
echo "  Service : ${UNIT_NAME}"
echo "  Project : ${ROOT}"
echo "  Status  : systemctl --user status ${UNIT_NAME}"
echo ""
echo "To remove: npm run remove:autostart"
