$ErrorActionPreference = 'Stop'

function Percent([double]$used,[double]$total) {
  if($total -le 0){ return $null }
  return [math]::Round(($used / $total) * 100, 1)
}

$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
$memTotal = [double]$os.TotalVisibleMemorySize * 1KB
$memFree = [double]$os.FreePhysicalMemory * 1KB
$memUsed = $memTotal - $memFree
$boot = $os.LastBootUpTime
$uptimeSeconds = [math]::Floor(((Get-Date) - $boot).TotalSeconds)

$driveLetter = 'F:'
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveLetter'" -ErrorAction SilentlyContinue
if(-not $disk){ $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" }

$workers = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*TigerIQ*Worker*worker.py*' })
$worker = $workers | Select-Object -First 1

$ollamaOnline = $false
$ollamaModels = @()
try {
  $tags = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
  $ollamaOnline = $true
  if($tags.models){ $ollamaModels = @($tags.models | ForEach-Object { $_.name }) }
} catch {}

$tailscaleIp = $null
$tailscaleOnline = $false
$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if($tailscale){
  try {
    $ip = (& $tailscale.Source ip -4 2>$null | Select-Object -First 1).Trim()
    if($ip){ $tailscaleIp = $ip; $tailscaleOnline = $true }
  } catch {}
}

$gpu = $null
try {
  $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if($nvidia){
    $line = & $nvidia.Source --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if($line){
      $parts = $line -split ',' | ForEach-Object { $_.Trim() }
      if($parts.Count -ge 4){
        $gpu = [ordered]@{ name=$parts[0]; utilizationPercent=[double]$parts[1]; memoryUsedMiB=[double]$parts[2]; memoryTotalMiB=[double]$parts[3] }
      }
    }
  }
} catch {}

$result = [ordered]@{
  server = 'PC01'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  cpu = [ordered]@{ utilizationPercent = if($cpu.Average -ne $null){ [math]::Round([double]$cpu.Average,1) } else { $null } }
  memory = [ordered]@{ usedBytes=[math]::Round($memUsed); totalBytes=[math]::Round($memTotal); utilizationPercent=(Percent $memUsed $memTotal) }
  uptimeSeconds = $uptimeSeconds
  disk = if($disk){ [ordered]@{ drive=$disk.DeviceID; freeBytes=[double]$disk.FreeSpace; totalBytes=[double]$disk.Size; utilizationPercent=(Percent ([double]$disk.Size-[double]$disk.FreeSpace) ([double]$disk.Size)) } } else { $null }
  worker = [ordered]@{ online=($workers.Count -gt 0); pid=if($worker){[int]$worker.ProcessId}else{$null}; instances=$workers.Count }
  ollama = [ordered]@{ online=$ollamaOnline; models=$ollamaModels }
  tailscale = [ordered]@{ online=$tailscaleOnline; ip=$tailscaleIp }
  gpu = $gpu
}

$result | ConvertTo-Json -Depth 6 -Compress
