param(
  [Parameter(Mandatory=$false)][string]$Model = $env:TIGERIQ_OLLAMA_MODEL,
  [Parameter(Mandatory=$false)][string]$BaseUrl = 'http://127.0.0.1:11434',
  [Parameter(Mandatory=$false)][int]$NumCtx = 16384,
  [Parameter(Mandatory=$false)][int]$NumPredict = 128,
  [Parameter(Mandatory=$false)][int]$TimeoutSec = 180,
  [Parameter(Mandatory=$false)][string]$Prompt = 'Reply exactly: TIGERIQ_LOCAL_OK'
)

$ErrorActionPreference = 'Stop'

if (-not $Model) {
  throw 'TIGERIQ_OLLAMA_MODEL is not set and -Model was not supplied.'
}

$baseUri = [uri]$BaseUrl
if ($baseUri.Scheme -ne 'http' -or $baseUri.Host -ne '127.0.0.1') {
  throw 'OLLAMA_LOOPBACK_LITERAL_REQUIRED'
}
if ($NumCtx -lt 256 -or $NumCtx -gt 32768) {
  throw 'NumCtx must be between 256 and 32768.'
}
if ($NumPredict -lt 1 -or $NumPredict -gt 2048) {
  throw 'NumPredict must be between 1 and 2048.'
}
if ($TimeoutSec -lt 10 -or $TimeoutSec -gt 900) {
  throw 'TimeoutSec must be between 10 and 900.'
}

function Get-CpuSnapshot {
  try {
    $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop
    $avg = ($cpu | Measure-Object -Property LoadPercentage -Average).Average
    if ($null -eq $avg) { return $null }
    return [math]::Round([double]$avg, 2)
  } catch {
    return $null
  }
}

function Get-MemorySnapshot {
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    return [ordered]@{
      totalBytes = [int64]$os.TotalVisibleMemorySize * 1024
      availableBytes = [int64]$os.FreePhysicalMemory * 1024
    }
  } catch {
    return $null
  }
}

function Get-GpuSnapshot {
  try {
    $nvidiaSmi = Get-Command 'nvidia-smi.exe' -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
      $nvidiaSmi = Get-Command 'nvidia-smi' -ErrorAction SilentlyContinue
    }
    if (-not $nvidiaSmi) { return @() }

    $rows = & $nvidiaSmi.Source '--query-gpu=index,name,utilization.gpu,memory.used,memory.total' '--format=csv,noheader,nounits' 2>$null

    return @($rows | ForEach-Object {
      $parts = $_ -split '\s*,\s*'
      if ($parts.Count -lt 5) { return }
      [ordered]@{
        index = [int]$parts[0]
        name = [string]$parts[1]
        utilizationPct = [double]$parts[2]
        memoryUsedMiB = [double]$parts[3]
        memoryTotalMiB = [double]$parts[4]
      }
    })
  } catch {
    return @()
  }
}

function Find-RuntimeModel {
  param($PsPayload, [string]$TargetModel)
  if (-not $PsPayload -or -not $PsPayload.models) { return $null }
  return @($PsPayload.models) | Where-Object {
    $_.name -eq $TargetModel -or $_.model -eq $TargetModel
  } | Select-Object -First 1
}

function Value-Or-Zero {
  param($Value)
  if ($null -eq $Value) { return 0 }
  return [double]$Value
}

$version = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/version" -TimeoutSec 10
$tags = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/tags" -TimeoutSec 10
$modelNames = @($tags.models | ForEach-Object { if ($_.name) { $_.name } else { $_.model } })
if ($modelNames -notcontains $Model) {
  throw "Model '$Model' is not installed. Installed: $($modelNames -join ', ')"
}

$psBefore = $null
try {
  $psBefore = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/ps" -TimeoutSec 10
} catch {}

$cpuBefore = Get-CpuSnapshot
$memoryBefore = Get-MemorySnapshot
$gpuBefore = Get-GpuSnapshot

$payload = @{
  model = $Model
  prompt = $Prompt
  stream = $false
  think = $false
  options = @{
    temperature = 0
    num_ctx = $NumCtx
    num_predict = $NumPredict
  }
} | ConvertTo-Json -Depth 8

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/generate" -ContentType 'application/json' -Body $payload -TimeoutSec $TimeoutSec
$stopwatch.Stop()

$text = [string]$response.response
if (-not $text) { throw 'Ollama returned no assistant content.' }

$psAfter = $null
try {
  $psAfter = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/ps" -TimeoutSec 10
} catch {}

$cpuAfter = Get-CpuSnapshot
$memoryAfter = Get-MemorySnapshot
$gpuAfter = Get-GpuSnapshot

$runtimeModel = Find-RuntimeModel -PsPayload $psAfter -TargetModel $Model
if (-not $runtimeModel) {
  $runtimeModel = Find-RuntimeModel -PsPayload $psBefore -TargetModel $Model
}

$modelSizeBytes = if ($runtimeModel -and $runtimeModel.size) { [int64]$runtimeModel.size } else { 0 }
$gpuResidentBytes = if ($runtimeModel -and $runtimeModel.size_vram) { [int64]$runtimeModel.size_vram } else { 0 }
$cpuResidentApproxBytes = if ($modelSizeBytes -gt 0) { [math]::Max([int64]0, $modelSizeBytes - $gpuResidentBytes) } else { 0 }
$gpuResidentPct = if ($modelSizeBytes -gt 0) { [math]::Round(($gpuResidentBytes / [double]$modelSizeBytes) * 100, 2) } else { 0 }

$evalDurationNs = Value-Or-Zero $response.eval_duration
$evalCount = Value-Or-Zero $response.eval_count
$tokensPerSec = if ($evalDurationNs -gt 0 -and $evalCount -gt 0) {
  [math]::Round($evalCount / ($evalDurationNs / 1000000000.0), 3)
} else { 0 }

[ordered]@{
  ok = $true
  version = $version.version
  endpoint = "$BaseUrl/api/generate"
  model = $Model
  contextTokens = $NumCtx
  maxPredictTokens = $NumPredict
  wallMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
  loadDurationNs = Value-Or-Zero $response.load_duration
  promptEvalDurationNs = Value-Or-Zero $response.prompt_eval_duration
  promptEvalCount = Value-Or-Zero $response.prompt_eval_count
  evalDurationNs = $evalDurationNs
  evalCount = $evalCount
  tokensPerSec = $tokensPerSec
  modelSizeBytes = $modelSizeBytes
  gpuResidentBytes = $gpuResidentBytes
  cpuResidentApproxBytes = $cpuResidentApproxBytes
  gpuResidentPct = $gpuResidentPct
  cpuLoadPctBefore = $cpuBefore
  cpuLoadPctAfter = $cpuAfter
  memoryBefore = $memoryBefore
  memoryAfter = $memoryAfter
  gpuBefore = $gpuBefore
  gpuAfter = $gpuAfter
  response = $text
} | ConvertTo-Json -Depth 8
