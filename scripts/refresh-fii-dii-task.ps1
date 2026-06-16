# Dedicated FII/DII flows refresh — fetch the latest daily cash-market net flows
# and commit + push, on its own predictable schedule.
#
# Run by the Windows scheduled task "India FII-DII Refresh" every weekday at
# 9:00 AM (local / Malaysia time). Kept separate from the heavy daily-refresh
# (which is chained to the PDF-sorting task and runs at a variable time) so the
# FII/DII chart updates at a fixed time each weekday morning. The prior trading
# day's provisional print is published ~7 pm IST the evening before, so a 9 AM
# MYT run reliably picks it up.
#
# Idempotent: refresh-fii-dii.js only appends genuinely-new dates, so this is a
# no-op (no commit) when already current. Always exits 0; never throws.
#
# Install / reinstall the schedule:  scripts\install-fii-dii-task.ps1

$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
$node = "C:\Program Files\nodejs\node.exe"
Set-Location $repo

$logDir = Join-Path $repo "scripts\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("fii-dii-" + (Get-Date -f "yyyyMMdd-HHmmss") + ".log")
function Log([string]$m){ $l = "[" + (Get-Date -f "HH:mm:ss") + "] " + $m; Write-Host $l; Add-Content -LiteralPath $log -Value $l }

Log "FII/DII refresh start"
$pre = if (Test-Path data\fii_dii.json) { (Get-FileHash data\fii_dii.json -Algorithm MD5).Hash } else { "" }

& $node "scripts\refresh-fii-dii.js" 2>&1 | ForEach-Object { Log ("node> " + ($_ | Out-String).TrimEnd()) }

$post = if (Test-Path data\fii_dii.json) { (Get-FileHash data\fii_dii.json -Algorithm MD5).Hash } else { "" }
if ($post -ne $pre -and $post -ne "") {
  & git add data/fii_dii.json
  & git commit -m ("chore: FII/DII daily flows -- " + (Get-Date -f "yyyy-MM-dd HH:mm")) | ForEach-Object { Log $_ }
  & git push origin main 2>&1 | ForEach-Object { Log ("push> " + ($_ | Out-String).TrimEnd()) }
  Log "committed + pushed"
} else {
  Log "no change (already current)"
}
Log "done"
exit 0
