# Register "India Positioning Refresh": runs refresh-positioning-task.ps1 at 12:00
# on days 15-31 of every month. The script's gate makes the 15th the real start:
# the first run that updates files closes that month's window and the rest of
# the month is a no-op; a failed run (auth lapse, sources not yet published)
# retries the next day.
#
# Registered through the Task Scheduler COM API because PowerShell 5.1's
# New-ScheduledTaskTrigger has no monthly trigger, and schtasks.exe would apply
# Windows' default settings (StartWhenAvailable off, batteries disallowed) --
# that is exactly how the FII/DII task silently missed 21-22 Jul 2026.
#
# Run once:   powershell -ExecutionPolicy Bypass -File scripts\install-positioning-task.ps1
# Uninstall:  Unregister-ScheduledTask -TaskName "India Positioning Refresh" -Confirm:$false

$taskName = "India Positioning Refresh"
$repo     = "C:\Users\admin\India-Research-Portal"
$script   = Join-Path $repo "scripts\refresh-positioning-task.ps1"
if (-not (Test-Path $script)) { Write-Error ("not found: " + $script); exit 1 }

$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$def = $svc.NewTask(0)
$def.RegistrationInfo.Description = "Monthly refresh of FPI sector positioning, MF category flows, SIP flows and model portfolios (headless Claude miner). Days 15-31 at 12:00; the first successful run each month closes the window. Commits + pushes its own four data files."

$s = $def.Settings
$s.Enabled                    = $true
$s.StartWhenAvailable         = $true     # PC off/asleep at 12:00 -> run once it's back
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries     = $false
$s.ExecutionTimeLimit         = "PT1H"    # miner itself is capped at 35 min
$s.MultipleInstances          = 2         # IgnoreNew
$s.RestartCount               = 3
$s.RestartInterval            = "PT10M"

$t = $def.Triggers.Create(4)              # TASK_TRIGGER_MONTHLY
$mask = 0; foreach ($d in 15..31) { $mask = $mask -bor (1 -shl ($d - 1)) }
$t.DaysOfMonth   = $mask                  # days 15..31
$t.MonthsOfYear  = 0xFFF                  # every month
$t.StartBoundary = (Get-Date -Day 1 -Hour 12 -Minute 0 -Second 0).ToString("yyyy-MM-ddTHH:mm:ss")
$t.Enabled       = $true

$a = $def.Actions.Create(0)               # TASK_ACTION_EXEC
$a.Path             = "powershell.exe"
$a.Arguments        = '-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"'
$a.WorkingDirectory = $repo

$def.Principal.LogonType = 3              # interactive token (current user)
$def.Principal.RunLevel  = 0              # limited

$null = $svc.GetFolder("\").RegisterTaskDefinition($taskName, $def, 6, $null, $null, 3)   # 6 = create or update

$task = Get-ScheduledTask -TaskName $taskName
$info = $task | Get-ScheduledTaskInfo
Write-Output ("Registered '" + $taskName + "'")
Write-Output ("  StartWhenAvailable=" + $task.Settings.StartWhenAvailable + "  batteriesOK=" + (-not $task.Settings.DisallowStartIfOnBatteries) + "  restarts=" + $task.Settings.RestartCount)
Write-Output ("  NextRunTime=" + $info.NextRunTime)
