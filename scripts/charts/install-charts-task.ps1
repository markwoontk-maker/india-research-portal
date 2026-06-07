# Install the Windows Task Scheduler entry that runs the charts auto-ingest
# (scripts/charts/build-charts.ps1) as its OWN weekday task.
#
# Trigger chain:  "Sorting Folder Rename"  ->  "India Research Portal Daily Refresh"
#                 ->  THIS task ("India Research Portal Charts Crop").
# It fires when the Daily Refresh task completes (Operational-log event 102), which
# itself only runs after the weekday rename/sorting task. Chaining after the refresh
# (rather than off the rename task directly) keeps the slow headless-Claude vision
# pass and its git push SEQUENTIAL with the refresh, so they never race on git.
# Because the refresh inherits the rename task's Mon-Fri schedule, this task is
# effectively a weekday task too (if the rename task ever goes daily, this follows).
#
# Run once (no admin needed -- registered under the current user):
#   powershell -ExecutionPolicy Bypass -File scripts\charts\install-charts-task.ps1
#
# Uninstall:  Unregister-ScheduledTask -TaskName "India Research Portal Charts Crop" -Confirm:$false
# Test now:   Start-ScheduledTask -TaskName "India Research Portal Charts Crop"

$taskName     = "India Research Portal Charts Crop"
$upstreamTask = "\India Research Portal Daily Refresh"
$repo         = "C:\Users\admin\India-Research-Portal"
$script       = Join-Path $repo "scripts\charts\build-charts.ps1"

if (-not (Test-Path $script)) { Write-Error ("build-charts.ps1 not found at " + $script); exit 1 }

$ts = New-Object -ComObject Schedule.Service
$ts.Connect()
$root = $ts.GetFolder("\")

$def = $ts.NewTask(0)
$def.RegistrationInfo.Description = "Renders newly-sorted broker PDFs, runs the headless-Claude vision pass to extract charts, crops them to WebP, and appends to data/charts.json (then commits + pushes). Fires after the Daily Refresh task completes -- which itself runs after the weekday 'Sorting Folder Rename' task -- so it is effectively a Mon-Fri task and never races the refresh on git."
$def.RegistrationInfo.Author = $env:USERNAME

$s = $def.Settings
$s.AllowDemandStart           = $true
$s.AllowHardTerminate         = $true
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries     = $false
$s.StartWhenAvailable         = $true
$s.ExecutionTimeLimit         = "PT4H"   # vision pass over a batch of new reports can be slow
$s.MultipleInstances          = 2        # IgnoreNew: don't start a second copy if one is running
$s.Compatibility              = 3        # TASK_COMPATIBILITY_V2_1 (Win7+)
$s.RunOnlyIfIdle              = $false

$p = $def.Principal
$p.UserId    = "$env:USERDOMAIN\$env:USERNAME"
$p.LogonType = 3   # TASK_LOGON_INTERACTIVE_TOKEN (cached git creds work)
$p.RunLevel  = 0   # Limited

# Event trigger: fire when EventID 102 (task completed) lands for the upstream task.
$trigger = $def.Triggers.Create(0)   # TASK_TRIGGER_EVENT
$trigger.Enabled = $true
$trigger.Delay   = "PT60S"
$trigger.Subscription = @"
<QueryList>
  <Query Id="0" Path="Microsoft-Windows-TaskScheduler/Operational">
    <Select Path="Microsoft-Windows-TaskScheduler/Operational">
      *[System[Provider[@Name='Microsoft-Windows-TaskScheduler'] and EventID=102]] and *[EventData[Data[@Name='TaskName']='$upstreamTask']]
    </Select>
  </Query>
</QueryList>
"@

$action = $def.Actions.Create(0)     # TASK_ACTION_EXEC
$action.Path             = "powershell.exe"
$action.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$action.WorkingDirectory = $repo

$null = $root.RegisterTaskDefinition($taskName, $def, 6, $null, $null, 3, $null)

Write-Host ""
Write-Host "Task registered: $taskName"
Write-Host "Upstream:        $upstreamTask  (charts crop fires ~60 s after each completion)"
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
Write-Host "Test it now with:  Start-ScheduledTask -TaskName `"$taskName`""
