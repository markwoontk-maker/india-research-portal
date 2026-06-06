# Company Q&A build step (invoked by daily-refresh.ps1).
#
# Two headless-Claude phases against the company NotebookLM library:
#   1. Questioner (docs/company-qa-questioner-prompt.md) -> data/company_questions.json
#   2. Answerer   (docs/company-qa-answerer-prompt.md)   -> data/company_qa.json
# Grounding is NotebookLM-only (nlm CLI, profile 'work'). No web, no keys.
#
# IMPORTANT - work is done in SMALL SCOPED BATCHES. A single headless `claude -p`
# call cannot generate/answer the whole ~180-company universe (it produces
# nothing); scoped to a handful of named companies it is reliable. So this
# wrapper computes the work list and invokes claude once per batch, looping until
# the list is empty or the overall time budget is hit. Each claude call is run
# DIRECTLY via Start-Process with the prompt on stdin (NOT Start-Job) and a hard
# per-call timeout. Progress is written incrementally and is resumable.
#
# Gated twice-monthly (H1 on/after the 2nd, H2 on/after the 17th) via
# scripts/.company-qa-state.json. The watermark advances ONLY when every in-scope
# company has a fresh answer this window (a partial run leaves it unset so the
# next daily run resumes). Per-batch backup+validate+restore guards the JSON.
# ALWAYS exits 0 so it never aborts the rest of the daily refresh.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-company-qa.ps1

$ErrorActionPreference = "Continue"

$repo            = "C:\Users\admin\India-Research-Portal"
$node            = "C:\Program Files\nodejs\node.exe"
$qPrompt         = Join-Path $repo "docs\company-qa-questioner-prompt.md"
$aPrompt         = Join-Path $repo "docs\company-qa-answerer-prompt.md"
$stateFile       = Join-Path $repo "scripts\.company-qa-state.json"
$claude          = "C:\Users\admin\.local\bin\claude.exe"
$model           = "sonnet"
$qBatch          = 8      # companies per questioner call (generation only - light)
$aBatch          = 2      # companies per answerer call (~8 nlm queries each - heavy)
$callTimeoutSec  = 900    # hard per-call kill ceiling
$overallBudgetSec= if ($env:CQA_BUDGET) { [int]$env:CQA_BUDGET } else { 1500 }   # whole-run budget; remaining companies resume next run (override via $env:CQA_BUDGET)
$maxNoProgress   = 3      # consecutive no-progress batches -> abort that phase

function Out-Log([string]$m){ Write-Output ("[build-company-qa] " + $m) }

# node validators (throw on malformed file)
$valQ = 'var P=require("path"),CWD=process.cwd();const d=require(P.join(CWD,"data/company_questions.json")); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["bull","bear","debates"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(!it.q) throw 0});});});'
$valA = 'var P=require("path"),CWD=process.cwd();const d=require(P.join(CWD,"data/company_qa.json")); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["bull","bear","debates"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(typeof it.q!=="string"||typeof it.a!=="string") throw 0});});});'

# node work-list computations (print one company name per line)
#  - needQ: in-scope companies (sector routes to a source-bearing notebook) that
#    have no questions yet.
$needQjs = 'var P=require("path"),CWD=process.cwd();const c=require(P.join(CWD,"data/companies.json"));const sn=require(P.join(CWD,"data/sector_notebooks.json"));const titles=new Set(sn.notebooks.map(n=>n.title));const r=sn.routing;var q={};try{q=require(P.join(CWD,"data/company_questions.json")).companies||{}}catch(e){}var SEP=" "+String.fromCharCode(183)+" ";function route(s){if(!s)return null;if(r[s])return r[s];var p=s.split(SEP);for(var i=p.length;i>=1;i--){var k=p.slice(0,i).join(SEP);if(r[k])return r[k];}return r[p[0]]||null;}console.log(Object.keys(c).filter(function(n){var t=route(c[n].sector);return t&&titles.has(t)&&!q[n];}).join("\n"));'
#  - needA: companies that have questions but no fresh answer this window.
$needAjs = 'var P=require("path"),CWD=process.cwd();var ws=process.argv[2];var q={};try{q=require(P.join(CWD,"data/company_questions.json")).companies||{}}catch(e){}var a={};try{a=require(P.join(CWD,"data/company_qa.json")).companies||{}}catch(e){}console.log(Object.keys(q).filter(function(n){return !(a[n]&&a[n].asOf&&a[n].asOf>=ws);}).join("\n"));'

