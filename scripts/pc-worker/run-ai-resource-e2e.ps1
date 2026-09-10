param(
  [ValidateSet('gemini','groq','ollama')][string]$Provider='gemini',
  [ValidateSet('low','medium','high')][string]$Risk='low'
)
$ErrorActionPreference='Stop'
$env:TIGERIQ_WORKFORCE_CONTROLLER_URL='http://100.97.23.87:8790'
$env:TIGERIQ_WORKFORCE_INGRESS_TOKEN=[IO.File]::ReadAllText('D:\TigerIQ\Secrets\pc01-primary-node.ingress-token').Trim()
try {
  & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'submit-ai-resource-e2e.mjs') "--provider=$Provider" "--risk=$Risk"
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:TIGERIQ_WORKFORCE_CONTROLLER_URL -ErrorAction SilentlyContinue
  Remove-Item Env:TIGERIQ_WORKFORCE_INGRESS_TOKEN -ErrorAction SilentlyContinue
}
