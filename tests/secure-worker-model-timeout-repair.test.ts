import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/repair-secure-worker-model-timeout.ps1', 'utf8');

describe('Secure Worker V3 model-timeout repair contract', () => {
  it('replaces only the reviewed 90 second default with the reviewed 300 second default', () => {
    expect(source).toContain("$marker = '# TIGERIQ_MODEL_TIMEOUT_300_V1'");
    expect(source).toContain("MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '90'))");
    expect(source).toContain("MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300'))");
    expect(source).toContain("if($hasLegacy -and $hasDesired){ Fail 'AMBIGUOUS_TIMEOUT_LAYOUT'");
    expect(source).toContain("if(-not $hasLegacy -and -not $hasDesired){ Fail 'WORKER_TIMEOUT_LAYOUT_CHANGED'");
    expect(source).toContain("$text = $text.Replace($legacy,\"$marker`n$desired\")");
  });

  it('fails closed when an effective timeout override can keep the Worker below 300 seconds', () => {
    expect(source).toContain("GetEnvironmentVariable('TIGERIQ_MODEL_TIMEOUT',$Scope)");
    expect(source).toContain("Fail \"TIMEOUT_OVERRIDE_INVALID_$($Scope.ToUpperInvariant())\"");
    expect(source).toContain("if($parsed -lt 300){ Fail \"TIMEOUT_OVERRIDE_TOO_LOW_$($Scope.ToUpperInvariant())\"");
    expect(source).toContain("$processOverride = Get-TimeoutOverride 'Process'");
    expect(source).toContain("$userOverride = Get-TimeoutOverride 'User'");
    expect(source).toContain("$machineOverride = Get-TimeoutOverride 'Machine'");
    expect(source).toContain("Fail 'WORKER_PRINCIPAL_CONTEXT_MISMATCH'");
  });

  it('requires the reviewed direct worker launcher so task wrappers cannot inject a hidden timeout', () => {
    expect(source).toContain("$workerLauncher = Join-Path $workerDir 'worker.py'");
    expect(source).toContain("if($arguments -match '(?i)TIGERIQ_MODEL_TIMEOUT'){ Fail 'WORKER_TASK_TIMEOUT_WRAPPER_UNREVIEWED'");
    expect(source).toContain("Fail 'WORKER_TASK_LAUNCHER_UNEXPECTED'");
    expect(source).toContain('[StringComparison]::OrdinalIgnoreCase');
  });

  it('backs up, compiles, restarts, verifies persistence and rolls back on post-write failure', () => {
    expect(source).toContain('Copy-Item -LiteralPath $workerImpl -Destination $backup -Force');
    expect(source).toContain('& $python -m py_compile $tmp');
    expect(source).toContain('Move-Item -Force -LiteralPath $tmp -Destination $workerImpl');
    expect(source).toContain('Restart-Worker');
    expect(source).toContain("Fail 'TIMEOUT_PATCH_NOT_PERSISTED'");
    expect(source).toContain("Fail 'TIMEOUT_300_NOT_PERSISTED'");
    expect(source).toContain("Fail 'TIMEOUT_90_STILL_PRESENT'");
    expect(source).toContain('ROLLBACK_OK');
  });

  it('is PC01-only and does not widen authority or mutate credentials/network/task definitions', () => {
    expect(source).toContain("if($env:COMPUTERNAME -ne 'PC01'){ Fail 'WRONG_HOST' 'PC01 only.' }");
    expect(source).not.toContain('New-NetFirewallRule');
    expect(source).not.toContain('Set-NetFirewallRule');
    expect(source).not.toContain('Register-ScheduledTask');
    expect(source).not.toContain('Unregister-ScheduledTask');
    expect(source).not.toContain('SetEnvironmentVariable');
    expect(source).not.toContain('F:\\TigerIQ\\Secrets');
    expect(source).not.toContain('git push');
    expect(source).not.toContain('gh pr merge');
  });
});