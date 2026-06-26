# Install the Windows Task Scheduler entry that runs weekly-strategy-refresh.ps1.
#
# Standalone task, fires WEEKLY on Friday 17:00 MYT (local time on this PC =
# Singapore Standard Time, UTC+08:00). It runs the gated Claude strategy miner
# and commits + pushes its own diff (index.html Strategy block +
# data\model_portfolios_house.json). Independent of the Mon-Fri 09:30 daily
# refresh -- the Strategy tab was moved OUT of that pipeline so its cadence is
# truly weekly.
#
# Run once (no admin needed -- registered under the current user):
#   powershell -ExecutionPolicy Bypass -File scripts\install-strategy-weekly-task.ps1
#
# Uninstall:
#   Unregister-ScheduledTask -TaskName "India Research Portal Strategy Weekly" -Confirm:$false
#
# Test now:
#   Start-ScheduledTask -TaskName "India Research Portal Strategy Weekly"

$taskName = "India Research Portal Strategy Weekly"
$repo     = "C:\Users\admin\India-Research-Portal"
$script   = Join-Path $repo "scripts\weekly-strategy-refresh.ps1"

if (-not (Test-Path $script)) {
  Write-Error ("weekly-strategy-refresh.ps1 not found at " + $script)
  exit 1
}

$ts = New-Object -ComObject Schedule.Service
$ts.Connect()
$root = $ts.GetFolder("\")

$def = $ts.NewTask(0)
$def.RegistrationInfo.Description = "Weekly Fri 17:00 MYT: runs the gated Claude strategy miner (scripts\weekly-strategy-refresh.ps1 -> scripts\build-strategy.ps1) and commits + pushes the Strategy-tab diff to GitHub Pages. Gated on a new India Strategy report since the last run."
$def.RegistrationInfo.Author      = $env:USERNAME

$s = $def.Settings
$s.AllowDemandStart           = $true
$s.AllowHardTerminate         = $true
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries     = $false
$s.StartWhenAvailable         = $true     # catch up if the PC was off at 17:00
$s.ExecutionTimeLimit         = "PT30M"   # miner self-caps at 15 min
$s.MultipleInstances          = 2         # IgnoreNew
$s.Compatibility              = 3
$s.RunOnlyIfIdle              = $false

$p = $def.Principal
$p.UserId    = "$env:USERDOMAIN\$env:USERNAME"
$p.LogonType = 3   # TASK_LOGON_INTERACTIVE_TOKEN (cached git creds work)
$p.RunLevel  = 0   # Limited

# Weekly trigger: Friday 17:00 local. TASK_TRIGGER_WEEKLY = 3.
# DaysOfWeek bitmask: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64.
$trigger = $def.Triggers.Create(3)
$trigger.Enabled       = $true
$trigger.StartBoundary = (Get-Date -Hour 17 -Minute 0 -Second 0).ToString("yyyy-MM-ddTHH:mm:ss")
$trigger.DaysOfWeek    = 32
$trigger.WeeksInterval = 1

$action = $def.Actions.Create(0)   # TASK_ACTION_EXEC
$action.Path             = "powershell.exe"
$action.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$action.WorkingDirectory = $repo

$null = $root.RegisterTaskDefinition($taskName, $def, 6, $null, $null, 3, $null)

Write-Host ""
Write-Host "Task registered: $taskName"
Write-Host "Schedule:        Fri 17:00 MYT (gated strategy miner, self-commits + pushes)"
Write-Host ""
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
  ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    [PSCustomObject]@{
      State       = $_.State
      NextRunTime = $info.NextRunTime
      LastRunTime = $info.LastRunTime
    } | Format-List
  }
