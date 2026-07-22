# Positioning-data build step (invoked by daily-refresh.ps1).
#
# Runs the Claude headless miner against docs/positioning-data-refresher-prompt.md
# to refresh the four web-sourced positioning data files:
#   data/fpi_sectors.json, data/mf_categories.json, data/sip_flows.json,
#   data/model_portfolios.json
# This replaces the cloud "Positioning Data Refresher" routine, whose git push
# silently fails (the CCR env clones the public repo read-only). Running locally
# means daily-refresh's git step actually publishes the result.
#
# Gated: fires at most twice a month (a "H1" window on/after the 2nd, a "H2"
# window on/after the 17th) to mirror the old 2nd/17th cron and avoid burning a
# 15-min headless run every day. Per-file validation: a file that comes back
# malformed is reverted individually; the valid ones are kept. ALWAYS exits 0 so
# it never aborts the rest of the daily refresh.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-positioning.ps1

$ErrorActionPreference = "Continue"

$repo       = "C:\Users\admin\India-Research-Portal"
$node       = "C:\Program Files\nodejs\node.exe"
$promptFile = Join-Path $repo "docs\positioning-data-refresher-prompt.md"
$stateFile  = Join-Path $repo "scripts\.positioning-state.json"
$claude     = "C:\Users\admin\.local\bin\claude.exe"
$model      = "sonnet"
$timeoutSec = 1200

function Out-Log([string]$m){ Write-Output ("[build-positioning] " + $m) }

# Each file -> a node validation expression (throws on a malformed result).
$validators = [ordered]@{
  "data/fpi_sectors.json"      = 'const d=require("./data/fpi_sectors.json"); if(!d.sectors||!d.sectors.length) throw 0; if(!d.months||!d.months.length) throw 0; d.sectors.forEach(s=>{if(!Array.isArray(s.hist)||s.hist.length!==d.months.length) throw 0});'
  "data/mf_categories.json"    = 'const d=require("./data/mf_categories.json"); if(d.categories.length!==6) throw 0; if(!d.months.length) throw 0; if(!Array.isArray(d.equityTotal)||d.equityTotal.length!==d.months.length) throw 0; d.categories.forEach(c=>{if(!Array.isArray(c.hist)||c.hist.length!==d.months.length) throw 0});'
  "data/sip_flows.json"        = 'const d=require("./data/sip_flows.json"); if(!d.months.length) throw 0; if(d.sip.length!==d.months.length) throw 0; if(typeof d.sipAum!=="number") throw 0;'
  "data/model_portfolios.json" = 'const d=require("./data/model_portfolios.json"); if(!d.houses||!d.houses.length) throw 0;'
}
$files = @($validators.Keys)

# --- locate claude -----------------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
if (-not (Test-Path -LiteralPath $promptFile)) { Out-Log "prompt file missing - skipping."; exit 0 }

# --- gate: fortnightly window, once each -------------------------------------
$now = Get-Date
$ym  = $now.ToString("yyyy-MM")
$window = if ($now.Day -ge 17) { "$ym-H2" } elseif ($now.Day -ge 2) { "$ym-H1" } else { $null }
if (-not $window) { Out-Log "1st of month - too early; skipping."; exit 0 }
$lastWindow = ""
if (Test-Path -LiteralPath $stateFile) {
  try { $lastWindow = (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).lastWindow } catch { $lastWindow = "" }
}
if ($window -eq $lastWindow) { Out-Log "window $window already done - skipping."; exit 0 }
Out-Log "window $window not yet done - running miner..."

Set-Location $repo

# --- snapshot for per-file revert --------------------------------------------
$pre = @{}
foreach ($f in $files) {
  $p = Join-Path $repo $f
  $pre[$f] = if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" }
}

# --- run the headless miner with a timeout -----------------------------------
$prompt = (Get-Content -LiteralPath $promptFile -Raw) +
  "`n`nWRAPPER OVERRIDE: Do NOT run git commit or git push and do NOT branch. Only create/update + validate the data files, then stop. The local wrapper commits + pushes."

# The prompt goes in on STDIN, never as an argv string. It embeds `node -e "..."`
# validation snippets, and PS 5.1 mangles those embedded quotes when building a
# native command's arguments -- claude then saw a stray `-e` and died instantly
# with "unknown option '-e'", so the 2 Jul and 17 Jul windows were burned on
# 0-file no-op runs. Same Start-Process + stdin pattern as build-house-view-notes.ps1.
$utf8nb = New-Object System.Text.UTF8Encoding $false
$tmpIn  = Join-Path $env:TEMP 'pos-in.txt'
$tmpOut = Join-Path $env:TEMP 'pos-out.txt'
$tmpErr = Join-Path $env:TEMP 'pos-err.txt'
[System.IO.File]::WriteAllText($tmpIn, $prompt, $utf8nb)
$procArgs = @('-p','--permission-mode','bypassPermissions',
              '--allowedTools','Bash','Read','Write','Edit','WebFetch','WebSearch',
              '--model',$model)
$p = Start-Process -FilePath $claude -ArgumentList $procArgs `
      -WorkingDirectory $repo -NoNewWindow -PassThru `
      -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
if (-not $p.WaitForExit($timeoutSec * 1000)) {
  try { $p.Kill() } catch {}
  Out-Log "miner timed out - reverting any changes, NOT advancing watermark (retry next run)."
  foreach ($f in $files) { & git checkout -- $f 2>&1 | Out-Null }
  exit 0
}
$out    = Get-Content -LiteralPath $tmpOut -Raw -ErrorAction SilentlyContinue
$errOut = Get-Content -LiteralPath $tmpErr -Raw -ErrorAction SilentlyContinue
if ($out)    { Out-Log ("claude> "  + $out.TrimEnd()) }
if ($errOut) { Out-Log ("claude!> " + $errOut.TrimEnd()) }
# A crashed miner must NOT consume the fortnightly window, or one bad launch
# freezes every positioning file until the next window (what happened in July).
if ($p.ExitCode -ne 0) {
  Out-Log ("miner FAILED (exit " + $p.ExitCode + ") - reverting, NOT advancing watermark (retry next run).")
  foreach ($f in $files) { & git checkout -- $f 2>&1 | Out-Null }
  exit 0
}

# --- per-file validate; revert only the bad ones -----------------------------
$changed = 0
foreach ($f in $files) {
  $p = Join-Path $repo $f
  $post = if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" }
  if ($post -eq $pre[$f]) { continue }   # unchanged
  & $node -e $validators[$f] 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Out-Log "VALIDATION FAILED: $f - reverting just this file."
    & git checkout -- $f 2>&1 | Out-Null
  } else {
    Out-Log "$f updated + validated."
    $changed++
  }
}

# --- advance the watermark (run completed; daily-refresh's git step commits) --
@{ lastWindow = $window; asOf = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
Out-Log ("done - $changed file(s) updated this run.")
exit 0
