# Install the Windows Task Scheduler entry that runs daily-refresh.ps1.
#
# ONE scheduled task (no chained pair). Fires Mon-Fri 09:30 MYT
# (local time on this PC = Singapore Standard Time, UTC+08:00) and
# runs the full pipeline serially -- Step 0 inside daily-refresh.ps1
# calls the user's existing
#   C:\Users\admin\.claude\sorting-folder-rename\run-rename.ps1
# (rename + sort + NotebookLM sync) before the data steps. The
# previously-separate "Sorting Folder Rename" task is DISABLED below
# so it doesn't double-run at 09:30.
#
# Run once (no admin needed -- registered under the current user):
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-task.ps1
#
# To uninstall (this task only):
#   Unregister-ScheduledTask -TaskName "India Research Portal Daily Refresh" -Confirm:$false
#
# To re-enable the separate rename task (NOT recommended -- it'd run twice):
#   Enable-ScheduledTask -TaskName "Sorting Folder Rename"
#
# To preview status:
#   Get-ScheduledTask -TaskName "India Research Portal Daily Refresh" | Get-ScheduledTaskInfo

$taskName     = "India Research Portal Daily Refresh"
$renameTask   = "Sorting Folder Rename"
$repo         = "C:\Users\admin\India-Research-Portal"
$script       = Join-Path $repo "scripts\daily-refresh.ps1"

if (-not (Test-Path $script)) {
  Write-Error ("daily-refresh.ps1 not found at " + $script)
  exit 1
}

# Connect to the Task Scheduler service. Root folder for tasks.
$ts = New-Object -ComObject Schedule.Service
$ts.Connect()
$root = $ts.GetFolder("\")

# Build a fresh task definition.
$def = $ts.NewTask(0)
$def.RegistrationInfo.Description = "Single Mon-Fri 09:30 MYT task: runs the sort+rename pipeline (delegated to C:\Users\admin\.claude\sorting-folder-rename\run-rename.ps1) and then the full India research-portal refresh (pdfdata, notes/prior, Trendlyne, theses, financials, FII/DII, highs, positioning, Company QA, House-View notes). Commits + pushes to GitHub Pages at the end."
$def.RegistrationInfo.Author      = $env:USERNAME

# Settings: allow on battery, start when available, generous time limit
# (the rename step adds ~5-15 min on top of the data pipeline).
$s = $def.Settings
$s.AllowDemandStart        = $true
$s.AllowHardTerminate      = $true
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries  = $false
$s.StartWhenAvailable      = $true
$s.ExecutionTimeLimit      = "PT90M"
$s.MultipleInstances       = 2     # IgnoreNew: queue subsequent fires
$s.Compatibility           = 3     # TASK_COMPATIBILITY_V2_1 (Win7+)
$s.RunOnlyIfIdle           = $false

# Principal: current user, interactive token (so cached git creds work).
$p = $def.Principal
$p.UserId    = "$env:USERDOMAIN\$env:USERNAME"
$p.LogonType = 3   # TASK_LOGON_INTERACTIVE_TOKEN
$p.RunLevel  = 0   # TASK_RUNLEVEL_LUA (Limited)

# Weekly trigger: Mon-Fri 09:30 local time.
# TASK_TRIGGER_WEEKLY = 3
# DaysOfWeek bitmask: Mon=2, Tue=4, Wed=8, Thu=16, Fri=32  -> 62
$trigger = $def.Triggers.Create(3)
$trigger.Enabled       = $true
$trigger.StartBoundary = (Get-Date -Hour 9 -Minute 30 -Second 0).ToString("yyyy-MM-ddTHH:mm:ss")
$trigger.DaysOfWeek    = 62
$trigger.WeeksInterval = 1

# Action: run powershell.exe with the daily-refresh script.
$action = $def.Actions.Create(0)     # 0 = TASK_ACTION_EXEC
$action.Path             = "powershell.exe"
$action.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$action.WorkingDirectory = $repo

# Register (TASK_CREATE_OR_UPDATE = 6, TASK_LOGON_INTERACTIVE_TOKEN = 3).
$null = $root.RegisterTaskDefinition($taskName, $def, 6, $null, $null, 3, $null)

# Disable the previously-separate "Sorting Folder Rename" task so it
# doesn't fire at 09:30 alongside this merged one. Leave it registered
# (just disabled) so the user can re-enable it if they want to split
# the pipeline again later.
$existingRename = Get-ScheduledTask -TaskName $renameTask -ErrorAction SilentlyContinue
if ($existingRename) {
  if ($existingRename.State -ne "Disabled") {
    Disable-ScheduledTask -TaskName $renameTask | Out-Null
    Write-Host ("Disabled task: " + $renameTask + "  (now driven from daily-refresh Step 0)")
  } else {
    Write-Host ("Already disabled: " + $renameTask)
  }
}

Write-Host ""
Write-Host "Task registered: $taskName"
Write-Host "Schedule:        Mon-Fri 09:30 MYT (Step 0 = rename+sort, then full data refresh)"
Write-Host ""
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
  ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    [PSCustomObject]@{
      State          = $_.State
      NextRunTime    = $info.NextRunTime
      LastRunTime    = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
    } | Format-List
  }
Write-Host "Test it now with:"
Write-Host "  Start-ScheduledTask -TaskName `"$taskName`""
Write-Host ""
Write-Host "Logs land in:"
Write-Host ("  " + (Join-Path $repo "scripts\logs"))
