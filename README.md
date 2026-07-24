# POS Print Bridge

Local service for **POS billing PCs** (Windows & Mac). It runs on each billing machine and lets the hosted billing website:

- Discover LAN printers on **this computer's network**
- Send raw print jobs to network printers (port 9100 / LPD / IPP probe)

The bridge binds to `127.0.0.1` only — it is not exposed to the internet.

## Requirements

- Node.js 18 or newer
- Billing PC on the same LAN as your thermal/network printers

## Quick start

```bash
cd pos-print-bridge
npm install
npm run dev
```

Production:

```bash
npm run build
npm start
```

Default URL: `http://127.0.0.1:9247`

## Auto-start on boot / login (one-time setup)

Run **once** on each billing PC. After this, the bridge starts automatically when the user logs in (even after restart or shutdown).

```bash
cd pos-print-bridge
npm run setup:autostart
```

| OS | What it installs |
|----|------------------|
| **macOS** | LaunchAgent (`com.pos.print-bridge`) — starts at login, restarts if it crashes |
| **Windows** | Scheduled Task (`POS Print Bridge`) — starts at user logon |
| **Linux** | systemd user service (`pos-print-bridge`) — starts at login |

To remove auto-start:

```bash
npm run remove:autostart
```

### macOS logs

```
~/Library/Logs/pos-print-bridge/out.log
~/Library/Logs/pos-print-bridge/err.log
```

### Manual platform scripts (optional)

```bash
# macOS
bash scripts/macos-install-autostart.sh "$(pwd)"

# Windows (PowerShell as normal user)
powershell -ExecutionPolicy Bypass -File scripts/windows-install-autostart.ps1 -BridgeRoot "C:\path\to\pos-print-bridge"
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Bridge health, version, platform |
| GET | `/discover` | List all printers on this PC (USB, Bluetooth, Wi‑Fi, LAN) + LAN scan |
| POST | `/print` | Send raw bytes to `host:port` |

### POST /print body

```json
{
  "host": "192.168.1.50",
  "port": 9100,
  "text": "Hello KOT\n\n\n"
}
```

Or base64 ESC/POS:

```json
{
  "host": "192.168.1.50",
  "port": 9100,
  "data_base64": "G0hlbGxvCg=="
}
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `POS_PRINT_BRIDGE_PORT` | `9247` | Local HTTP port |
| `POS_PRINT_BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `POS_PRINT_TIMEOUT_MS` | `8000` | Print socket timeout |
| `POS_DISCOVERY_TIMEOUT_MS` | `220` | Per-host probe timeout |

## Billing app

Set in `pos-billing/.env` (optional):

```
VITE_PRINT_BRIDGE_URL=http://127.0.0.1:9247
```

The printer configuration page uses the local bridge first for network discovery. If the bridge is not running, it falls back to the backend server scan (limited when the site is hosted remotely).
