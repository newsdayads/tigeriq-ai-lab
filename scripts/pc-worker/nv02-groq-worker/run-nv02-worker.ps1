$ErrorActionPreference='Continue'
Set-Location 'D:\TigerIQ\Runtime\nv02-worker'
$node='C:\Program Files\nodejs\node.exe'
$worker='D:\TigerIQ\Runtime\nv02-worker\groq-worker.mjs'
$log='D:\TigerIQ\Logs\nv02-worker.log'
$failures=0
while($true){
  $started=Get-Date
  & $node $worker *>> $log
  $code=$LASTEXITCODE
  $runtime=[int]((Get-Date)-$started).TotalSeconds
  if($runtime -ge 300){$failures=0}else{$failures++}
  $delay=[Math]::Min(60,[Math]::Max(2,[Math]::Pow(2,[Math]::Min($failures,5))))
  Add-Content -LiteralPath $log -Value (([ordered]@{event='NV02_WORKER_RESTART';exitCode=$code;runtimeSeconds=$runtime;delaySeconds=$delay;at=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress))
  Start-Sleep -Seconds $delay
}
