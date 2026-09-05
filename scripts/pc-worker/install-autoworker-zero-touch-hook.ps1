param(
  [switch]$Apply,
  [string]$WorkerDir = 'F:\TigerIQ\Worker'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$marker = '# TIGERIQ_AUTOWORKER_ZERO_TOUCH_HOOK_V1'
$launcher = Join-Path $WorkerDir 'worker.py'
$sidecarSource = Join-Path $PSScriptRoot 'autoworker-zero-touch-deploy.py'
$sidecarTarget = Join-Path $WorkerDir 'autoworker-zero-touch-deploy.py'
$requestPath = Join-Path $WorkerDir 'autoworker-deploy-request-v1.json'
$resultPath = Join-Path $WorkerDir 'autoworker-deploy-result-v1.json'
$sidecarSha = '83dc8e2c8cb13cf1eb379237d8fb74539926b1173dee1c12949f8dd850f831e0'
$version = '14.2.2'
$installerUrl = 'https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/8f0a45c57588a9abb846192517240fb21153f5de/scripts/pc-worker/TigerIQ_AW_14.2.2_installer.ps1'
$installerSha = '57be6bcfea2cea8afb375842b4b825d13689b7e59afc9bf6e41e7e1b8109fc2e'
$requestId = 'nv02-v14.2.2-zero-touch-57be6bcf-v1'
$taskName = 'TigerIQ Worker'
$backupRoot = Join-Path $WorkerDir 'backup\autoworker-zero-touch-v1'
$mutated = $false
$backup = $null
$hookActivated = $false

function Fail([string]$Code, [string]$Message) {
  throw "$Code`: $Message"
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Text, $encoding)
}

function JsonResult([hashtable]$Object) {
  $Object | ConvertTo-Json -Compress -Depth 8
}

function Read-Result {
  if(-not (Test-Path -LiteralPath $resultPath -PathType Leaf)){ return $null }
  try { return (Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json) } catch { return $null }
}

function Restore-Launcher {
  if($backup -and (Test-Path -LiteralPath $backup)){
    Copy-Item -LiteralPath $backup -Destination $launcher -Force
  }
}

