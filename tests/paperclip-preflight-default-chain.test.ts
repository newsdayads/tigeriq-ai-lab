import { describe, expect, it, vi } from 'vitest';

// A sealed OS boundary: exercise the real preflight -> Docker/WSL -> broker
// call chain while forbidding real PC01, filesystem writes, process starts or TCP.
const state = vi.hoisted(() => ({
  rootExists: false,
  rootSymlink: false,
  brokerReady: false,
  directDockerReady: false,
  releaseReady: false,
  inspectBindings: null as null | Record<string, unknown>,
  inspectArgs: [] as string[][],
  lstatPaths: [] as string[],
  spawned: [] as string[],
  writeAttempts: [] as string[],
  socketConnects: 0,
}));

const ROOT = String.raw`D:\TigerIQ-Paperclip-Lab`;
const HEARTBEAT = ROOT + String.raw`\broker\heartbeat.json`;
const CONFIG = ROOT + String.raw`\config`;
const RELEASE = CONFIG + String.raw`\release.json`;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const denied = (name: string) => (...args: unknown[]) => {
    state.writeAttempts.push(name + ':' + String(args[0] ?? ''));
    throw new Error('TEST_FS_MUTATION_DENIED');
  };
  const missing = () => Object.assign(new Error('File missing'), { code: 'ENOENT' });
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: denied('mkdir'),
      writeFile: denied('writeFile'),
      rm: denied('rm'),
      rename: denied('rename'),
      unlink: denied('unlink'),
      lstat: async (p: string) => {
        const target = String(p);
        state.lstatPaths.push(target);
        if (!state.rootExists) throw missing();
        if (target === ROOT) return {
          isDirectory: () => !state.rootSymlink,
          isFile: () => false,
          isSymbolicLink: () => state.rootSymlink,
        };
        if (target === HEARTBEAT && state.brokerReady) return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
        if (target === CONFIG && state.releaseReady) return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        };
        if (target === RELEASE && state.releaseReady) return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
        throw missing();
      },
      realpath: async (p: string) => String(p),
      readFile: async (p: string) => {
        if (String(p) === RELEASE && state.releaseReady) return JSON.stringify({
          release: 'v2026.916.1',
          sourceCommit: 'd554c4789ed3930f8a53ac9fdf6503b3187097da',
          imageDigest: 'ghcr.io/paperclipai/paperclip@sha256:' + 'a'.repeat(64),
        });
        if (String(p) !== HEARTBEAT || !state.brokerReady) throw missing();
        return JSON.stringify({
          schema: 'TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1',
          distro: 'Ubuntu',
          version: '1.7-openai-device-auth',
          sessionId: 123,
          user: 'test-only',
          wslKeepaliveRunning: true,
          wslKeepalivePid: 456,
          at: new Date().toISOString(),
        });
      },
      statfs: async () => ({ bavail: 2, bsize: 4096, blocks: 8 }),
    },
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    spawn: (exe: string, args: string[] = []) => {
      state.spawned.push(String(exe));
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => {
        if (state.directDockerReady && exe === 'docker.exe' && args[0] === 'version') {
          child.stdout.emit('data', Buffer.from('27.5.0\n'));
          child.emit('close', 0);
          return;
        }
        if (state.directDockerReady && exe === 'docker.exe' && args[0] === 'inspect') {
          state.inspectArgs.push([...args]);
          child.stdout.emit('data', Buffer.from(JSON.stringify({
            State: { Running: true },
            Config: { Image: 'ghcr.io/paperclipai/paperclip:2026.916.1' },
            NetworkSettings: state.inspectBindings === null
              ? {} : { Ports: state.inspectBindings },
          })));
          child.emit('close', 0);
          return;
        }
        child.emit('close', 1);
      });
      return child;
    },
  };
});

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  const { EventEmitter } = await import('node:events');
  class IsolatedSocket extends EventEmitter {
    setTimeout(_ms: number) { return this; }
    destroy() { return this; }
    connect(_port: number, _host: string) {
      state.socketConnects++;
      queueMicrotask(() => this.emit('error', { code: 'ECONNREFUSED' }));
      return this;
    }
  }
  return { ...actual, default: { Socket: IsolatedSocket } };
});

// @ts-ignore — Existing native .mjs API intentionally has no TS declaration.
import { paperclipReadOnlyPreflight, executePaperclipLabAction, paperclipUnverifiedDockerHealth, paperclipHealthFailureClass } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

