param(
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
$appRoot=Split-Path $PSScriptRoot -Parent
$repoRoot=(Resolve-Path (Join-Path $appRoot '..\..')).Path
$project=Join-Path $PSScriptRoot 'TigerIQPhoneFarm.csproj'
$nodeVersion='24.19.0'
$nodeSha256='3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237'
$nodePublisherPattern='OpenJS Foundation'
$dotnetSdkPattern='^8\.0\.\d+$'
$webView2Version='1.0.4258.31'
$webView2LoaderSha256='3426DCC55FDFB8B5E7AC623CF33B4CCF283FBF68A0C5A65BDDFDB4D749A8ABEE'
$webView2PublisherPattern='Microsoft Corporation'

function Assert-Sha256([string]$Path,[string]$Expected,[string]$Label){
  $actual=(Get-FileHash $Path -Algorithm SHA256).Hash.ToUpperInvariant()
  if($actual -ne $Expected.ToUpperInvariant()){throw "$Label SHA-256 mismatch. Expected $Expected, found $actual"}
  return $actual
}
function Assert-AuthenticodePublisher([string]$Path,[string]$PublisherPattern,[string]$Label){
  $sig=Get-AuthenticodeSignature -FilePath $Path
  if($sig.Status -ne 'Valid'){throw "$Label Authenticode status is $($sig.Status), expected Valid"}
  $subject=$sig.SignerCertificate.Subject
  if([string]::IsNullOrWhiteSpace($subject) -or $subject -notmatch [regex]::Escape($PublisherPattern)){
    throw "$Label signer mismatch. Expected publisher containing '$PublisherPattern', found '$subject'"
  }
  return $subject
}
if(Test-Path $OutputPath){Remove-Item $OutputPath -Recurse -Force}
New-Item -ItemType Directory -Path $OutputPath | Out-Null
$dotnetSdk=(& dotnet --list-sdks | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -match $dotnetSdkPattern } | Sort-Object {[version]$_} -Descending | Select-Object -First 1)
if([string]::IsNullOrWhiteSpace($dotnetSdk)){throw "No installed .NET SDK matches $dotnetSdkPattern"}
$sdkProbeRoot=Join-Path ([IO.Path]::GetTempPath()) ("tigeriq-phonefarm-sdk-"+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sdkProbeRoot | Out-Null
@{sdk=@{version=$dotnetSdk;rollForward='disable'}}|ConvertTo-Json -Depth 3|Set-Content (Join-Path $sdkProbeRoot 'global.json') -Encoding utf8
Push-Location $sdkProbeRoot
try{
  $selectedSdk=((& dotnet --version).Trim())
  if($selectedSdk -ne $dotnetSdk){throw "Expected selected .NET SDK $dotnetSdk, found $selectedSdk"}
  dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $OutputPath
  if($LASTEXITCODE -ne 0){throw "dotnet publish failed: $LASTEXITCODE"}
}finally{
  Pop-Location
  Remove-Item $sdkProbeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
$runtime=@('app.mjs','farm-ops.mjs','index.html','macro-engine.mjs','recording.mjs','recording.test.mjs','schedule-engine.mjs','test.mjs','ui.js','README.md','INSTALL_WINDOWS.md','RELEASE_NOTES_WINDOWS_RC.md','SUPPLY_CHAIN_RC_20261026.md')
foreach($name in $runtime){Copy-Item (Join-Path $appRoot $name) (Join-Path $OutputPath $name) -Force}
$sourceDir=Join-Path $OutputPath 'windows'
New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Program.cs') (Join-Path $sourceDir 'Program.cs') -Force
Copy-Item (Join-Path $PSScriptRoot 'TigerIQPhoneFarm.csproj') (Join-Path $sourceDir 'TigerIQPhoneFarm.csproj') -Force
Copy-Item (Join-Path $PSScriptRoot 'package-windows.ps1') (Join-Path $sourceDir 'package-windows.ps1') -Force
Copy-Item (Join-Path $PSScriptRoot 'install-user.ps1') (Join-Path $OutputPath 'install-user.ps1') -Force
Copy-Item (Join-Path $PSScriptRoot 'uninstall-user.ps1') (Join-Path $OutputPath 'uninstall-user.ps1') -Force
$node=(Get-Command node -ErrorAction Stop).Source
$version=(& $node --version).Trim().TrimStart('v')
if($version -ne $nodeVersion){throw "Expected Node $nodeVersion, found $version"}
$verifiedNodeSha256=Assert-Sha256 $node $nodeSha256 'Node.js'
$nodeSignerSubject=Assert-AuthenticodePublisher $node $nodePublisherPattern 'Node.js'
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
$wv=Join-Path $nugetRoot "microsoft.web.webview2\$webView2Version"
if(!(Test-Path $wv)){throw "WebView2 NuGet package not found: $wv"}
Copy-Item (Join-Path $wv 'LICENSE.txt') (Join-Path $OutputPath 'WEBVIEW2_LICENSE.txt') -Force
Copy-Item (Join-Path $wv 'NOTICE.txt') (Join-Path $OutputPath 'WEBVIEW2_NOTICE.txt') -Force
$webView2Loader=Join-Path $OutputPath 'WebView2Loader.dll'
$verifiedWebView2LoaderSha256=Assert-Sha256 $webView2Loader $webView2LoaderSha256 'WebView2Loader.dll'
$webView2SignerSubject=Assert-AuthenticodePublisher $webView2Loader $webView2PublisherPattern 'WebView2Loader.dll'
New-Item -ItemType Directory -Path (Join-Path $OutputPath 'drop'),(Join-Path $OutputPath 'recordings') -Force | Out-Null
$head=(& git -C $repoRoot rev-parse HEAD).Trim()
$manifest=[ordered]@{
  schema='TIGERIQ_PHONE_FARM_BUILD_V1'
  sourceHead=$head
  builtAtUtc=[DateTime]::UtcNow.ToString('o')
  localOnly=$true
  tigeriqExeSha256=(Get-FileHash (Join-Path $OutputPath 'TigerIQPhoneFarm.exe') -Algorithm SHA256).Hash
  nodeVersion=$nodeVersion
  nodeSha256=$verifiedNodeSha256
  nodeSignerSubject=$nodeSignerSubject
  nodeLicenseSha256=(Get-FileHash $nodeLicense -Algorithm SHA256).Hash
  dotnetSdk=$dotnetSdk
  dotnetSdkPolicy=$dotnetSdkPattern
  dotnetLicenseSha256=(Get-FileHash (Join-Path $OutputPath 'DOTNET_LICENSE.txt') -Algorithm SHA256).Hash
  dotnetThirdPartySha256=(Get-FileHash (Join-Path $OutputPath 'DOTNET_THIRD_PARTY.txt') -Algorithm SHA256).Hash
  webView2Version=$webView2Version
  webView2LoaderSha256=$verifiedWebView2LoaderSha256
  webView2SignerSubject=$webView2SignerSubject
  webView2LicenseSha256=(Get-FileHash (Join-Path $OutputPath 'WEBVIEW2_LICENSE.txt') -Algorithm SHA256).Hash
  webView2NoticeSha256=(Get-FileHash (Join-Path $OutputPath 'WEBVIEW2_NOTICE.txt') -Algorithm SHA256).Hash
}
$manifest|ConvertTo-Json -Depth 4|Set-Content (Join-Path $OutputPath 'BUILD_MANIFEST.json') -Encoding utf8
Write-Output ($manifest|ConvertTo-Json -Compress)
