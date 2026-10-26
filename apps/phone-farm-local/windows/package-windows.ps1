param(
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
$appRoot=Split-Path $PSScriptRoot -Parent
$repoRoot=(Resolve-Path (Join-Path $appRoot '..\..')).Path
$project=Join-Path $PSScriptRoot 'TigerIQPhoneFarm.csproj'
$nodeVersion='24.19.0'
if(Test-Path $OutputPath){Remove-Item $OutputPath -Recurse -Force}
New-Item -ItemType Directory -Path $OutputPath | Out-Null
dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $OutputPath
if($LASTEXITCODE -ne 0){throw "dotnet publish failed: $LASTEXITCODE"}
$runtime=@('app.mjs','farm-ops.mjs','index.html','macro-engine.mjs','recording.mjs','recording.test.mjs','schedule-engine.mjs','test.mjs','ui.js','README.md','INSTALL_WINDOWS.md','RELEASE_NOTES_WINDOWS_RC.md','SUPPLY_CHAIN_RC_20261026.md')
foreach($name in $runtime){Copy-Item (Join-Path $appRoot $name) (Join-Path $OutputPath $name) -Force}
$sourceDir=Join-Path $OutputPath 'windows'
New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Program.cs') (Join-Path $sourceDir 'Program.cs') -Force
Copy-Item (Join-Path $PSScriptRoot 'TigerIQPhoneFarm.csproj') (Join-Path $sourceDir 'TigerIQPhoneFarm.csproj') -Force
Copy-Item (Join-Path $PSScriptRoot 'install-user.ps1') (Join-Path $OutputPath 'install-user.ps1') -Force
Copy-Item (Join-Path $PSScriptRoot 'uninstall-user.ps1') (Join-Path $OutputPath 'uninstall-user.ps1') -Force
$node=(Get-Command node -ErrorAction Stop).Source
$version=(& $node --version).Trim().TrimStart('v')
if($version -ne $nodeVersion){throw "Expected Node $nodeVersion, found $version"}
Copy-Item $node (Join-Path $OutputPath 'node.exe') -Force
$nodeDir=Split-Path $node -Parent
$license=@((Join-Path $nodeDir 'LICENSE'),(Join-Path $nodeDir 'LICENSE.txt'))|Where-Object{Test-Path $_}|Select-Object -First 1
$nodeLicense=Join-Path $OutputPath 'NODE_LICENSE.txt'
if($license){Copy-Item $license $nodeLicense -Force}else{
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/v$nodeVersion/LICENSE" -OutFile $nodeLicense
}
$dotnetRoot=(Get-Command dotnet).Source|Split-Path -Parent
Copy-Item (Join-Path $dotnetRoot 'LICENSE.txt') (Join-Path $OutputPath 'DOTNET_LICENSE.txt') -Force
Copy-Item (Join-Path $dotnetRoot 'ThirdPartyNotices.txt') (Join-Path $OutputPath 'DOTNET_THIRD_PARTY.txt') -Force
$nugetLine=(& dotnet nuget locals global-packages --list | Select-Object -First 1)
$nugetRoot=($nugetLine -replace '^global-packages:\s*','').Trim()
$wv=Join-Path $nugetRoot 'microsoft.web.webview2\1.0.4258.31'
if(!(Test-Path $wv)){throw "WebView2 NuGet package not found: $wv"}
Copy-Item (Join-Path $wv 'LICENSE.txt') (Join-Path $OutputPath 'WEBVIEW2_LICENSE.txt') -Force
Copy-Item (Join-Path $wv 'NOTICE.txt') (Join-Path $OutputPath 'WEBVIEW2_NOTICE.txt') -Force
New-Item -ItemType Directory -Path (Join-Path $OutputPath 'drop'),(Join-Path $OutputPath 'recordings') -Force | Out-Null
$head=(& git -C $repoRoot rev-parse HEAD).Trim()
$manifest=[ordered]@{
  schema='TIGERIQ_PHONE_FARM_BUILD_V1'
  sourceHead=$head
  builtAtUtc=[DateTime]::UtcNow.ToString('o')
  localOnly=$true
  tigeriqExeSha256=(Get-FileHash (Join-Path $OutputPath 'TigerIQPhoneFarm.exe') -Algorithm SHA256).Hash
  nodeVersion=$nodeVersion
  nodeSha256=(Get-FileHash (Join-Path $OutputPath 'node.exe') -Algorithm SHA256).Hash
  nodeLicenseSha256=(Get-FileHash $nodeLicense -Algorithm SHA256).Hash
  dotnetSdk=((& dotnet --version).Trim())
  webView2LoaderSha256=(Get-FileHash (Join-Path $OutputPath 'WebView2Loader.dll') -Algorithm SHA256).Hash
}
$manifest|ConvertTo-Json -Depth 4|Set-Content (Join-Path $OutputPath 'BUILD_MANIFEST.json') -Encoding utf8
Write-Output ($manifest|ConvertTo-Json -Compress)
