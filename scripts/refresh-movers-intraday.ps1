# Intraday movers refresh — STANDALONE, runs on a repeating schedule through NSE
# market hours (scheduled task "India Research Portal Movers Intraday").
#
# Each run: pull latest, run the auth-free chartink scraper (scripts\refresh-
# movers.js) plus the Watchlist quotes refresher (scripts\refresh-wl-quotes.js,
# LTP/1D/1W/1M/YTD + Nifty 500 history), and commit + push whichever of
# data/movers.json / data/wl_quotes.json changed, so the static GitHub Pages
# cards show near-live intraday gainers/detractors and Watchlist prices
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

$qfile = Join-Path $repo "data\wl_quotes.json"
$sfile = Join-Path $repo "data\sectors.json"
function FileHash([string]$p){ if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" } }
$preHash = FileHash $file
$preQ = FileHash $qfile
$preS = FileHash $sfile

# Keep local main current so the push fast-forwards; --autostash tolerates dirt.
& git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }

# Run the scrapers: movers (breadth/top-bottom) + Watchlist quotes (LTP/1D/1W/1M/YTD +
# Nifty 500 history) + sectors (Sector Performance bars/detail + Desk Snapshot).
# The browser can't fetch Yahoo (CORS), so the page reads these committed files.
& $node "scripts\refresh-movers.js" 2>&1 | ForEach-Object { Out-Log ("node> " + ($_ | Out-String).TrimEnd()) }
& $node "scripts\refresh-wl-quotes.js" 2>&1 | ForEach-Object { Out-Log ("node> " + ($_ | Out-String).TrimEnd()) }
& $node "scripts\refresh-sectors.js" 2>&1 | ForEach-Object { Out-Log ("node> " + ($_ | Out-String).TrimEnd()) }

$moversChanged = (FileHash $file) -ne $preHash
$quotesChanged = (FileHash $qfile) -ne $preQ
$sectorsChanged = (FileHash $sfile) -ne $preS
if (-not $moversChanged -and -not $quotesChanged -and -not $sectorsChanged) { Out-Log "no change - not committing."; exit 0 }

# Validate before publishing: movers = valid JSON with a plausible breadth count.
$j = $null
if ($moversChanged) {
  try {
    $j = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if (-not $j.count -or [int]$j.count -lt 50 -or -not $j.top -or -not $j.bottom) {
      Out-Log "movers validation failed (count/top/bottom) - reverting."
      & git checkout -- data/movers.json 2>&1 | Out-Null; $moversChanged = $false
    }
  } catch { Out-Log ("movers JSON parse failed - reverting: " + $_.Exception.Message); & git checkout -- data/movers.json 2>&1 | Out-Null; $moversChanged = $false }
}
# quotes = valid JSON with at least 50 symbols.
if ($quotesChanged) {
  try {
    $jq = Get-Content -LiteralPath $qfile -Raw | ConvertFrom-Json
    $nq = ($jq.q.PSObject.Properties | Measure-Object).Count
    if ($nq -lt 50) { Out-Log ("quotes validation failed (" + $nq + " symbols) - reverting."); & git checkout -- data/wl_quotes.json 2>&1 | Out-Null; $quotesChanged = $false }
  } catch { Out-Log ("quotes JSON parse failed - reverting: " + $_.Exception.Message); & git checkout -- data/wl_quotes.json 2>&1 | Out-Null; $quotesChanged = $false }
}
# sectors = valid JSON with 14 sectors + >=80 member quotes.
if ($sectorsChanged) {
  try {
    $js = Get-Content -LiteralPath $sfile -Raw | ConvertFrom-Json
    $ns = ($js.sectors | Measure-Object).Count
    $nm = ($js.q.PSObject.Properties | Measure-Object).Count
    if ($ns -lt 10 -or $nm -lt 80) { Out-Log ("sectors validation failed (" + $ns + " sectors / " + $nm + " members) - reverting."); & git checkout -- data/sectors.json 2>&1 | Out-Null; $sectorsChanged = $false }
  } catch { Out-Log ("sectors JSON parse failed - reverting: " + $_.Exception.Message); & git checkout -- data/sectors.json 2>&1 | Out-Null; $sectorsChanged = $false }
}
if (-not $moversChanged -and -not $quotesChanged -and -not $sectorsChanged) { Out-Log "nothing valid to publish - exiting."; exit 0 }

if ($moversChanged) { & git add data/movers.json 2>&1 | Out-Null }
if ($quotesChanged) { & git add data/wl_quotes.json 2>&1 | Out-Null }
if ($sectorsChanged) { & git add data/sectors.json 2>&1 | Out-Null }
$cached = & git diff --cached --stat
if ([string]::IsNullOrWhiteSpace($cached)) { Out-Log "nothing staged - exiting."; exit 0 }

$extra = (@(if ($quotesChanged) { "watchlist quotes" }; if ($sectorsChanged) { "sectors" }) | Where-Object { $_ }) -join " + "
$msg = if ($moversChanged) { "chore: intraday movers (" + $j.session + ", adv " + $j.adv + "/dec " + $j.dec + ")" + $(if ($extra) { " + " + $extra } else { "" }) } `
       elseif ($extra) { "chore: intraday " + $extra } `
       else { "chore: intraday refresh" }
& git commit -m $msg 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }
& git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }
& git push origin main 2>&1 | ForEach-Object { Out-Log ("git> " + ($_ | Out-String).TrimEnd()) }
Out-Log ("published: " + $msg)
exit 0