try {
  if($env:COMPUTERNAME -ne 'PC01'){ Fail 'WRONG_HOST' 'Zero-touch Auto Worker deploy is restricted to PC01.' }
  if(-not (Test-Path -LiteralPath $launcher -PathType Leaf)){ Fail 'WORKER_LAUNCHER_MISSING' $launcher }
  if(-not (Test-Path -LiteralPath $sidecarSource -PathType Leaf)){ Fail 'SIDECAR_SOURCE_MISSING' $sidecarSource }
  $actualSidecarSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $sidecarSource).Hash.ToLowerInvariant()
  if($actualSidecarSha -ne $sidecarSha){ Fail 'SIDECAR_SOURCE_HASH_MISMATCH' $actualSidecarSha }

  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if([string]$task.State -eq 'Disabled'){ Fail 'WORKER_TASK_DISABLED' 'TigerIQ Worker task is disabled.' }
  if(@($task.Actions).Count -ne 1){ Fail 'WORKER_TASK_ACTION_COUNT' 'TigerIQ Worker must keep exactly one action.' }
  $action = $task.Actions[0]
  $taskLauncher = ([string]$action.Arguments).Trim().Trim('"')
  if(-not [string]::Equals($taskLauncher,$launcher,[StringComparison]::OrdinalIgnoreCase)){
    Fail 'WORKER_TASK_LAUNCHER_DRIFT' ([string]$action.Arguments)
  }

  $existing = Read-Result
  if($existing -and [string]$existing.request_id -eq $requestId -and [bool]$existing.ok){
    JsonResult @{
      status='READY'; deploy='READY'; physical=[string]$existing.physical; reload_mode=[string]$existing.reload_mode;
      version=$version; request_id=$requestId; mutated=$false; workerTask=[string]$task.State
    }
    exit 0
  }

  $launcherText = Get-Content -Raw -LiteralPath $launcher
  $anchor = "    resolved = prepare_environment()`r`n    with LOG_PATH.open('a', encoding='utf-8', buffering=1) as log:"
  $anchorLf = "    resolved = prepare_environment()`n    with LOG_PATH.open('a', encoding='utf-8', buffering=1) as log:"
  $injection = @"
    resolved = prepare_environment()
    $marker
    deploy_hook = WORKER_DIR / 'autoworker-zero-touch-deploy.py'
    if deploy_hook.exists():
        try:
            subprocess.run(
                [sys.executable, str(deploy_hook)],
                cwd=WORKER_DIR,
                timeout=240,
                check=False,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        except Exception as deploy_error:
            print(json.dumps({'event': 'autoworker_zero_touch_hook_error', 'error': str(deploy_error)[:500]}, ensure_ascii=False), flush=True)
    with LOG_PATH.open('a', encoding='utf-8', buffering=1) as log:
"@

  if(-not $launcherText.Contains($marker)){
    if($launcherText.Contains($anchor)){
      $launcherText = $launcherText.Replace($anchor, ($injection -replace "`n","`r`n").TrimEnd("`r","`n"))
    } elseif($launcherText.Contains($anchorLf)){
      $launcherText = $launcherText.Replace($anchorLf, $injection.TrimEnd("`r","`n"))
    } else {
      Fail 'WORKER_LAUNCHER_LAYOUT_CHANGED' 'Reviewed launcher anchor not found.'
    }

    if(-not (Test-Path -LiteralPath $backupRoot)){ New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null }
    $backup = Join-Path $backupRoot ("worker.py.{0}.bak" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    Copy-Item -LiteralPath $launcher -Destination $backup -Force
    Write-Utf8NoBom $launcher $launcherText
    $mutated = $true
  }

  Copy-Item -LiteralPath $sidecarSource -Destination $sidecarTarget -Force
  if((Get-FileHash -Algorithm SHA256 -LiteralPath $sidecarTarget).Hash.ToLowerInvariant() -ne $sidecarSha){
    Fail 'SIDECAR_INSTALL_HASH_MISMATCH' $sidecarTarget
  }

  $python = [string]$action.Execute
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'WORKER_PYTHON_MISSING' $python }
  $compile = & $python -m py_compile $launcher $sidecarTarget 2>&1
  if($LASTEXITCODE -ne 0){ Fail 'PY_COMPILE_FAILED' ($compile -join ' ') }

  if(-not $Apply){
    JsonResult @{status='PLAN'; deploy='PENDING_APPLY'; physical='UNKNOWN'; version=$version; request_id=$requestId; mutated=$mutated}
    exit 0
  }

  $request = [ordered]@{
    schema=1
    request_id=$requestId
    version=$version
    installer_url=$installerUrl
    installer_sha256=$installerSha
    created_at=(Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Depth 4
  Write-Utf8NoBom $requestPath $request

  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $hookActivated = $true
  $mutated = $true

  $deadline = (Get-Date).AddSeconds(235)
  $result = $null
  do {
    Start-Sleep -Seconds 2
    $result = Read-Result
    if($result -and [string]$result.request_id -eq $requestId){ break }
  } while((Get-Date) -lt $deadline)

  if(-not $result -or [string]$result.request_id -ne $requestId){
    Fail 'ZERO_TOUCH_RESULT_TIMEOUT' 'User-session Worker did not return deploy result within bounded timeout.'
  }
  if(-not [bool]$result.ok){
    Fail 'ZERO_TOUCH_DEPLOY_FAILED' ("state={0}; attempt={1}; error={2}" -f [string]$result.state,[string]$result.attempt,[string]$result.error)
  }

  $taskAfter = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if([string]$taskAfter.State -ne 'Running'){ Start-ScheduledTask -TaskName $taskName -ErrorAction Stop }

  JsonResult @{
    status='PASS'; deploy='DEPLOYED'; physical=[string]$result.physical; reload_mode=[string]$result.reload_mode;
    state=[string]$result.state; version=$version; request_id=$requestId; mutated=$mutated; attempt=[int]$result.attempt
  }
  exit 0
}
catch {
  $message = $_.Exception.Message
  if($backup -and -not $hookActivated){
    try { Restore-Launcher } catch {}
  }
  JsonResult @{status='FAIL'; deploy='FAILED'; physical='UNKNOWN'; version=$version; request_id=$requestId; mutated=$mutated; error=$message}
  exit 41
}
