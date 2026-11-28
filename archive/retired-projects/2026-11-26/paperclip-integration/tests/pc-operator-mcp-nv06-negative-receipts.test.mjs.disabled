import { describe, it, expect, vi } from 'vitest';
import { registerPcOperatorTools } from '../apps/tigeriq-core/pc-operator-mcp.mjs';

// GH-2054: isolated source-contract checks only. No real PC01, auth, lease, or Docker calls.
function createInstallHarness({ heartbeatResults = [true, true], releaseResult = true, nativeReceipt } = {}) {
  const executePcAction = vi.fn().mockResolvedValue(nativeReceipt ?? {
    ok: true,
    data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' },
  });
  const leaseDb = { query: vi.fn() };
  const heartbeatValues = [...heartbeatResults];
  const leaseApi = {
    acquire: vi.fn(async (_db, spec) => ({
      resource_id: spec.resourceId,
      work_id: spec.workId,
      lease_token: 'test-only-secret-never-publish',
      lease_until: new Date(Date.now() + 120_000).toISOString(),
    })),
    heartbeat: vi.fn(async () => heartbeatValues.length ? heartbeatValues.shift() : true),
    release: vi.fn().mockResolvedValue(releaseResult),
  };
  const server = { tool: vi.fn() };
  registerPcOperatorTools(server, executePcAction, {
    allowMutation: true,
    leaseDb,
    leaseApi,
  });
  const registration = server.tool.mock.calls.find(([name]) => name === 'paperclip_lab_broker_install');
  if (!registration) throw new Error('GH2054_MCP_BROKER_INSTALL_NOT_REGISTERED');
  return { install: registration[3], executePcAction, leaseApi };
}

function parseFailedReceipt(response) {
  expect(response.isError).toBe(true);
  const receipt = JSON.parse(response.content[0].text);
  expect(receipt.ok).toBe(false);
  expect(receipt.workOrderId).toBe(2054);
  expect(receipt.resourceScope).toBe('TIGERIQ_PAPERCLIP_LAB_PC01_EXISTING_SANDBOX_20261018');
  expect(receipt.targetStepId).toBe('R07');
  expect(receipt.completedStepId).toBeNull();
  expect(response.content[0].text).not.toContain('test-only-secret-never-publish');
  return receipt;
}

describe('GH-2054 NV06 broker installation: negative receipt and lease gates', () => {
  it('denies native installation when the initial atomic lease heartbeat fails', async () => {
    const { install, executePcAction, leaseApi } = createInstallHarness({
      heartbeatResults: [false],
    });
    const receipt = parseFailedReceipt(await install());
    expect(receipt.reason).toBe('NV06_SHARED_LEASE_NOT_FENCED');
    expect(receipt.leaseVerified).toBe(true);
    expect(receipt.leaseReleased).toBe(true);
    expect(leaseApi.acquire).toHaveBeenCalledOnce();
    expect(leaseApi.release).toHaveBeenCalledOnce();
    expect(executePcAction).not.toHaveBeenCalled();
  });

  it('does not mark R07 complete if the atomic lease is lost after a native action', async () => {
    const { install, executePcAction, leaseApi } = createInstallHarness({
      heartbeatResults: [true, false],
    });
    const receipt = parseFailedReceipt(await install());
    expect(receipt.reason).toBe('NV06_SHARED_LEASE_LOST');
    expect(receipt.leaseVerified).toBe(true);
    expect(receipt.leaseReleased).toBe(true);
    expect(leaseApi.heartbeat).toHaveBeenCalledTimes(2);
    expect(executePcAction).toHaveBeenCalledOnce();
    expect(leaseApi.release).toHaveBeenCalledOnce();
  });

  it('does not mark R07 complete when a successful native call cannot release its lease', async () => {
    const { install, executePcAction, leaseApi } = createInstallHarness({
      releaseResult: false,
    });
    const receipt = parseFailedReceipt(await install());
    expect(receipt.reason).toBe('NV06_SHARED_LEASE_RELEASE_UNVERIFIED');
    expect(receipt.leaseVerified).toBe(true);
    expect(receipt.leaseReleased).toBe(false);
    expect(executePcAction).toHaveBeenCalledOnce();
    expect(leaseApi.release).toHaveBeenCalledOnce();
  });

  it('denies native success when the broker install receipt does not confirm installation', async () => {
    const { install, executePcAction, leaseApi } = createInstallHarness({
      nativeReceipt: {
        ok: true,
        data: { installed: false, r07SourceVerified: false, dockerVersion: '' },
      },
    });
    const receipt = parseFailedReceipt(await install());
    expect(receipt.reason).toBe('NATIVE_BROKER_INSTALL_NOT_ACCEPTED');
    expect(receipt.leaseVerified).toBe(true);
    expect(receipt.leaseReleased).toBe(true);
    expect(executePcAction).toHaveBeenCalledOnce();
    expect(leaseApi.release).toHaveBeenCalledOnce();
  });
});
