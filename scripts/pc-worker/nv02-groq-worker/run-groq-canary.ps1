$ErrorActionPreference='Stop'
$env:TIGERIQ_WORKFORCE_CONTROLLER_URL='http://100.97.23.87:8790'
$env:TIGERIQ_WORKFORCE_INGRESS_TOKEN=[IO.File]::ReadAllText('D:\TigerIQ\Secrets\pc01-primary-node.ingress-token').Trim()
try {
  & 'C:\Program Files\nodejs\node.exe' 'D:\TigerIQ\Runtime\nv02-worker\submit-groq-canary.js'
  exit $LASTEXITCODE
} finally {
  $env:TIGERIQ_WORKFORCE_INGRESS_TOKEN=$null
}
