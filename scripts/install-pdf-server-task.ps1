# Install (or reinstall) the Windows Task Scheduler entry that keeps the
# local PDF server (scripts/pdf-server.js) running. Two triggers wire it up:
#   1. AtLogOn -- launch as soon as the user logs in.
#   2. Every 5 minutes (heartbeat) -- if the previous instance died for
#      any reason, the next heartbeat starts a fresh one. Combined with
#      MultipleInstances=IgnoreNew, a heartbeat that finds the task
#      already running is a no-op, so this is cheap.
#
# Run once (no admin needed):
#   powershell -ExecutionPolicy Bypass -File scripts\install-pdf-server-task.ps1

$ErrorActionPreference = "Stop"

$taskName = "India Research PDF Server"
$repo     = "C:\Users\admin\India-Research-Portal"
$node     = "C:\Program Files\nodejs\node.exe"
$script   = Join-Path $repo "scripts\pdf-server.js"

if (-not (Test-Path $script)) { Write-Error ("Missing " + $script); exit 1 }
if (-not (Test-Path $node))   { Write-Error ("Missing " + $node);   exit 1 }

# Schedule.Service COM API (event-style triggers + multiple-trigger config
# is more reliable through COM than through Register-ScheduledTask).
$ts = New-Object -ComObject Schedule.Service
$ts.Connect()
$root = $ts.GetFolder("\")

$def = $ts.NewTask(0)
$def.RegistrationInfo.Description = "Serves the local broker-PDF library on http://127.0.0.1:8788/ so the research dashboard's report-title clicks open the actual PDF in a new tab. Logon trigger + 5-minute heartbeat keeps it alive."
$def.RegistrationInfo.Author = $env:USERNAME

# Settings: never auto-stop, allow on battery, skip-if-running (heartbeat
# trigger fires every 5 min and would otherwise queue up).
$s = $def.Settings
$s.AllowDemandStart        = $true
$s.AllowHardTerminate      = $true
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries  = $false
$s.StartWhenAvailable      = $true
$s.ExecutionTimeLimit      = "PT0S"   # zero = no limit
$s.MultipleInstances       = 1        # TASK_INSTANCES_IGNORE_NEW
$s.Compatibility           = 3        # Win7+
$s.RunOnlyIfIdle           = $false

$p = $def.Principal
$p.UserId    = "$env:USERDOMAIN\$env:USERNAME"
$p.LogonType = 3   # TASK_LOGON_INTERACTIVE_TOKEN
$p.RunLevel  = 0   # TASK_RUNLEVEL_LUA

# Trigger 1: AtLogOn for the current user.
$t1 = $def.Triggers.Create(9)  # TASK_TRIGGER_LOGON
$t1.UserId  = "$env:USERDOMAIN\$env:USERNAME"
$t1.Enabled = $true

# Trigger 2: 5-minute heartbeat. A daily trigger with a repetition
# pattern is the canonical way to express "every N minutes forever".
$t2 = $def.Triggers.Create(2)  # TASK_TRIGGER_DAILY
$t2.StartBoundary = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
$t2.DaysInterval  = 1
$t2.Enabled       = $true
$t2.Repetition.Interval = "PT5M"   # every 5 minutes
$t2.Repetition.Duration = "P1D"    # for 24 h (re-armed each day by the daily trigger)

# Action: launch the Node server.
$a = $def.Actions.Create(0)   # TASK_ACTION_EXEC
$a.Path             = $node
$a.Arguments        = ('"' + $script + '"')
$a.WorkingDirectory = $repo

# Register (TASK_CREATE_OR_UPDATE, TASK_LOGON_INTERACTIVE_TOKEN).
$null = $root.RegisterTaskDefinition($taskName, $def, 6, $null, $null, 3, $null)

Write-Host ""
Write-Host "Task installed: $taskName"
Get-ScheduledTask -TaskName $taskName |
  Select-Object State, @{n='TriggerTypes';e={ ($_.Triggers | ForEach-Object { $_.GetType().Name }) -join ',' }} |
  Format-List
# Kick it off right now (no-op if already running).
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:8788/healthz" -UseBasicParsing -TimeoutSec 3
  Write-Host ("Server probe: HTTP " + $r.StatusCode + " -- running.")
} catch {
  Write-Host ("Server probe FAILED: " + $_.Exception.Message)
}
