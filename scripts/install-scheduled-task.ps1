# Install the Windows Task Scheduler entry that runs daily-refresh.ps1.
#
# Trigger chain: instead of a fixed clock time, this task fires whenever
# the upstream "Sorting Folder Rename" task finishes successfully (Task
# Scheduler Operational log event 102). The rename task is responsible
# for downloading + renaming + sorting any new broker PDFs into
# C:\Users\admin\Desktop\India Related Reports\ before this refresh runs.
# Inherits the rename task's days, so if/when that task switches from
# Mon-Fri to all 7 days, the refresh follows automatically.
#
# A 90-second delay is built in so the rename task's file handles have
# fully released before pdftotext walks the tree.
#
# Implementation note: event triggers aren't fully supported through
# Register-ScheduledTask / New-ScheduledTaskTrigger (the CIM instance
# fails parameter binding). Build the task via the COM Schedule.Service
# API instead, which is the canonical path.
#
# Run once (no admin needed -- registered under the current user):
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-task.ps1
#
# To uninstall:
#   Unregister-ScheduledTask -TaskName "India Research Portal Daily Refresh" -Confirm:$false
#
# To preview status:
#   Get-ScheduledTask -TaskName "India Research Portal Daily Refresh" | Get-ScheduledTaskInfo

$taskName     = "India Research Portal Daily Refresh"
$upstreamTask = "\Sorting Folder Rename"
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
$def.RegistrationInfo.Description = "Refreshes the India research portal (pdfdata, notes arrays, theses, financials, Trendlyne external calls, FII/DII flows) and pushes to GitHub Pages. Fires automatically when the upstream 'Sorting Folder Rename' task completes -- inherits its schedule (so switching the rename task to daily auto-promotes this one to daily too)."
$def.RegistrationInfo.Author      = $env:USERNAME

# Settings: allow on battery, start when available, no hard time-limit
# beyond 45 min. Don't stop on inactivity.
$s = $def.Settings
$s.AllowDemandStart        = $true
$s.AllowHardTerminate      = $true
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries  = $false
$s.StartWhenAvailable      = $true
$s.ExecutionTimeLimit      = "PT45M"
$s.MultipleInstances       = 2     # IgnoreNew: queue subsequent fires
$s.Compatibility           = 3     # TASK_COMPATIBILITY_V2_1 (Win7+)
$s.RunOnlyIfIdle           = $false

# Principal: current user, interactive token (so cached git creds work).
$p = $def.Principal
$p.UserId    = "$env:USERDOMAIN\$env:USERNAME"
$p.LogonType = 3   # TASK_LOGON_INTERACTIVE_TOKEN
$p.RunLevel  = 0   # TASK_RUNLEVEL_LUA (Limited)

# Event trigger: fire when EventID 102 lands on the
# Microsoft-Windows-TaskScheduler/Operational log for the upstream task.
$trigger = $def.Triggers.Create(0)   # 0 = TASK_TRIGGER_EVENT
$trigger.Enabled = $true
$trigger.Delay   = "PT90S"           # ISO-8601: 90-second debounce
$trigger.Subscription = @"
<QueryList>
  <Query Id="0" Path="Microsoft-Windows-TaskScheduler/Operational">
    <Select Path="Microsoft-Windows-TaskScheduler/Operational">
      *[System[Provider[@Name='Microsoft-Windows-TaskScheduler'] and EventID=102]] and *[EventData[Data[@Name='TaskName']='$upstreamTask']]
    </Select>
  </Query>
</QueryList>
"@

# Action: run powershell.exe with the daily-refresh script.
$action = $def.Actions.Create(0)     # 0 = TASK_ACTION_EXEC
$action.Path             = "powershell.exe"
$action.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$action.WorkingDirectory = $repo

# Register (TASK_CREATE_OR_UPDATE = 6, TASK_LOGON_INTERACTIVE_TOKEN = 3).
# Passing $null for password works because the LogonType is Interactive.
$null = $root.RegisterTaskDefinition($taskName, $def, 6, $null, $null, 3, $null)

Write-Host ""
Write-Host "Task registered: $taskName"
Write-Host "Upstream:        $upstreamTask  (refresh fires ~90 s after each completion)"
Write-Host ""
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
  ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    [PSCustomObject]@{
      State          = $_.State
      Triggers       = ($_.Triggers | ForEach-Object { $_.GetType().Name }) -join ','
      LastRunTime    = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
    } | Format-List
  }
Write-Host "Test it now with:"
Write-Host "  Start-ScheduledTask -TaskName `"$taskName`""
Write-Host ""
Write-Host "Logs land in:"
Write-Host ("  " + (Join-Path $repo "scripts\logs"))
