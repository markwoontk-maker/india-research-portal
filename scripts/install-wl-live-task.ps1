# Registers "India Research Portal Live Quotes": starts scripts\refresh-wl-live.js at 11:40 MYT
# (09:10 IST) on weekdays. The script loops through NSE hours and exits at 15:40 IST by itself.
# It is one long-running hidden process, not a repeating trigger, so nothing flashes on screen
# every 2 minutes. StartWhenAvailable catches up if the PC was asleep at 11:40.
#
# Install / reinstall:  powershell -ExecutionPolicy Bypass -File scripts\install-wl-live-task.ps1

$repo = "C:\Users\admin\India-Research-Portal"
$node = "C:\Program Files\nodejs\node.exe"
$name = "India Research Portal Live Quotes"

$cmd = "& '" + $node + "' '" + $repo + "\scripts\refresh-wl-live.js'"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"" + $cmd + "`"") -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "11:40"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 8) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output ("Registered: " + $name)
