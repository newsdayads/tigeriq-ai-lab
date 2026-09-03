import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const installer = readFileSync('scripts/pc-worker/install-command-center.ps1', 'utf8');
const telemetry = readFileSync('scripts/pc-worker/pc01-telemetry.ps1', 'utf8');
const server = readFileSync('apps/dashboard/src/server.ts', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));

describe('WO-059 PC01 primary Command Center safety', () => {
  it('defaults deployment source to main and auto-starts at Windows startup as SYSTEM', () => {
    expect(installer).toContain("[string]$Branch = 'main'");
    expect(installer).toContain('New-ScheduledTaskTrigger -AtStartup');
    expect(installer).toContain("-UserId 'SYSTEM'");
    expect(installer).toContain("-RemoteAddress '100.64.0.0/10'");
    expect(installer).toContain('PUBLIC_EXPOSURE');
    expect(installer).not.toContain("$hostIp = '0.0.0.0'");
  });

  it('collects real PC01 runtime sources without credentials', () => {
    expect(telemetry).toContain('worker-github-queue.py');
    expect(telemetry).toContain('/api/workforce/status');
    expect(telemetry).toContain('postgresql');
    expect(telemetry).toContain('nvidia-smi');
    expect(telemetry).toContain('127.0.0.1:11434/api/tags');
    expect(telemetry.toLowerCase()).not.toContain('password=');
    expect(telemetry.toLowerCase()).not.toContain('authorization:');
  });

  it('keeps Vy identity and rejects public binding', () => {
    expect(server).toContain('Vy — AI Chief of Staff');
    expect(server).toContain('anh Sơn');
    expect(server).toContain('GIAO VIỆC CHO VY');
    expect(server).not.toContain('Sếp');
    expect(server).toContain("host === 'localhost'");
    expect(server).toContain("octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127");
  });

  it('keeps Vercel Git deployment disabled', () => {
    expect(vercel.git?.deploymentEnabled).toBe(false);
  });
});
