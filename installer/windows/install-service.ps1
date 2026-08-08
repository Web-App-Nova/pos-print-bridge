param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$ServiceName = "POSPrintBridge"
$DisplayName = "POS Print Bridge"
$Node = Join-Path $InstallDir "node.exe"
$Entry = Join-Path $InstallDir "app\build\index.js"
$Nssm = Join-Path $InstallDir "nssm.exe"
$DataDir = Join-Path $env:ProgramData "POS Print Bridge"
$LogDir = Join-Path $DataDir "logs"
$ConfigPath = Join-Path $DataDir "config.json"

if (-not (Test-Path $Node)) { throw "Node runtime not found: $Node" }
if (-not (Test-Path $Entry)) { throw "Agent entry not found: $Entry" }
if (-not (Test-Path $Nssm)) { throw "NSSM not found: $Nssm" }

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $ConfigPath)) {
  @{
    version = 1
    environment = "production"
    host = "127.0.0.1"
    port = 9247
    authToken = ""
    printers = @()
    updateChannel = "stable"
    updateUrl = ""
    maxRetries = 2
    retryDelayMs = 1500
  } | ConvertTo-Json -Depth 5 | Set-Content -Path $ConfigPath -Encoding UTF8
}

Unregister-ScheduledTask -TaskName "POS Print Bridge" -Confirm:$false -ErrorAction SilentlyContinue

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  & $Nssm stop $ServiceName confirm 2>$null
  Start-Sleep -Seconds 1
  & $Nssm remove $ServiceName confirm 2>$null
  Start-Sleep -Seconds 1
}

& $Nssm install $ServiceName $Node
& $Nssm set $ServiceName AppParameters "`"$Entry`""
& $Nssm set $ServiceName AppDirectory $InstallDir
& $Nssm set $ServiceName DisplayName $DisplayName
& $Nssm set $ServiceName Description "POS Printer Agent — localhost print API for POS billing"
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $LogDir "service-stdout.log")
& $Nssm set $ServiceName AppStderr (Join-Path $LogDir "service-stderr.log")
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateBytes 5242880
& $Nssm set $ServiceName AppEnvironmentExtra "POS_PRINT_BRIDGE_ENV=production" "POS_PRINT_BRIDGE_DATA_DIR=$DataDir" "POS_PRINT_BRIDGE_LOG_DIR=$LogDir" "POS_PRINT_BRIDGE_HOST=127.0.0.1" "POS_PRINT_BRIDGE_PORT=9247" "POS_PRINT_BRIDGE_INSTALL_DIR=$InstallDir"
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 2000

Start-Service -Name $ServiceName

$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:9247/health" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}

if (-not $ok) {
  Write-Warning "Service installed but health check did not succeed yet. Check logs in $LogDir"
} else {
  Write-Host "POS Print Bridge service is running. Health OK at http://127.0.0.1:9247/health"
}
