# Company Q&A build step (invoked by daily-refresh.ps1).
#
# Two headless-Claude passes against the company NotebookLM library:
#   1. Questioner (docs/company-qa-questioner-prompt.md) -> data/company_questions.json
#   2. Answerer   (docs/company-qa-answerer-prompt.md)   -> data/company_qa.json
# Grounding is NotebookLM-only (nlm CLI, profile 'work'). No web, no keys.
#
# Gated twice-monthly (H1 on/after the 2nd, H2 on/after the 17th) via
# scripts/.company-qa-state.json, like build-positioning.ps1. The answerer is
# resumable (skips companies already fresh in the window), so the watermark is
# advanced only after a window's pass completes without timing out; a timed-out
# partial run leaves the watermark UNset so the next daily run keeps going.
# Per-file validation; revert a malformed file individually. ALWAYS exits 0.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-company-qa.ps1

$ErrorActionPreference = "Continue"

$repo        = "C:\Users\admin\India-Research-Portal"
$node        = "C:\Program Files\nodejs\node.exe"
$qPrompt     = Join-Path $repo "docs\company-qa-questioner-prompt.md"
$aPrompt     = Join-Path $repo "docs\company-qa-answerer-prompt.md"
$stateFile   = Join-Path $repo "scripts\.company-qa-state.json"
$claude      = "C:\Users\admin\.local\bin\claude.exe"
$model       = "sonnet"
$timeoutSec  = 1500   # hard kill ceiling; answerer self-stops ~20 min, this leaves a margin so a kill rarely lands mid-write

function Out-Log([string]$m){ Write-Output ("[build-company-qa] " + $m) }

# file -> node validation expression (throws on malformed result)
$validators = [ordered]@{
  "data/company_questions.json" = 'const d=require("./data/company_questions.json"); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["bull","bear","debates"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(!it.q) throw 0});});});'
  "data/company_qa.json"        = 'const d=require("./data/company_qa.json"); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["bull","bear","debates"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(typeof it.q!=="string"||typeof it.a!=="string") throw 0});});});'
}
$files = @($validators.Keys)

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
Out-Log "window $window not yet done - running miner..."

Set-Location $repo

# --- snapshot for per-file revert --------------------------------------------
$pre = @{}
foreach ($f in $files) {
  $p = Join-Path $repo $f
  $pre[$f] = if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" }
}

# --- helper: run one headless pass with a timeout; returns $true if it finished
function Invoke-Pass([string]$promptPath, [string]$label) {
  $prompt = (Get-Content -LiteralPath $promptPath -Raw) +
    "`n`nWRAPPER OVERRIDE: Do NOT run git commit/push and do NOT branch. Only create/update the data file(s), then stop. The local wrapper commits + pushes."
  # Run claude DIRECTLY via Start-Process, prompt fed on stdin (temp file), hard
  # timeout via WaitForExit. An earlier Start-Job version returned empty / zero
  # changes for long tool-using runs (the background runspace did not carry the
  # CLI's tool/auth context a direct child process gets); stdin also sidesteps
  # command-line length/quoting limits for the large prompt.
  $tmpIn  = Join-Path $env:TEMP ("cqa-$label-in.txt")
  $tmpOut = Join-Path $env:TEMP ("cqa-$label-out.txt")
  $tmpErr = Join-Path $env:TEMP ("cqa-$label-err.txt")
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tmpIn, $prompt, $utf8NoBom)
  $procArgs = @('-p','--permission-mode','bypassPermissions','--allowedTools','Bash','Read','Write','Edit','--model',$model)
  $p = Start-Process -FilePath $claude -ArgumentList $procArgs `
        -WorkingDirectory $repo -NoNewWindow -PassThru `
        -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
  $done = $p.WaitForExit($script:timeoutSec * 1000)
  if ($done) {
    Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue | ForEach-Object { if ($_) { Out-Log ("$label> " + $_) } }
    $err = Get-Content -LiteralPath $tmpErr -Raw -ErrorAction SilentlyContinue
    if ($err -and $err.Trim()) { Out-Log ("$label-stderr> " + $err.Trim()) }
  } else {
    try { $p.Kill() } catch {}
    Out-Log "$label pass timed out."
  }
  Remove-Item $tmpIn,$tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  return $done
}

# --- pass 1: questioner ------------------------------------------------------
$qDone = Invoke-Pass $qPrompt "questioner"

# --- pass 2: answerer (resumable; runs even if questioner partial) -----------
$aDone = Invoke-Pass $aPrompt "answerer"

# --- per-file validate; revert only the bad ones -----------------------------
$changed = 0
foreach ($f in $files) {
  $p = Join-Path $repo $f
  $post = if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" }
  if ($post -eq $pre[$f]) { continue }
  & $node -e $validators[$f] 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Out-Log "VALIDATION FAILED: $f - reverting just this file."
    & git checkout -- $f 2>&1 | Out-Null
  } else {
    Out-Log "$f updated + validated."
    $changed++
  }
}

# --- advance the watermark ONLY when every questioned company has a fresh answer
# in this window. A run that timed out, was killed, or just made partial progress
# leaves the watermark unset so the next daily run resumes the remaining names.
# (Completion is measured by the data, not by "the passes returned" - a no-op or
# self-stopped answerer must NOT burn the fortnight window.)
$allFresh = $false
if ($qDone) {
  $winStart = if ($now.Day -ge 17) { $now.ToString('yyyy-MM-17') } else { $now.ToString('yyyy-MM-02') }
  & $node -e "const q=require('./data/company_questions.json').companies||{};const a=(require('./data/company_qa.json').companies)||{};const ws=process.argv[1];const pending=Object.keys(q).filter(n=>!(a[n]&&a[n].asOf&&a[n].asOf>=ws));if(pending.length){console.error(pending.length+' company(ies) still pending');process.exit(1)}process.exit(0)" $winStart 2>&1 | Out-Null
  $allFresh = ($LASTEXITCODE -eq 0)
}
if ($allFresh) {
  @{ lastWindow = $window; asOf = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  Out-Log "window $window complete (all questioned companies have fresh answers) - watermark advanced."
} else {
  Out-Log "window NOT complete (companies still pending or a pass failed) - watermark left unset; next run resumes."
}
Out-Log ("done - $changed file(s) updated this run.")
exit 0
