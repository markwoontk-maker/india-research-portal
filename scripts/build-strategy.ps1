# Strategy-tab daily build step (invoked by daily-refresh.ps1).
#
# Gated: runs the Claude headless miner ONLY when a new India strategy PDF has
# appeared since the last successful run. Rewrites just the marked regions of
# index.html, then validates structure; on any failure it reverts index.html so
# a botched run never publishes. ALWAYS exits 0 so it never aborts the rest of
# the daily refresh.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-strategy.ps1

$ErrorActionPreference = "Continue"

$repo        = "C:\Users\admin\India-Research-Portal"
$strategyDir = "C:\Users\admin\Desktop\India Related Reports\India Strategy"
$html        = Join-Path $repo "index.html"
$mpFile      = Join-Path $repo "data\model_portfolios_house.json"
$mfFile      = Join-Path $repo "data\mf_sectors.json"
$promptFile  = Join-Path $repo "docs\strategy-build-prompt.md"
$stateFile   = Join-Path $repo "scripts\.strategy-state.json"
$claude      = "C:\Users\admin\.local\bin\claude.exe"
$model       = "sonnet"          # matches the routine convention; cheap + capable
$timeoutSec  = 900               # 15 min hard cap on the headless run

function Out-Log([string]$m){ Write-Output ("[build-strategy] " + $m) }

# --- locate claude ------------------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}

# --- gate: any strategy PDF newer than the watermark? -------------------------
if (-not (Test-Path -LiteralPath $strategyDir)) { Out-Log "strategy folder missing - skipping."; exit 0 }
$pdfs = Get-ChildItem -LiteralPath $strategyDir -Filter *.pdf -File -ErrorAction SilentlyContinue
if (-not $pdfs -or $pdfs.Count -eq 0) { Out-Log "no strategy PDFs - skipping."; exit 0 }

$maxTicks = [long](($pdfs | ForEach-Object { $_.LastWriteTimeUtc.Ticks } | Measure-Object -Maximum).Maximum)
$prevTicks = 0
if (Test-Path -LiteralPath $stateFile) {
  try { $prevTicks = [long]((Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).lastMaxTicks) } catch { $prevTicks = 0 }
}
if ($maxTicks -le $prevTicks) { Out-Log "no new strategy reports (watermark current) - skipping."; exit 0 }
Out-Log ("new strategy report detected (" + $pdfs.Count + " PDFs) - running miner...")

# --- snapshot for revert ------------------------------------------------------
Set-Location $repo
$preHash   = (Get-FileHash -LiteralPath $html -Algorithm MD5).Hash
$preHashMp = if (Test-Path -LiteralPath $mpFile) { (Get-FileHash -LiteralPath $mpFile -Algorithm MD5).Hash } else { "" }
$preHashMf = if (Test-Path -LiteralPath $mfFile) { (Get-FileHash -LiteralPath $mfFile -Algorithm MD5).Hash } else { "" }

# --- run the headless miner with a timeout ------------------------------------
if (-not (Test-Path -LiteralPath $promptFile)) { Out-Log "prompt file missing - skipping."; exit 0 }
$prompt = Get-Content -LiteralPath $promptFile -Raw

$job = Start-Job -ScriptBlock {
  param($claude,$prompt,$repo,$dir,$model)
  Set-Location $repo
  & $claude -p $prompt `
      --permission-mode bypassPermissions `
      --allowedTools Bash Read Edit Grep Glob `
      --add-dir $dir `
      --model $model 2>&1
} -ArgumentList $claude,$prompt,$repo,$strategyDir,$model

if (Wait-Job $job -Timeout $timeoutSec) {
  $out = Receive-Job $job
  if ($out) { $out | ForEach-Object { Out-Log ("claude> " + ($_ | Out-String).TrimEnd()) } }
} else {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Out-Log "miner timed out - reverting."
  & git checkout -- index.html data/model_portfolios_house.json data/mf_sectors.json 2>&1 | Out-Null
  exit 0
}
Remove-Job $job -Force -ErrorAction SilentlyContinue

