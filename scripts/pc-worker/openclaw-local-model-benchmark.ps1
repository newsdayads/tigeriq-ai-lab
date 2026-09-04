param(
  [string[]]$Models = @('qwen3:4b','gemma3:4b'),
  [int[]]$Contexts = @(4096,8192),
  [int]$Repeats = 3,
  [int]$TimeoutSec = 120,
  [string]$OutputDir = 'D:\TigerIQ\OpenClaw\diagnostics'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$OllamaBase = 'http://127.0.0.1:11434'
$Expected = 'TIGERIQ_LOCAL_PASS'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$outFile = Join-Path $OutputDir "OPENCLAW_LOCAL_BENCH_$stamp.json"
$lockPath = Join-Path $OutputDir '.openclaw-local-benchmark.lock'
$lockStream = $null

function Get-GatewayAudit {
  $tasks = @()
  try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -in @('TigerIQ OpenClaw Runtime','OpenClaw Gateway') } | ForEach-Object {
      $action = @($_.Actions | ForEach-Object { [ordered]@{ execute=$_.Execute; arguments=$_.Arguments; workingDirectory=$_.WorkingDirectory } })
      [ordered]@{ taskName=$_.TaskName; taskPath=$_.TaskPath; state=[string]$_.State; actions=$action }
    })
  } catch {
    $tasks = @([ordered]@{ error="$($_.Exception.GetType().Name): $($_.Exception.Message)" })
  }

  $listeners = @()
  try {
    foreach($l in @(Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction Stop)) {
      $procName = $null; $exePath = $null
      try {
        $p = Get-Process -Id $l.OwningProcess -ErrorAction Stop
        $procName = $p.ProcessName
        try { $exePath = $p.Path } catch {}
      } catch {}
      $listeners += [ordered]@{ localAddress=$l.LocalAddress; localPort=$l.LocalPort; owningProcess=$l.OwningProcess; processName=$procName; executablePath=$exePath }
    }
  } catch {}

  $httpStatus = $null; $httpError = $null
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/' -Method Get -TimeoutSec 5 -UseBasicParsing
    $httpStatus = [int]$r.StatusCode
  } catch {
    $httpError = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
    try { if($null -ne $_.Exception.Response){ $httpStatus = [int]$_.Exception.Response.StatusCode } } catch {}
  }

  $configPath = 'D:\TigerIQ\OpenClaw\openclaw.json'
  $configEvidence = [ordered]@{ path=$configPath; exists=(Test-Path -LiteralPath $configPath); sha256=$null; lastWriteTime=$null }
  if($configEvidence.exists) {
    try { $configEvidence.sha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash } catch {}
    try { $configEvidence.lastWriteTime = (Get-Item -LiteralPath $configPath).LastWriteTime.ToString('o') } catch {}
  }

  return [ordered]@{
    timestamp=(Get-Date).ToString('o')
    mutation='NONE_READ_ONLY'
    scheduledTasks=$tasks
    listeners=$listeners
    listenerCount=$listeners.Count
    httpStatus=$httpStatus
    httpError=$httpError
    config=$configEvidence
  }
}

function Get-OllamaPsSnapshot {
  try {
    $r = Invoke-RestMethod -Uri "$OllamaBase/api/ps" -Method Get -TimeoutSec 10
    $models = @()
    if($null -ne $r -and $r.PSObject.Properties.Name -contains 'models' -and $null -ne $r.models) {
      $models = @($r.models | ForEach-Object {
        $size = if($_.PSObject.Properties.Name -contains 'size') { [double]$_.size } else { $null }
        $sizeVram = if($_.PSObject.Properties.Name -contains 'size_vram') { [double]$_.size_vram } else { $null }
        $vramPct = $null
        if($null -ne $size -and $size -gt 0 -and $null -ne $sizeVram) { $vramPct = [math]::Round(($sizeVram / $size) * 100,1) }
        [ordered]@{
          name=[string]$_.name
          model=[string]$_.model
          sizeBytes=$size
          sizeVramBytes=$sizeVram
          vramPercent=$vramPct
          contextLength=if($_.PSObject.Properties.Name -contains 'context_length') { $_.context_length } else { $null }
          expiresAt=if($_.PSObject.Properties.Name -contains 'expires_at') { [string]$_.expires_at } else { $null }
          parameterSize=if($null -ne $_.details -and $_.details.PSObject.Properties.Name -contains 'parameter_size') { [string]$_.details.parameter_size } else { $null }
          quantization=if($null -ne $_.details -and $_.details.PSObject.Properties.Name -contains 'quantization_level') { [string]$_.details.quantization_level } else { $null }
        }
      })
    }
    return [ordered]@{ ok=$true; error=$null; models=$models }
  } catch {
    return [ordered]@{ ok=$false; error="$($_.Exception.GetType().Name): $($_.Exception.Message)"; models=@() }
  }
}

