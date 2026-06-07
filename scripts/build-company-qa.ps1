# Company Q&A build step (invoked by daily-refresh.ps1, after build-company-qa-sync.ps1).
#
# Single-phase STATEMENT GENERATOR. For each in-scope company that has no current
# entry (new, or blanked by the sync step when a report landed), runs a scoped
# headless-claude pass that queries the company's NotebookLM SECTOR notebook for
# upside opportunities and downside risks and writes statement lists:
#   data/company_qa.json -> companies[<name>] = { asOf, upside:[{s,source,date,url}], downside:[...] }
# Each statement is sourced to the broker where grounded in a report, else to
# "Claude" (the assistant's own point). NotebookLM-only; no web, no keys.
#
# IMPORTANT - work is SMALL SCOPED BATCHES (1 company/call): a single claude call
# cannot cover the whole ~180-company universe (returns nothing); scoped to a few
# named companies it is reliable. claude is run DIRECTLY via Start-Process with
# the prompt on stdin (NOT Start-Job) and a hard per-call timeout.
#
# Runs DAILY (event-driven, no fortnight gate): needGen returns only companies
# with no current statements, so a quiet day is a fast no-op. Shares
# scripts\.company-qa.lock with the sync step. Per-batch backup+validate+restore.
# ALWAYS exits 0. Budget via $env:CQA_BUDGET (default 1500s).
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-company-qa.ps1

$ErrorActionPreference = "Continue"

$repo            = "C:\Users\admin\India-Research-Portal"
$node            = "C:\Program Files\nodejs\node.exe"
$genPrompt       = Join-Path $repo "docs\company-qa-answerer-prompt.md"
$claude          = "C:\Users\admin\.local\bin\claude.exe"
$lock            = Join-Path $repo "scripts\.company-qa.lock"
$model           = "sonnet"
$genBatch        = 1      # ONE company per call (each does several nlm queries)
$callTimeoutSec  = 900    # hard per-call kill ceiling
$overallBudgetSec= if ($env:CQA_BUDGET) { [int]$env:CQA_BUDGET } else { 1500 }
$maxNoProgress   = 3

function Out-Log([string]$m){ Write-Output ("[build-company-qa] " + $m) }

# validator: company_qa.json has upside/downside arrays of {s:string}
$valGen = 'var P=require("path"),CWD=process.cwd();const d=require(P.join(CWD,"data/company_qa.json")); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["upside","downside"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(typeof it.s!=="string") throw 0});});});'

# needGen: in-scope companies (sector routes to a source-bearing notebook) that
# have no current statements - no company_qa entry, or its asOf is empty (the
# sync step blanks asOf when a new report lands).
$needGenJs = 'var P=require("path"),CWD=process.cwd();var c=require(P.join(CWD,"data/companies.json"));var sn=require(P.join(CWD,"data/sector_notebooks.json"));var titles=new Set(sn.notebooks.map(n=>n.title));var r=sn.routing;var a={};try{a=require(P.join(CWD,"data/company_qa.json")).companies||{}}catch(e){}var SEP=" "+String.fromCharCode(183)+" ";function route(s){if(!s)return null;if(r[s])return r[s];var p=s.split(SEP);for(var i=p.length;i>=1;i--){var k=p.slice(0,i).join(SEP);if(r[k])return r[k];}return r[p[0]]||null;}console.log(Object.keys(c).filter(function(n){var t=route(c[n].sector);if(!(t&&titles.has(t)))return false;var e=a[n];return !(e&&e.asOf&&String(e.asOf).trim());}).join("\n"));'

# --- locate claude / prompt --------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
if (-not (Test-Path -LiteralPath $genPrompt)) { Out-Log "prompt file missing - skipping."; exit 0 }

# --- single-run lock (shared with build-company-qa-sync.ps1) ------------------
if (Test-Path -LiteralPath $lock) {
  $age = (New-TimeSpan -Start (Get-Item $lock).LastWriteTime -End (Get-Date)).TotalMinutes
  if ($age -lt 90) { Out-Log "another Q&A run holds the lock ($([int]$age)m old) - skipping."; exit 0 }
}
Set-Content -LiteralPath $lock -Value (Get-Date).ToString("s") -Encoding utf8

