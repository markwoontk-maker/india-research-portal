# One-shot: delete EVERY notebook in the `work` NotebookLM profile.
#
# Prerequisite: NotebookLM auth (currently expired). Re-authenticate first:
#   nlm login --profile work
# (opens a browser for Google OAuth; sign in as markworktk@gmail.com)
#
# Then run:
#   powershell -ExecutionPolicy Bypass -File scripts\nuke-notebooklm.ps1
#
# The script lists every notebook, prints a confirmation prompt, and only
# deletes when you type YES. Progress is logged. Sector notebook shells,
# uploaded PDFs, notes and chat history are all removed permanently --
# this is irreversible.
#
# After it finishes, the daily-refresh pipeline no longer touches
# NotebookLM (already unwired 2026-07-29, commit a50cf8a), so nothing
# will re-populate these notebooks unless you manually re-enable the
# build-company-qa-sync step in scripts\daily-refresh.ps1.

$ErrorActionPreference = "Continue"
$nlm = "C:\Users\admin\.local\bin\nlm.exe"

if (-not (Test-Path -LiteralPath $nlm)) {
    Write-Error "nlm CLI not found at $nlm"
    exit 1
}

Write-Host "Checking NotebookLM auth (profile=work) ..." -ForegroundColor Cyan
$authCheck = & $nlm login --check --profile work 2>&1
$authCheck | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Auth failed. Re-authenticate first, then re-run this script:" -ForegroundColor Yellow
    Write-Host "  nlm login --profile work" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Listing notebooks in the `"work`" profile ..." -ForegroundColor Cyan
$listJson = & $nlm notebook list --profile work --json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to list notebooks:" -ForegroundColor Red
    $listJson | ForEach-Object { Write-Host "  $_" }
    exit 1
}

$notebooks = @()
try {
    $notebooks = ($listJson -join "`n") | ConvertFrom-Json
} catch {
    Write-Host "Could not parse the notebook list as JSON." -ForegroundColor Red
    exit 1
}

if (-not $notebooks -or $notebooks.Count -eq 0) {
    Write-Host "No notebooks found. Nothing to delete." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host ("Found " + $notebooks.Count + " notebook(s):") -ForegroundColor Cyan
$notebooks | ForEach-Object {
    $title = if ($_.title) { $_.title } elseif ($_.name) { $_.name } else { "(untitled)" }
    $id = if ($_.id) { $_.id } elseif ($_.notebook_id) { $_.notebook_id } else { "(no id)" }
    $sc = if ($null -ne $_.source_count) { $_.source_count } else { "?" }
    Write-Host ("  " + $id + "  " + $title.PadRight(45) + "  " + $sc + " source(s)")
}

Write-Host ""
Write-Host "This will PERMANENTLY DELETE all " -NoNewline -ForegroundColor Yellow
Write-Host ("" + $notebooks.Count + " ") -NoNewline -ForegroundColor Red
Write-Host "notebook(s) shown above." -ForegroundColor Yellow
Write-Host "All sources (PDFs), notes, chat history are removed. Irreversible." -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Type YES (all caps) to proceed, anything else to abort"
if ($confirm -ne "YES") {
    Write-Host "Aborted. No notebooks deleted." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Deleting ..." -ForegroundColor Cyan
$ok = 0; $fail = 0
foreach ($nb in $notebooks) {
    $id = if ($nb.id) { $nb.id } elseif ($nb.notebook_id) { $nb.notebook_id } else { $null }
    $title = if ($nb.title) { $nb.title } elseif ($nb.name) { $nb.name } else { "(untitled)" }
    if (-not $id) {
        Write-Host ("  SKIP (no id): " + $title) -ForegroundColor Yellow
        $fail++
        continue
    }
    & $nlm notebook delete $id --confirm --profile work | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("  OK   " + $id + "  " + $title) -ForegroundColor Green
        $ok++
    } else {
        Write-Host ("  FAIL " + $id + "  " + $title + "  (exit " + $LASTEXITCODE + ")") -ForegroundColor Red
        $fail++
    }
}

Write-Host ""
Write-Host ("Done. Deleted " + $ok + " / " + $notebooks.Count + "; failed " + $fail + ".") -ForegroundColor Cyan
