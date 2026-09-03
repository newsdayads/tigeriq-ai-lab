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

$workers = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like '*worker-github-queue.py*' -or $_.CommandLine -like '*TigerIQ*Worker*worker.py*'
})
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
$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if(-not $tailscale){ $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue }
if($tailscale){
  try {
    $ip = (& $tailscale.Source ip -4 2>$null | Select-Object -First 1).Trim()
    if($ip -match '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') {
      $octets = $ip.Split('.') | ForEach-Object { [int]$_ }
      if($octets[1] -ge 64 -and $octets[1] -le 127){
        $tailscaleIp = $ip
        $tailscaleOnline = $true
      }
    }
  } catch {}
}

$controllerOnline = $false
$controllerPort = 8790
$workforce = $null
if($tailscaleIp){
  try {
    $controllerStatus = Invoke-RestMethod -Uri "http://$tailscaleIp`:$controllerPort/api/workforce/status" -TimeoutSec 2
    $controllerOnline = [bool]$controllerStatus.ok
    if($controllerOnline -and $controllerStatus.workforce){
      $wf = $controllerStatus.workforce
      $workforce = [ordered]@{
        employeesTotal = [int]$wf.employees.total
        idle = [int]$wf.employees.byAvailability.idle
        busy = [int]$wf.employees.byAvailability.busy
        offline = [int]$wf.employees.byAvailability.offline
        degraded = [int]$wf.employees.byAvailability.degraded
        activeTasks = [int]$wf.employees.activeTasks
        tasksActive = [int]$wf.tasks.active
        tasksFailed = [int]$wf.tasks.failed
      }
    }
  } catch {}
}

$postgresService = $null
$postgresOnline = $false
$postgresPort = 5432
try {
  $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'postgresql*' -or $_.DisplayName -like 'PostgreSQL*' } | Select-Object -First 1
  if($svc){ $postgresService = $svc.Name }
  $listener = Get-NetTCPConnection -LocalPort $postgresPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $postgresOnline = [bool]$listener -or ($svc -and $svc.Status -eq 'Running')
} catch {}

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
  controller = [ordered]@{ online=$controllerOnline; ip=$tailscaleIp; port=$controllerPort }
  workforce = $workforce
  postgresql = [ordered]@{ online=$postgresOnline; service=$postgresService; port=$postgresPort }
  ollama = [ordered]@{ online=$ollamaOnline; models=$ollamaModels }
  tailscale = [ordered]@{ online=$tailscaleOnline; ip=$tailscaleIp }
  gpu = $gpu
}

$result | ConvertTo-Json -Depth 8 -Compress
