# Company Q&A — NEW-REPORT SYNC step (invoked by daily-refresh.ps1, before build-company-qa.ps1).
#
# Event-driven trigger: when a new broker PDF appears in the local library, push
# it into the company's NotebookLM SECTOR notebook (so the grounding source has
# it) and mark that company stale (blank its asOf in data/company_qa.json) so the
# answerer regenerates its Q&A grounded in the updated notebook.
#
# "New" = a data/pdfmap.json key not seen on a prior run (tracked in
# scripts/.company-qa-synced.json, written WITHOUT a BOM so node JSON.parse can
# read it). FIRST run BASELINES (records the current library as already-seen and
# uploads nothing) so it never bulk-uploads the existing ~600 PDFs - only
# genuinely new reports from then on trigger work.
#
# pdfmap key = "House|YYMMDD|Company|slug"; Company (field 3) = folder = a
# companies.json key. Sector notebook resolved via data/sector_notebooks.json
# routing (same as the answerer). Companies whose sector has no sourced notebook
# are recorded as seen and skipped.
#
# Shares scripts\.company-qa.lock with build-company-qa.ps1 so it never races the
# (one-off) backfill's writes to company_qa.json. ALWAYS exits 0.
#
# Dry run (no uploads, no writes):  powershell -File scripts\build-company-qa-sync.ps1 -DryRun

param([switch]$DryRun)
$ErrorActionPreference = "Continue"

$repo  = "C:\Users\admin\India-Research-Portal"
$node  = "C:\Program Files\nodejs\node.exe"
$nlm   = "C:\Users\admin\.local\bin\nlm.exe"
$state = Join-Path $repo "scripts\.company-qa-synced.json"
$lock  = Join-Path $repo "scripts\.company-qa.lock"
Set-Location $repo
$utf8nb = New-Object System.Text.UTF8Encoding $false

function SLog([string]$m){ Write-Output ("[company-qa-sync] " + $m) }
function Save-State($keys){ $json = (@{ keys = $keys; asOf = (Get-Date).ToString("s") } | ConvertTo-Json -Compress); [System.IO.File]::WriteAllText($state, $json, $utf8nb) }

if (-not (Test-Path -LiteralPath $nlm)) { $c = Get-Command nlm -ErrorAction SilentlyContinue; if ($c) { $nlm = $c.Source } else { SLog "nlm not found - skipping."; exit 0 } }

# --- lock (shared with build-company-qa.ps1); skip if a fresh lock is held ----
if (-not $DryRun -and (Test-Path -LiteralPath $lock)) {
  $age = (New-TimeSpan -Start (Get-Item $lock).LastWriteTime -End (Get-Date)).TotalMinutes
  if ($age -lt 90) { SLog "another Q&A run holds the lock ($([int]$age)m old) - skipping this sync."; exit 0 }
}
if (-not $DryRun) { Set-Content -LiteralPath $lock -Value (Get-Date).ToString("s") -Encoding utf8 }

