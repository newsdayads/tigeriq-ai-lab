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
