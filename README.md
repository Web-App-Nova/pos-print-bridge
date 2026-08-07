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
| GET | `/queues` | System printer queues + pending OS job counts |
| GET | `/queues/:name` | One queue state + jobs |
| GET | `/queues/:name/jobs` | Jobs waiting in that system queue |
| DELETE | `/queues/:name/jobs/:jobId` | Cancel a stuck OS job |
| POST | `/print` | Print and **confirm** job left the OS queue (or LAN TCP OK) |

### Print confirmation

`POST /print` no longer means “accepted by OS only”. For USB/system queues the bridge:

1. Submits the job and captures the OS job id  
2. Polls the system queue (up to 40s) until the job is gone (= printed)  
3. If the printer is offline/paused or time runs out → **cancels** the OS job and returns `printed: false` (HTTP 422)

Success body includes `printed: true`, `status: "printed"`. Failure includes `printed: false`, `status: "failed"`, `message`, and optional `os_job_id` / `queue_jobs`.

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
| `POS_PRINT_TIMEOUT_MS` | `8000` | Submit / TCP timeout |
| `POS_PRINT_CONFIRM_TIMEOUT_MS` | `40000` | Wait for OS job to leave queue |
| `POS_PRINT_CONFIRM_POLL_MS` | `1000` | Queue poll interval |
| `POS_DISCOVERY_TIMEOUT_MS` | `220` | Per-host probe timeout |

## Packaged installers (invisible background)

Goal: install once → bridge runs **with no window / no tray**, starts at login, no PowerShell flash.

### 1) Build binaries (any OS with Node)

```bash
cd pos-print-bridge
npm install
npm run package:binaries
```

Creates:

- `dist/bin/pos-print-bridge-win-x64.exe`
- `dist/bin/pos-print-bridge-macos-arm64` / `…-macos-x64`
- `dist/stage-win/` — ready for Inno Setup
- `dist/stage-mac/` — ready for DMG / Install.command

Current machine only (faster):

```bash
npm run package:binaries:current
```

### 2) Windows Setup.exe (Inno Setup)

1. Install [Inno Setup 6](https://jrsoftware.org/isinfo.php)
2. Build binaries (above) so `dist/stage-win/pos-print-bridge.exe` exists
3. Compile: open `packaging/windows/installer.iss` → Build, or:

```bat
iscc packaging\windows\installer.iss
```

Output: `dist/installers/POS-Print-Bridge-Setup.exe`

Installer will:

- Copy files under `%LocalAppData%` / Program Files (per privileges)
- Register a **Task Scheduler** job “POS Print Bridge” (at logon, restart on failure)
- Start the bridge **hidden** (`runhidden` — no console)

Uninstall removes the task and stops the process.

### 3) macOS DMG

```bash
npm run package:binaries
npm run package:dmg
```

Output: `dist/installers/POS-Print-Bridge.dmg`

User opens DMG → double-clicks **Install.command** → LaunchAgent installed → runs in background (no Dock icon).  
**Uninstall.command** removes it.

Logs: `~/Library/Logs/pos-print-bridge/`

For public distribution: codesign + notarize the binary/DMG (Apple Developer ID).

### Runtime check

```bash
curl http://127.0.0.1:9247/status
```

## Billing app

Set in `pos-billing/.env` (optional):

```
VITE_PRINT_BRIDGE_URL=http://127.0.0.1:9247
```

The printer configuration page uses the local bridge first for network discovery. If the bridge is not running, it falls back to the backend server scan (limited when the site is hosted remotely).