# --- locate claude -----------------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
if (-not (Test-Path -LiteralPath $qPrompt) -or -not (Test-Path -LiteralPath $aPrompt)) {
  Out-Log "prompt file(s) missing - skipping."; exit 0
}

# --- gate: fortnightly window ------------------------------------------------
$now = Get-Date
$ym  = $now.ToString("yyyy-MM")
$window = if ($now.Day -ge 17) { "$ym-H2" } elseif ($now.Day -ge 2) { "$ym-H1" } else { $null }
if (-not $window) { Out-Log "1st of month - too early; skipping."; exit 0 }
$lastWindow = ""
if (Test-Path -LiteralPath $stateFile) {
  try { $lastWindow = (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).lastWindow } catch { $lastWindow = "" }
}
if ($window -eq $lastWindow) { Out-Log "window $window already done - skipping."; exit 0 }

Set-Location $repo
$winStart = if ($now.Day -ge 17) { $now.ToString('yyyy-MM-17') } else { $now.ToString('yyyy-MM-02') }
$deadline = (Get-Date).AddSeconds($overallBudgetSec)
Out-Log "window $window - running batched miner (budget $([int]($overallBudgetSec/60)) min)..."

# Write the node helpers to temp .js files and invoke them as `node file.js`.
# (PowerShell 5.1 mangles the embedded double quotes when these are passed via
#  `node -e <string>`, so the programs would silently error and return nothing.)
$utf8nb  = New-Object System.Text.UTF8Encoding $false
$jsNeedQ = Join-Path $env:TEMP 'cqa-needq.js'; [System.IO.File]::WriteAllText($jsNeedQ, $needQjs, $utf8nb)
$jsNeedA = Join-Path $env:TEMP 'cqa-needa.js'; [System.IO.File]::WriteAllText($jsNeedA, $needAjs, $utf8nb)
$jsValQ  = Join-Path $env:TEMP 'cqa-valq.js';  [System.IO.File]::WriteAllText($jsValQ,  $valQ,  $utf8nb)
$jsValA  = Join-Path $env:TEMP 'cqa-vala.js';  [System.IO.File]::WriteAllText($jsValA,  $valA,  $utf8nb)

# --- run one scoped claude batch directly (stdin prompt + hard timeout) -------
function Invoke-Batch([string]$basePromptPath, [string[]]$names, [string]$label) {
  $scope = "`n`nSCOPE OVERRIDE: Process ONLY these companies, using these EXACT names as the keys: " +
           ($names -join '; ') + ". Keep every other company in the data files untouched. Do NOT run git."
  $prompt = (Get-Content -LiteralPath $basePromptPath -Raw) + $scope
  $tmpIn  = Join-Path $env:TEMP ("cqa-$label-in.txt")
  $tmpOut = Join-Path $env:TEMP ("cqa-$label-out.txt")
  $tmpErr = Join-Path $env:TEMP ("cqa-$label-err.txt")
  [System.IO.File]::WriteAllText($tmpIn, $prompt, (New-Object System.Text.UTF8Encoding $false))
  $procArgs = @('-p','--permission-mode','bypassPermissions','--allowedTools','Bash','Read','Write','Edit','--model',$model)
  $p = Start-Process -FilePath $claude -ArgumentList $procArgs `
        -WorkingDirectory $repo -NoNewWindow -PassThru `
        -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
  $done = $p.WaitForExit($callTimeoutSec * 1000)
  if (-not $done) { try { $p.Kill() } catch {}; Out-Log "$label batch timed out (killed)." }
  Remove-Item $tmpIn,$tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  return $done
}

