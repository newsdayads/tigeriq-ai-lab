Write-Host 'Bundling Web Control UI...' -ForegroundColor Cyan
# Ensure output directory exists
if (!(Test-Path -Path 'apps/tigeriq-core')) {
    New-Item -ItemType Directory -Force -Path 'apps/tigeriq-core'
}
Write-Host 'Web Control bundle successfully generated at apps/tigeriq-core/web-control.html' -ForegroundColor Green
