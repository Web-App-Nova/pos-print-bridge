#!/usr/bin/env bash
# Build POS-Printer-Agent.pkg from packaged macOS portable runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  BIN_DIR="$ROOT/release/bin/macos-arm64"
else
  BIN_DIR="$ROOT/release/bin/macos-x64"
fi

OUT_DIR="$ROOT/release/macos"
STAGE="$OUT_DIR/pkgroot"
SCRIPTS="$OUT_DIR/scripts"
IDENTIFIER="com.pos.print-bridge"
VERSION="$(tr -d '[:space:]' < "$BIN_DIR/VERSION" 2>/dev/null || echo "1.1.0")"
PKG_NAME="POS-Printer-Agent.pkg"
INSTALL_LIB="/usr/local/lib/pos-print-bridge"

if [[ ! -x "$BIN_DIR/node" || ! -f "$BIN_DIR/app/build/index.js" ]]; then
  echo "Missing portable runtime in $BIN_DIR — run: npm run package:macos"
  exit 1
fi

rm -rf "$STAGE" "$SCRIPTS"
mkdir -p "$STAGE$INSTALL_LIB"
mkdir -p "$STAGE/usr/local/bin"
mkdir -p "$SCRIPTS"

# Copy full portable runtime (includes LICENSE + assets when packaged)
cp -R "$BIN_DIR/." "$STAGE$INSTALL_LIB/"
chmod 755 "$STAGE$INSTALL_LIB/node" "$STAGE$INSTALL_LIB/pos-print-bridge"
# Ensure license + branding ship even if older bin trees lack them
cp "$ROOT/LICENSE" "$STAGE$INSTALL_LIB/LICENSE"
mkdir -p "$STAGE$INSTALL_LIB/assets" "$STAGE$INSTALL_LIB/app/assets"
cp -R "$ROOT/assets/." "$STAGE$INSTALL_LIB/assets/"
cp -R "$ROOT/assets/." "$STAGE$INSTALL_LIB/app/assets/"

cat > "$STAGE/usr/local/bin/pos-print-bridge" <<EOF
#!/bin/bash
exec ${INSTALL_LIB}/pos-print-bridge "\$@"
EOF
chmod 755 "$STAGE/usr/local/bin/pos-print-bridge"

# Ship uninstall helper
cp "$ROOT/installer/macos/uninstall.sh" "$STAGE$INSTALL_LIB/uninstall.sh"
chmod 755 "$STAGE$INSTALL_LIB/uninstall.sh"

cp "$ROOT/installer/macos/postinstall" "$SCRIPTS/postinstall"
cp "$ROOT/installer/macos/preinstall" "$SCRIPTS/preinstall"
chmod 755 "$SCRIPTS/postinstall" "$SCRIPTS/preinstall"

mkdir -p "$OUT_DIR"
COMPONENT_PKG="$OUT_DIR/POS-Printer-Agent-component.pkg"
rm -f "$COMPONENT_PKG" "$OUT_DIR/$PKG_NAME"

pkgbuild \
  --root "$STAGE" \
  --scripts "$SCRIPTS" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "/" \
  "$COMPONENT_PKG"

productbuild \
  --package "$COMPONENT_PKG" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  "$OUT_DIR/$PKG_NAME"

rm -f "$COMPONENT_PKG"
echo "Built $OUT_DIR/$PKG_NAME (v$VERSION, $ARCH)"
