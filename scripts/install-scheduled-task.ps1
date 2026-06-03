# Install the Windows Task Scheduler entry that runs daily-refresh.ps1
# every Monday-Friday at 10:00 local time.
#
# Run once (no admin needed -- registered under the current user):
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-task.ps1
#
# To uninstall:
#   Unregister-ScheduledTask -TaskName "India Research Portal Daily Refresh" -Confirm:$false
#
# To preview the schedule:
#   Get-ScheduledTask -TaskName "India Research Portal Daily Refresh" | Get-ScheduledTaskInfo

$taskName = "India Research Portal Daily Refresh"
$repo     = "C:\Users\admin\India-Research-Portal"
$script   = Join-Path $repo "scripts\daily-refresh.ps1"

if (-not (Test-Path $script)) {
  Write-Error ("daily-refresh.ps1 not found at " + $script)
  exit 1
}

# Run powershell.exe with bypass policy + the daily-refresh script, working
# directory set to the repo so relative paths in the script resolve.
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $script + "`"") `
  -WorkingDirectory $repo

# 10:00 local time, Monday through Friday.
$trigger = New-ScheduledTaskTrigger `
  -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday `
  -At 10:00am

# Run under the current user, only when the user is logged on (so git
# can use cached HTTPS credentials from Windows Credential Manager).
# Wake the machine if asleep, fire even if the scheduled time was missed
# (e.g. machine off at 10:00 -- runs as soon as it boots).
$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

# Unregister any prior version, then register fresh.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host ("Unregistering existing task: " + $taskName)
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName    $taskName `
  -Description "Refreshes the India research portal (pdfdata, notes arrays, Trendlyne external calls) and pushes to GitHub Pages." `
  -Action      $action `
  -Trigger     $trigger `
  -Principal   $principal `
  -Settings    $settings | Out-Null

Write-Host ""
Write-Host "Task registered: $taskName"
Write-Host "Next run:"
Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo |
  Select-Object -Property LastRunTime, NextRunTime, LastTaskResult
Write-Host ""
Write-Host "Test it now with:"
Write-Host "  Start-ScheduledTask -TaskName `"$taskName`""
Write-Host ""
Write-Host "Logs land in:"
Write-Host ("  " + (Join-Path $repo "scripts\logs"))
