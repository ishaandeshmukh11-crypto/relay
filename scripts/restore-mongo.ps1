param(
  [Parameter(Mandatory = $true)][string]$Uri,
  [Parameter(Mandatory = $true)][string]$Dir
)
$ErrorActionPreference = "Stop"
Write-Host "WARNING: restoring $Dir into $Uri (destructive --drop). Never use against production without separate authorization."
& mongorestore --uri=$Uri --gzip --drop $Dir
if ($LASTEXITCODE -ne 0) { throw "mongorestore failed with $LASTEXITCODE" }
Write-Host "Restore finished"
