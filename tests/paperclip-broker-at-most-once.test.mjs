import {readFileSync} from 'node:fs';
import {test} from 'vitest';
import assert from 'node:assert/strict';

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
