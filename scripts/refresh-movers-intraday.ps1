# Intraday movers refresh — STANDALONE, runs on a repeating schedule through NSE
# market hours (scheduled task "India Research Portal Movers Intraday").
#
# Each run: pull latest, run the auth-free chartink scraper (scripts\refresh-
# movers.js), and if data/movers.json changed, commit + push just that file so
# the static GitHub Pages card shows near-live intraday gainers/detractors
# (<= the schedule interval stale). The daily pipeline runs the same scraper once
# more post-close for the settled EOD snapshot.
#
# The scraper self-detects the NSE session and tags the file (intraday/session),
# so running slightly outside hours is harmless (it just writes a "closed"/"pre-
# open" snapshot). Only pushes when the file actually changed -> quiet on
# holidays. Never throws; always exits 0.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\refresh-movers-intraday.ps1

$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
$node = "C:\Program Files\nodejs\node.exe"
$file = Join-Path $repo "data\movers.json"

$logDir = Join-Path $repo "scripts\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("movers-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")
function Out-Log([string]$m){ $l="[" + (Get-Date -f "HH:mm:ss") + "] [movers] " + $m; Write-Host $l; Add-Content -LiteralPath $log -Value $l }

Set-Location $repo
if (-not (Test-Path -LiteralPath $node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source } else { Out-Log "node not found - skipping."; exit 0 }
}

$preHash = if (Test-Path -LiteralPath $file) { (Get-FileHash -LiteralPath $file -Algorithm MD5).Hash } else { "" }

# Keep local main current so the push fast-forwards; --autostash tolerates dirt.
& git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }

# Run the scraper.
& $node "scripts\refresh-movers.js" 2>&1 | ForEach-Object { Out-Log ("node> " + ($_ | Out-String).TrimEnd()) }

$postHash = if (Test-Path -LiteralPath $file) { (Get-FileHash -LiteralPath $file -Algorithm MD5).Hash } else { "" }
if ($postHash -eq $preHash) { Out-Log "no change - not committing."; exit 0 }

# Validate before publishing: valid JSON with a plausible breadth count.
try {
  $j = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  if (-not $j.count -or [int]$j.count -lt 50 -or -not $j.top -or -not $j.bottom) {
    Out-Log "validation failed (count/top/bottom) - reverting."
    & git checkout -- data/movers.json 2>&1 | Out-Null
    exit 0
  }
} catch { Out-Log ("JSON parse failed - reverting: " + $_.Exception.Message); & git checkout -- data/movers.json 2>&1 | Out-Null; exit 0 }

& git add data/movers.json 2>&1 | Out-Null
$cached = & git diff --cached --stat
if ([string]::IsNullOrWhiteSpace($cached)) { Out-Log "nothing staged - exiting."; exit 0 }

$msg = "chore: intraday movers (" + $j.session + ", adv " + $j.adv + "/dec " + $j.dec + ")"
& git commit -m $msg 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }
& git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }
& git push origin main 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }
Out-Log ("published movers.json (" + $j.session + ", adv " + $j.adv + "/dec " + $j.dec + ").")
exit 0