function Get-OllamaPsCliRaw {
  try { return ((& ollama ps 2>&1 | Out-String).Trim()) } catch { return "ERROR: $($_.Exception.Message)" }
}

function Get-ResourceSample {
  $ram = 0L
  try {
    $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'ollama|llama' })
    foreach($p in $procs){ $ram += [int64]$p.WorkingSet64 }
  } catch {}
  $gpuDedicated = $null
  try {
    $sample = Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction Stop
    $sum = 0.0
    foreach($c in @($sample.CounterSamples)){ if($c.CookedValue -ge 0){ $sum += $c.CookedValue } }
    $gpuDedicated = [int64]$sum
  } catch {}
  return [ordered]@{ ollamaWorkingSetBytes=$ram; gpuDedicatedBytesSystemSample=$gpuDedicated }
}

function Wait-OllamaIdle([int]$WaitSeconds) {
  $last = $null
  for($i=0; $i -le $WaitSeconds; $i++) {
    $last = Get-OllamaPsSnapshot
    if(-not $last.ok) { return [ordered]@{ idle=$false; reason='OLLAMA_PS_API_ERROR'; snapshot=$last } }
    if(@($last.models).Count -eq 0) { return [ordered]@{ idle=$true; reason=$null; snapshot=$last } }
    if($i -lt $WaitSeconds) { Start-Sleep -Seconds 1 }
  }
  return [ordered]@{ idle=$false; reason='OLLAMA_NOT_IDLE'; snapshot=$last }
}

