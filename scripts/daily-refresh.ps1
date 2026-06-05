# Daily research portal refresh.
#
# Triggered by Windows Task Scheduler ~90 s after the upstream
# "Sorting Folder Rename" task finishes (event 102 on the rename task's
# completion). That task downloads + renames + sorts any new broker PDFs
# into the India Related Reports library on disk before this script runs;
# we inherit its schedule (currently Mon-Fri, but if it's promoted to
# every day this refresh follows automatically -- no edit needed here).
#
# End-to-end workflow:
#   1. Rebuild data/pdfmap.json from the local PDF library on disk.
#   2. Run pdftotext over every PDF, regex-extract TP/call into pdfdata.json.
#   3. Rebuild the notes[] (last 2 days) and notesPrior[] (older) arrays
#      from the current PDF library and patch them into index.html.
#   4. Pull fresh external broker calls from Trendlyne, refresh notesExt.
#   5. Rebuild data/theses.json (bull/bear theses, 2-yr freshness window).
#   6. Rebuild data/financials.json (per-broker Revenue/EBITDA/Net Profit).
#   7. Commit + push to GitHub (auto-publishes via Pages).
#
# Install / reinstall the scheduled task with:
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-task.ps1
#
# Manual run (any time):
#   powershell -ExecutionPolicy Bypass -File scripts\daily-refresh.ps1

# PS 5.1 quirk: redirecting a native command's stderr with 2>&1 wraps each
# line in a NativeCommandError record and trips ErrorActionPreference=Stop
# even when the exe exited 0. Leave stderr alone; rely on $LASTEXITCODE.
$ErrorActionPreference = "Continue"

$repo = "C:\Users\admin\India-Research-Portal"
$node = "C:\Program Files\nodejs\node.exe"
Set-Location $repo

$logDir = Join-Path $repo "scripts\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("refresh-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")

function Log([string]$msg){
  $line = "[" + (Get-Date -f "HH:mm:ss") + "] " + $msg
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line
}

function Step([string]$desc, [scriptblock]$block){
  Log ("=== " + $desc + " ===")
  $global:LASTEXITCODE = 0
  $output = & $block
  # Mirror stdout to console + log.
  if ($null -ne $output) {
    foreach ($line in @($output)) {
      $s = ($line | Out-String).TrimEnd()
      if ($s) {
        Write-Host $s
        Add-Content -LiteralPath $log -Value $s
      }
    }
  }
  if ($global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) {
    Log ("ERROR: " + $desc + " exited with code " + $global:LASTEXITCODE)
    exit $global:LASTEXITCODE
  }
}

Log ("Daily research refresh -- repo: " + $repo)
Log ("Log: " + $log)

# 1. Rebuild data/pdfmap.json (filename -> absolute path map).
Step "rebuild-pdfmap" { & $node "scripts\rebuild-pdfmap.js" }

# 2. Re-run the pdftotext extraction for TP / call / summary.
Step "extract-pdfdata" { & $node "scripts\extract-pdfdata.js" }

# 3. Regenerate notes (last 2 days) + notesPrior (older 45 days).
#    The build script writes a single combined stdout that we split here
#    into the two staging files the patch script reads.
Step "build-notes-array" {
  $combined = & $node "scripts\build-notes-array.js"
  $mode = $null
  $recent = New-Object System.Collections.Generic.List[string]
  $prior  = New-Object System.Collections.Generic.List[string]
  foreach ($line in $combined) {
    if ($line -match "^=== RECENT") { $mode = "recent"; continue }
    if ($line -match "^=== PRIOR")  { $mode = "prior";  continue }
    if ($mode -eq "recent") { $recent.Add($line) | Out-Null }
    elseif ($mode -eq "prior") { $prior.Add($line) | Out-Null }
  }
  # Write as plain UTF-8 (no BOM) so the patch script's literal read
  # doesn't drag in a byte-order mark.
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText((Join-Path $repo "scripts\notes-recent.txt"), ($recent -join "`r`n"), $utf8NoBom)
  [System.IO.File]::WriteAllText((Join-Path $repo "scripts\notes-prior.txt"),  ($prior  -join "`r`n"), $utf8NoBom)
  Write-Output ("Wrote " + $recent.Count + " recent + " + $prior.Count + " prior lines")
}

# 4. Patch the new arrays into index.html.
Step "patch-notes-into-html" { & $node "scripts\patch-notes-into-html.js" }

# 5. Refresh notesExt from Trendlyne (free, no auth -- first batch only).
Step "refresh-trendlyne" { & $node "scripts\refresh-trendlyne.js" }

# 6. Rebuild bull/bear theses (depends on pdfdata.json + notes arrays).
#    2-year freshness window enforced inside the script.
Step "build-theses" { & $node "scripts\build-theses.js" }

# 7. Rebuild financial summary (per-broker Revenue/EBITDA/Net Profit).
#    Re-runs pdftotext on each broker's latest report, so this step is
#    the slowest -- usually 5-10 min depending on library size.
Step "build-financials" { & $node "scripts\build-financials.js" }

# 8. Refresh the Strategy tab from new India strategy PDFs (gated: only runs the
#    Claude headless miner when a new strategy report appeared; reverts on any
#    validation failure). Always exits 0 so it never aborts the refresh.
Step "build-strategy" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-strategy.ps1"
}

# 8b. Append the latest daily FII/DII flows (data/fii_dii.json). Done here (not
#     the cloud routine, whose git push silently fails) so the local git step
#     below actually publishes it. Append-only + idempotent; never throws.
Step "refresh-fii-dii" { & $node "scripts\refresh-fii-dii.js" }

# 8b2. Refresh the All-Time-High + 52-Week-High lists (data/highs.json) via the
#      Claude headless miner (Dhan ATH list + Groww Nifty 500 52WH list + the
#      Nifty 500 constituents CSV filter). Validates JSON + reverts on failure.
#      Always exits 0.
Step "build-highs" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-highs.ps1"
}

# 8c. Refresh the monthly Positioning data files (fpi_sectors, mf_categories,
#     sip_flows, model_portfolios) via the Claude headless miner. Gated to ~twice
#     a month (2nd & 17th windows); replaces the cloud routine that can't push.
#     Per-file validate + selective revert. Always exits 0.
Step "build-positioning" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-positioning.ps1"
}

# 9. Commit + push if there are any changes. No-op on a quiet day.
Step "git stage" {
  & git add data/pdfdata.json data/pdfmap.json data/theses.json data/theses-manual.json data/financials.json data/financials-manual.json data/model_portfolios_house.json data/mf_sectors.json data/fii_dii.json data/highs.json data/fpi_sectors.json data/mf_categories.json data/sip_flows.json data/model_portfolios.json index.html scripts/notes-recent.txt scripts/notes-prior.txt
}
Step "git commit + push" {
  $cached = & git diff --cached --stat
  if ([string]::IsNullOrWhiteSpace($cached)) {
    Write-Output "No changes to commit."
    return
  }
  Write-Output $cached
  $msg = "Daily research refresh -- " + (Get-Date -f "yyyy-MM-dd HH:mm")
  & git commit -m $msg
  & git push origin main
}

Log "Done."
