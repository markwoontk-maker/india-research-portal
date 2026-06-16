# Register the Windows Task Scheduler entry that runs refresh-fii-dii-task.ps1
# every weekday (Mon-Fri) at 9:00 AM local time. Registered under the current
# user (no admin needed). StartWhenAvailable so a missed 9 AM (PC asleep) runs
# as soon as the machine is back.
#
# Run once:   powershell -ExecutionPolicy Bypass -File scripts\install-fii-dii-task.ps1
# Uninstall:  Unregister-ScheduledTask -TaskName "India FII-DII Refresh" -Confirm:$false
# Status:     Get-ScheduledTask -TaskName "India FII-DII Refresh" | Get-ScheduledTaskInfo

$taskName = "India FII-DII Refresh"
$repo     = "C:\Users\admin\India-Research-Portal"
$script   = Join-Path $repo "scripts\refresh-fii-dii-task.ps1"

if (-not (Test-Path $script)) { Write-Error ("not found: " + $script); exit 1 }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"') `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 9:00AM

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Appends the latest daily FII/DII cash-market net flows to data/fii_dii.json and pushes to GitHub Pages. Runs Mon-Fri 9:00 AM local time. Idempotent." `
  -Force | Out-Null

# New-ScheduledTaskTrigger -Weekly anchors StartBoundary ~a week ahead, which would
# delay the first run by a week. Pull it into the past so Task Scheduler fires on
# the next matching weekday. Set after registration (the pre-register property
# assignment doesn't persist for weekly CIM triggers).
$task = Get-ScheduledTask -TaskName $taskName
$task.Triggers[0].StartBoundary = (Get-Date).AddDays(-7).ToString("yyyy-MM-ddT09:00:00")
$task | Set-ScheduledTask | Out-Null

Write-Output ("Registered '" + $taskName + "' (Mon-Fri 9:00 AM).")
Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo | Select-Object NextRunTime, LastRunTime, LastTaskResult | Format-List
