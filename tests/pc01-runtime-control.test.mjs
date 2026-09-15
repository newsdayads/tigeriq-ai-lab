import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  actionTimeoutMs,
  assertLoopbackBaseUrl,
  collectSnapshot,
  requestJson,
  resolveActionPath,
  tailJsonl,
} from '../scripts/pc-worker/pc01-runtime-control.mjs';

const tempDirs = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempLog(lines) {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-runtime-control-'));
  tempDirs.push(dir);
  const path = join(dir, 'chrome-controller.jsonl');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

describe('pc01 runtime control safety', () => {
  it('allows loopback HTTP only', () => {
    expect(assertLoopbackBaseUrl('http://127.0.0.1:8798')).toBe('http://127.0.0.1:8798');
    expect(() => assertLoopbackBaseUrl('https://example.com')).toThrow('RUNTIME_CONTROL_LOOPBACK_ONLY');
  });

  it('maps only allowlisted controller actions', () => {
    expect(resolveActionPath('resume')).toBe('/api/resume');
    expect(resolveActionPath('layout', 'NV05')).toBe('/api/workers/NV05/layout');
    expect(() => resolveActionPath('kill', 'NV05')).toThrow('RUNTIME_CONTROL_ACTION_NOT_ALLOWED');
    expect(() => resolveActionPath('layout', 'NV99')).toThrow('RUNTIME_CONTROL_ACTION_NOT_ALLOWED');
  });

  it('uses a longer but bounded timeout only for worker start', () => {
    expect(actionTimeoutMs('start')).toBe(120_000);
    expect(actionTimeoutMs('layout')).toBe(15_000);
    expect(actionTimeoutMs('resume')).toBe(15_000);
  });

  it('uses the state endpoint without shelling out', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, method: init.method });
      return new Response(JSON.stringify({ workers: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await expect(requestJson('/api/state', { fetchImpl })).resolves.toEqual({ workers: [] });
    expect(seen).toEqual([{ url: 'http://127.0.0.1:8798/api/state', method: 'GET' }]);
  });
});

describe('pc01 runtime control snapshot', () => {
  it('tails JSONL directly through Node fs', async () => {
    const logPath = await tempLog(['{"event":"A"}', '{"event":"B"}', '{"event":"C"}']);
    await expect(tailJsonl(logPath, 2)).resolves.toEqual([{ event: 'B' }, { event: 'C' }]);
  });

  it('collects state and recent events in one snapshot', async () => {
    const logPath = await tempLog(['{"event":"READY"}']);
    const fetchImpl = async () => new Response(JSON.stringify({ paused: false, workers: [{ id: 'NV05', status: 'READY' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const snapshot = await collectSnapshot({ logPath, logTail: 1, fetchImpl });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.state.workers[0]).toMatchObject({ id: 'NV05', status: 'READY' });
    expect(snapshot.recentEvents).toEqual([{ event: 'READY' }]);
    expect(snapshot.elapsedMs).toBeTypeOf('number');
  });

  it('contains no child-process or PowerShell dependency', async () => {
    const source = await readFile('scripts/pc-worker/pc01-runtime-control.mjs', 'utf8');
    expect(source).not.toMatch(/node:child_process|powershell|cmd\.exe|Start-Sleep/i);
  });
});
