import { describe, it, expect, vi } from 'vitest';
import { registerPcOperatorTools } from '../apps/tigeriq-core/pc-operator-mcp.mjs';

// GH-2054: contract-only mock harness; never talks to real PC01 or changes a lease.
// R01 requires observed preflight coverage; R02/R07 remain incomplete until
// separate heartbeat/restart/dedup acceptance. No real PC01 is touched.
function getHandler(action, execute, options = {}) {
  const server = { tool: vi.fn() };
  registerPcOperatorTools(server, execute, options);
  const registration = server.tool.mock.calls.find(([name]) => name === action);
  expect(registration).toBeDefined();
  return registration[3];
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

function acceptedLease() {
  const leaseDb = { query: vi.fn() };
  const leaseApi = {
    acquire: vi.fn(async (_db, spec) => ({
      resource_id: spec.resourceId,
      work_id: spec.workId,
      lease_token: 'fixture-private-token-do-not-echo',
      lease_until: new Date(Date.now() + 120_000).toISOString(),
    })),
    heartbeat: vi.fn(async () => true),
    release: vi.fn(async () => true),
  };
  return { leaseDb, leaseApi };
}

describe('GH-2054: only accepted MCP native receipts complete a checklist step', () => {
  it('marks R01 only when native Docker preflight is accepted', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: {
      rootPresent: true, docker: { ok: true },
      container: { attempted: true, present: true, running: true, imagePinMatch: true, port3210LoopbackBinding: true },
      port3210: { reachable: true },
      pinned: { release: 'v2026.916.1', image: 'ghcr.io/paperclipai/paperclip:2026.916.1' },
    } });
    const response = parse(await getHandler('paperclip_lab_preflight', execute)());
    expect(response.ok).toBe(true);
    expect(response.targetStepId).toBe('R01');
    expect(response.completedStepId).toBe('R01');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ action: 'paperclip_lab_preflight' });
  });

  it('does not mark R01 when Docker works but required observed container evidence is missing', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { docker: { ok: true } } });
    const response = parse(await getHandler('paperclip_lab_preflight', execute)());
    expect(response.ok).toBe(false);
    expect(response.completedStepId).toBeNull();
  });

  it('checks R02 native health but does not yet complete the broker-heartbeat checklist', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { ok: true, port: { reachable: true }, http: { appOk: true },
        container: { identityOk: true, portBindingOk: true },
        database: { present: true, running: true, healthStatus: 'healthy' } }, 
    });
    const response = parse(await getHandler('paperclip_lab_health', execute)());
    expect(response.ok).toBe(true);
    expect(response.targetStepId).toBe('R02');
    expect(response.completedStepId).toBeNull();
  });

  it('completes R02 only after a real, fresh broker heartbeat accompanies native container, database and HTTP acceptance', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        port: { reachable: true },
        http: { appOk: true },
        container: { identityOk: true, portBindingOk: true },
        database: { present: true, running: true, healthStatus: 'healthy' },
        broker: {
          ready: true,
          version: '1.7-openai-device-auth',
          sessionId: 1,
          ageMs: 1200,
          wslKeepaliveRunning: true,
        },
      },
    });
    const response = parse(await getHandler('paperclip_lab_health', execute)());
    expect(response.ok).toBe(true);
    expect(response.targetStepId).toBe('R02');
    expect(response.completedStepId).toBe('R02');
    expect(execute).toHaveBeenCalledExactlyOnceWith({ action: 'paperclip_lab_health' });
  });

  it.each([
    ['stale heartbeat', { ready: true, version: '1.7-openai-device-auth', sessionId: 1, ageMs: 16000, wslKeepaliveRunning: true }],
    ['missing heartbeat', { ready: false, version: '1.7-openai-device-auth', sessionId: 1, ageMs: 0, wslKeepaliveRunning: true }],
    ['missing keepalive', { ready: true, version: '1.7-openai-device-auth', sessionId: 1, ageMs: 300, wslKeepaliveRunning: false }],
    ['unexpected broker version', { ready: true, version: 'unknown', sessionId: 1, ageMs: 300, wslKeepaliveRunning: true }],
  ])('does not complete R02 with %s', async (_why, broker) => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        port: { reachable: true },
        http: { appOk: true },
        container: { identityOk: true, portBindingOk: true },
        database: { present: true, running: true, healthStatus: 'healthy' },
        broker,
      },
    });
    const response = parse(await getHandler('paperclip_lab_health', execute)());
    expect(response.ok).toBe(false);
    expect(response.completedStepId).toBeNull();
  });

  it('does not mark R02 for HTTP-only health with database unverified', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { result: { dockerVerified: true, containerVerified: true, databaseVerified: false } },
    });
    const response = parse(await getHandler('paperclip_lab_health', execute)());
    expect(response.ok).toBe(false);
    expect(response.completedStepId).toBeNull();
  });

  it('accepts native R07 install evidence but does not mark restart-dedup checklist complete', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' },
    });
    const { leaseDb, leaseApi } = acceptedLease();
    const response = parse(await getHandler('paperclip_lab_broker_install', execute, {
      allowMutation: true, leaseDb, leaseApi,
    })());
    expect(response.ok).toBe(true);
    expect(response.completedStepId).toBeNull();
    expect(response.leaseReleased).toBe(true);
    expect(leaseApi.release).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ action: 'paperclip_lab_broker_install' });
    expect(JSON.stringify(response)).not.toContain('fixture-private-token-do-not-echo');
  });

  it('keeps R07 incomplete when native install reports success but lease cannot release', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' },
    });
    const { leaseDb, leaseApi } = acceptedLease();
    leaseApi.release.mockResolvedValue(false);
    const response = parse(await getHandler('paperclip_lab_broker_install', execute, {
      allowMutation: true, leaseDb, leaseApi,
    })());
    expect(response.ok).toBe(false);
    expect(response.reason).toBe('NV06_SHARED_LEASE_RELEASE_UNVERIFIED');
    expect(response.completedStepId).toBeNull();
  });

  it('keeps R07 incomplete if native broker source or install is unverified', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { installed: false, r07SourceVerified: false, dockerVersion: '' },
    });
    const { leaseDb, leaseApi } = acceptedLease();
    const response = parse(await getHandler('paperclip_lab_broker_install', execute, {
      allowMutation: true, leaseDb, leaseApi,
    })());
    expect(response.ok).toBe(false);
    expect(response.reason).toBe('NATIVE_BROKER_INSTALL_NOT_ACCEPTED');
    expect(response.completedStepId).toBeNull();
  });

  it('keeps R07 incomplete without existing authenticated MCP mutation authority', async () => {
    const execute = vi.fn();
    const response = parse(await getHandler('paperclip_lab_broker_install', execute)());
    expect(response.ok).toBe(false);
    expect(response.reason).toBe('MCP_EXISTING_AUTH_REQUIRED');
    expect(response.completedStepId).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps R07 incomplete and does not execute when shared NV06 lease is busy', async () => {
    const execute = vi.fn();
    const { leaseDb, leaseApi } = acceptedLease();
    leaseApi.acquire.mockResolvedValue(null);
    const response = parse(await getHandler('paperclip_lab_broker_install', execute, {
      allowMutation: true, leaseDb, leaseApi,
    })());
    expect(response.ok).toBe(false);
    expect(response.reason).toBe('NV06_SHARED_LEASE_BUSY');
    expect(response.completedStepId).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
