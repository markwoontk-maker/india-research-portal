# Highs (ATH + 52-week-high) daily build step (invoked by daily-refresh.ps1).
#
# Runs the Claude headless miner using docs/highs-refresher-prompt.md to refresh
# data/highs.json from Dhan (ATH list) + Groww (Nifty 500 52-week-high list) +
# the Nifty 500 constituents CSV. Validates JSON structure; reverts on any
# failure. ALWAYS exits 0 so it never aborts the rest of the daily refresh.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-highs.ps1

$ErrorActionPreference = "Continue"

$repo       = "C:\Users\admin\India-Research-Portal"
$file       = Join-Path $repo "data\highs.json"
$promptFile = Join-Path $repo "docs\highs-refresher-prompt.md"
$claude     = "C:\Users\admin\.local\bin\claude.exe"
$model      = "sonnet"          # cheap + capable; same convention as build-strategy
$timeoutSec = 600               # 10 min hard cap on the headless run

function Out-Log([string]$m){ Write-Output ("[build-highs] " + $m) }

# --- locate claude ------------------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
if (-not (Test-Path -LiteralPath $promptFile)) { Out-Log "prompt file missing - skipping."; exit 0 }

# --- snapshot for revert ------------------------------------------------------
Set-Location $repo
$preHash = if (Test-Path -LiteralPath $file) { (Get-FileHash -LiteralPath $file -Algorithm MD5).Hash } else { "" }

# --- run the headless miner with a timeout ------------------------------------
$prompt = Get-Content -LiteralPath $promptFile -Raw

$job = Start-Job -ScriptBlock {
  param($claude,$prompt,$repo,$model)
  Set-Location $repo
  & $claude -p $prompt `
      --permission-mode bypassPermissions `
      --allowedTools Bash Read Edit Write WebFetch `
      --model $model 2>&1
} -ArgumentList $claude,$prompt,$repo,$model

if (Wait-Job $job -Timeout $timeoutSec) {
  $out = Receive-Job $job
  if ($out) { $out | ForEach-Object { Out-Log ("claude> " + ($_ | Out-String).TrimEnd()) } }
} else {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Out-Log "miner timed out - reverting."
  & git checkout -- data/highs.json 2>&1 | Out-Null
  exit 0
}
Remove-Job $job -Force -ErrorAction SilentlyContinue

# --- did anything change? -----------------------------------------------------
$postHash = if (Test-Path -LiteralPath $file) { (Get-FileHash -LiteralPath $file -Algorithm MD5).Hash } else { "" }
if ($postHash -eq $preHash) {
  Out-Log "miner made no change (sources may have been unreachable)."
  exit 0
}

# --- validate structure; revert on any failure --------------------------------
$bad = $false
try {
  $j = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  if (-not $j.asOf -or $j.asOf -notmatch "^\d{4}-\d{2}-\d{2}$") { $bad = $true; Out-Log "VALIDATION: asOf missing or malformed." }
  if (-not ($j.ath -is [array]) -or -not ($j.w52 -is [array])) { $bad = $true; Out-Log "VALIDATION: ath/w52 must be arrays." }
  if (-not $bad) {
    foreach ($r in @($j.ath)) {
      if (-not $r.name -or $null -eq $r.cmp -or $null -eq $r.ath) { $bad = $true; Out-Log "VALIDATION: ath row missing name/cmp/ath."; break }
    }
  }
  if (-not $bad) {
    foreach ($r in @($j.w52)) {
      if (-not $r.name -or $null -eq $r.cmp -or $null -eq $r.w52h) { $bad = $true; Out-Log "VALIDATION: w52 row missing name/cmp/w52h."; break }
    }
  }
  if (-not $bad -and $j.ath.Count -eq 0 -and $j.w52.Count -eq 0) {
    $bad = $true; Out-Log "VALIDATION: both lists empty - treating as fetch failure."
  }
} catch { $bad = $true; Out-Log ("VALIDATION: JSON parse failed - " + $_.Exception.Message) }

if ($bad) {
  & git checkout -- data/highs.json 2>&1 | Out-Null
  Out-Log "Reverted data/highs.json."
  exit 0
}

Out-Log ("Refreshed data/highs.json (asOf " + $j.asOf + ", ath=" + $j.ath.Count + ", w52=" + $j.w52.Count + ").")
exit 0
