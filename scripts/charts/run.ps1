# scripts/charts/run.ps1  — orchestrates the charts pipeline
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "== Phase A: render pages ==" -ForegroundColor Cyan
uv run --python 3.12 --with pymupdf python render_pages.py

Write-Host ""
Write-Host "== Phase B: vision analysis (run by Claude) ==" -ForegroundColor Yellow
Write-Host "For each PDF in .charts-work/index.json, dispatch a subagent with"
Write-Host "analysis_prompt.md (filled with that PDF's page PNG paths + context) and"
Write-Host "analysis_schema.json, then write its response to"
Write-Host ".charts-work/<slug>/analysis.json. Re-run this script (or just Phase C)"
Write-Host "once analyses exist."
$work = Join-Path $here "..\.charts-work"
if (-not (Test-Path $work)) { exit 0 }
$pending = (Get-ChildItem $work -Directory | Where-Object {
    -not (Test-Path (Join-Path $_.FullName "analysis.json")) }).Count
Write-Host "PDFs still awaiting analysis.json: $pending"
if ($pending -gt 0) { Write-Host "Stopping before Phase C (analyses incomplete)."; exit 0 }

Write-Host ""
Write-Host "== Phase C: crop + assemble ==" -ForegroundColor Cyan
uv run --python 3.12 --with pymupdf --with pillow python crop_assemble.py
