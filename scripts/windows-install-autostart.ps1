param(
  [Parameter(Mandatory = $true)]
  [string]$BridgeRoot
)

$ErrorActionPreference = "Stop"
$ServiceName = "POSPrintBridge"

$PackagedDir = Join-Path $BridgeRoot "release\bin\win-x64"
$Node = Join-Path $PackagedDir "node.exe"
$Entry = Join-Path $PackagedDir "app\build\index.js"
$NssmVendor = Join-Path $BridgeRoot "installer\windows\vendor\nssm.exe"
$BuildEntry = Join-Path $BridgeRoot "build\index.js"
$DataDir = Join-Path $env:ProgramData "POS Print Bridge"
$LogDir = Join-Path $DataDir "logs"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Prefer Windows Service via NSSM when portable runtime + nssm present
if ((Test-Path $Node) -and (Test-Path $Entry) -and (Test-Path $NssmVendor)) {
  Copy-Item $NssmVendor (Join-Path $PackagedDir "nssm.exe") -Force
  $script = Join-Path $BridgeRoot "installer\windows\install-service.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script -InstallDir $PackagedDir
  return
}

# Fallback: Scheduled Task with system Node (dev)
$NodeCmd = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeCmd) {
  Write-Error "Node.js not found. Run npm run package:windows and place nssm.exe in installer\windows\vendor\"
}

if (-not (Test-Path $BuildEntry)) {
  Write-Error "Build not found at $BuildEntry. Run npm run build first."
}

Unregister-ScheduledTask -TaskName "POS Print Bridge" -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction -Execute $NodeCmd -Argument "`"$BuildEntry`"" -WorkingDirectory $BridgeRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName "POS Print Bridge" `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "POS billing local Printer Agent (dev scheduled task)" `
  -Force | Out-Null

Start-ScheduledTask -TaskName "POS Print Bridge"

Write-Host ""
Write-Host "Auto-start enabled on Windows (Scheduled Task — Node/dev mode)."
Write-Host "  For production Windows Service: npm run package:windows + NSSM in installer\windows\vendor\"
Write-Host "  URL     : http://127.0.0.1:9247"
