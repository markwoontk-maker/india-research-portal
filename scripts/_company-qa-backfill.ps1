# One-off Company Q&A BACKFILL loop (manual / overnight).
#
# Repeatedly runs scripts\build-company-qa.ps1 (the batched miner) until every
# in-scope company has a fresh answer, committing + pushing the data after each
# iteration so progress is durable and the live site fills incrementally.
#
# Why a loop: answering is ~1 company per ~7 min, so full coverage of ~150
# companies is many hours - far more than a single gated run. The loop clears the
# fortnight watermark each pass (so the gate never short-circuits a backfill) and
# stops when 0 in-scope companies remain pending (or after $maxIter passes).
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\_company-qa-backfill.ps1
# Safe to re-run; resumable (skips companies already answered this window).
# Requires the nlm 'work' profile to stay authenticated.

$ErrorActionPreference = "Continue"
$repo = "C:\Users\admin\India-Research-Portal"
$node = "C:\Program Files\nodejs\node.exe"
$maxIter = 40
$iterBudgetSec = 3600   # per pass; questioner empties fast, answerer uses the rest
Set-Location $repo

$log = Join-Path $repo "scripts\logs\company-qa-backfill.log"
New-Item -ItemType Directory -Force (Join-Path $repo "scripts\logs") | Out-Null
function BLog([string]$m){ $line = "[" + (Get-Date -f "HH:mm:ss") + "] " + $m; Write-Output $line; Add-Content -LiteralPath $log -Value $line }

# in-scope pending counter (companies whose sector routes to a sourced notebook
# and that lack a fresh answer this window).
$nb = New-Object System.Text.UTF8Encoding $false
$pendJs = Join-Path $env:TEMP 'cqa-pending.js'
[System.IO.File]::WriteAllText($pendJs, 'var P=require("path"),CWD=process.cwd();var ws=process.argv[2];var c=require(P.join(CWD,"data/companies.json"));var sn=require(P.join(CWD,"data/sector_notebooks.json"));var titles=new Set(sn.notebooks.map(n=>n.title));var r=sn.routing;var a={};try{a=require(P.join(CWD,"data/company_qa.json")).companies||{}}catch(e){}var SEP=" "+String.fromCharCode(183)+" ";function route(s){if(!s)return null;if(r[s])return r[s];var p=s.split(SEP);for(var i=p.length;i>=1;i--){var k=p.slice(0,i).join(SEP);if(r[k])return r[k];}return r[p[0]]||null;}var inscope=Object.keys(c).filter(function(n){var t=route(c[n].sector);return t&&titles.has(t);});var pend=inscope.filter(function(n){return !(a[n]&&a[n].asOf&&a[n].asOf>=ws)});console.log(pend.length);', $nb)
$ws = if ((Get-Date).Day -ge 17) { (Get-Date).ToString('yyyy-MM-17') } else { (Get-Date).ToString('yyyy-MM-02') }

$startPend = (& $node $pendJs $ws 2>$null | Select-Object -Last 1)
BLog "backfill START - in-scope pending: $startPend (budget $([int]($iterBudgetSec/60)) min/pass, max $maxIter passes)"

for ($i = 1; $i -le $maxIter; $i++) {
  Remove-Item (Join-Path $repo "scripts\.company-qa-state.json") -Force -ErrorAction SilentlyContinue
  $env:CQA_BUDGET = "$iterBudgetSec"
  BLog "pass $i - running miner..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo "scripts\build-company-qa.ps1") *>> $log

  # commit + push whatever this pass produced (tolerate push races - next pass retries)
  & git add data/company_qa.json data/company_questions.json 2>&1 | Out-Null
  $staged = & git diff --cached --stat
  if (-not [string]::IsNullOrWhiteSpace($staged)) {
    & git commit -m "Company Q&A backfill pass $i" 2>&1 | Out-Null
    & git push origin HEAD:main 2>&1 | Out-Null
  }

  $pend = (& $node $pendJs $ws 2>$null | Select-Object -Last 1)
  $answered = (& $node -e "var a=require('./data/company_qa.json').companies;var n=0;Object.values(a).forEach(function(c){if([].concat(c.bull,c.bear,c.debates).some(function(x){return x.a&&x.a.trim()}))n++});console.log(n)" 2>$null | Select-Object -Last 1)
  BLog "pass $i done - answered companies: $answered | in-scope pending: $pend"
  if ([int]$pend -le 0) { BLog "BACKFILL COMPLETE - 0 pending."; break }
}
BLog "backfill loop exited."
exit 0
