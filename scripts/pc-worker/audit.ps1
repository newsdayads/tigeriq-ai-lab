$ErrorActionPreference = 'SilentlyContinue'

function CommandVersion($name, $args = @('--version')) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  try { return (& $name @args 2>&1 | Select-Object -First 1).ToString().Trim() } catch { return $null }
}

$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{
    name = $_.Name
    adapterRamBytes = [int64]$_.AdapterRAM
    driverVersion = $_.DriverVersion
  }
})
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"

$nvidia = $null
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  try {
    $nvidia = & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
  } catch {}
}

$result = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  os = [ordered]@{
    caption = $os.Caption
    version = $os.Version
    architecture = $os.OSArchitecture
  }
  cpu = [ordered]@{
    name = $cpu.Name
    cores = $cpu.NumberOfCores
    logicalProcessors = $cpu.NumberOfLogicalProcessors
  }
  memory = [ordered]@{
    totalBytes = [int64]$os.TotalVisibleMemorySize * 1024
  }
  gpus = $gpus
  nvidiaSmi = $nvidia
  diskC = [ordered]@{
    sizeBytes = [int64]$disk.Size
    freeBytes = [int64]$disk.FreeSpace
  }
  tools = [ordered]@{
    git = CommandVersion 'git'
    node = CommandVersion 'node'
    npm = CommandVersion 'npm'
    python = CommandVersion 'python'
    docker = CommandVersion 'docker'
    ollama = CommandVersion 'ollama'
  }
}

$result | ConvertTo-Json -Depth 8
