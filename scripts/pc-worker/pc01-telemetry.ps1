$ErrorActionPreference = 'Stop'

function Percent([double]$used,[double]$total) {
  if($total -le 0){ return $null }
  return [math]::Round(($used / $total) * 100, 1)
}

function Test-TcpPort([string]$HostName,[int]$Port,[int]$TimeoutMs = 250) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName,$Port,$null,$null)
    if(-not $async.AsyncWaitHandle.WaitOne($TimeoutMs,$false)){ return $false }
    $client.EndConnect($async)
    return $true
  } catch { return $false } finally { $client.Close() }
}

$os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime
$cpuRows = @(Get-CimInstance Win32_Processor -Property LoadPercentage)
$cpuValues = @($cpuRows | ForEach-Object { if($_.LoadPercentage -ne $null){ [double]$_.LoadPercentage } })
$cpuAverage = if($cpuValues.Count -gt 0){ ($cpuValues | Measure-Object -Average).Average } else { $null }
$memTotal = [double]$os.TotalVisibleMemorySize * 1KB
$memFree = [double]$os.FreePhysicalMemory * 1KB
$memUsed = $memTotal - $memFree
$uptimeSeconds = [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds)

$driveName = if(Test-Path 'F:\'){ 'F' } else { 'C' }
$driveInfo = New-Object System.IO.DriveInfo($driveName)
$diskTotal = [double]$driveInfo.TotalSize
$diskFree = [double]$driveInfo.AvailableFreeSpace

$workers = @()
try {
  $workers = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -Property ProcessId,CommandLine | Where-Object {
    $_.CommandLine -and ($_.CommandLine -like '*worker-github-queue.py*' -or $_.CommandLine -like '*TigerIQ*Worker*worker.py*' -or $_.CommandLine -like '*worker_impl.py*')
  })
} catch {}
$worker = $workers | Select-Object -First 1

$ollamaOnline = $false
$ollamaModels = @()
try {
  $tags = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1
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
    $controllerStatus = Invoke-RestMethod -Uri "http://$tailscaleIp`:$controllerPort/api/workforce/status" -TimeoutSec 1
    $controllerOnline = [bool]$controllerStatus.ok
    if($controllerOnline -and $controllerStatus.workforce){
      $wf = $controllerStatus.workforce
      $roster = @()
      if($wf.roster){
        $roster = @($wf.roster | ForEach-Object {
          [ordered]@{
            employeeId = [string]$_.employeeId
            displayName = [string]$_.displayName
            department = [string]$_.department
            role = [string]$_.role
            nodeId = [string]$_.nodeId
            provider = if($_.provider){[string]$_.provider}else{$null}
            model = if($_.model){[string]$_.model}else{$null}
            availability = [string]$_.availability
            healthScore = [double]$_.healthScore
            concurrencyLimit = [int]$_.concurrencyLimit
            activeTaskCount = [int]$_.activeTaskCount
            currentTaskIds = @($_.currentTaskIds | ForEach-Object { [string]$_ })
          }
        })
      }
      $taskList = @()
      if($wf.taskList){
        $taskList = @($wf.taskList | ForEach-Object {
          [ordered]@{
            taskId = [string]$_.taskId
            objective = [string]$_.objective
            stage = [string]$_.stage
            priority = [string]$_.priority
            assignedEmployeeId = if($_.assignedEmployeeId){[string]$_.assignedEmployeeId}else{$null}
          }
        })
      }
      $workforce = [ordered]@{
        employeesTotal = [int]$wf.employees.total
        idle = [int]$wf.employees.byAvailability.idle
        busy = [int]$wf.employees.byAvailability.busy
        offline = [int]$wf.employees.byAvailability.offline
        degraded = [int]$wf.employees.byAvailability.degraded
        activeTasks = [int]$wf.employees.activeTasks
        tasksActive = [int]$wf.tasks.active
        tasksFailed = [int]$wf.tasks.failed
        roster = $roster
        taskList = $taskList
      }
    }
  } catch {}
}

$postgresService = $null
$postgresOnline = $false
$postgresPort = 5432
try {
  $svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if($svc){
    $postgresService = $svc.Name
    $postgresOnline = ($svc.Status -eq 'Running')
  } else {
    $postgresOnline = Test-TcpPort '127.0.0.1' $postgresPort 250
  }
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
  cpu = [ordered]@{ utilizationPercent = if($cpuAverage -ne $null){ [math]::Round([double]$cpuAverage,1) } else { $null } }
  memory = [ordered]@{ usedBytes=[math]::Round($memUsed); totalBytes=[math]::Round($memTotal); utilizationPercent=(Percent $memUsed $memTotal) }
  uptimeSeconds = $uptimeSeconds
  disk = [ordered]@{ drive="$driveName`:"; freeBytes=$diskFree; totalBytes=$diskTotal; utilizationPercent=(Percent ($diskTotal-$diskFree) $diskTotal) }
  worker = [ordered]@{ online=($workers.Count -gt 0); pid=if($worker){[int]$worker.ProcessId}else{$null}; instances=$workers.Count }
  controller = [ordered]@{ online=$controllerOnline; ip=$tailscaleIp; port=$controllerPort }
  workforce = $workforce
  postgresql = [ordered]@{ online=$postgresOnline; service=$postgresService; port=$postgresPort }
  ollama = [ordered]@{ online=$ollamaOnline; models=$ollamaModels }
  tailscale = [ordered]@{ online=$tailscaleOnline; ip=$tailscaleIp }
  gpu = $gpu
}

$result | ConvertTo-Json -Depth 10 -Compress
