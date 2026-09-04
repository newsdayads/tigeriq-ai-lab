import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/repair-secure-worker-model-timeout.ps1', 'utf8');

describe('Secure Worker V3 model-timeout repair contract', () => {
  it('migrates reviewed 90/300 assignments to a minimum-300 clamp', () => {
    expect(source).toContain("$marker = '# TIGERIQ_MODEL_TIMEOUT_MIN300_V2'");
    expect(source).toContain("$oldMarker = '# TIGERIQ_MODEL_TIMEOUT_300_V1'");
    expect(source).toContain("MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '90'))");
    expect(source).toContain("MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300'))");
    expect(source).toContain("MODEL_TIMEOUT = max(300, int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300')))" );
    expect(source).toContain('$anchorCount = 0');
    expect(source).toContain('if($has90){ $anchorCount += 1 }');
    expect(source).toContain('if($hasPlain300){ $anchorCount += 1 }');
    expect(source).toContain('if($hasDesired){ $anchorCount += 1 }');
    expect(source).toContain("if($anchorCount -ne 1){ Fail 'WORKER_TIMEOUT_LAYOUT_CHANGED'");
    expect(source).toContain("$text = $text.Replace($legacy90,\"$marker`n$desired\")");
    expect(source).toContain("$text = $text.Replace($plain300,\"$marker`n$desired\")");
    expect(source).toContain("$text = $text.Replace($desired,\"$marker`n$desired\")");
    expect(source).not.toContain('TIMEOUT_CLAMP_MARKER_MISSING');
  });

  it('prevents future low environment overrides from reducing effective timeout below 300', () => {
    expect(source).toContain("MODEL_TIMEOUT = max(300, int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '300')))" );
    expect(source).toContain("policy='MIN_300_CLAMP'");
    expect(source).toContain('secondsMin=300');
    expect(source).not.toContain('GetEnvironmentVariable');
    expect(source).not.toContain('WORKER_PRINCIPAL_CONTEXT_MISMATCH');
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
    expect(source).toContain("Fail 'TIMEOUT_MIN300_NOT_PERSISTED'");
    expect(source).toContain("Fail 'TIMEOUT_UNCLAMPED_STILL_PRESENT'");
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