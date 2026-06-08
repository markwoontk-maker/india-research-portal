# Charts auto-ingest build step (invoked by daily-refresh.ps1).
#
# Renders ONLY report PDFs not yet in data/charts.json (idempotent by report_key),
# runs the headless Claude vision miner per new report to produce analysis.json
# (long decks are chunked by page range into analysis.part*.json), merges parts,
# and APPENDS the new exhibits + WebP crops to data/charts.json. Validates the
# manifest and reverts charts.json on failure. ALWAYS exits 0 so it never aborts
# the rest of the daily refresh. Local-only (cloud routines can't push this repo).
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\charts\build-charts.ps1

$ErrorActionPreference = "Continue"

$repo    = "C:\Users\admin\India-Research-Portal"
$cdir    = Join-Path $repo "scripts\charts"
$work    = Join-Path $repo "scripts\.charts-work"
$charts  = Join-Path $repo "data\charts.json"
$rules   = Join-Path $cdir "_run_instructions.md"
$claude  = "C:\Users\admin\.local\bin\claude.exe"
$model   = "sonnet"
$perCallTimeoutSec = 900     # 15 min hard cap per headless claude call
$chunkSize = 20              # pages per agent call for long decks (image-budget safe)
$maxNew    = 40              # cap reports charted per run; backfills the ~540-report
                            # library over ~2 weeks of weekday runs, then settles into
                            # a few new reports/day. Override per-run via CHARTS_MAX_NEW.
if ($env:CHARTS_MAX_NEW) { $maxNew = [int]$env:CHARTS_MAX_NEW }

function Out-Log([string]$m){ Write-Output ("[build-charts] " + $m) }

if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
Set-Location $repo

# --- Phase A (incremental): render only new reports ---------------------------
Out-Log "scanning for new reports (cap $maxNew/run)..."
& uv run --python 3.12 --with pymupdf python (Join-Path $cdir "render_pages.py") --incremental --limit $maxNew 2>&1 |
  ForEach-Object { Out-Log $_ }

$newFile = Join-Path $work "_new.json"
if (-not (Test-Path -LiteralPath $newFile)) { Out-Log "no _new.json - nothing to do."; exit 0 }
$new = (Get-Content -LiteralPath $newFile -Raw | ConvertFrom-Json).new
if (-not $new -or @($new).Count -eq 0) { Out-Log "no new reports."; exit 0 }
Out-Log ("new reports: " + @($new).Count)

# --- Phase B: headless Claude vision per new report ---------------------------
function Invoke-Claude([string]$prompt){
  $job = Start-Job -ScriptBlock {
    param($claude,$prompt,$repo,$model)
    Set-Location $repo
    & $claude -p $prompt --permission-mode bypassPermissions `
        --allowedTools Read Write --model $model 2>&1
  } -ArgumentList $claude,$prompt,$repo,$model
  if (Wait-Job $job -Timeout $perCallTimeoutSec) {
    Receive-Job $job | Out-Null
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Out-Log "  claude call timed out."
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}

foreach ($p in $new) {
  $slug = $p.slug; $pages = [int]$p.pages
  $dir  = Join-Path $work $slug
  $ctx  = "Source folder / theme: $($p.folder)`nBroker: $($p.house)   Date: $($p.date)`nTitle: $($p.report_title)"
  Out-Log ("analysing " + $slug + " (" + $pages + "pp)")
  if ($pages -le 28) {
    $prompt = @"
Analyze ONE broker report for a charts gallery. FIRST read the rules file and follow it EXACTLY: $rules

Report context:
$ctx

Rendered pages folder: $dir\
Pages p01.png .. p$("{0:D2}" -f $pages).png ($pages pages) - read every page.
Write JSON to: $dir\analysis.json
Report DONE when written.
"@
    Invoke-Claude $prompt
  } else {
    $part = 0
    for ($a = 1; $a -le $pages; $a += $chunkSize) {
      $part++
      $b = [Math]::Min($a + $chunkSize - 1, $pages)
      $pf = Join-Path $dir ("analysis.part{0:D2}.json" -f $part)
      $prompt = @"
Analyze PART of one broker report for a charts gallery (SPLIT job - pages $a-$b only). FIRST read the rules file and follow it EXACTLY: $rules

Report context:
$ctx

Rendered pages folder: $dir\
Read ONLY p$("{0:D2}" -f $a).png .. p$("{0:D2}" -f $b).png; use the real page numbers $a..$b. (Late pages may be disclosures/legal - skip those.)
Write JSON to this PART file: $pf  (shape {"pages":[{"page":N,"charts":[...]}]}, omit empty pages)
Report DONE when written.
"@
      Invoke-Claude $prompt
    }
  }
}

# --- merge split parts, then APPEND-crop ------------------------------------
& uv run --python 3.12 python (Join-Path $cdir "merge_parts.py") 2>&1 | ForEach-Object { Out-Log $_ }

$preHash = if (Test-Path -LiteralPath $charts) { (Get-FileHash -LiteralPath $charts -Algorithm MD5).Hash } else { "" }
& uv run --python 3.12 --with pymupdf --with pillow python (Join-Path $cdir "crop_assemble.py") --append 2>&1 |
  ForEach-Object { Out-Log $_ }

# --- validate; revert charts.json on failure ---------------------------------
$bad = $false
try {
  $j = Get-Content -LiteralPath $charts -Raw | ConvertFrom-Json
  if (-not $j.updated -or -not ($j.charts -is [array]) -or $j.charts.Count -eq 0) { $bad = $true; Out-Log "VALIDATION: charts.json malformed/empty." }
} catch { $bad = $true; Out-Log ("VALIDATION: charts.json unparseable - " + $_.Exception.Message) }

if ($bad) {
  & git checkout -- data/charts.json 2>&1 | Out-Null
  Out-Log "reverted charts.json."
  exit 0
}
$postHash = if (Test-Path -LiteralPath $charts) { (Get-FileHash -LiteralPath $charts -Algorithm MD5).Hash } else { "" }
if ($postHash -eq $preHash) { Out-Log "no new charts added - nothing to commit."; exit 0 }
Out-Log "charts.json updated."

# --- commit + push (self-contained; this runs as its own scheduled task) ------
# Rebase on the remote first so we never clash with the daily-refresh push.
& git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Out-Log ("git> " + $_) }
& git add data/charts.json charts/ 2>&1 | Out-Null
$cached = & git diff --cached --stat
if ([string]::IsNullOrWhiteSpace($cached)) { Out-Log "nothing staged."; exit 0 }
& git commit -m ("Charts auto-ingest -- " + (Get-Date -f "yyyy-MM-dd HH:mm")) 2>&1 | ForEach-Object { Out-Log ("git> " + $_) }
& git push origin main 2>&1 | ForEach-Object { Out-Log ("git> " + $_) }
exit 0
