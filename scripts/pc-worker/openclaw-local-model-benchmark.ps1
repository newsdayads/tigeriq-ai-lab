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
$mutex = New-Object Threading.Mutex($false,'Global\TigerIQ_OpenClaw_Local_Benchmark')
$mutexHeld = $false
try { $mutexHeld = $mutex.WaitOne(0) } catch { $mutexHeld = $false }
if(-not $mutexHeld){
  [ordered]@{status='BLOCKED';reason='BENCHMARK_ALREADY_RUNNING';timestamp=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $outFile -Encoding UTF8
  Write-Host 'OPENCLAW_LOCAL_BENCH_BLOCKED BENCHMARK_ALREADY_RUNNING' -ForegroundColor Yellow
  exit 19
}

function Get-OllamaPsRaw {
  try { return ((& ollama ps 2>&1 | Out-String).Trim()) } catch { return "ERROR: $($_.Exception.Message)" }
}
function Get-ResidentModels([string]$raw) {
  if([string]::IsNullOrWhiteSpace($raw)){ return @() }
  $lines = @($raw -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if($lines.Count -le 1){ return @() }
  return @($lines | Select-Object -Skip 1)
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
function Invoke-BenchRun([string]$model,[int]$ctx,[int]$runNo) {
  $payload = [ordered]@{
    model=$model
    stream=$true
    keep_alive='5m'
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
  try {
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post,"$OllamaBase/api/chat")
    $req.Content = $content
    $resp = $client.SendAsync($req,[System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $resp.EnsureSuccessStatusCode() | Out-Null
    $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $reader = New-Object IO.StreamReader($stream)
    while(-not $reader.EndOfStream){
      $line = $reader.ReadLine()
      if([string]::IsNullOrWhiteSpace($line)){ continue }
      $obj = $line | ConvertFrom-Json
      $meaningful = $false
      if($null -ne $obj.message){
        if($null -ne $obj.message.content -and [string]$obj.message.content -ne ''){
          [void]$text.Append([string]$obj.message.content)
          $meaningful = $true
        }
        if($obj.message.PSObject.Properties.Name -contains 'thinking' -and $null -ne $obj.message.thinking -and [string]$obj.message.thinking -ne ''){ $meaningful = $true }
      }
      if($meaningful -and $null -eq $ttft){ $ttft = $sw.Elapsed.TotalMilliseconds }
      if($obj.done -eq $true){ $final = $obj }
    }
  } catch {
    $errorText = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
  } finally {
    $sw.Stop(); $client.Dispose(); $handler.Dispose()
  }
  $evalCount = $null; $evalDuration = $null; $promptCount = $null; $promptDuration = $null; $loadDuration = $null; $totalDuration = $null; $tps = $null
  if($null -ne $final){
    foreach($name in @('eval_count','eval_duration','prompt_eval_count','prompt_eval_duration','load_duration','total_duration')){
      if($final.PSObject.Properties.Name -contains $name){ Set-Variable -Name (@{eval_count='evalCount';eval_duration='evalDuration';prompt_eval_count='promptCount';prompt_eval_duration='promptDuration';load_duration='loadDuration';total_duration='totalDuration'}[$name]) -Value $final.$name }
    }
    if($null -ne $evalCount -and $null -ne $evalDuration -and [double]$evalDuration -gt 0){ $tps = [math]::Round(([double]$evalCount / ([double]$evalDuration / 1e9)),2) }
  }
  $psRaw = Get-OllamaPsRaw
  $resources = Get-ResourceSample
  $response = $text.ToString().Trim()
  return [ordered]@{
    model=$model; context=$ctx; run=$runNo; pass=($null -eq $errorText -and $response -eq $Expected); response=$response; error=$errorText;
    ttftMs=if($null -eq $ttft){$null}else{[math]::Round([double]$ttft,1)}; wallMs=[math]::Round($sw.Elapsed.TotalMilliseconds,1);
    tokensPerSec=$tps; evalCount=$evalCount; evalDurationNs=$evalDuration; promptEvalCount=$promptCount; promptEvalDurationNs=$promptDuration;
    loadDurationNs=$loadDuration; totalDurationNs=$totalDuration; ollamaPs=$psRaw; resources=$resources
  }
}

try {
  $tags = Invoke-RestMethod -Uri "$OllamaBase/api/tags" -TimeoutSec 15
  $installed = @($tags.models | ForEach-Object { [string]$_.name })
  $missing = @($Models | Where-Object { $_ -notin $installed })
  if($missing.Count -gt 0){
    [ordered]@{status='BLOCKED';reason='MODEL_MISSING';missing=$missing;installed=$installed;timestamp=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outFile -Encoding UTF8
    Write-Host "OPENCLAW_LOCAL_BENCH_BLOCKED MODEL_MISSING: $($missing -join ', ')" -ForegroundColor Red
    exit 20
  }
  $initialPs = Get-OllamaPsRaw
  $resident = Get-ResidentModels $initialPs
  if($resident.Count -gt 0){
    [ordered]@{status='BLOCKED';reason='OLLAMA_NOT_IDLE';initialOllamaPs=$initialPs;timestamp=(Get-Date).ToString('o');safety='No benchmark was started; shared Ollama was left untouched.'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outFile -Encoding UTF8
    Write-Host 'OPENCLAW_LOCAL_BENCH_BLOCKED OLLAMA_NOT_IDLE' -ForegroundColor Yellow
    exit 21
  }

  $gpu = @()
  try { $gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion) } catch {}
  $runs = @()
  foreach($model in $Models){
    foreach($ctx in $Contexts){
      for($i=1;$i -le $Repeats;$i++){
        Write-Host "BENCH model=$model ctx=$ctx run=$i/$Repeats" -ForegroundColor Cyan
        $runs += Invoke-BenchRun -model $model -ctx $ctx -runNo $i
        Start-Sleep -Seconds 2
      }
    }
  }
  $groups = @()
  foreach($model in $Models){
    foreach($ctx in $Contexts){
      $g = @($runs | Where-Object { $_.model -eq $model -and $_.context -eq $ctx })
      $passCount = @($g | Where-Object { $_.pass }).Count
      $ttfts = @($g | Where-Object { $null -ne $_.ttftMs } | ForEach-Object {[double]$_.ttftMs} | Sort-Object)
      $tpss = @($g | Where-Object { $null -ne $_.tokensPerSec } | ForEach-Object {[double]$_.tokensPerSec} | Sort-Object)
      $medianTtft = if($ttfts.Count){$ttfts[[int][math]::Floor(($ttfts.Count-1)/2)]}else{$null}
      $medianTps = if($tpss.Count){$tpss[[int][math]::Floor(($tpss.Count-1)/2)]}else{$null}
      $groups += [ordered]@{model=$model;context=$ctx;passCount=$passCount;required=$Repeats;stable=($passCount -eq $Repeats);medianTtftMs=$medianTtft;medianTokensPerSec=$medianTps}
    }
  }
  $stable = @($groups | Where-Object { $_.stable })
  $preferred = $null
  if($stable.Count -gt 0){
    $preferred = $stable | Sort-Object @{Expression={ if($_.context -eq 8192){0}else{1} }}, @{Expression={ if($null -eq $_.medianTtftMs){[double]::PositiveInfinity}else{[double]$_.medianTtftMs} }}, @{Expression={ if($null -eq $_.medianTokensPerSec){0}else{-[double]$_.medianTokensPerSec} }} | Select-Object -First 1
  }
  $report = [ordered]@{
    status=if($null -ne $preferred){'BENCH_PASS_CANDIDATE'}else{'BENCH_FAIL_NO_STABLE_PROFILE'}
    timestamp=(Get-Date).ToString('o'); openAiPath='UNCHANGED'; ollamaServiceConfig='UNCHANGED'; initialOllamaPs=$initialPs;
    gpu=$gpu; models=$Models; contexts=$Contexts; repeats=$Repeats; runs=$runs; summary=$groups; preferred=$preferred;
    nextGate='After 3 consecutive benchmark PASS on one profile, configure that exact local profile as fallback only; then run OpenClaw local E2E and deliberate cloud-failure failover validation.'
  }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8
  Write-Host "OPENCLAW_LOCAL_BENCH_EVIDENCE $outFile" -ForegroundColor Green
  if($null -ne $preferred){ Write-Host ("OPENCLAW_LOCAL_BENCH_CANDIDATE model={0} ctx={1} medianTTFTms={2} medianTPS={3}" -f $preferred.model,$preferred.context,$preferred.medianTtftMs,$preferred.medianTokensPerSec) -ForegroundColor Green; exit 0 }
  Write-Host 'OPENCLAW_LOCAL_BENCH_FAIL_NO_STABLE_PROFILE' -ForegroundColor Red
  exit 22
}
finally {
  if($mutexHeld){ try { $mutex.ReleaseMutex() | Out-Null } catch {} }
  $mutex.Dispose()
}
