# Weekly Strategy-tab refresh (standalone scheduled task, Fri 17:00 MYT).
#
# Runs the gated Claude headless strategy miner (scripts\build-strategy.ps1),
# which rewrites the Strategy block in index.html + data\model_portfolios_house.json
# ONLY when a new India Strategy report has landed since the last run (validates
# the result and reverts on failure). Then commits + pushes its own diff, like
# build-highs.ps1 / the charts crop. Always exits 0.
#
# Registered by scripts\install-strategy-weekly-task.ps1 as
#   "India Research Portal Strategy Weekly"  (weekly, Friday 17:00 local).
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\weekly-strategy-refresh.ps1

$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
Set-Location $repo

$logDir = Join-Path $repo "scripts\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("strategy-weekly-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")
function Log([string]$m){ $line = "[" + (Get-Date -f "HH:mm:ss") + "] " + $m; Write-Host $line; Add-Content -LiteralPath $log -Value $line }
function Run([string]$tag, [scriptblock]$b){ & $b 2>&1 | ForEach-Object { Log ($tag + "> " + ($_ | Out-String).TrimEnd()) } }

Log ("Weekly strategy refresh start -- repo: " + $repo)

# Sync first so the miner's revert-on-failure (git checkout) and the final push
# operate on an up-to-date tree. Skip the pull if the tree is dirty (a rebase
# would abort); the post-commit pull below still resyncs before pushing.
$dirty = & git status --porcelain
if ([string]::IsNullOrWhiteSpace($dirty)) { Run "git" { git pull --rebase } }
else { Log "working tree not clean -- skipping initial pull --rebase" }

# Gated miner: updates index.html STRAT blocks + model_portfolios_house.json
# only when a new strategy report appeared; validates + reverts on failure.
Run "strategy" { powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-strategy.ps1" }

# Commit + push only the strategy outputs, if they changed.
$changed = & git status --porcelain -- index.html data/model_portfolios_house.json
if ([string]::IsNullOrWhiteSpace($changed)) {
  Log "No strategy changes to publish."
} else {
  Run "git" { git add index.html data/model_portfolios_house.json }
  $msg = "Weekly strategy refresh -- " + (Get-Date -f "yyyy-MM-dd HH:mm")
  Run "git" { git commit -m $msg }
  Run "git" { git pull --rebase }   # tree is clean after commit; safe to rebase
  Run "git" { git push origin main }
  Log "Published strategy update."
}

Log "Weekly strategy refresh done."
exit 0
