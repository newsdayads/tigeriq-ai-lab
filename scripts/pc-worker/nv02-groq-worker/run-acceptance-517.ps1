$ErrorActionPreference='Stop'
$env:TIGERIQ_WORKFORCE_CONTROLLER_URL='http://100.97.23.87:8790'
$env:TIGERIQ_WORKFORCE_INGRESS_TOKEN=[IO.File]::ReadAllText('D:\TigerIQ\Secrets\pc01-primary-node.ingress-token').Trim()
$env:TIGERIQ_DATABASE_URL=[IO.File]::ReadAllText('D:\TigerIQ\Secrets\workforce-controller-v1.database-url').Trim()
$env:PGPASSFILE='D:\TigerIQ\Secrets\workforce-controller-v1.pgpass'
$env:TIGERIQ_AUTONOMY_ROOT='D:\TigerIQ\AutonomyRuntime\tigeriq-fast-20260903-174812'
$env:TIGERIQ_WORKSPACE='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$env:TIGERIQ_NV02_RUNTIME='D:\TigerIQ\Runtime\nv02-worker'
& 'C:\Program Files\nodejs\node.exe' 'D:\TigerIQ\Runtime\nv02-worker\acceptance-517.mjs'
exit $LASTEXITCODE
