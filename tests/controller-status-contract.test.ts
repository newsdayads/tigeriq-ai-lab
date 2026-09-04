import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contract = readFileSync('scripts/pc-worker/repair-control-plane-controller-status-contract.ps1', 'utf8');
const runtime = readFileSync('scripts/pc-worker/repair-workforce-controller-runtime-deps.ps1', 'utf8');
const server = readFileSync('apps/workforce-controller/src/server.ts', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/command-center-release.yml', 'utf8');

describe('PC01 Workforce Controller status contract repair', () => {
  it('aligns physical probes with the live Controller route', () => {
    expect(server).toContain("url.pathname === '/api/workforce/status'");
    expect(contract).toContain("$expectedPath='/api/workforce/status'");
    expect(runtime).toContain("$HealthPath = '/api/workforce/status'");
    expect(runtime).not.toContain("$HealthPath = '/api/v1/status'");
    expect(runtime).toContain('$health.workforce');
    expect(runtime).not.toContain('$health.postgres');
    expect(runtime).not.toContain('$health.migration');
  });

  it('patches only the workforce_status function with longest-known legacy-path precedence', () => {
    expect(contract).toContain("$start=$text.IndexOf('def workforce_status():')");
    expect(contract).toContain('$next=$text.IndexOf("`ndef ",$start+1)');
    expect(contract).toContain("$legacyPaths=@('/api/v1/status','/api/status','/status')");
    expect(contract).toContain('foreach($candidate in $legacyPaths)');
    expect(contract).toContain("Fail 'STATUS_PATH_UNKNOWN'");
    expect(contract).not.toContain("Fail 'STATUS_PATH_AMBIGUOUS'");
    expect(contract).toContain('& $python -m py_compile $tmp');
    expect(contract).toContain('ROLLBACK_OK');
  });

  it('keeps network, credentials and scheduled-task definitions unchanged', () => {
    for (const source of [contract, runtime]) {
      expect(source).not.toContain('New-NetFirewallRule');
      expect(source).not.toContain('Set-NetFirewallRule');
      expect(source).not.toContain('Register-ScheduledTask');
      expect(source).not.toContain('Unregister-ScheduledTask');
      expect(source).not.toContain('Set-Content F:\\TigerIQ\\Secrets');
    }
  });

  it('runs the bounded status-contract repair before runtime HTTP verification', () => {
    expect(runtime).toContain("$StatusContractRepair = Join-Path $PSScriptRoot 'repair-control-plane-controller-status-contract.ps1'");
    expect(runtime).toContain("Fail 'STATUS_CONTRACT_REPAIR_FAILED'");
    expect(runtime.indexOf('$contractOutput =')).toBeLessThan(runtime.indexOf('$health = $null'));
  });

  it('ships the status-contract repair in the immutable PC01 runtime bundle', () => {
    const asset = 'scripts/pc-worker/repair-control-plane-controller-status-contract.ps1';
    expect(releaseWorkflow).toContain(`cp ${asset} .release/runtime/scripts/pc-worker/`);
    expect(releaseWorkflow).toContain(`test -s .release/runtime/${asset}`);
    expect(releaseWorkflow).toContain(`'${asset}'`);
  });
});
