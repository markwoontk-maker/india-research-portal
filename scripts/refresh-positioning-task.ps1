# Monthly Positioning refresh -- FPI Sector Positioning, MF Category Flows,
# MF SIP Flows (+ Total Monthly Equity MF Flows) and Model Portfolios.
#
# Run by the Windows scheduled task "India Positioning Refresh" at 12:00 on days
# 15-31 of every month (install: scripts\install-positioning-task.ps1). Runs
# build-positioning.ps1, whose gate opens one window per month on the 15th: the
# first run that actually updates files closes the window, so the remaining days
# of the month are a sub-second no-op, and a failed run retries the next day.
#
# Owns the commit for its four files (they were removed from daily-refresh's
# git-add list). Commits only those four, rebases onto origin before pushing so a
# concurrent push from another task never makes it fail. Always exits 0.

$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
Set-Location $repo

$logDir = Join-Path $repo "scripts\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("positioning-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")
function Log([string]$m){ $l = "[" + (Get-Date -f "HH:mm:ss") + "] " + $m; Write-Host $l; Add-Content -LiteralPath $log -Value $l }

$files = @("data/fpi_sectors.json","data/mf_categories.json","data/sip_flows.json","data/model_portfolios.json")

Log "Positioning refresh start"
& powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-positioning.ps1" 2>&1 |
  ForEach-Object { Log (($_ | Out-String).TrimEnd()) }

$dirty = @(& git status --porcelain -- $files)
if ($dirty.Count -gt 0) {
  & git add -- $files
  & git commit -m ("chore: monthly positioning refresh -- " + (Get-Date -f "yyyy-MM-dd HH:mm")) 2>&1 | ForEach-Object { Log ("commit> " + ($_ | Out-String).TrimEnd()) }
  & git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Log ("pull> " + ($_ | Out-String).TrimEnd()) }
  & git push origin main 2>&1 | ForEach-Object { Log ("push> " + ($_ | Out-String).TrimEnd()) }
  if ($LASTEXITCODE -ne 0) {
    Log "push rejected - rebasing once more and retrying"
    & git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Log ("pull> " + ($_ | Out-String).TrimEnd()) }
    & git push origin main 2>&1 | ForEach-Object { Log ("push> " + ($_ | Out-String).TrimEnd()) }
  }
  Log "committed + pushed"
} else {
  Log "no positioning changes to commit"
}
Log "done"
exit 0
