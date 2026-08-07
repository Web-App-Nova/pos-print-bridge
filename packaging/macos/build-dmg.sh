#!/usr/bin/env bash
# Build a simple DMG from dist/stage-mac (after npm run package:binaries).
# Optional: brew install create-dmg
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$ROOT/dist/stage-mac"
OUT_DIR="$ROOT/dist/installers"
DMG_NAME="POS-Print-Bridge"
VOL="$OUT_DIR/${DMG_NAME}-src"

if [[ ! -f "$STAGE/pos-print-bridge" ]]; then
  echo "Run: npm run package:binaries" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -rf "$VOL"
mkdir -p "$VOL/POS Print Bridge"
cp "$STAGE/pos-print-bridge" "$VOL/POS Print Bridge/"
cp "$STAGE/com.pos.print-bridge.plist" "$VOL/POS Print Bridge/"
cp "$STAGE/install.sh" "$VOL/POS Print Bridge/Install.command"
cp "$STAGE/uninstall.sh" "$VOL/POS Print Bridge/Uninstall.command"
chmod +x "$VOL/POS Print Bridge/pos-print-bridge" \
  "$VOL/POS Print Bridge/Install.command" \
  "$VOL/POS Print Bridge/Uninstall.command"

# Double-click friendly note
cat > "$VOL/POS Print Bridge/README.txt" <<'EOF'
POS Print Bridge
================
1. Double-click Install.command (allow if macOS asks)
2. Bridge runs in the background — no window
3. Billing app uses http://127.0.0.1:9247

To remove: double-click Uninstall.command
EOF

DMG_PATH="$OUT_DIR/${DMG_NAME}.dmg"
rm -f "$DMG_PATH"

if command -v create-dmg >/dev/null 2>&1; then
  create-dmg \
    --volname "POS Print Bridge" \
    --window-pos 200 120 \
    --window-size 540 360 \
    --icon-size 80 \
    --text-size 12 \
    --app-drop-link 400 180 \
    "$DMG_PATH" \
    "$VOL"
else
  hdiutil create -volname "POS Print Bridge" -srcfolder "$VOL" -ov -format UDZO "$DMG_PATH"
fi

echo "Created: $DMG_PATH"
echo "Note: for distribution outside your org, codesign + notarize the binary/DMG."
