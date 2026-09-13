$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/tigeriq-core/update-core-runtime.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'UPDATER_SYNTAX_INVALID'}
# Load only pure gate/impact functions, never the runtime loop or task controls.
foreach($name in @('Gates-Pass','Resolve-GateSha','Get-Impact')){
  $fn=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true))
  if($fn.Count -ne 1){throw "FUNCTION_COUNT:$name"}
  Invoke-Expression $fn[0].Extent.Text
}
$sha='a'*40
$script:runs=@()
function gh { $global:LASTEXITCODE=0;return @{workflow_runs=$script:runs}|ConvertTo-Json -Depth 8 }
function Assert([bool]$ok,[string]$message){if(-not $ok){throw $message}}
Assert (-not (Gates-Pass $sha)) 'Missing gates must fail'
$names=@('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify')
$script:runs=@($names|ForEach-Object{@{name=$_;head_sha=$sha;run_number=1;run_attempt=1;status='completed';conclusion='success'}})
Assert (Gates-Pass $sha) 'Exact SHA success required'
Assert (-not (Gates-Pass ('b'*40))) 'Other SHA cannot pass'
$script:runs+=@{name='CI';head_sha=$sha;run_number=2;run_attempt=1;status='in_progress';conclusion=$null}
Assert (-not (Gates-Pass $sha)) 'New pending run must invalidate older success'
$script:runs[-1].status='completed';$script:runs[-1].conclusion='failure'
Assert (-not (Gates-Pass $sha)) 'New failed run must invalidate older success'
Assert ($null -eq (Resolve-GateSha $sha)) 'No PR-head fallback permitted'
$script:runs[-1].conclusion='success'
Assert ((Resolve-GateSha $sha) -eq $sha) 'Return only exact verified SHA'
$impact=Get-Impact @('apps/tigeriq-core/execution-policy.mjs')
Assert ($impact.web -and $impact.core -and -not $impact.coding) 'Policy must update Core and Web, never Coding'
Assert (-not (Get-Impact @('apps/tigeriq-coding-lane/coding-entry.mjs')).coding) 'Legacy change must not restart Coding'
Write-Output "UPDATER_BEHAVIOR_PASS TESTED_SHA=$env:TESTED_SHA"
