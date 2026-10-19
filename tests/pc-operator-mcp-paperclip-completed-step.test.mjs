import { describe, it, expect, vi } from 'vitest';
import { registerPcOperatorTools } from '../apps/tigeriq-core/pc-operator-mcp.mjs';

// GH-2054: contract-only mock harness; never talks to real PC01 or changes a lease.
// completedStepId must attest only an actually accepted native step result.
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
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { docker: { ok: true } } });
    const response = parse(await getHandler('paperclip_lab_preflight', execute)());
    expect(response.ok).toBe(true);
    expect(response.targetStepId).toBe('R01');
    expect(response.completedStepId).toBe('R01');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ action: 'paperclip_lab_preflight' });
  });

  it('does not mark R01 for a failed native Docker probe', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { docker: { ok: false } } });
    const response = parse(await getHandler('paperclip_lab_preflight', execute)());
    expect(response.ok).toBe(false);
    expect(response.completedStepId).toBeNull();
  });

  it('marks R02 only when Docker, container, and database all verify', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { result: { dockerVerified: true, containerVerified: true, databaseVerified: true } },
    });
    const response = parse(await getHandler('paperclip_lab_health', execute)());
    expect(response.ok).toBe(true);
    expect(response.targetStepId).toBe('R02');
    expect(response.completedStepId).toBe('R02');
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

  it('marks R07 only with accepted native installation and verified lease release', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' },
    });
    const { leaseDb, leaseApi } = acceptedLease();
    const response = parse(await getHandler('paperclip_lab_broker_install', execute, {
      allowMutation: true, leaseDb, leaseApi,
    })());
    expect(response.ok).toBe(true);
    expect(response.completedStepId).toBe('R07');
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
