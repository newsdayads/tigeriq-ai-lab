import { describe, expect, it } from 'vitest';
import { paperclipFixedExecutableForPlatform, resolveDockerTransport } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

describe('Paperclip: WSL system executable on Windows', () => {
  it('uses SystemRoot when present, not the worker PATH', () => {
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'win32', systemRoot: 'C:\\Windows',
    })).toBe('C:\\Windows\\System32\\wsl.exe');
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'win32', systemRoot: 'D:\\Windows',
    })).toBe('D:\\Windows\\System32\\wsl.exe');
  });

  it('uses only the verified fixed Windows directory when restricted NV06 lacks SystemRoot', () => {
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'win32', systemRoot: '',
    })).toBe('C:\\Windows\\System32\\wsl.exe');
  });

  it('leaves other commands and non-Windows hosts untouched', () => {
    expect(paperclipFixedExecutableForPlatform('docker.exe', {
      platform: 'win32', systemRoot: '',
    })).toBe('docker.exe');
    expect(paperclipFixedExecutableForPlatform('wsl.exe', {
      platform: 'linux', systemRoot: '',
    })).toBe('wsl.exe');
  });

  it('rejects unsafe or redirected system roots without arbitrary-executable resolution', () => {
    for (const systemRoot of ['\\\\server\\Windows', 'C:\\Windows\\..\\Temp', 'C:\\Temp']) {
      expect(paperclipFixedExecutableForPlatform('wsl.exe', {
        platform: 'win32', systemRoot,
      })).toBe('wsl.exe');
    }
  });

  it('reports a silent WSL Docker exit code without confusing HTTP 200 with Docker verification', async () => {
    const attempted = [];
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: false,
      runVersionCommand: async (exe, _args, options) => {
        attempted.push({ exe, readOnly: options.readOnly });
        return exe === 'docker.exe'
          ? { exitCode: -1, timedOut: false, stdout: '', stderr: 'spawn docker.exe ENOENT' }
          : { exitCode: 127, timedOut: false, stdout: '', stderr: '' };
      },
      readBrokerStatus: async () => ({ ready: false, reason: 'ENOENT' }),
      probeViaBroker: async () => { throw new Error('MUST_NOT_CREATE_BROKER_REQUEST'); },
    });
    expect(attempted).toEqual([
      { exe: 'docker.exe', readOnly: true },
      { exe: 'wsl.exe', readOnly: true },
    ]);
    expect(result.kind).toBeNull();
    expect(result.error).toContain('WINDOWS_DOCKER: spawn docker.exe ENOENT');
    expect(result.error).toContain('WSL_DOCKER: EXIT_CODE_127');
    expect(result.error).toContain('BROKER: ENOENT');
  });

  it('distinguishes empty successful WSL version and timeout without creating any broker request', async () => {
    const once = (wsl) => resolveDockerTransport(null, {
      allowBrokerProbe: false,
      runVersionCommand: async (exe) => exe === 'docker.exe'
        ? { exitCode: 0, timedOut: false, stdout: '', stderr: '' }
        : wsl,
      readBrokerStatus: async () => ({ ready: false, reason: 'ENOENT' }),
      probeViaBroker: async () => { throw new Error('BROKER_MUTATION_NOT_ALLOWED'); },
    });
    const empty = await once({ exitCode: 0, timedOut: false, stdout: '', stderr: '' });
    expect(empty.error).toContain('WINDOWS_DOCKER: EMPTY_SERVER_VERSION');
    expect(empty.error).toContain('WSL_DOCKER: EMPTY_SERVER_VERSION');
    const timeout = await once({ exitCode: -1, timedOut: true, stdout: '', stderr: '' });
    expect(timeout.error).toContain('WSL_DOCKER: PROBE_TIMEOUT');
  });

  it('distinguishes Windows Docker, WSL Docker and broker errors without mutating host', async () => {
    const called = [];
    const result = await resolveDockerTransport(null, {
      allowBrokerProbe: false,
      runVersionCommand: async (exe, _args, opts) => {
        called.push([exe, opts.readOnly]);
        throw new Error(exe === 'docker.exe' ? 'spawn docker.exe ENOENT' : 'ENOENT');
      },
      readBrokerStatus: async () => ({ ready: false, reason: 'ENOENT' }),
      probeViaBroker: async () => { throw new Error('BROKER_WRITE_FORBIDDEN'); },
    });
    expect(called).toEqual([['docker.exe', true], ['wsl.exe', true]]);
    expect(result.kind).toBeNull();
    expect(result.broker.ready).toBe(false);
    expect(result.error).toContain('WINDOWS_DOCKER: spawn docker.exe ENOENT');
    expect(result.error).toContain('WSL_DOCKER: ENOENT');
    expect(result.error).toContain('BROKER: ENOENT');
  });
});
