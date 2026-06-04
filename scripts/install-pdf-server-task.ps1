# Register a Windows Task Scheduler entry that starts the local PDF server
# (scripts/pdf-server.js) at each user logon. The server listens only on
# 127.0.0.1:8788 -- never exposed to the LAN.
#
# Run once (no admin needed -- task is registered under the current user):
#   powershell -ExecutionPolicy Bypass -File scripts\install-pdf-server-task.ps1
#
# Uninstall:
#   Unregister-ScheduledTask -TaskName "India Research PDF Server" -Confirm:$false
#
# Check status / next run:
#   Get-ScheduledTask -TaskName "India Research PDF Server" | Get-ScheduledTaskInfo

$taskName = "India Research PDF Server"
$repo     = "C:\Users\admin\India-Research-Portal"
$script   = Join-Path $repo "scripts\pdf-server.js"
$node     = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $script)) { Write-Error ("Missing " + $script); exit 1 }
if (-not (Test-Path $node))   { Write-Error ("Missing " + $node);   exit 1 }

# Run node directly with the server script. Working directory = repo so
# any relative paths inside the script resolve.
$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument ("`"" + $script + "`"") `
  -WorkingDirectory $repo

# Fire as soon as the user logs in.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

# Long-running service: never auto-stop, restart on failure, allow on
# battery, no execution-time limit. RestartCount/RestartInterval keep
# it alive if it crashes.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host ("Unregistering existing task: " + $taskName)
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName    $taskName `
  -Description "Serves the local broker-PDF library on http://127.0.0.1:8788/ so the research dashboard's report-title clicks open the actual PDF in a new tab." `
  -Action      $action `
  -Trigger     $trigger `
  -Principal   $principal `
  -Settings    $settings | Out-Null

# Start it right now so it's running before the user reloads the page.
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Task registered: $taskName"
Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo |
  Select-Object -Property State, LastRunTime, LastTaskResult
Write-Host ""
Write-Host "Quick check:"
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:8788/healthz" -UseBasicParsing -TimeoutSec 3
  Write-Host ("  HTTP " + $r.StatusCode + " from /healthz -- server is running.")
} catch {
  Write-Host "  Server probe failed -- check logs under scripts\logs\ or run scripts\pdf-server.js manually."
}
