# NSSM (Non-Sucking Service Manager)

Place the 64-bit `nssm.exe` in this folder before building the Windows installer.

1. Download from https://nssm.cc/download
2. Extract `win64/nssm.exe`
3. Copy to `installer/windows/vendor/nssm.exe`

The Inno Setup script bundles this binary and uses it to register the
`POSPrintBridge` Windows Service.
