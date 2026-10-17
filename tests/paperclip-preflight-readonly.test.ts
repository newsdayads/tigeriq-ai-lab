import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
// @ts-ignore — Paperclip's existing native .mjs exports do not publish TypeScript declarations.
import { paperclipReadOnlyPreflight, resolveDockerTransport } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

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
    const preflight = section('export async function paperclipReadOnlyPreflight(', 'function redactPaperclipDiagnosticText(');
    expect(preflight).toContain('ensureRootIntegrity({ create: false })');
    expect(preflight).toContain('allowBrokerProbe: false');
    expect(preflight).toContain('rootPresent');
    expect(preflight).toContain("error?.code !== 'ENOENT'");
    expect(preflight).not.toContain('fs.mkdir(');
    expect(preflight).not.toContain('runBrokerRequest(');
  });

  it('returns an absent-root diagnostic without probing the missing disk', async () => {
    const result = await paperclipReadOnlyPreflight({
      checkRoot: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      inspectDocker: async () => ({
        kind: null, version: null, error: 'DOCKER_UNAVAILABLE',
        broker: { ready: false, reason: 'BROKER_MISSING' },
      }),
      inspectPort: async () => ({ host: '127.0.0.1', port: 3210, reachable: false, reason: 'refused' }),
      inspectDisk: async () => { throw new Error('unreachable disk probe'); },
      inspectBroker: async () => { throw new Error('unreachable broker probe'); },
    });
    expect(result.rootPresent).toBe(false);
    expect(result.disk).toBeNull();
    expect(result.docker.ok).toBe(false);
    expect(result.docker.error).toBe('DOCKER_UNAVAILABLE');
    expect(result.port3210.reachable).toBe(false);
  });
  it('collects present-root read-only probe results exactly once', async () => {
    let disks = 0;
    let brokers = 0;
    const result = await paperclipReadOnlyPreflight({
      checkRoot: async () => {},
      inspectDocker: async () => ({ kind: 'windows', version: '27.0', error: null }),
      inspectPort: async () => ({ host: '127.0.0.1', port: 3210, reachable: true, reason: 'connected' }),
      inspectDisk: async () => {
        disks++;
        return { bavail: 2, bsize: 4096, blocks: 100 };
      },
      inspectBroker: async () => {
        brokers++;
        return { ready: true, version: '1.7-openai-device-auth' };
      },
    });
    expect(result.rootPresent).toBe(true);
    expect(result.disk).toEqual({ freeBytes: 8192, totalBytes: 409600 });
    expect(result.docker).toMatchObject({ ok: true, transport: 'windows', version: '27.0', broker: { ready: true } });
    expect(disks).toBe(1);
    expect(brokers).toBe(1);
  });
  it('rejects an unsafe root instead of suppressing a security error', async () => {
    let dockerCalled = false;
    await expect(paperclipReadOnlyPreflight({
      checkRoot: async () => { throw new Error('TIGERIQ_PAPERCLIP_LAB_ROOT_SYMLINK_BLOCKED'); },
      inspectDocker: async () => { dockerCalled = true; throw new Error('unreachable docker probe'); },
    })).rejects.toThrow('TIGERIQ_PAPERCLIP_LAB_ROOT_SYMLINK_BLOCKED');
    expect(dockerCalled).toBe(false);
  });


  it('does not write broker request when Docker and WSL fail but broker is healthy', async () => {
    const attempted: string[] = [];
    let bridged = 0;
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: false,
      runVersionCommand: async (command: string) => {
        attempted.push(command);
        return { exitCode: 1, timedOut: false, stdout: '', stderr: 'version unavailable' };
      },
      readBrokerStatus: async () => ({ ready: true, version: '1.7-openai-device-auth' }),
      probeViaBroker: async () => {
        bridged++;
        throw new Error('BROKER_WRITE_MUST_NOT_OCCUR');
      },
    });
    expect(attempted).toEqual(['docker.exe', 'wsl.exe']);
    expect(bridged).toBe(0);
    expect(result).toMatchObject({
      kind: null, version: null,
      error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT',
      broker: { ready: true },
    });
  });
  it('preserves the existing operational broker route outside R01', async () => {
    let bridged = 0;
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: true,
      runVersionCommand: async () => ({ exitCode: 1, timedOut: false, stdout: '', stderr: 'version unavailable' }),
      readBrokerStatus: async () => ({ ready: true }),
      probeViaBroker: async () => {
        bridged++;
        return { exitCode: 0, timedOut: false, stdout: '27.1.0\n', stderr: '' };
      },
    });
    expect(bridged).toBe(1);
    expect(result).toMatchObject({
      kind: 'wsl-ubuntu-interactive-broker', version: '27.1.0', error: null,
      broker: { ready: true },
    });
  });
  it('short-circuits broker checks when a direct Docker transport works', async () => {
    let brokerReads = 0;
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: false,
      runVersionCommand: async (command: string) => {
        if (command !== 'docker.exe') throw new Error('WSL_MUST_NOT_RUN');
        return { exitCode: 0, timedOut: false, stdout: '27.2.0\n', stderr: '' };
      },
      readBrokerStatus: async () => { brokerReads++; throw new Error('BROKER_MUST_NOT_RUN'); },
      probeViaBroker: async () => { throw new Error('BROKER_WRITE_MUST_NOT_OCCUR'); },
    });
    expect(brokerReads).toBe(0);
    expect(result).toMatchObject({ kind: 'windows', version: '27.2.0', error: null });
  });

});
