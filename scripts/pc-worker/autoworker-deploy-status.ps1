param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$path=Join-Path $env:LOCALAPPDATA 'TigerIQ\AutoWorker\zero-touch-status.json'
function Fail([string]$Code){
  [ordered]@{ok=$false;error=$Code;schema_version=1}|ConvertTo-Json -Compress
  exit 42
}
if(-not(Test-Path -LiteralPath $path -PathType Leaf)){Fail 'STATUS_NOT_FOUND'}
try{$j=Get-Content -Raw -LiteralPath $path|ConvertFrom-Json}catch{Fail 'STATUS_INVALID_JSON'}
$allowedPhases=@('STAGING','PREFLIGHT_PASS','APPLIED','FAILED')
if([int]$j.schema_version-ne1){Fail 'STATUS_SCHEMA_UNSUPPORTED'}
if(([string]$j.phase)-notin$allowedPhases){Fail 'STATUS_PHASE_INVALID'}
if(([string]$j.extension_id)-notmatch'^[a-p]{32}$'){Fail 'STATUS_EXTENSION_ID_INVALID'}
if(-not[string]::IsNullOrWhiteSpace([string]$j.source_commit)-and([string]$j.source_commit)-notmatch'^[0-9a-f]{40}$'){Fail 'STATUS_SOURCE_COMMIT_INVALID'}
if(-not[string]::IsNullOrWhiteSpace([string]$j.manifest_sha256)-and([string]$j.manifest_sha256)-notmatch'^[0-9a-f]{64}$'){Fail 'STATUS_MANIFEST_SHA_INVALID'}
$out=[ordered]@{
  schema_version=1
  ok=[bool]$j.ok
  phase=[string]$j.phase
  version=[string]$j.version
  extension_id=[string]$j.extension_id
  source_commit=[string]$j.source_commit
  manifest_sha256=[string]$j.manifest_sha256
  chrome_running=[bool]$j.chrome_running
  reload_mode=[string]$j.reload_mode
  rolled_back=[bool]$j.rolled_back
  updated_at=[string]$j.updated_at
}
$out|ConvertTo-Json -Compress
