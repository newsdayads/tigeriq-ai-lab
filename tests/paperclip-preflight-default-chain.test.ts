import { describe, expect, it, vi } from 'vitest';

// A sealed OS boundary: exercise the real preflight -> Docker/WSL -> broker
// call chain while forbidding real PC01, filesystem writes, process starts or TCP.
const state = vi.hoisted(() => ({
  rootExists: false,
  rootSymlink: false,
  brokerReady: false,
  lstatPaths: [] as string[],
  spawned: [] as string[],
  writeAttempts: [] as string[],
  socketConnects: 0,
}));

const ROOT = String.raw`D:\TigerIQ-Paperclip-Lab`;
const HEARTBEAT = ROOT + String.raw`\broker\heartbeat.json`;

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
        throw missing();
      },
      realpath: async (p: string) => String(p),
      readFile: async (p: string) => {
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
    spawn: (exe: string) => {
      state.spawned.push(String(exe));
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => child.emit('close', 1));
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
import { paperclipReadOnlyPreflight } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

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
});
