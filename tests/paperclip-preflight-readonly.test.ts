import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
// @ts-ignore — Paperclip's existing native .mjs exports do not publish TypeScript declarations.
import { paperclipReadOnlyPreflight, resolveDockerTransport, paperclipReadOnlyExistingDirectory, paperclipReadOnlyContainerStatus } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

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
    const subprocess = section('async function runFixed(', 'function parseBrokerJson(');
    expect(subprocess).toContain('await ensureRootIntegrity({ create: !readOnly })');
    expect(subprocess).toContain('paperclipReadOnlyExistingDirectory(safeCwd)');
    expect(subprocess).toContain('readOnly = false');
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
      inspectContainer: async () => ({ attempted: true, present: true, running: true, imageRef: 'test', imageDigestVerified: false, reason: null }),
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
    const readonly: unknown[] = [];
    let bridged = 0;
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: false,
      runVersionCommand: async (command: string, _args: unknown, opts: { readOnly?: boolean }) => {
        attempted.push(command);
        readonly.push(opts.readOnly);
        return { exitCode: 1, timedOut: false, stdout: '', stderr: 'version unavailable' };
      },
      readBrokerStatus: async () => ({ ready: true, version: '1.7-openai-device-auth' }),
      probeViaBroker: async () => {
        bridged++;
        throw new Error('BROKER_WRITE_MUST_NOT_OCCUR');
      },
    });
    expect(attempted).toEqual(['docker.exe', 'wsl.exe']);
    expect(readonly).toEqual([true, true]);
    expect(bridged).toBe(0);
    expect(result).toMatchObject({
      kind: null, version: null,
      error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT',
      broker: { ready: true },
    });
  });
  it('preserves the existing operational broker route outside R01', async () => {
    let bridged = 0;
    const readonly: unknown[] = [];
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: true,
      runVersionCommand: async (_command: string, _args: unknown, opts: { readOnly?: boolean }) => {
        readonly.push(opts.readOnly);
        return { exitCode: 1, timedOut: false, stdout: '', stderr: 'version unavailable' };
      },
      readBrokerStatus: async () => ({ ready: true }),
      probeViaBroker: async () => {
        bridged++;
        return { exitCode: 0, timedOut: false, stdout: '27.1.0\n', stderr: '' };
      },
    });
    expect(bridged).toBe(1);
    expect(readonly).toEqual([false, false]);
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


  it('reads an existing Lab directory using lstat and realpath without mkdir', async () => {
    const paths: string[] = [];
    const root = String.raw`D:\TigerIQ-Paperclip-Lab`;
    const result = await paperclipReadOnlyExistingDirectory(root, {
      lstat: async (path: string) => {
        paths.push('lstat:' + path);
        return { isDirectory: () => true, isSymbolicLink: () => false };
      },
      realpath: async (path: string) => {
        paths.push('realpath:' + path);
        return root;
      },
    });
    expect(result).toBe(root);
    expect(paths).toEqual(['lstat:' + root, 'realpath:' + root]);
  });

  it('fails closed on missing, symlinked, non-directory and escaped Lab root', async () => {
    const root = String.raw`D:\TigerIQ-Paperclip-Lab`;
    const bad = (directory: boolean, link: boolean) => ({
      lstat: async () => ({ isDirectory: () => directory, isSymbolicLink: () => link }),
      realpath: async () => root,
    });
    await expect(paperclipReadOnlyExistingDirectory(root, {
      lstat: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      realpath: async () => root,
    })).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(paperclipReadOnlyExistingDirectory(root, bad(true, true))).rejects.toThrow('READ_ONLY_DIRECTORY_UNSAFE');
    await expect(paperclipReadOnlyExistingDirectory(root, bad(false, false))).rejects.toThrow('READ_ONLY_DIRECTORY_UNSAFE');
    await expect(paperclipReadOnlyExistingDirectory(root, {
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      realpath: async () => String.raw`D:\TigerIQ\State`,
    })).rejects.toThrow('REALPATH_ESCAPE_BLOCKED');
  });


  it('R01 reads an existing container only through direct Docker with readOnly:true', async () => {
    const calls: unknown[] = [];
    const result = await paperclipReadOnlyContainerStatus('windows', {
      runReadOnlyCommand: async (exe: string, args: string[], options: { readOnly: boolean; cwd: string }) => {
        calls.push({ exe, args, options });
        return { exitCode: 0, timedOut: false,
          stdout: JSON.stringify({ State: { Running: false }, Config: { Image: 'ghcr.io/paperclipai/paperclip:2026.916.1' } }) };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      exe: 'docker.exe',
      args: ['inspect', 'tigeriq-paperclip-lab', '--format', '{{json .}}'],
      options: { readOnly: true, cwd: String.raw`D:\TigerIQ-Paperclip-Lab` },
    });
    expect(result).toMatchObject({ attempted: true, present: true, running: false,
      imageRef: 'ghcr.io/paperclipai/paperclip:2026.916.1', imageDigestVerified: false, reason: null });
  });


  it('R01 distinguishes observed pinned tag, drift and unknown digest without mutating Docker', async () => {
    const observed: Array<{ ref: string | null; match: boolean | null }> = [];
    const inspect = async (ref?: string) => paperclipReadOnlyContainerStatus('windows', {
      runReadOnlyCommand: async (_exe: string, _args: string[], opts: { readOnly: boolean }) => {
        expect(opts.readOnly).toBe(true);
        return { exitCode: 0, timedOut: false, stdout: JSON.stringify({
          State: { Running: true }, Config: ref == null ? {} : { Image: ref },
        }) };
      },
    });
    for (const [ref, match] of [
      ['ghcr.io/paperclipai/paperclip:2026.916.1', true],
      ['ghcr.io/paperclipai/paperclip:latest', false],
      ['example.invalid/paperclip:2026.916.1', false],
      ['ghcr.io/paperclipai/paperclip@sha256:' + 'b'.repeat(64), null],
      [null, null],
    ] as Array<[string | null, boolean | null]>) {
      const result = await inspect(ref ?? undefined);
      expect(result).toMatchObject({ attempted: true, present: true, running: true,
        imagePinMatch: match, imageDigestVerified: false });
      observed.push({ ref, match: result.imagePinMatch });
    }
    expect(observed).toHaveLength(5);
    const unknown = await paperclipReadOnlyContainerStatus('wsl-ubuntu-interactive-broker', {
      runReadOnlyCommand: async () => { throw new Error('BROKER_MUST_NOT_RUN'); },
    });
    expect(unknown).toMatchObject({ attempted: false, imagePinMatch: null,
      imageDigestVerified: false });
  });


  it('R01 reports Docker-observed host-port exposure without claiming static loopback as runtime proof', async () => {
    const inspect = async (ports?: Record<string, unknown>) => paperclipReadOnlyContainerStatus('windows', {
      runReadOnlyCommand: async (_exe: string, _args: string[], options: { readOnly: boolean }) => {
        expect(options.readOnly).toBe(true);
        return { exitCode: 0, timedOut: false, stdout: JSON.stringify({
          State: { Running: true },
          Config: { Image: 'ghcr.io/paperclipai/paperclip:2026.916.1' },
          NetworkSettings: ports === undefined ? {} : { Ports: ports },
        }) };
      },
    });
    const cases: Array<[string, Record<string, unknown> | undefined, boolean | null]> = [
      ['IPv4 localhost', { '3100/tcp': [{ HostIp: '127.0.0.1', HostPort: '3210' }] }, true],
      ['IPv6 localhost', { '3100/tcp': [{ HostIp: '::1', HostPort: '3210' }] }, true],
      ['public IPv4', { '3100/tcp': [{ HostIp: '0.0.0.0', HostPort: '3210' }] }, false],
      ['public IPv6', { '3100/tcp': [{ HostIp: '::', HostPort: '3210' }] }, false],
      ['default all-interface bind', { '3100/tcp': [{ HostIp: '', HostPort: '3210' }] }, false],
      ['wrong host port', { '3100/tcp': [{ HostIp: '127.0.0.1', HostPort: '3100' }] }, false],
      ['extra published port', { '3100/tcp': [{ HostIp: '127.0.0.1', HostPort: '3210' }],
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] }, false],
      ['Docker port mapping unknown', undefined, null],
      ['malformed Docker binding', { '3100/tcp': [{ HostIp: '127.0.0.1' }] }, null],
      ['no port published', { '3100/tcp': null }, null],
      ['other EXPOSE only', { '3100/tcp': [{ HostIp: '127.0.0.1', HostPort: '3210' }],
        '3000/tcp': null }, true],
    ];
    for (const [label, ports, expected] of cases) {
      const result = await inspect(ports);
      expect(result.port3210LoopbackBinding, label).toBe(expected);
      expect(result.imageDigestVerified, label).toBe(false);
    }
    const broker = await paperclipReadOnlyContainerStatus('wsl-ubuntu-interactive-broker', {
      runReadOnlyCommand: async () => { throw new Error('BROKER_MUST_NOT_RUN'); },
    });
    expect(broker).toMatchObject({ attempted: false, port3210LoopbackBinding: null });
    const absent = await paperclipReadOnlyPreflight({
      checkRoot: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      inspectDocker: async () => ({ kind: 'windows', version: '27.0', error: null }),
      inspectPort: async () => ({ reachable: false }),
      inspectBroker: async () => ({ ready: false }),
      inspectContainer: async () => { throw new Error('SHOULD_NOT_INSPECT_ABSENT_LAB'); },
    });
    expect(absent.container.port3210LoopbackBinding).toBeNull();
  });

  it('R01 supports direct WSL without broker and does not fabricate unavailable container state', async () => {
    const calls: string[] = [];
    const wsl = await paperclipReadOnlyContainerStatus('wsl-ubuntu', {
      runReadOnlyCommand: async (exe: string, args: string[], options: { readOnly: boolean }) => {
        calls.push(exe + ':' + args.join(' ') + ':' + options.readOnly);
        return { exitCode: 1, timedOut: false, stdout: '', stderr: 'not found' };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('wsl.exe:--distribution Ubuntu --exec docker inspect tigeriq-paperclip-lab');
    expect(calls[0]).toContain(':true');
    expect(wsl).toMatchObject({ attempted: true, present: null, running: null,
      imageDigestVerified: false, reason: 'CONTAINER_INSPECT_FAILED' });
    const broker = await paperclipReadOnlyContainerStatus('wsl-ubuntu-interactive-broker', {
      runReadOnlyCommand: async () => { throw new Error('BROKER_MUST_NOT_RUN'); },
    });
    expect(broker).toMatchObject({ attempted: false, present: null, running: null,
      reason: 'DIRECT_DOCKER_TRANSPORT_UNAVAILABLE' });
  });

  it('R01 attaches real container probe result only when Lab exists and Docker is available', async () => {
    let inspected = 0;
    const result = await paperclipReadOnlyPreflight({
      checkRoot: async () => {},
      inspectDocker: async () => ({ kind: 'windows', version: '27.0', error: null }),
      inspectPort: async () => ({ reachable: false }),
      inspectDisk: async () => ({ bavail: 2, bsize: 4, blocks: 10 }),
      inspectBroker: async () => ({ ready: false }),
      inspectContainer: async () => {
        inspected++;
        return { attempted: true, present: true, running: true, imageRef: 'tag', imageDigestVerified: false, reason: null };
      },
    });
    expect(inspected).toBe(1);
    expect(result.container).toMatchObject({ attempted: true, present: true, running: true });
    const missing = await paperclipReadOnlyPreflight({
      checkRoot: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      inspectDocker: async () => ({ kind: 'windows', version: '27.0', error: null }),
      inspectPort: async () => ({ reachable: false }),
      inspectBroker: async () => ({ ready: false }),
      inspectContainer: async () => { throw new Error('CONTAINER_MUST_NOT_BE_PROBED_WITH_MISSING_ROOT'); },
    });
    expect(missing.container).toMatchObject({ attempted: false, present: null,
      imagePinMatch: null, imageDigestVerified: false, reason: 'LAB_ROOT_MISSING' });
  });


});
