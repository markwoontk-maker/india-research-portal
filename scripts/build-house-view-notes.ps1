# House-view notes build step (invoked by daily-refresh.ps1, after build-theses).
#
# Generates data/house_view_notes.json — the overlay that adds a cross-house
# summary + per-broker change-vs-prior + the assistant's own view to the
# Company-tab House Views segment. Pure reasoning over LOCAL data
# (theses.json + pdfdata.json + trendlyne-coverage.json) via a headless-claude
# pass -- NO NotebookLM, so it is NOT rate-limited.
#
# Event-driven: a company is (re)generated when its houseViews "signature"
# (sorted broker|date keys) differs from the sig stored in the notes file -- i.e.
# whenever build-theses refreshes that company's house views. Small scoped
# batches; claude run via Start-Process + stdin (NOT Start-Job) + hard timeout;
# node helpers run as temp .js files with cwd-resolved requires. Per-batch
# backup+validate+restore. ALWAYS exits 0. Budget via $env:HVN_BUDGET (default 1200).
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-house-view-notes.ps1

$ErrorActionPreference = "Continue"

$repo            = "C:\Users\admin\India-Research-Portal"
$node            = "C:\Program Files\nodejs\node.exe"
$prompt          = Join-Path $repo "docs\house-view-notes-prompt.md"
$claude          = "C:\Users\admin\.local\bin\claude.exe"
$model           = "sonnet"
$batch           = 2      # companies per call (richer multi-paragraph output - small batch limits blast radius if one write fails validation)
$callTimeoutSec  = 600
$overallBudgetSec= if ($env:HVN_BUDGET) { [int]$env:HVN_BUDGET } else { 1200 }
$maxNoProgress   = 6      # tolerate a few bad/empty batches before aborting (run is resumable anyway)

function Out-Log([string]$m){ Write-Output ("[build-house-view-notes] " + $m) }

# validator: house_view_notes.json companies have string summary + object brokers
$valJs = 'var P=require("path"),CWD=process.cwd();var d=require(P.join(CWD,"data/house_view_notes.json"));if(!d.companies)throw 0;Object.keys(d.companies).forEach(function(k){var c=d.companies[k];if(typeof c.summary!=="string")throw 0;if(!c.brokers||typeof c.brokers!=="object")throw 0;});'

# needGen: companies with houseViews whose signature differs from the stored sig
$needJs = 'var P=require("path"),CWD=process.cwd();var T=require(P.join(CWD,"data/theses.json"));var n={};try{n=require(P.join(CWD,"data/house_view_notes.json")).companies||{}}catch(e){}function sig(hv){return hv.map(function(v){return v.broker+"|"+v.date}).sort().join(",");}function norm(s){return String(s||"").split(",").map(function(x){return x.trim()}).filter(Boolean).sort().join(",");}console.log(Object.keys(T).filter(function(c){var hv=T[c]&&T[c].houseViews;if(!hv||!hv.length)return false;var e=n[c];return !(e&&norm(e.sig)===sig(hv));}).join("\n"));'

# --- locate claude / prompt --------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
if (-not (Test-Path -LiteralPath $prompt)) { Out-Log "prompt file missing - skipping."; exit 0 }
if (-not (Test-Path -LiteralPath (Join-Path $repo 'data\theses.json'))) { Out-Log "theses.json missing - skipping."; exit 0 }

Set-Location $repo
# seed the notes file if absent so requires/validates don't fail
if (-not (Test-Path -LiteralPath (Join-Path $repo 'data\house_view_notes.json'))) {
  [System.IO.File]::WriteAllText((Join-Path $repo 'data\house_view_notes.json'), '{"asOf":"","companies":{}}', (New-Object System.Text.UTF8Encoding $false))
}
$deadline = (Get-Date).AddSeconds($overallBudgetSec)
Out-Log "running house-view-notes generator (budget $([int]($overallBudgetSec/60)) min)..."

$utf8nb = New-Object System.Text.UTF8Encoding $false
$jsNeed = Join-Path $env:TEMP 'hvn-need.js'; [System.IO.File]::WriteAllText($jsNeed, $needJs, $utf8nb)
$jsVal  = Join-Path $env:TEMP 'hvn-val.js';  [System.IO.File]::WriteAllText($jsVal,  $valJs, $utf8nb)

function Invoke-Batch([string[]]$names) {
  $scope = "`n`nSCOPE OVERRIDE: Process ONLY these companies, using these EXACT names as the keys: " +
           ($names -join '; ') + ". Keep every other company in data/house_view_notes.json untouched. Do NOT run git."
  $full = (Get-Content -LiteralPath $prompt -Raw) + $scope
  $tmpIn  = Join-Path $env:TEMP 'hvn-in.txt'
  $tmpOut = Join-Path $env:TEMP 'hvn-out.txt'
  $tmpErr = Join-Path $env:TEMP 'hvn-err.txt'
  [System.IO.File]::WriteAllText($tmpIn, $full, $utf8nb)
  $procArgs = @('-p','--permission-mode','bypassPermissions','--allowedTools','Bash','Read','Write','Edit','--model',$model)
  $p = Start-Process -FilePath $claude -ArgumentList $procArgs `
        -WorkingDirectory $repo -NoNewWindow -PassThru `
        -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
  $done = $p.WaitForExit($callTimeoutSec * 1000)
  if (-not $done) { try { $p.Kill() } catch {}; Out-Log "batch timed out (killed)." }
  Remove-Item $tmpIn,$tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  return $done
}

function Get-Need { @(& $node $jsNeed 2>$null) | Where-Object { $_ -and $_.Trim() } }
$need = @(Get-Need)
Out-Log "$($need.Count) companies need house-view notes (new or changed)."
$noProgress = 0; $attempted = @{}
while ($need.Count -gt 0 -and (Get-Date) -lt $deadline -and $noProgress -lt $maxNoProgress) {
  $b = @($need | Where-Object { -not $attempted[$_] } | Select-Object -First $batch)
  if ($b.Count -eq 0) { break }
  Out-Log ("generate (" + $b.Count + "): " + ($b -join ', '))
  $bak = Join-Path $env:TEMP 'hvn.bak.json'
  Copy-Item -LiteralPath (Join-Path $repo 'data/house_view_notes.json') $bak -Force -ErrorAction SilentlyContinue
  [void](Invoke-Batch $b)
  & $node $jsVal 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Out-Log "house_view_notes.json invalid after batch - restoring pre-batch copy."
    if (Test-Path -LiteralPath $bak) { Copy-Item -LiteralPath $bak (Join-Path $repo 'data/house_view_notes.json') -Force }
  }
  Remove-Item $bak -Force -ErrorAction SilentlyContinue
  $before = $need.Count
  $need = @(Get-Need)
  if ($need.Count -ge $before) { foreach ($n in $b) { $attempted[$n] = $true }; $noProgress++; Out-Log "batch made no progress ($noProgress/$maxNoProgress)." }
  else { $noProgress = 0 }
}
if ($noProgress -ge $maxNoProgress) { Out-Log "aborting after $maxNoProgress no-progress batches." }
$rem = @(Get-Need).Count
Out-Log ("done - $rem companies still pending.")
exit 0
