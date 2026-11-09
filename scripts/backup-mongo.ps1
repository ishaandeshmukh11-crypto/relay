param(
  [Parameter(Mandatory = $true)][string]$Uri,
  [string]$OutDir = ".\backups"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$dir = Join-Path $OutDir "relay-$stamp"
Write-Host "Backing up to $dir (directory format)"
& mongodump --uri=$Uri --out=$dir --gzip
if ($LASTEXITCODE -ne 0) { throw "mongodump failed with $LASTEXITCODE" }
Get-ChildItem $dir -Recurse | Format-Table FullName, Length
Write-Host "OK $dir"
