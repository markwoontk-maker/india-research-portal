# Daily research portal refresh.
#
# ONE scheduled task. Fires Mon-Fri 09:30 MYT (local time) via Windows
# Task Scheduler and runs the full pipeline serially:
#   Step 0:  rename + sort the new broker PDFs into the library
#            (delegates to C:\Users\admin\.claude\sorting-folder-rename\run-rename.ps1
#            so the user's existing rename logic + NotebookLM sync stay
#            in one place). The separate "Sorting Folder Rename" task is
#            kept disabled so it doesn't double-run at 09:30.
#   Step 1+: rebuild pdfmap / pdfdata, regenerate notes arrays, refresh
#            Trendlyne externals, theses / financials / Strategy / FII-DII
#            / highs / Positioning / Company QA / House-View notes, then
#            commit + push.
#
# Install / reinstall the scheduled task with:
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-task.ps1
#
# Manual run (any time):
#   powershell -ExecutionPolicy Bypass -File scripts\daily-refresh.ps1
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

# 0. Rename + sort the new broker PDFs into the library, and push them
#    into NotebookLM. Delegates to the user's own pipeline so all the
#    rename heuristics stay in one place. Never aborts the refresh -- a
#    rename failure must not block the data steps below.
$renameScript = "C:\Users\admin\.claude\sorting-folder-rename\run-rename.ps1"
if (Test-Path -LiteralPath $renameScript) {
  Step "sort-and-rename" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $renameScript
    # Force success: rename errors are logged in run-rename's own log.
    $global:LASTEXITCODE = 0
  }
} else {
  Log ("WARN: rename script not found at " + $renameScript + " -- skipping Step 0.")
}

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

# 8. (Strategy tab moved OUT of the daily pipeline.) It now refreshes WEEKLY via
#    the standalone "India Research Portal Strategy Weekly" task (Fri 17:00 MYT,
#    scripts\weekly-strategy-refresh.ps1 → scripts\build-strategy.ps1), which
#    commits + pushes its own diff. Do not re-add build-strategy here, or the
#    shared watermark would let the daily run consume new reports before Friday.

# 8b. Append the latest daily FII/DII flows (data/fii_dii.json). Done here (not
#     the cloud routine, whose git push silently fails) so the local git step
#     below actually publishes it. Append-only + idempotent; never throws.
Step "refresh-fii-dii" { & $node "scripts\refresh-fii-dii.js" }

# 8b2. Append the latest Watchlist Daily-Return data (data/wl_returns.json) from
#      the official NSE bhavcopy + index close. The dashboard is a static Pages
#      site that can't reach NSE directly (no CORS; public proxies are dead), so
#      the exact per-stock returns are fetched here and committed for the page to
#      read. Append-only + idempotent (floored at 2026-07-14, no backdating);
#      never throws.
Step "refresh-wl-returns" { & $node "scripts\refresh-wl-returns.js" }

# 8b3. Rebuild the forward results calendar (data/earnings_calendar.json) from
#      ICICI Direct's results-calendar API. Must run here rather than in the
#      page: the endpoint is a POST whose CORS is pinned to icicidirect.com, so
#      the browser can't call it from Pages and the GET-only public proxies
#      can't forward it. Rewrites the rolling 35-day window each run, but keeps
#      the last good file if the fetch fails; never throws.
Step "refresh-earnings-calendar" { & $node "scripts\refresh-earnings-calendar.js" }

# Note: the All-Time-High + 52-Week-High refresh (data/highs.json) was a step
# here, but is now its own concurrent scheduled task ("India Research Portal
# Highs Refresh", weekday 09:32) so the highs don't have to wait behind the
# slow PDF/financial steps. See scripts/build-highs.ps1.

# 8c. Refresh the monthly Positioning data files (fpi_sectors, mf_categories,
#     sip_flows, model_portfolios) via the Claude headless miner. Gated to ~twice
#     a month (2nd & 17th windows); replaces the cloud routine that can't push.
#     Per-file validate + selective revert. Always exits 0.
Step "build-positioning" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-positioning.ps1"
}

# 8c2. Sync NEW broker reports into their NotebookLM sector notebooks and mark
#      those companies stale (blank asOf), so the answerer below regenerates them.
#      Event-driven: only companies that got a new report today are touched.
#      Baselines on first run (no bulk upload). Always exits 0.
Step "build-company-qa-sync" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-company-qa-sync.ps1"
}

# 8d. Generate the Company-tab Upside Opportunity / Downside Risk statements
#     (data/company_qa.json) via the batched statement generator. Runs daily
#     (event-driven); only companies with no current statements (new, or blanked
#     by the sync step above) are (re)generated - a quiet day is a no-op. Shares a
#     lock with the sync step; NotebookLM-grounded, else sourced to Claude. Exits 0.
Step "build-company-qa" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-company-qa.ps1"
}

# 8e. Generate House-View notes (data/house_view_notes.json): cross-house summary
#     + per-broker change-vs-prior + the assistant's own view, overlaid on the
#     House Views card. Pure reasoning over theses.json + pdfdata.json (NO
#     NotebookLM, not rate-limited); regenerates a company when its houseViews
#     signature changes. Always exits 0.
Step "build-house-view-notes" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-house-view-notes.ps1"
}

# 8f. Charts auto-ingest runs as its OWN scheduled weekday task (chained after this
#     refresh) so the slow headless-Claude vision pass doesn't hold up the refresh.
#     See scripts/charts/build-charts.ps1 + scripts/charts/install-charts-task.ps1.

# 9. Commit + push if there are any changes. No-op on a quiet day.
Step "git stage" {
  & git add data/pdfdata.json data/pdfmap.json data/research.json data/sector-tps.json data/theses.json data/theses-manual.json data/financials.json data/financials-manual.json data/model_portfolios_house.json data/mf_sectors.json data/fii_dii.json data/wl_returns.json data/earnings_calendar.json data/fpi_sectors.json data/mf_categories.json data/sip_flows.json data/model_portfolios.json data/company_qa.json data/company_questions.json data/sector_notebooks.json data/house_view_notes.json index.html scripts/notes-recent.txt scripts/notes-prior.txt
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