# --- did anything change? -----------------------------------------------------
$postHash   = (Get-FileHash -LiteralPath $html -Algorithm MD5).Hash
$postHashMp = if (Test-Path -LiteralPath $mpFile) { (Get-FileHash -LiteralPath $mpFile -Algorithm MD5).Hash } else { "" }
$postHashMf = if (Test-Path -LiteralPath $mfFile) { (Get-FileHash -LiteralPath $mfFile -Algorithm MD5).Hash } else { "" }
if ($postHash -eq $preHash -and $postHashMp -eq $preHashMp -and $postHashMf -eq $preHashMf) {
  Out-Log "miner made no change - updating watermark only."
  @{ lastMaxTicks = $maxTicks; asOf = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  exit 0
}

# --- validate structure; revert on any failure --------------------------------
$body = Get-Content -LiteralPath $html -Raw
$checks = @{
  "STRAT:ASOF marker"        = ($body -match "STRAT:ASOF" -and $body -match "/STRAT:ASOF")
  "STRAT:GRID markers"       = ($body -match "STRAT:GRID:START" -and $body -match "STRAT:GRID:END")
  "STRAT:CHANGES markers"    = ($body -match "STRAT:CHANGES:START" -and $body -match "STRAT:CHANGES:END")
  "STRAT:HOUSES markers"     = ($body -match "STRAT:HOUSES:START" -and $body -match "STRAT:HOUSES:END")
  "STRAT:CONS markers"       = ($body -match "STRAT:CONS:START" -and $body -match "STRAT:CONS:END")
  "MAMG script intact"       = ($body -match "mamgViewDraft" -and $body -match "data/mamg-views\.json")
  "MAMG header th intact"    = ($body -match '<th class="mamg"')
  "house header columns"     = ($body -match ">JPMorgan</th>" -and $body -match ">Kotak</th>")
  "consensus heading intact" = ($body -match "Cross-Broker Consensus")
}
$failed = $checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key }

# the MAMG shared-views data file must never be touched by the miner
$touchedMamg = (& git diff --name-only -- data/mamg-views.json) -match "mamg-views"

# model_portfolios_house.json (if the miner rewrote it) must be valid JSON with houses[]
$mpBad = $false
if (Test-Path -LiteralPath $mpFile) {
  try { $mp = Get-Content -LiteralPath $mpFile -Raw | ConvertFrom-Json; if (-not $mp.houses) { $mpBad = $true } }
  catch { $mpBad = $true }
}

# mf_sectors.json (if the miner rewrote it) must be valid JSON with sectors[]
$mfBad = $false
if (Test-Path -LiteralPath $mfFile) {
  try { $mf = Get-Content -LiteralPath $mfFile -Raw | ConvertFrom-Json; if (-not $mf.sectors) { $mfBad = $true } }
  catch { $mfBad = $true }
}

if ($failed -or $touchedMamg -or $mpBad -or $mfBad) {
  if ($failed)      { Out-Log ("VALIDATION FAILED: " + ($failed -join "; ") + " - reverting.") }
  if ($touchedMamg) { Out-Log "VALIDATION FAILED: data/mamg-views.json was modified - reverting." }
  if ($mpBad)       { Out-Log "VALIDATION FAILED: model_portfolios_house.json is not valid JSON with houses[] - reverting." }
  if ($mfBad)       { Out-Log "VALIDATION FAILED: mf_sectors.json is not valid JSON with sectors[] - reverting." }
  & git checkout -- index.html data/mamg-views.json data/model_portfolios_house.json data/mf_sectors.json 2>&1 | Out-Null
  exit 0
}

# --- success: advance the watermark; daily-refresh's git step will commit ------
@{ lastMaxTicks = $maxTicks; asOf = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
Out-Log "Strategy tab + house model portfolios updated and validated."
exit 0
