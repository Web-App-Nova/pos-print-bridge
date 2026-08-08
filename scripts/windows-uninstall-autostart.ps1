$ErrorActionPreference = "SilentlyContinue"
$TaskName = "POS Print Bridge"
$ServiceName = "POSPrintBridge"

# Remove Windows Service if present
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  $nssmCandidates = @(
    (Join-Path $PSScriptRoot "..\release\bin\win-x64\nssm.exe"),
    (Join-Path $PSScriptRoot "..\installer\windows\vendor\nssm.exe")
  )
  $nssm = $nssmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($nssm) {
    & $nssm stop $ServiceName confirm
    Start-Sleep -Seconds 1
    & $nssm remove $ServiceName confirm
  } else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
  }
  Write-Host "Windows Service removed ($ServiceName)."
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Auto-start removed on Windows."
