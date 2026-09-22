import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  assertLoopbackBaseUrl,
  executeRuntimeAction,
  redactSensitive,
  resolveChromeAction,
} from '../apps/openclaw-tigeriq-runtime/bridge.mjs';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('OpenClaw TigerIQ bounded runtime bridge', () => {
  it('accepts only loopback HTTP and fixed runtime ports', () => {
    expect(assertLoopbackBaseUrl('http://127.0.0.1:8795', 8795)).toBe('http://127.0.0.1:8795');
    expect(() => assertLoopbackBaseUrl('https://example.com:8795', 8795)).toThrow('TIGERIQ_RUNTIME_LOOPBACK_ONLY');
    expect(() => assertLoopbackBaseUrl('http://127.0.0.1:9999', 8795)).toThrow('TIGERIQ_RUNTIME_PORT_NOT_ALLOWED');
  });

  it('keeps Chrome actions inside the existing allowlist', () => {
    expect(resolveChromeAction('focus', 'NV02')).toBe('/api/workers/NV02/focus');
    expect(resolveChromeAction('pause')).toBe('/api/pause');
    expect(() => resolveChromeAction('exec', 'NV02')).toThrow('TIGERIQ_RUNTIME_CHROME_ACTION_NOT_ALLOWED');
    expect(() => resolveChromeAction('focus', 'NV99')).toThrow('TIGERIQ_RUNTIME_CHROME_ACTION_NOT_ALLOWED');
  });

  it('reads compact Core truth without shell and redacts sensitive fields', async () => {
    const fetchImpl = vi.fn(async () => response({
      ok: true,
      pid: 42,
      resources: [{ employee_id: 'NV11', provider: 'groq', model: 'm', health_state: 'ONLINE', credential_state: 'READY', apiKey: 'gsk_1234567890abcdef' }],
      objectives: [{ id: 'OBJ-1', status: 'active', summary: 'work', updated_at: 'now' }],
    }));
    const result = await executeRuntimeAction({ action: 'core_status' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8795/api/status', expect.objectContaining({ method: 'GET' }));
    expect(result.evidence).toEqual({
      transport: 'loopback-http',
      shell: false,
      arbitraryFileAccess: false,
      arbitraryCommandExecution: false,
    });
    expect(result.data.resources[0]).toEqual(expect.objectContaining({ employeeId: 'NV11', provider: 'groq' }));
    expect(JSON.stringify(result)).not.toContain('gsk_1234567890abcdef');
  });

  it('invokes only a typed Chrome Controller endpoint', async () => {
    const fetchImpl = vi.fn(async () => response({ ok: true, mode: 'focused', token: 'sk-1234567890abcdef' }));
    const result = await executeRuntimeAction(
      { action: 'chrome_action', command: 'focus', workerId: 'NV03' },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8798/api/workers/NV03/focus',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.stringify(result)).not.toContain('sk-1234567890abcdef');
  });

  it('submits a bounded Core objective through typed HTTP', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      expect(payload).toEqual({ objective: 'Verify runtime bridge canary', priority: 'P0' });
      return response({ ok: true, id: 'OBJ-TEST' });
    });
    const result = await executeRuntimeAction(
      { action: 'submit_objective', objective: 'Verify runtime bridge canary', priority: 'P0' },
      { fetchImpl },
    );
    expect(result.data).toEqual({ ok: true, id: 'OBJ-TEST' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not expose arbitrary shell or file mutation in the plugin source', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/dist/index.js', import.meta.url), 'utf8');
    const bridge = await readFile(new URL('../apps/openclaw-tigeriq-runtime/bridge.mjs', import.meta.url), 'utf8');
    const joined = `${source}\n${bridge}`;
    expect(joined).not.toMatch(/child_process|powershell|cmd\.exe|spawn\s*\(|execFile\s*\(/i);
    expect(joined).not.toMatch(/readFile\s*\(|writeFile\s*\(|unlink\s*\(|rename\s*\(/i);
  });

  it('redacts nested credential-like fields and token-shaped text', () => {
    const value = redactSensitive({
      token: 'abc',
      nested: { password: 'pw', message: 'key gsk_1234567890abcdef' },
    });
    expect(value.token).toBe('[REDACTED]');
    expect(value.nested.password).toBe('[REDACTED]');
    expect(value.nested.message).not.toContain('gsk_1234567890abcdef');
  });
});
