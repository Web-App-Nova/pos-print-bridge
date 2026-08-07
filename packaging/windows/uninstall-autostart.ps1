# Remove POS Print Bridge autostart task and stop the process.
param(
  [string]$InstallDir = ''
)

$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'POS Print Bridge'

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Get-Process -Name 'pos-print-bridge' -ErrorAction SilentlyContinue | Stop-Process -Force

if ($InstallDir -and (Test-Path $InstallDir)) {
  # Leave file deletion to the installer uninstall step
}

Write-Output "Removed scheduled task: $taskName"
