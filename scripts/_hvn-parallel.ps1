# One-off PARALLEL backfill of house-view notes to beat a deadline.
# Fans out P concurrent headless-claude workers, each generating notes for a small
# shard of companies into its OWN part file (no write races), then merges all
# parts into data/house_view_notes.json and commits+pushes. Local data only (no
# NotebookLM). Hard time cutoffs guarantee a commit by ~23:48.
$ErrorActionPreference="Continue"
$repo="C:\Users\admin\India-Research-Portal"
$node="C:\Program Files\nodejs\node.exe"
$claude="C:\Users\admin\.local\bin\claude.exe"
Set-Location $repo
$utf8=New-Object System.Text.UTF8Encoding $false
$log=Join-Path $repo "scripts\logs\hvn-parallel.log"
function L([string]$m){ $s="["+(Get-Date -f "HH:mm:ss")+"] "+$m; Write-Output $s; Add-Content -LiteralPath $log -Value $s }

$P=8
$shardSize=1
$launchCut=(Get-Date).AddMinutes(360)
$hardCut=(Get-Date).AddMinutes(370)

$prompt=(Get-Content -LiteralPath (Join-Path $repo "docs\house-view-notes-prompt.md") -Raw)
$parts=Join-Path $env:TEMP "hvn_parts"
New-Item -ItemType Directory -Force $parts | Out-Null
Get-ChildItem $parts -EA SilentlyContinue | Remove-Item -Force -Recurse -EA SilentlyContinue

# accuracy-safe sig recovery first (fixes sig formatting on already-complete notes
# so we don't waste limited quota regenerating them)
& $node (Join-Path $repo "scripts\_hvn_canon.js") 2>&1 | ForEach-Object { L $_ }
$need=@(& $node (Join-Path $repo "scripts\_hvn_need.js") 2>$null | Where-Object { $_ -and $_.Trim() })
L ("remaining companies: "+$need.Count+" | P="+$P+" shardSize="+$shardSize+" launchCut="+$launchCut.ToString("HH:mm")+" hardCut="+$hardCut.ToString("HH:mm"))

$shards=New-Object System.Collections.ArrayList
for($i=0;$i -lt $need.Count;$i+=$shardSize){ $hi=[Math]::Min($i+$shardSize-1,$need.Count-1); [void]$shards.Add(@($need[$i..$hi])) }

$W=2               # accuracy-first: low concurrency avoids throttling/truncation; each call runs clean
$waveCap=600       # generous - let each careful generation finish rather than be killed mid-write
$wave=0
while($wave*$W -lt $shards.Count -and (Get-Date) -lt $launchCut){
  $lo=$wave*$W; $hi=[Math]::Min($lo+$W-1,$shards.Count-1)
  $procs=@()
  for($s=$lo; $s -le $hi; $s++){
    $names=$shards[$s]
    $pf=Join-Path $parts ("part_"+$s+".json")
    $full=$prompt + "`n`nSCOPE OVERRIDE: generate house-view notes ONLY for these companies: " + ($names -join "; ") + "."
    $full=$full + "`n`nOUTPUT FILE OVERRIDE: do NOT read or modify data/house_view_notes.json. Instead create a NEW JSON file at this exact absolute path: " + $pf + " whose top-level 'companies' object maps each scoped company name to its entry with keys summary, brokers, sig (same schema described above). Read data/theses.json, data/pdfdata.json and data/trendlyne-coverage.json for these companies only."
    $inf=Join-Path $parts ("in_"+$s+".txt"); [System.IO.File]::WriteAllText($inf,$full,$utf8)
    $of=Join-Path $parts ("log_"+$s+".txt")
    $p=Start-Process -FilePath $claude -ArgumentList @('-p','--permission-mode','bypassPermissions','--allowedTools','Bash','Read','Write','Edit','--model','sonnet') -WorkingDirectory $repo -NoNewWindow -PassThru -RedirectStandardInput $inf -RedirectStandardOutput $of -RedirectStandardError ($of+".err")
    $procs += $p
  }
  L ("wave "+$wave+": launched shards "+$lo+".."+$hi+" ("+$procs.Count+" workers)")
  $waveEnd=(Get-Date).AddSeconds($waveCap)
  foreach($p in $procs){ $ms=[int]([Math]::Max(1000,($waveEnd-(Get-Date)).TotalMilliseconds)); try{ [void]$p.WaitForExit($ms) }catch{} }
  foreach($p in $procs){ if(-not $p.HasExited){ try{ $p.Kill() }catch{} } }
  $donef=(Get-ChildItem $parts -Filter part_*.json -EA SilentlyContinue | Measure-Object).Count
  L ("wave "+$wave+" complete; part files so far: "+$donef)
  # publish progress after each wave (merge accumulated parts -> commit -> push)
  & $node -e "try{require('./data/house_view_notes.json')}catch(e){process.exit(3)}" 2>$null
  if($LASTEXITCODE -ne 0){ & git checkout HEAD -- data/house_view_notes.json 2>&1 | Out-Null }
  & $node (Join-Path $repo "scripts\_hvn_merge.js") $parts (Get-Date -f "yyyy-MM-dd") 2>&1 | ForEach-Object { L $_ }
  & $node -e "var d=require('./data/house_view_notes.json'); Object.keys(d.companies).forEach(function(k){var c=d.companies[k]; if(typeof c.summary!=='string'||!c.brokers) throw 0;});" 2>$null
  if($LASTEXITCODE -eq 0){ & git add data/house_view_notes.json 2>&1 | Out-Null; & git commit -m ("House Views: wave "+$wave+" progress "+(Get-Date -f 'HH:mm')) 2>&1 | Out-Null; & git push origin HEAD:main 2>&1 | Out-Null; L "published progress." }
  # detect claude session-usage limit (workers print "hit your session limit") and stop cleanly
  $limited=$false
  for($cs=$lo; $cs -le $hi; $cs++){ $ct=Get-Content -LiteralPath (Join-Path $parts ("log_"+$cs+".txt")) -Raw -EA SilentlyContinue; if($ct -and ($ct -match 'session limit' -or $ct -match 'hit your')){ $limited=$true } }
  if($limited){ L "CLAUDE SESSION LIMIT reached - stopping run; resume after it resets."; $wave++; break }
  $wave++
}

# ensure base file is valid (restore committed version if a prior run left it bad)
& $node -e "try{require('./data/house_view_notes.json')}catch(e){process.exit(3)}" 2>$null
if($LASTEXITCODE -ne 0){ L "base house_view_notes.json invalid - restoring from HEAD."; & git checkout HEAD -- data/house_view_notes.json 2>&1 | Out-Null }

L "merging shard parts..."
& $node (Join-Path $repo "scripts\_hvn_merge.js") $parts (Get-Date -f "yyyy-MM-dd") 2>&1 | ForEach-Object { L $_ }

# validate merged result; only commit if valid
& $node -e "var d=require('./data/house_view_notes.json'); if(!d.companies) throw 0; Object.keys(d.companies).forEach(function(k){var c=d.companies[k]; if(typeof c.summary!=='string'||!c.brokers) throw 0;}); console.log('valid '+Object.keys(d.companies).length)" 2>&1 | ForEach-Object { L $_ }
if($LASTEXITCODE -eq 0){
  & git add data/house_view_notes.json 2>&1 | Out-Null
  & git commit -m ("House Views: parallel backfill " + (Get-Date -f "HH:mm")) 2>&1 | Out-Null
  & git push origin HEAD:main 2>&1 | Out-Null
  L "committed + pushed."
} else { L "merged file INVALID - not committing." }
L "done."
exit 0
