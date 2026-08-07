# Install hidden Task Scheduler autostart for POS Print Bridge.
# Run elevated or as the logged-in user. No interactive window when called with -WindowStyle Hidden.
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path $InstallDir 'pos-print-bridge.exe'
if (-not (Test-Path $exe)) {
  throw "Bridge executable not found: $exe"
}

$taskName = 'POS Print Bridge'
# Remove previous task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

# Hidden / background — no console
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Local POS print bridge (127.0.0.1:9247) — runs hidden at logon' `
  -Force | Out-Null

# Start immediately (hidden)
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started scheduled task: $taskName"
