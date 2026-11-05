# Resumable full read of the broker notes for the Company tab's FY26-FY29 estimates (revenue, EBITDA, EPS).
# Runs until every company-broker pair is read: mines for EST_BUDGET seconds (30 min), commits and
# pushes data/estimates.json so the live site fills in, then repeats. When claude reports a
# usage limit it waits 30 minutes and tries again.
#
#   powershell -ExecutionPolicy Bypass -File scripts\estimates\backfill.ps1
#   $env:EST_ONLY="Maruti Suzuki;HDFC Bank"; powershell -File scripts\estimates\backfill.ps1   # subset, no push
#
# To stop it: create the file scripts\.estimates-work\STOP (checked between cycles), or kill the
# process. Safe to re-run: every finished pair is already on disk and is skipped next time.
# Needs CLAUDE_CODE_OAUTH_TOKEN (user env var, from `claude setup-token`).
$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
Set-Location $repo
$tok = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_OAUTH_TOKEN', 'User')
if ($tok) { $env:CLAUDE_CODE_OAUTH_TOKEN = ($tok -replace '\s', '') }
Get-ChildItem env: | Where-Object { $_.Name -match '^(ANTHROPIC_|CLAUDECODE$|CLAUDE_AGENT|CLAUDE_CODE_)' -and $_.Name -ne 'CLAUDE_CODE_OAUTH_TOKEN' } |
  ForEach-Object { Remove-Item -LiteralPath ("env:" + $_.Name) -ErrorAction SilentlyContinue }
$node = "C:\Program Files\nodejs\node.exe"
$env:PATH = "C:\Program Files\Git\mingw64\bin;" + $env:PATH
if (-not $env:EST_BUDGET) { $env:EST_BUDGET = "1800" }
$subset = [bool]$env:EST_ONLY
New-Item -ItemType Directory -Force -Path (Join-Path $repo "scripts\logs") | Out-Null
$log = Join-Path $repo ("scripts\logs\estimates-backfill-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")
$stopFile = Join-Path $repo "scripts\.estimates-work\STOP"
function Say($m) { $l = "[" + (Get-Date -f "yyyy-MM-dd HH:mm:ss") + "] " + $m; Write-Output $l; Add-Content -Path $log -Value $l -Encoding UTF8 }

while ($true) {
  if (Test-Path $stopFile) { Say "STOP file found - exiting."; Remove-Item $stopFile; break }
  & $node "scripts\estimates\build-estimates.js" --backfill 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding UTF8 }
  $code = $LASTEXITCODE

  if (-not $subset) {
    & git add -- data/estimates.json
    $files = @(& git diff --cached --name-only -- data/estimates.json)
    if ($files.Count) {
      $p = (Get-Content data\estimates.json -TotalCount 1 -Encoding UTF8) -replace '.*"withEstimates":(\d+).*"pairsLeft":(\d+).*', '$1 companies, $2 pairs left'
      & git commit -m "data: broker estimates backfill ($p)" -- data/estimates.json 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding UTF8 }
      & git pull --rebase --autostash origin main 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding UTF8 }
      & git push origin main 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding UTF8 }
    }
  }

  $left = (& $node "scripts\estimates\build-estimates.js" --count | Select-String '^LEFT=(\d+)').Matches.Groups[1].Value
  Say "cycle finished (exit $code), $left pair(s) left."
  if ($left -eq "0") { Say "All pairs read - done."; break }
  if ($code -eq 3) { Say "claude limit or auth problem - waiting 30 minutes."; Start-Sleep -Seconds 1800 }
  else { Start-Sleep -Seconds 60 }
}