Set-Location $repo
$deadline = (Get-Date).AddSeconds($overallBudgetSec)
Out-Log "running statement generator (budget $([int]($overallBudgetSec/60)) min)..."

$utf8nb  = New-Object System.Text.UTF8Encoding $false
$jsNeed  = Join-Path $env:TEMP 'cqa-needgen.js'; [System.IO.File]::WriteAllText($jsNeed, $needGenJs, $utf8nb)
$jsVal   = Join-Path $env:TEMP 'cqa-valgen.js';  [System.IO.File]::WriteAllText($jsVal,  $valGen,    $utf8nb)

# --- run one scoped claude batch directly (stdin prompt + hard timeout) -------
function Invoke-Batch([string]$names) {
  $scope = "`n`nSCOPE OVERRIDE: Process ONLY these companies, using these EXACT names as the keys: " +
           ($names -join '; ') + ". Keep every other company in data/company_qa.json untouched. Do NOT run git."
  $prompt = (Get-Content -LiteralPath $genPrompt -Raw) + $scope
  $tmpIn  = Join-Path $env:TEMP 'cqa-gen-in.txt'
  $tmpOut = Join-Path $env:TEMP 'cqa-gen-out.txt'
  $tmpErr = Join-Path $env:TEMP 'cqa-gen-err.txt'
  [System.IO.File]::WriteAllText($tmpIn, $prompt, $utf8nb)
  $procArgs = @('-p','--permission-mode','bypassPermissions','--allowedTools','Bash','Read','Write','Edit','--model',$model)
  $p = Start-Process -FilePath $claude -ArgumentList $procArgs `
        -WorkingDirectory $repo -NoNewWindow -PassThru `
        -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
  $done = $p.WaitForExit($callTimeoutSec * 1000)
  if (-not $done) { try { $p.Kill() } catch {}; Out-Log "generate batch timed out (killed)." }
  Remove-Item $tmpIn,$tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  return $done
}

# --- generate loop: scoped batches, per-batch backup/validate/restore ---------
function Get-Need { @(& $node $jsNeed 2>$null) | Where-Object { $_ -and $_.Trim() } }
$need = @(Get-Need)
Out-Log "generator: $($need.Count) companies need statements."
$noProgress = 0; $attempted = @{}
while ($need.Count -gt 0 -and (Get-Date) -lt $deadline -and $noProgress -lt $maxNoProgress) {
  $batch = @($need | Where-Object { -not $attempted[$_] } | Select-Object -First $genBatch)
  if ($batch.Count -eq 0) { break }
  Out-Log ("generate (" + $batch.Count + "): " + ($batch -join ', '))
  $bak = Join-Path $env:TEMP 'cqa-gen.bak.json'
  Copy-Item -LiteralPath (Join-Path $repo 'data/company_qa.json') $bak -Force -ErrorAction SilentlyContinue
  [void](Invoke-Batch $batch)
  & $node $jsVal 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Out-Log "company_qa.json invalid after batch - restoring pre-batch copy."
    if (Test-Path -LiteralPath $bak) { Copy-Item -LiteralPath $bak (Join-Path $repo 'data/company_qa.json') -Force }
  }
  Remove-Item $bak -Force -ErrorAction SilentlyContinue
  $before = $need.Count
  $need = @(Get-Need)
  if ($need.Count -ge $before) { foreach ($n in $batch) { $attempted[$n] = $true }; $noProgress++; Out-Log "batch made no progress ($noProgress/$maxNoProgress)." }
  else { $noProgress = 0 }
}
if ($noProgress -ge $maxNoProgress) { Out-Log "aborting after $maxNoProgress no-progress batches (check nlm auth / rate limit)." }

$rem = @(Get-Need).Count
if ($rem -eq 0) { Out-Log "all in-scope companies covered (0 pending)." } else { Out-Log "remaining: $rem companies pending (next run resumes)." }
Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
Out-Log "done."
exit 0