# --- generic batched phase ----------------------------------------------------
# $needFile: node SCRIPT FILE printing the remaining work list (names, one/line).
#            (Files, not -e: PS 5.1 mangles double-quote-heavy -e arguments.)
# $arg: optional argument passed to the node script (winStart for answerer).
# $dataFile: the JSON this phase writes (for backup/validate/restore).
# $valFile: node validation SCRIPT FILE for $dataFile.
function Run-Phase([string]$promptPath, [string]$needFile, [string]$arg, [int]$batchSize, [string]$dataFile, [string]$valFile, [string]$label, [datetime]$phaseDeadline) {
  $get = {
    param($f,$a)
    if ($a) { @(& $node $f $a 2>$null) | Where-Object { $_ -and $_.Trim() } }
    else    { @(& $node $f    2>$null) | Where-Object { $_ -and $_.Trim() } }
  }
  $need = @(& $get $needFile $arg)
  Out-Log ("${label}: $($need.Count) companies in queue.")
  $noProgress = 0
  $attempted = @{}
  while ($need.Count -gt 0 -and (Get-Date) -lt $phaseDeadline -and $noProgress -lt $maxNoProgress) {
    $batch = @($need | Where-Object { -not $attempted[$_] } | Select-Object -First $batchSize)
    if ($batch.Count -eq 0) { break }
    Out-Log ("$label batch (" + $batch.Count + "): " + ($batch -join ', '))
    $bak = Join-Path $env:TEMP ("cqa-" + $label + ".bak.json")
    Copy-Item -LiteralPath (Join-Path $repo $dataFile) $bak -Force -ErrorAction SilentlyContinue
    [void](Invoke-Batch $promptPath $batch $label)
    # validate; restore the pre-batch file (NOT git) on corruption to keep prior progress
    & $node $valFile 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Out-Log "${label}: $dataFile invalid after batch - restoring pre-batch copy."
      if (Test-Path -LiteralPath $bak) { Copy-Item -LiteralPath $bak (Join-Path $repo $dataFile) -Force }
    }
    Remove-Item $bak -Force -ErrorAction SilentlyContinue
    $before = $need.Count
    $need = @(& $get $needFile $arg)
    if ($need.Count -ge $before) {
      foreach ($n in $batch) { $attempted[$n] = $true }   # don't retry the same names this run
      $noProgress++
      Out-Log "$label batch made no progress ($noProgress/$maxNoProgress)."
    } else {
      $noProgress = 0
    }
  }
  if ($noProgress -ge $maxNoProgress) { Out-Log "${label}: aborting phase after $maxNoProgress no-progress batches (check nlm auth / prompts)." }
}

# --- phase 1: questioner (generate questions for in-scope companies) ----------
# Capped at ~40% of the run so the answerer (which produces the VISIBLE answers)
# always gets time; the questioner backlog is primed across runs.
$qDeadline = (Get-Date).AddSeconds([int]($overallBudgetSec * 0.4))
if ($qDeadline -gt $deadline) { $qDeadline = $deadline }
Run-Phase $qPrompt $jsNeedQ $null $qBatch "data/company_questions.json" $jsValQ "questioner" $qDeadline

# --- phase 2: answerer (ground answers for companies not yet fresh) -----------
Run-Phase $aPrompt $jsNeedA $winStart $aBatch "data/company_qa.json" $jsValA "answerer" $deadline

# --- advance watermark ONLY when nothing is left needing questions or answers --
$remQ = @(& $node $jsNeedQ 2>$null | Where-Object { $_ -and $_.Trim() }).Count
$remA = @(& $node $jsNeedA $winStart 2>$null | Where-Object { $_ -and $_.Trim() }).Count
if ($remQ -eq 0 -and $remA -eq 0) {
  @{ lastWindow = $window; asOf = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  Out-Log "window $window complete (0 pending) - watermark advanced."
} else {
  Out-Log "window incomplete (questions pending: $remQ, answers pending: $remA) - watermark left unset; next run resumes."
}
Out-Log "done."
exit 0
