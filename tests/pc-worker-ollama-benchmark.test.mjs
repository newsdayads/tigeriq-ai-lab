import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const script=readFileSync(new URL('../scripts/pc-worker/test-ollama.ps1',import.meta.url),'utf8');

test('Ollama benchmark stays loopback-only and bounded',()=>{
  assert.match(script,/http:\/\/127\.0\.0\.1:11434/);
  assert.match(script,/OLLAMA_LOOPBACK_ONLY/);
  assert.match(script,/NumCtx must be between 256 and 32768/);
  assert.match(script,/TimeoutSec must be between 10 and 900/);
  assert.doesNotMatch(script,/\/api\/pull/);
  assert.doesNotMatch(script,/\/api\/delete/);
});

test('Ollama benchmark uses generate telemetry and exposes quantitative metrics',()=>{
  assert.match(script,/\/api\/generate/);
  assert.match(script,/\/api\/ps/);
  assert.match(script,/stream = \$false/);
  assert.match(script,/think = \$false/);
  assert.match(script,/num_ctx = \$NumCtx/);
  assert.match(script,/num_predict = \$NumPredict/);
  for(const key of [
    'wallMs',
    'loadDurationNs',
    'promptEvalDurationNs',
    'promptEvalCount',
    'evalDurationNs',
    'evalCount',
    'tokensPerSec',
    'modelSizeBytes',
    'gpuResidentBytes',
    'cpuResidentApproxBytes',
    'gpuResidentPct',
    'cpuLoadPctBefore',
    'cpuLoadPctAfter',
    'memoryBefore',
    'memoryAfter',
    'gpuBefore',
    'gpuAfter'
  ]){
    assert.match(script,new RegExp('\\b'+key+'\\b'));
  }
});

test('GPU snapshot is best-effort and does not require nvidia-smi',()=>{
  assert.match(script,/Get-Command 'nvidia-smi\.exe' -ErrorAction SilentlyContinue/);
  assert.match(script,/if \(-not \$nvidiaSmi\) \{ return @\(\) \}/);
  assert.match(script,/catch \{\s*return @\(\)\s*\}/s);
});
