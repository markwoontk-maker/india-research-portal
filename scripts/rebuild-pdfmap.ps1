# Regenerate data/pdfmap.json from the local broker-PDF library.
# Run any time new reports are dropped into:
#   C:\Users\admin\Desktop\India Related Reports\<Company>\[YYMMDD] [House] Co - Title.pdf
# Then commit + push so the GitHub Pages site picks up the new map.

$repo = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $repo 'data\pdfmap.json'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

$cut = (Get-Date).AddDays(-2)
$rows = Get-ChildItem 'C:\Users\admin\Desktop\India Related Reports' -Recurse -File -Filter *.pdf -ErrorAction SilentlyContinue |
  Where-Object {
    $_.LastWriteTime -ge $cut -and
    $_.BaseName -match '^\[(\d{6})\]\s*\[([^\]]+)\]\s*(.+?)\s*-\s*(.+)$' -and
    $matches[1] -ge (Get-Date).AddDays(-2).ToString('yyMMdd')
  } |
  ForEach-Object {
    $null = $_.BaseName -match '^\[(\d{6})\]\s*\[([^\]]+)\]\s*(.+?)\s*-\s*(.+)$'
    # Drop trailing " (N)" suffix on duplicates; lenient-key the title
    # (alphanumeric-only) so headline ↔ filename punctuation differences
    # (commas, em-dash vs hyphen, slash vs hyphen) still match.
    $titleNorm = (($matches[4].Trim() -replace '\s*\(\d+\)\s*$','').ToLower() -replace '[^a-z0-9]+','')
    [pscustomobject]@{
      Key = "$($matches[2].Trim())|$($matches[1])|$($_.Directory.Name)|$titleNorm"
      Path = $_.FullName
    }
  } | Sort-Object Key -Unique

$map = @{}
foreach ($r in $rows) { $map[$r.Key] = $r.Path }
$json = $map | ConvertTo-Json -Compress
# PS 5.1's `Out-File -Encoding utf8` always writes a BOM; use raw .NET to avoid it.
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Output ("Wrote {0} entries -> {1}" -f $rows.Count, $out)