try {
  # --- detect new pdfmap keys (baseline-aware). State JSON is read with a BOM
  #     strip so a stray BOM never makes it silently re-baseline. --------------
  $detect = @'
var P=require("path"),CWD=process.cwd(),fs=require("fs");
var pdfmap=require(P.join(CWD,"data/pdfmap.json"));
var c=require(P.join(CWD,"data/companies.json"));
var sn=require(P.join(CWD,"data/sector_notebooks.json"));
var titles=new Set(sn.notebooks.map(function(n){return n.title;}));
var r=sn.routing, SEP=" "+String.fromCharCode(183)+" ";
function route(s){if(!s)return null;if(r[s])return r[s];var p=s.split(SEP);for(var i=p.length;i>=1;i--){var k=p.slice(0,i).join(SEP);if(r[k])return r[k];}return r[p[0]]||null;}
function nbId(t){var f=sn.notebooks.find(function(n){return n.title===t;});return f?f.id:null;}
var sf=P.join(CWD,"scripts/.company-qa-synced.json"), seen=null;
try{seen=JSON.parse(fs.readFileSync(sf,"utf8").replace(/^﻿/,"")).keys;}catch(e){}
var cur=Object.keys(pdfmap);
if(!seen){console.log(JSON.stringify({baseline:true,currentKeys:cur,newRouted:[],newUnrouted:[]}));process.exit(0);}
var seenSet=new Set(seen);
var fresh=cur.filter(function(k){return !seenSet.has(k);});
var newRouted=[],newUnrouted=[];
fresh.forEach(function(k){
  var parts=k.split("|"), company=parts[2];
  var sec=(c[company]?c[company].sector:null);
  var t=sec?route(sec):null, id=(t&&titles.has(t))?nbId(t):null;
  if(id&&c[company]){newRouted.push({key:k,company:company,notebookId:id,title:t,path:pdfmap[k]});}
  else{newUnrouted.push(k);}
});
console.log(JSON.stringify({baseline:false,currentKeys:cur,newRouted:newRouted,newUnrouted:newUnrouted}));
'@
  $detectJs = Join-Path $env:TEMP 'cqa-sync-detect.js'; [System.IO.File]::WriteAllText($detectJs, $detect, $utf8nb)
  $raw = (& $node $detectJs 2>$null | Out-String).Trim()
  Remove-Item $detectJs -Force -ErrorAction SilentlyContinue
  if (-not $raw) { SLog "detection produced no output - skipping."; return }
  $d = $raw | ConvertFrom-Json

  if ($d.baseline) {
    SLog ("first run - baselining " + @($d.currentKeys).Count + " existing PDFs as seen (no uploads).")
    if (-not $DryRun) { Save-State $d.currentKeys }
    return
  }

  $newRouted = @($d.newRouted); $newUnrouted = @($d.newUnrouted)
  SLog ("new reports since last run: " + $newRouted.Count + " routed, " + $newUnrouted.Count + " unrouted (skipped).")
  if ($newRouted.Count -eq 0) {
    if (-not $DryRun) { Save-State $d.currentKeys }
    return
  }

  # --- upload each new routed PDF into its sector notebook --------------------
  $affected = @{}; $failed = @{}
  foreach ($it in $newRouted) {
    $fileName = Split-Path -Leaf $it.path
    if ($DryRun) { SLog ("DRYRUN would upload [" + $it.company + " -> " + $it.title + "] " + $fileName); $affected[$it.company] = $true; continue }
    if (-not (Test-Path -LiteralPath $it.path)) { SLog ("file missing, skip: " + $it.path); continue }
    SLog ("uploading [" + $it.company + " -> " + $it.title + "] " + $fileName)
    & $nlm source add $it.notebookId --file $it.path --title $fileName --wait --wait-timeout 600 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $affected[$it.company] = $true }
    else { SLog ("  upload FAILED (" + $it.company + ") - will retry next run."); $failed[$it.key] = $true }
  }

  # --- mark affected companies stale (blank asOf) so the answerer re-does them
  $names = @($affected.Keys)
  if ($names.Count -gt 0 -and -not $DryRun) {
    $namesFile = Join-Path $env:TEMP 'cqa-sync-stale.txt'
    [System.IO.File]::WriteAllText($namesFile, ($names -join "`n"), $utf8nb)
    $blank = @'
var P=require("path"),CWD=process.cwd(),fs=require("fs");
var qaPath=P.join(CWD,"data/company_qa.json");
var d=JSON.parse(fs.readFileSync(qaPath,"utf8").replace(/^﻿/,""));
var names=fs.readFileSync(process.argv[2],"utf8").replace(/^﻿/,"").split("\n").map(function(s){return s.trim();}).filter(Boolean);
var n=0;
names.forEach(function(nm){ if(d.companies&&d.companies[nm]){ d.companies[nm].asOf=""; n++; } });
fs.writeFileSync(qaPath, JSON.stringify(d,null,2));
console.log(n);
'@
    $blankJs = Join-Path $env:TEMP 'cqa-sync-blank.js'; [System.IO.File]::WriteAllText($blankJs, $blank, $utf8nb)
    $marked = (& $node $blankJs $namesFile 2>$null | Out-String).Trim()
    SLog ("marked $marked company(ies) stale for re-answer: " + ($names -join ', '))
    Remove-Item $namesFile,$blankJs -Force -ErrorAction SilentlyContinue
  } elseif ($names.Count -gt 0) {
    SLog ("DRYRUN would mark stale: " + ($names -join ', '))
  }

  # --- advance state: everything current EXCEPT keys whose upload failed ------
  if (-not $DryRun) {
    $keep = @($d.currentKeys | Where-Object { -not $failed[$_] })
    Save-State $keep
  }
  SLog "sync done."
}
finally {
  if (-not $DryRun) { Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue }
}
exit 0