function Invoke-BenchRun([string]$model,[int]$ctx,[int]$runNo) {
  $payload = [ordered]@{
    model=$model
    stream=$true
    think=$false
    keep_alive=0
    messages=@(
      [ordered]@{role='system';content='You are a deterministic TigerIQ local fallback probe. Follow the user instruction exactly. Do not add explanation.'},
      [ordered]@{role='user';content='Return exactly TIGERIQ_LOCAL_PASS and nothing else.'}
    )
    options=[ordered]@{temperature=0;num_ctx=$ctx;num_predict=64}
  } | ConvertTo-Json -Depth 8 -Compress

  $handler = [System.Net.Http.HttpClientHandler]::new()
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
  $content = [System.Net.Http.StringContent]::new($payload,[Text.Encoding]::UTF8,'application/json')
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ttft = $null
  $text = New-Object Text.StringBuilder
  $final = $null
  $errorText = $null
  $runtimePs = $null
  $runtimeCli = $null
  $runtimeResources = $null

  try {
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post,"$OllamaBase/api/chat")
    $req.Content = $content
    $resp = $client.SendAsync($req,[System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $resp.EnsureSuccessStatusCode() | Out-Null
    $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $reader = New-Object IO.StreamReader($stream)
    while(-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if([string]::IsNullOrWhiteSpace($line)){ continue }
      $obj = $line | ConvertFrom-Json
      if($null -ne $obj.message -and $null -ne $obj.message.content -and [string]$obj.message.content -ne '') {
        [void]$text.Append([string]$obj.message.content)
        if($null -eq $ttft) {
          $ttft = $sw.Elapsed.TotalMilliseconds
          $runtimePs = Get-OllamaPsSnapshot
          $runtimeCli = Get-OllamaPsCliRaw
          $runtimeResources = Get-ResourceSample
        }
      }
      if($obj.done -eq $true){ $final = $obj }
    }
  } catch {
    $errorText = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
  } finally {
    $sw.Stop()
    $client.Dispose()
    $handler.Dispose()
  }

  $evalCount = $null; $evalDuration = $null; $promptCount = $null; $promptDuration = $null; $loadDuration = $null; $totalDuration = $null; $tps = $null
  if($null -ne $final) {
    foreach($name in @('eval_count','eval_duration','prompt_eval_count','prompt_eval_duration','load_duration','total_duration')) {
      if($final.PSObject.Properties.Name -contains $name) {
        Set-Variable -Name (@{eval_count='evalCount';eval_duration='evalDuration';prompt_eval_count='promptCount';prompt_eval_duration='promptDuration';load_duration='loadDuration';total_duration='totalDuration'}[$name]) -Value $final.$name
      }
    }
    if($null -ne $evalCount -and $null -ne $evalDuration -and [double]$evalDuration -gt 0) { $tps = [math]::Round(([double]$evalCount / ([double]$evalDuration / 1e9)),2) }
  }

  $response = $text.ToString().Trim()
  $runtimeModel = $null
  $contended = $false
  $runtimeEvidenceOk = $false
  if($null -ne $runtimePs -and $runtimePs.ok) {
    $runtimeModels = @($runtimePs.models)
    $runtimeModel = @($runtimeModels | Where-Object { $_.name -eq $model -or $_.model -eq $model } | Select-Object -First 1)
    if($runtimeModel.Count -gt 0) { $runtimeModel = $runtimeModel[0] } else { $runtimeModel = $null }
    $contended = ($runtimeModels.Count -ne 1)
    $runtimeEvidenceOk = ($null -ne $runtimeModel -and -not $contended)
  }

  return [ordered]@{
    model=$model
    context=$ctx
    run=$runNo
    pass=($null -eq $errorText -and $response -eq $Expected -and $runtimeEvidenceOk)
    response=$response
    error=$errorText
    ttftMs=if($null -eq $ttft){$null}else{[math]::Round([double]$ttft,1)}
    wallMs=[math]::Round($sw.Elapsed.TotalMilliseconds,1)
    tokensPerSec=$tps
    evalCount=$evalCount
    evalDurationNs=$evalDuration
    promptEvalCount=$promptCount
    promptEvalDurationNs=$promptDuration
    loadDurationNs=$loadDuration
    totalDurationNs=$totalDuration
    think=false
    keepAlive=0
    runtimeEvidenceOk=$runtimeEvidenceOk
    contended=$contended
    runtimeModel=$runtimeModel
    runtimeOllamaPsApi=$runtimePs
    runtimeOllamaPsCli=$runtimeCli
    runtimeResources=$runtimeResources
  }
}

$gatewayAudit = Get-GatewayAudit

try {
  try {
    $lockStream = [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  } catch {
    [ordered]@{status='BLOCKED';reason='BENCHMARK_ALREADY_RUNNING';timestamp=(Get-Date).ToString('o');gatewayAudit=$gatewayAudit} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8
    Write-Host 'OPENCLAW_LOCAL_BENCH_BLOCKED BENCHMARK_ALREADY_RUNNING' -ForegroundColor Yellow
    exit 19
  }

  $tags = Invoke-RestMethod -Uri "$OllamaBase/api/tags" -TimeoutSec 15
  $installed = @($tags.models | ForEach-Object { [string]$_.name })
  $missing = @($Models | Where-Object { $_ -notin $installed })
  if($missing.Count -gt 0) {
    [ordered]@{status='BLOCKED';reason='MODEL_MISSING';missing=$missing;installed=$installed;timestamp=(Get-Date).ToString('o');gatewayAudit=$gatewayAudit} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8
    Write-Host "OPENCLAW_LOCAL_BENCH_BLOCKED MODEL_MISSING: $($missing -join ', ')" -ForegroundColor Red
    exit 20
  }

  $initialIdle = Wait-OllamaIdle -WaitSeconds 0
  if(-not $initialIdle.idle) {
    [ordered]@{status='BLOCKED';reason=$initialIdle.reason;initialOllamaPs=$initialIdle.snapshot;timestamp=(Get-Date).ToString('o');safety='No inference was started; shared Ollama was left untouched.';gatewayAudit=$gatewayAudit} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8
    Write-Host "OPENCLAW_LOCAL_BENCH_BLOCKED $($initialIdle.reason)" -ForegroundColor Yellow
    exit 21
  }

  $gpu = @()
  try { $gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion) } catch {}

  $runs = @()
  $blockedDuringRun = $null
  foreach($model in $Models) {
    foreach($ctx in $Contexts) {
      for($i=1; $i -le $Repeats; $i++) {
        $idleGate = Wait-OllamaIdle -WaitSeconds 5
        if(-not $idleGate.idle) {
          $blockedDuringRun = [ordered]@{reason=$idleGate.reason;model=$model;context=$ctx;run=$i;snapshot=$idleGate.snapshot}
          break
        }
        Write-Host "BENCH model=$model ctx=$ctx run=$i/$Repeats" -ForegroundColor Cyan
        $one = Invoke-BenchRun -model $model -ctx $ctx -runNo $i
        $runs += $one
        if($one.contended) {
          $blockedDuringRun = [ordered]@{reason='OLLAMA_CONTENTION_DETECTED';model=$model;context=$ctx;run=$i;snapshot=$one.runtimeOllamaPsApi}
          break
        }
        Start-Sleep -Seconds 1
      }
      if($null -ne $blockedDuringRun){ break }
    }
    if($null -ne $blockedDuringRun){ break }
  }

  if($null -ne $blockedDuringRun) {
    [ordered]@{status='BLOCKED';reason=$blockedDuringRun.reason;timestamp=(Get-Date).ToString('o');gatewayAudit=$gatewayAudit;gpu=$gpu;runs=$runs;blockedDuringRun=$blockedDuringRun;safety='Benchmark stopped without changing Ollama service configuration or OpenClaw configuration.'} | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $outFile -Encoding UTF8
    Write-Host "OPENCLAW_LOCAL_BENCH_BLOCKED $($blockedDuringRun.reason)" -ForegroundColor Yellow
    exit 23
  }

  $groups = @()
  foreach($model in $Models) {
    foreach($ctx in $Contexts) {
      $g = @($runs | Where-Object { $_.model -eq $model -and $_.context -eq $ctx })
      $passCount = @($g | Where-Object { $_.pass }).Count
      $ttfts = @($g | Where-Object { $null -ne $_.ttftMs } | ForEach-Object {[double]$_.ttftMs} | Sort-Object)
      $tpss = @($g | Where-Object { $null -ne $_.tokensPerSec } | ForEach-Object {[double]$_.tokensPerSec} | Sort-Object)
      $vramPcts = @($g | Where-Object { $null -ne $_.runtimeModel -and $null -ne $_.runtimeModel.vramPercent } | ForEach-Object {[double]$_.runtimeModel.vramPercent} | Sort-Object)
      $medianTtft = if($ttfts.Count){$ttfts[[int][math]::Floor(($ttfts.Count-1)/2)]}else{$null}
      $medianTps = if($tpss.Count){$tpss[[int][math]::Floor(($tpss.Count-1)/2)]}else{$null}
      $medianVramPct = if($vramPcts.Count){$vramPcts[[int][math]::Floor(($vramPcts.Count-1)/2)]}else{$null}
      $groups += [ordered]@{model=$model;context=$ctx;passCount=$passCount;required=$Repeats;stable=($passCount -eq $Repeats);medianTtftMs=$medianTtft;medianTokensPerSec=$medianTps;medianModelVramPercent=$medianVramPct}
    }
  }

  $stable = @($groups | Where-Object { $_.stable })
  $preferred = $null
  if($stable.Count -gt 0) {
    $preferred = $stable | Sort-Object @{Expression={ if($_.context -eq 8192){0}else{1} }}, @{Expression={ if($null -eq $_.medianTtftMs){[double]::PositiveInfinity}else{[double]$_.medianTtftMs} }}, @{Expression={ if($null -eq $_.medianTokensPerSec){0}else{-[double]$_.medianTokensPerSec} }} | Select-Object -First 1
  }

  $report = [ordered]@{
    status=if($null -ne $preferred){'BENCH_PASS_CANDIDATE'}else{'BENCH_FAIL_NO_STABLE_PROFILE'}
    timestamp=(Get-Date).ToString('o')
    openAiPath='UNCHANGED'
    openClawConfig='UNCHANGED'
    ollamaServiceConfig='UNCHANGED'
    gatewayAudit=$gatewayAudit
    initialOllamaPs=$initialIdle.snapshot
    gpu=$gpu
    models=$Models
    contexts=$Contexts
    repeats=$Repeats
    runs=$runs
    summary=$groups
    preferred=$preferred
    selectionNote='8192 is preferred for the next OpenClaw validation when stable; 4096 remains diagnostic/limited and is not auto-enabled.'
    nextGate='Do not configure fallback from benchmark evidence alone. Review the selected profile, then run OpenClaw local E2E/tool-policy validation and three consecutive local PASS turns before adding exactly one local fallback; finally validate deliberate failover and primary recovery.'
  }
  $report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $outFile -Encoding UTF8
  Write-Host "OPENCLAW_LOCAL_BENCH_EVIDENCE $outFile" -ForegroundColor Green
  if($null -ne $preferred) {
    Write-Host ("OPENCLAW_LOCAL_BENCH_CANDIDATE model={0} ctx={1} medianTTFTms={2} medianTPS={3} medianModelVRAMpct={4}" -f $preferred.model,$preferred.context,$preferred.medianTtftMs,$preferred.medianTokensPerSec,$preferred.medianModelVramPercent) -ForegroundColor Green
    exit 0
  }
  Write-Host 'OPENCLAW_LOCAL_BENCH_FAIL_NO_STABLE_PROFILE' -ForegroundColor Red
  exit 22
}
finally {
  if($null -ne $lockStream) { try { $lockStream.Dispose() } catch {} }
}
