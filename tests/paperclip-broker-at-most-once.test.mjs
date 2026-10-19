import {readFileSync} from 'node:fs';
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {paperclipBrokerR07GuardPresent} from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

// GH-2054 R07: offline contract test. This cannot attest a live broker restart.
const source=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/paperclip-wsl-broker.ps1',import.meta.url),'utf8');
const loop=source.slice(source.indexOf('    $items = @(Get-ChildItem'),source.indexOf('    Start-Sleep -Milliseconds 200',source.indexOf('    $items = @(Get-ChildItem')));

test('R07 broker durably claims a validated UUID exactly once before any Docker/device-auth side effect',()=>{
  assert.match(source,/\$Claims = Join-Path \$BrokerRoot 'claims'/);
  assert.match(source,/function Reserve-BrokerRequestOnce\(/);
  assert.match(source,/\[System\.IO\.FileMode\]::CreateNew/);
  assert.match(source,/\.Flush\(\$true\)/);
  assert.ok(loop.indexOf('Test-Request $req')>=0);
  assert.ok(loop.indexOf('Reserve-BrokerRequestOnce')>loop.indexOf('Test-Request $req'));
  assert.ok(loop.indexOf('Invoke-OpenAiDeviceAuth')>loop.indexOf('Reserve-BrokerRequestOnce'));
  assert.ok(loop.indexOf('Invoke-FixedWslDocker')>loop.indexOf('Reserve-BrokerRequestOnce'));
});

test('R07 broker preserves durable claim after completion/failure and never overwrites an existing response',()=>{
  assert.match(source,/TIGERIQ_PAPERCLIP_WSL_BROKER_DUPLICATE_OR_UNKNOWN/);
  assert.match(loop,/if \(-not \(Test-Path -LiteralPath \$responsePath -PathType Leaf\)\) \{/);
  assert.doesNotMatch(source,/Remove-Item\s+-LiteralPath\s+\$claimPath/);
  assert.doesNotMatch(source,/Move-Item\s+-LiteralPath\s+\$claimPath/);
  assert.match(loop,/Remove-Item -LiteralPath \$item\.FullName -Force -ErrorAction SilentlyContinue/);
});

test('R07 broker retains a strict allowlist and does not add a retry/replay path',()=>{
  assert.match(source,/function Get-OperationSpec\(/);
  assert.match(source,/function Test-Request\(/);
  assert.match(source,/Get-ChildItem -LiteralPath \$Requests -Filter 'request-\*\.json'/);
  assert.doesNotMatch(source,/-Force\s+\$claimPath/);
});

test('R07 source admission rejects old broker or missing durability controls before an install',()=>{
  assert.equal(paperclipBrokerR07GuardPresent(source),true);
  assert.equal(paperclipBrokerR07GuardPresent(null),false);
  assert.equal(paperclipBrokerR07GuardPresent(source.replace('function Reserve-BrokerRequestOnce(', 'function Legacy-Request(')),false);
  assert.equal(paperclipBrokerR07GuardPresent(source.replace('[System.IO.FileMode]::CreateNew','[System.IO.FileMode]::OpenOrCreate')),false);
  assert.equal(paperclipBrokerR07GuardPresent(source.replace('.Flush($true)', '.Flush($false)')),false);
  assert.equal(paperclipBrokerR07GuardPresent(source.replace('        Test-Request $req', '        # validation missing')),false);
  assert.equal(paperclipBrokerR07GuardPresent(source.replace('        Reserve-BrokerRequestOnce ([string]$req.id) ([string]$req.operation)', '        # claim missing')),false);
});

test('R07 typed broker install verifies deployed source before and after the task restart',()=>{
  const lab=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs',import.meta.url),'utf8');
  const fn=lab.slice(lab.indexOf('async function installInteractiveWslBroker('),lab.indexOf('async function runBrokerRequest('));
  assert.ok(fn.indexOf('paperclipBrokerR07GuardPresent(brokerSource)')>=0);
  const first=fn.indexOf("fs.readFile(safeBroker, 'utf8')");
  const execute=fn.indexOf("['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',safeInstaller]");
  const second=fn.lastIndexOf("fs.readFile(safeBroker, 'utf8')");
  const accepted=fn.indexOf('r07SourceVerified: true');
  assert.ok(first>=0 && execute>first && second>execute && accepted>second);
  assert.match(fn,/TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_SOURCE_DRIFT/g);
});


// GH-2054 R07: unlike the source-text guards above, these tests execute the
// exact claim function from the broker in isolated, fresh PowerShell processes.
// No PC01, WSL, Docker, scheduled task, authentication or live Lab access.
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pwshProbe=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{encoding:'utf8',timeout:10000});
const pwshAvailable=pwshProbe.status===0;
const realPwshTest=pwshAvailable||process.env.CI==='true'?test:test.skip;

function newIsolatedPowerShellClaimFixture() {
  const start=source.indexOf('function Reserve-BrokerRequestOnce(');
  const end=source.indexOf('\nfunction Write-JsonAtomic(',start);
  assert.ok(start>=0&&end>start,'R07 claim function boundaries must exist');
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-r07-claim-'));
  mkdirSync(join(dir,'claims'));
  mkdirSync(join(dir,'responses'));
  const script=join(dir,'claim-only.ps1');
  const code=[
    "$ErrorActionPreference='Stop'",
    "$Claims=Join-Path $env:TIGERIQ_R07_TEST_DIR 'claims'",
    "$Responses=Join-Path $env:TIGERIQ_R07_TEST_DIR 'responses'",
    source.slice(start,end),
    'try {',
    "  Reserve-BrokerRequestOnce $env:TIGERIQ_R07_TEST_ID 'version'",
    "  Write-Output 'R07_CLAIMED'",
    '  exit 0',
    '} catch {',
    "  if ($_.Exception.Message -eq 'TIGERIQ_PAPERCLIP_WSL_BROKER_DUPLICATE_OR_UNKNOWN') {",
    "    Write-Output 'R07_DUPLICATE_BLOCKED'",
    '    exit 23',
    '  }',
    '  throw',
    '}',
  ].join('\n');
  writeFileSync(script,code,'utf8');
  return {dir,script,id:randomUUID()};
}

function runIsolatedPowerShellClaim(fixture) {
  assert.equal(pwshAvailable,true,'PowerShell must be installed for real R07 CI tests');
  const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',fixture.script],{
    encoding:'utf8',timeout:15000,
    env:{...process.env,TIGERIQ_R07_TEST_DIR:fixture.dir,TIGERIQ_R07_TEST_ID:fixture.id},
  });
  assert.ifError(result.error);
  return result;
}

realPwshTest('R07 PowerShell fresh-process claim survives restart and blocks duplicate side effect',()=>{
  const fixture=newIsolatedPowerShellClaimFixture();
  try {
    const first=runIsolatedPowerShellClaim(fixture);
    assert.equal(first.status,0,first.stderr);
    assert.match(first.stdout,/R07_CLAIMED/);
    const claim=join(fixture.dir,'claims','claim-'+fixture.id+'.json');
    assert.equal(existsSync(claim),true);
    const before=readFileSync(claim,'utf8');
    assert.deepEqual(
      (({schema,id,operation})=>({schema,id,operation}))(JSON.parse(before)),
      {schema:'TIGERIQ_PAPERCLIP_WSL_CLAIM_V1',id:fixture.id,operation:'version'},
    );
    const restarted=runIsolatedPowerShellClaim(fixture);
    assert.equal(restarted.status,23,restarted.stderr);
    assert.match(restarted.stdout,/R07_DUPLICATE_BLOCKED/);
    assert.equal(readFileSync(claim,'utf8'),before,'durable claim must be unchanged');
  } finally {rmSync(fixture.dir,{recursive:true,force:true})}
});

realPwshTest('R07 PowerShell fresh-process fails closed on a pre-existing terminal response',()=>{
  const fixture=newIsolatedPowerShellClaimFixture();
  try {
    const response=join(fixture.dir,'responses','response-'+fixture.id+'.json');
    writeFileSync(response,'{"schema":"TIGERIQ_PAPERCLIP_WSL_RESPONSE_V1"}','utf8');
    const result=runIsolatedPowerShellClaim(fixture);
    assert.equal(result.status,23,result.stderr);
    assert.match(result.stdout,/R07_DUPLICATE_BLOCKED/);
    assert.equal(existsSync(join(fixture.dir,'claims','claim-'+fixture.id+'.json')),false);
    assert.equal(readFileSync(response,'utf8'),'{"schema":"TIGERIQ_PAPERCLIP_WSL_RESPONSE_V1"}');
  } finally {rmSync(fixture.dir,{recursive:true,force:true})}
});

realPwshTest('R07 PowerShell fresh-process fails closed on an incomplete crash claim',()=>{
  const fixture=newIsolatedPowerShellClaimFixture();
  try {
    const claim=join(fixture.dir,'claims','claim-'+fixture.id+'.json');
    writeFileSync(claim,'{"schema":','utf8');
    const result=runIsolatedPowerShellClaim(fixture);
    assert.equal(result.status,23,result.stderr);
    assert.match(result.stdout,/R07_DUPLICATE_BLOCKED/);
    assert.equal(readFileSync(claim,'utf8'),'{"schema":');
  } finally {rmSync(fixture.dir,{recursive:true,force:true})}
});

// GH-2054 R07: fail closed when installer sees legacy/stale running broker.
import {createHash} from 'node:crypto';
import {paperclipBrokerLiveSourceMatches} from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

test('R07 running-broker SHA attestation rejects old process, missing hash, forged version-only health',()=>{
  const good=createHash('sha256').update(source,'utf8').digest('hex');
  assert.equal(paperclipBrokerLiveSourceMatches({ready:true,sourceSha256:good},source),true);
  assert.equal(paperclipBrokerLiveSourceMatches({ready:true,sourceSha256:'0'.repeat(64)},source),false);
  assert.equal(paperclipBrokerLiveSourceMatches({ready:true,version:'1.7-openai-device-auth'},source),false);
  assert.equal(paperclipBrokerLiveSourceMatches({ready:false,sourceSha256:good},source),false);
  assert.equal(paperclipBrokerLiveSourceMatches({ready:true,sourceSha256:good.toUpperCase()},source),false);
  assert.equal(paperclipBrokerLiveSourceMatches({ready:true,sourceSha256:good},source+'\n#drift'),false);
  assert.equal(paperclipBrokerLiveSourceMatches({ready:true,sourceSha256:good},null),false);
});

test('R07 installer and heartbeat require the running script identity, not merely identical broker version',()=>{
  const installer=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/Install-PaperclipWslBroker.ps1',import.meta.url),'utf8');
  const lab=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs',import.meta.url),'utf8');
  assert.match(source,/\$BrokerSourceSha256\s*=\s*\(Get-FileHash -LiteralPath \$PSCommandPath -Algorithm SHA256\)\.Hash\.ToLowerInvariant\(\)/);
  assert.match(source,/sourceSha256=\$BrokerSourceSha256/);
  assert.match(installer,/\$ExpectedBrokerSha256=\(Get-FileHash -LiteralPath \$Broker -Algorithm SHA256\)\.Hash\.ToLowerInvariant\(\)/);
  assert.match(installer,/\[string\]\$h\.sourceSha256 -ceq \$ExpectedBrokerSha256/);
  assert.match(lab,/TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_RUNNING_SOURCE_MISMATCH/);
  assert.ok(lab.indexOf('paperclipBrokerLiveSourceMatches(status, brokerSource)')<lab.indexOf("runDockerViaBroker(['version', '--format', '{{.Server.Version}}']"));
});
