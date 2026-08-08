$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Iss = Join-Path $PSScriptRoot "setup.iss"
$Vendor = Join-Path $PSScriptRoot "vendor"
$Node = Join-Path $Root "release\bin\win-x64\node.exe"
$Entry = Join-Path $Root "release\bin\win-x64\app\build\index.js"

if (-not ((Test-Path $Node) -and (Test-Path $Entry))) {
  throw "Missing portable Windows runtime — run npm run package:windows first"
}
if (-not (Test-Path (Join-Path $Vendor "nssm.exe"))) {
  throw @"
Missing NSSM binary at installer\windows\vendor\nssm.exe

Download NSSM from https://nssm.cc/download (win64 nssm.exe)
and place it at installer\windows\vendor\nssm.exe
"@
}

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
  throw "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php"
}

& $iscc $Iss
Write-Host "Installer written to release\windows\YourPOS-Printer-Agent-Setup.exe"
