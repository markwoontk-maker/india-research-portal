# One-off / resumable full backfill of the Earnings tab: mines EVERY season in the PDF
# library (not just the current one) with parallel headless-claude workers.
#
#   powershell -ExecutionPolicy Bypass -File scripts\earnings\backfill.ps1            # all
#   $env:EARN_ONLY="Eternal|1Q27;Maruti Suzuki"; powershell -File scripts\earnings\backfill.ps1   # subset
#
# Safe to stop and re-run: every finished item is written to data/earnings.json at once
# and skipped next time. Needs CLAUDE_CODE_OAUTH_TOKEN (user env var, from `claude setup-token`).
# When launched from inside a Claude Code session, the session's own CLAUDE_CODE_* /
# ANTHROPIC_* variables are cleared first, otherwise the child claude tries the parent's auth.
$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
Set-Location $repo
$tok = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_OAUTH_TOKEN', 'User')
if ($tok) { $env:CLAUDE_CODE_OAUTH_TOKEN = ($tok -replace '\s', '') }
Get-ChildItem env: | Where-Object { $_.Name -match '^(ANTHROPIC_|CLAUDECODE$|CLAUDE_AGENT|CLAUDE_CODE_)' -and $_.Name -ne 'CLAUDE_CODE_OAUTH_TOKEN' } |
  ForEach-Object { Remove-Item -LiteralPath ("env:" + $_.Name) -ErrorAction SilentlyContinue }
$log = Join-Path $repo ("scripts\logs\earnings-backfill-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")
& "C:\Program Files\nodejs\node.exe" "scripts\earnings\build-earnings.js" --backfill 2>&1 |
  Where-Object { $_ -notmatch 'Syntax Warning' } | Tee-Object -FilePath $log
