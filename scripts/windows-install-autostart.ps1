param(
  [Parameter(Mandatory = $true)]
  [string]$BridgeRoot
)

$ErrorActionPreference = "Stop"
$TaskName = "POS Print Bridge"

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Write-Error "Node.js not found in PATH. Install Node.js 18+ first."
}

$BuildEntry = Join-Path $BridgeRoot "build\index.js"
if (-not (Test-Path $BuildEntry)) {
  Write-Error "Build not found at $BuildEntry. Run npm run build first."
}

$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$BuildEntry`"" -WorkingDirectory $BridgeRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "POS billing local print bridge (LAN printers)" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Auto-start enabled on Windows."
Write-Host "  Task    : $TaskName"
Write-Host "  Project : $BridgeRoot"
Write-Host "  URL     : http://127.0.0.1:9247"
Write-Host ""
Write-Host "The bridge will start automatically every time you log in."
Write-Host "To remove: npm run remove:autostart"
