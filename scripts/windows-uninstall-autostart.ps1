$ErrorActionPreference = "SilentlyContinue"
$TaskName = "POS Print Bridge"

Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "Auto-start removed on Windows ($TaskName)."
