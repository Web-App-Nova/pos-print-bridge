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

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Bridge health, version, platform |
| GET | `/discover` | Scan local private LAN for printers |
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

## Auto-start (optional)

**macOS** — save as `~/Library/LaunchAgents/com.pos.print-bridge.plist` and load with `launchctl`.

**Windows** — add a shortcut to `npm start` in the Startup folder, or use PM2:

```bash
npm install -g pm2
pm2 start build/index.js --name pos-print-bridge
pm2 save
pm2 startup
```

## Billing app

Set in `pos-billing/.env` (optional):

```
VITE_PRINT_BRIDGE_URL=http://127.0.0.1:9247
```

The printer configuration page uses the local bridge first for network discovery. If the bridge is not running, it falls back to the backend server scan (limited when the site is hosted remotely).