describe('Paperclip R01 production-default preflight call chain (isolated OS)', () => {
  it('returns missing-root without mkdir, spawn or broker-file writes', async () => {
    state.rootExists = false;
    state.rootSymlink = false;
    state.brokerReady = false;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const result = await paperclipReadOnlyPreflight();
    expect(result.rootPresent).toBe(false);
    expect(result.disk).toBeNull();
    expect(result.docker.ok).toBe(false);
    expect(result.port3210.reachable).toBe(false);
    expect(state.lstatPaths).toContain(ROOT);
    expect(state.spawned).toEqual([]);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(1);
  });

  it('on existing root, probes Docker/WSL without writing broker requests', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = true;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const result = await paperclipReadOnlyPreflight();
    expect(result.rootPresent).toBe(true);
    expect(result.disk).toEqual({ freeBytes: 8192, totalBytes: 32768 });
    expect(result.docker.error).toBe('BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT');
    expect(result.container).toMatchObject({
      attempted:false,present:null,running:null,reason:'DOCKER_UNVERIFIED_READ_ONLY',
      imageDigestVerified:false,
    });
    expect(result.docker.broker.ready).toBe(true);
    expect(state.spawned).toEqual(['docker.exe', 'wsl.exe']);
    expect(state.lstatPaths).toContain(HEARTBEAT);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(1);
  });

  it('rejects symlinked Lab root before Docker, WSL and port probes', async () => {
    state.rootExists = true;
    state.rootSymlink = true;
    state.brokerReady = false;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;
    await expect(paperclipReadOnlyPreflight()).rejects.toThrow('ROOT_SYMLINK_BLOCKED');
    expect(state.spawned).toEqual([]);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(0);
  });

  it('runs the actual typed R01 executor entrypoint without writing to the Lab', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = true;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const result = await executePaperclipLabAction({ action: 'paperclip_lab_preflight' });
    expect(result.data.rootPresent).toBe(true);
    expect(result.data.docker.error).toBe('BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT');
    expect(result.data.docker.broker.ready).toBe(true);
    expect(result.evidence).toMatchObject({
      capability: 'paperclip-lab-v2',
      root: ROOT,
      port: 3210,
      loopbackOnly: false,
      loopbackOnlyConfigured: true,
      observedLoopbackBinding: null,
      arbitraryShell: false,
      arbitraryPath: false,
      arbitraryPort: false,
    });
    expect(state.spawned).toEqual(['docker.exe', 'wsl.exe']);
    expect(state.lstatPaths).toContain(HEARTBEAT);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(1);
  });

  it('R01 native receipt never asserts localhost when Docker actually published publicly', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = false;
    state.directDockerReady = true;
    state.inspectArgs.length = 0;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;
    state.inspectBindings = { '3100/tcp': [{ HostIp: '0.0.0.0', HostPort: '3210' }] };

    try {
      const exposed = await executePaperclipLabAction({ action: 'paperclip_lab_preflight' });
      expect(exposed.data.container.port3210LoopbackBinding).toBe(false);
      expect(exposed.evidence).toMatchObject({
        loopbackOnlyConfigured: true,
        observedLoopbackBinding: false,
        loopbackOnly: false,
      });
      expect(state.writeAttempts).toEqual([]);

      state.inspectBindings = { '3100/tcp': [{ HostIp: '127.0.0.1', HostPort: '3210' }] };
      const privateBinding = await executePaperclipLabAction({ action: 'paperclip_lab_preflight' });
      expect(privateBinding.data.container.port3210LoopbackBinding).toBe(true);
      expect(privateBinding.evidence).toMatchObject({
        loopbackOnlyConfigured: true,
        observedLoopbackBinding: true,
        loopbackOnly: true,
      });

      state.inspectBindings = null;
      const unknown = await executePaperclipLabAction({ action: 'paperclip_lab_preflight' });
      expect(unknown.data.container.port3210LoopbackBinding).toBeNull();
      expect(unknown.evidence).toMatchObject({
        loopbackOnlyConfigured: true,
        observedLoopbackBinding: null,
        loopbackOnly: false,
      });
      expect(state.writeAttempts).toEqual([]);
      expect(state.spawned).toEqual(['docker.exe', 'docker.exe', 'docker.exe', 'docker.exe', 'docker.exe', 'docker.exe']);
    } finally {
      state.inspectBindings = null;
      state.directDockerReady = false;
    }
  });

  it('R02 native health evidence never claims live localhost when release pin is missing', async () => {
    state.rootExists = false;
    state.rootSymlink = false;
    state.brokerReady = false;
    state.directDockerReady = false;
    state.inspectBindings = null;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const result = await executePaperclipLabAction({ action: 'paperclip_lab_health' });
    expect(result.data).toMatchObject({ ok: false, reason: 'PIN_NOT_READY' });
    expect(result.evidence).toMatchObject({
      loopbackOnly: false,
      loopbackOnlyConfigured: true,
      observedLoopbackBinding: null,
    });
    expect(state.spawned).toEqual([]);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(0);
  });

  it('R02 health never creates a missing config directory when the Lab root exists', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = false;
    state.directDockerReady = false;
    state.inspectBindings = null;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const result = await executePaperclipLabAction({ action: 'paperclip_lab_health' });
    expect(result.data).toMatchObject({ ok: false, reason: 'PIN_NOT_READY' });
    expect(result.evidence).toMatchObject({ loopbackOnly: false, observedLoopbackBinding: null });
    expect(state.lstatPaths).toContain(ROOT);
    expect(state.lstatPaths).toContain(ROOT + String.raw`\config`);
    expect(state.spawned).toEqual([]);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(0);
  });

  it('R02 rejects broker fallback without writing a broker request when only broker is ready', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = true;
    state.directDockerReady = false;
    state.releaseReady = true;
    state.inspectBindings = null;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const fetchProbe = vi.fn(async (url: string) => {
      expect(url).toBe('http://127.0.0.1:3210/api/health');
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    });
    vi.stubGlobal('fetch', fetchProbe);
    try {
      const result = await executePaperclipLabAction({ action: 'paperclip_lab_health' });
      expect(result.data).toMatchObject({
        ok: false,
        reason: 'DOCKER_UNVERIFIED_READ_ONLY',
        docker: {
          kind: null,
          error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT',
          broker: { ready: true },
        },
        port: { reachable: false },
        http: { reachable: true, status: 200, appOk: true },
        result: {
          portReachable: false, httpReachable: true, httpStatus: 200, httpAppOk: true,
          dockerVerified: false, containerVerified: false, databaseVerified: false,
        },
      });
      expect(result.evidence).toMatchObject({ loopbackOnly: false, observedLoopbackBinding: null });
      expect(fetchProbe).toHaveBeenCalledOnce();
      expect(state.spawned).toEqual(['docker.exe', 'wsl.exe']);
      expect(state.writeAttempts).toEqual([]);
      expect(state.socketConnects).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      state.releaseReady = false;
    }
  });

  it('R02 broker-only helper never promotes HTTP-only health to container or database acceptance', () => {
    const result = paperclipUnverifiedDockerHealth({
      docker: { kind: null, error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT' },
      port: { reachable: true },
      http: { reachable: true, status: 200, appOk: true },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('DOCKER_UNVERIFIED_READ_ONLY');
    expect(result.result).toMatchObject({
      portReachable: true, httpReachable: true, httpStatus: 200, httpAppOk: true,
      dockerVerified: false, containerVerified: false, databaseVerified: false,
    });
  });

  it('R02 distinguishes a skipped read-only broker probe from a real Docker error, without upgrading acceptance', () => {
    const base = {
      port: { reachable: true },
      http: { reachable: true, status: 200, appOk: true },
    };
    const skipped = paperclipUnverifiedDockerHealth({
      ...base,
      docker: { kind: null, error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT' },
    });
    const failed = paperclipUnverifiedDockerHealth({
      ...base,
      docker: { kind: null, error: 'docker executable not found' },
    });
    expect(skipped.reason).toBe('DOCKER_UNVERIFIED_READ_ONLY');
    expect(failed.reason).toBe('DOCKER_UNAVAILABLE');
    expect(paperclipHealthFailureClass(skipped)).toBe('DOCKER_UNVERIFIED_READ_ONLY');
    expect(paperclipHealthFailureClass(failed)).toBe('DOCKER_UNAVAILABLE');
    for (const sample of [skipped, failed]) {
      expect(sample.ok).toBe(false);
      expect(sample.result).toMatchObject({
        httpStatus: 200, httpAppOk: true,
        dockerVerified: false, containerVerified: false, databaseVerified: false,
      });
    }
  });

  it('R02 broker-only helper reports HTTP failure without inventing health', () => {
    const result = paperclipUnverifiedDockerHealth({
      docker: { kind: null, error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT' },
      port: { reachable: false },
      http: { reachable: false, status: null, appOk: false },
    });
    expect(result.ok).toBe(false);
    expect(result.result).toMatchObject({
      portReachable: false, httpReachable: false, httpStatus: null, httpAppOk: false,
      dockerVerified: false, containerVerified: false, databaseVerified: false,
    });
    expect(paperclipUnverifiedDockerHealth({}).ok).toBe(false);
  });

  it('rejects a typed R01 request with extra fields before any IO', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = true;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    await expect(executePaperclipLabAction({
      action: 'paperclip_lab_preflight',
      path: String.raw`C:\Windows\System32`,
    })).rejects.toThrow('TIGERIQ_PAPERCLIP_LAB_ARGUMENT_NOT_ALLOWED');
    expect(state.lstatPaths).toEqual([]);
    expect(state.spawned).toEqual([]);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(0);
  });

  it('follows the typed R01 default direct-Docker inspect chain without OS writes', async () => {
    state.rootExists = true;
    state.rootSymlink = false;
    state.brokerReady = false;
    state.directDockerReady = true;
    state.inspectArgs.length = 0;
    state.lstatPaths.length = 0;
    state.spawned.length = 0;
    state.writeAttempts.length = 0;
    state.socketConnects = 0;

    const result = await executePaperclipLabAction({ action: 'paperclip_lab_preflight' });
    expect(result.data.docker).toMatchObject({ ok: true, transport: 'windows', version: '27.5.0' });
    expect(result.data.container).toMatchObject({
      attempted: true,
      present: true,
      running: true,
      imageRef: 'ghcr.io/paperclipai/paperclip:2026.916.1',
      imageDigestVerified: false,
      reason: null,
    });
    expect(state.inspectArgs).toEqual([[
      'inspect', 'tigeriq-paperclip-lab', '--format', '{{json .}}',
    ]]);
    expect(state.spawned).toEqual(['docker.exe', 'docker.exe']);
    expect(state.lstatPaths).toContain(ROOT);
    expect(state.writeAttempts).toEqual([]);
    expect(state.socketConnects).toBe(1);
  });
});
