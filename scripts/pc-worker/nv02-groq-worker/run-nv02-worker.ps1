$ErrorActionPreference='Stop'
Set-Location 'D:\TigerIQ\Runtime\nv02-worker'
& 'C:\Program Files\nodejs\node.exe' 'D:\TigerIQ\Runtime\nv02-worker\groq-worker.mjs' *>> 'D:\TigerIQ\Logs\nv02-worker.log'
exit $LASTEXITCODE
