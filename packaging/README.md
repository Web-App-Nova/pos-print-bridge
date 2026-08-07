# Packaging POS Print Bridge

Invisible background installers (no tray UI).

## Flow

```
npm run package:binaries
        │
        ├─► dist/stage-win  ──► Inno Setup (installer.iss) ──► Setup.exe
        │
        └─► dist/stage-mac  ──► build-dmg.sh ──► POS-Print-Bridge.dmg
```

## Windows

- Autostart: Task Scheduler task “POS Print Bridge”
- Child PowerShell used by the bridge runs with `-WindowStyle Hidden` + `windowsHide`
- Installer `[Run]` uses `Flags: runhidden`

Requires Inno Setup on a Windows machine (or CI `windows-latest`).

## macOS

- Autostart: LaunchAgent `com.pos.print-bridge`
- `KeepAlive` + `RunAtLoad`, `ProcessType=Background`
- DMG contains Install.command / Uninstall.command

## Next steps (not in Phase 1)

- Authenticode sign Windows Setup.exe
- Apple notarize DMG
- GitHub Actions release on tag
