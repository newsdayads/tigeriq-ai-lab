$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$targets = @(
  Get-ChildItem -Path (Join-Path $PSScriptRoot 'pc-worker') -Filter '*.ps1' -File
  Get-ChildItem -Path (Join-Path $repoRoot 'apps\chrome-controller') -Filter '*.ps1' -File -Recurse
) | Sort-Object FullName -Unique
$failed = $false
foreach ($target in $targets) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($target.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    $failed = $true
    foreach ($parseError in $errors) {
      Write-Error ("{0}:{1}:{2} {3}" -f $target.Name, $parseError.Extent.StartLineNumber, $parseError.Extent.StartColumnNumber, $parseError.Message)
    }
  }
}
if ($failed) { exit 1 }
Write-Output ("POWERSHELL_SYNTAX_PASS files={0}" -f $targets.Count)
