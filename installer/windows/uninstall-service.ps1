param(
  [Parameter(Mandatory = $false)]
  [string]$InstallDir = ""
)

$ErrorActionPreference = "SilentlyContinue"
$ServiceName = "POSPrintBridge"

$Nssm = $null
if ($InstallDir) {
  $candidate = Join-Path $InstallDir "nssm.exe"
  if (Test-Path $candidate) { $Nssm = $candidate }
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($Nssm) {
    & $Nssm stop $ServiceName confirm
    Start-Sleep -Seconds 1
    & $Nssm remove $ServiceName confirm
  } else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
  }
}

Unregister-ScheduledTask -TaskName "POS Print Bridge" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "POS Print Bridge service removed."
