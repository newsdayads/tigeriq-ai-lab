param(
  [Parameter(Mandatory=$false)][string]$Model = $env:TIGERIQ_OLLAMA_MODEL,
  [Parameter(Mandatory=$false)][string]$BaseUrl = 'http://127.0.0.1:11434'
)

$ErrorActionPreference = 'Stop'

if (-not $Model) {
  throw 'TIGERIQ_OLLAMA_MODEL is not set and -Model was not supplied.'
}

$version = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/version" -TimeoutSec 10
$tags = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/tags" -TimeoutSec 10
$modelNames = @($tags.models | ForEach-Object { $_.name })
if ($modelNames -notcontains $Model) {
  throw "Model '$Model' is not installed. Installed: $($modelNames -join ', ')"
}

$payload = @{
  model = $Model
  messages = @(@{ role = 'user'; content = 'Reply exactly: TIGERIQ_LOCAL_OK' })
  stream = $false
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/v1/chat/completions" -ContentType 'application/json' -Body $payload -TimeoutSec 180
$text = $response.choices[0].message.content
if (-not $text) { throw 'Ollama returned no assistant content.' }

[ordered]@{
  ok = $true
  version = $version.version
  endpoint = "$BaseUrl/v1/chat/completions"
  model = $Model
  response = $text
} | ConvertTo-Json -Depth 5
