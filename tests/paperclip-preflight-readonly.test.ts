import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Paperclip #2054 R01 read-only source contract', () => {
  it('avoids root creation, heartbeat directory creation and broker request writes', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url), 'utf8');
    const section = (start: string, end: string) => {
      const a = source.indexOf(start);
      const b = source.indexOf(end, a + start.length);
      expect(a).toBeGreaterThan(-1);
      expect(b).toBeGreaterThan(a);
      return source.slice(a, b);
    };
    const root = section('async function ensureRootIntegrity(', 'async function ensureContainedDirectory(');
    expect(root).toContain('if (create) await fs.mkdir(PAPERCLIP_LAB_ROOT');
    const status = section('async function brokerStatus()', 'export function paperclipLabBrokerOperationForDockerArgs(');
    expect(status).toContain('await fs.lstat(safeHeartbeat)');
    expect(status).toContain('if (!pathInsideLab(real))');
    expect(status).not.toContain('assertSafeFileTarget(');
    expect(status).not.toContain('fs.mkdir(');
    const transport = section('async function resolveDockerTransport(', 'function pathInsideLab(');
    expect(transport).toContain('if (!allowBrokerProbe) return');
    const preflight = section('async function preflight(', 'function redactPaperclipDiagnosticText(');
    expect(preflight).toContain('await ensureRootIntegrity({ create: false })');
    expect(preflight).toContain('allowBrokerProbe: false');
    expect(preflight).not.toContain('fs.mkdir(');
    expect(preflight).not.toContain('runBrokerRequest(');
  });
});
