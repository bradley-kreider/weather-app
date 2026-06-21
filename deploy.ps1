param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Staging all changes..." -ForegroundColor Cyan
git add -A

Write-Host "  Committing: `"$Message`"" -ForegroundColor Cyan
git commit -m $Message

Write-Host "  Pushing to GitHub..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "  Deployed successfully!" -ForegroundColor Green
Write-Host "  $Message" -ForegroundColor DarkGray
Write-Host ""
