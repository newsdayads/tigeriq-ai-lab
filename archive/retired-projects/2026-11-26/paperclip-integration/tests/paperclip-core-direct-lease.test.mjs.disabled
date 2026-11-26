import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PAPERCLIP_DIRECT_SCOPE,
  PAPERCLIP_NV06_RESOURCE,
  paperclipBrokerNativeAccepted,
  executeFencedPaperclipBrokerInstall,
} from '../apps/tigeriq-core/paperclip-direct-lease.mjs';

// GH-2054: isolated native lease contract; no PC01 calls, Docker, or credentials.
function harness({
  scope = PAPERCLIP_DIRECT_SCOPE,
  ownerDirect = true,
  issueNumber = 2054,
  leaseMissing = false,
  heartbeatValues = [true, true],
  releaseOk = true,
  nativeReceipt = {
    ok: true,
    data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' },
  },
} = {}) {
  const job = {
    id: 'JOB-2054-LEASE-TEST',
    objective_metadata: {
      issueNumber,
      resourceScope: scope,
      ownerDirect,
      pcOperatorDirectAction: { action: 'paperclip_lab_broker_install' },
    },
  };
  const db = { query: vi.fn() };
  const execute = vi.fn().mockResolvedValue(nativeReceipt);
  const acquire = vi.fn(async (_db, spec) => leaseMissing ? null : ({
    resource_id: spec.resourceId,
    work_id: spec.workId,
    lease_token: 'sensitive-test-lease-token',
    lease_until: new Date(Date.now() + 120000).toISOString(),
  }));
  const queue = [...heartbeatValues];
  const heartbeat = vi.fn(async () => queue.length ? queue.shift() : true);
  const release = vi.fn().mockResolvedValue(releaseOk);
  const call = () => executeFencedPaperclipBrokerInstall({
    job,db,execute,acquire,heartbeat,release,
  });
  return { job, execute, acquire, heartbeat, release, call };
}

describe('GH-2054 fenced Core direct Paperclip broker install', () => {
  it('Core direct dispatch calls the NV06 shared lease path, not the unguarded native action', () => {
    const source = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');
    expect(source).toContain("const receipt=action.action==='paperclip_lab_broker_install'");
    expect(source).toContain('executeFencedPaperclipBrokerInstall({');
    expect(source).toContain('acquire:acquireSharedResourceLease,heartbeat:heartbeatSharedResourceLease');
    expect(source).toContain('release:releaseSharedResourceLease');
  });

  it('accepts only fresh running-source and Docker attestation, not generic HTTP 200', () => {
    expect(paperclipBrokerNativeAccepted({ ok: true, data: { status: 200 } })).toBe(false);
    expect(paperclipBrokerNativeAccepted({ ok: true, data: {
      installed: true, r07SourceVerified: false, dockerVersion: '27.0',
    } })).toBe(false);
    expect(paperclipBrokerNativeAccepted({ ok: true, data: {
      installed: true, r07SourceVerified: true, dockerVersion: '   ',
    } })).toBe(false);
  });

  it('accepts one scoped native install only after NV06 atomic claim and both heartbeats, then releases', async () => {
    const h=harness();
    const r=await h.call();
    expect(r.leaseVerified).toBe(true);
    expect(r.leaseReleased).toBe(true);
    expect(r.receipt.data.dockerVersion).toBe('27.0');
    expect(h.acquire).toHaveBeenCalledOnce();
    expect(h.acquire.mock.calls[0][1]).toMatchObject({
      employeeId: 'NV06',resourceId: PAPERCLIP_NV06_RESOURCE,
      workId: h.job.id,lane: 'core_pc_direct',
      metadata: { workOrderId: 2054,resourceScope: PAPERCLIP_DIRECT_SCOPE,targetStepId: 'R07' },
    });
    expect(h.heartbeat).toHaveBeenCalledTimes(2);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute).toHaveBeenCalledWith({ action: 'paperclip_lab_broker_install' });
    expect(h.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toContain('sensitive-test-lease-token');
  });

  it.each([
    ['wrong Work Order', { issueNumber: 4456 }],
    ['other scope', { scope: 'OTHER_PC01_WORKSTREAM' }],
    ['no Owner authority', { ownerDirect: false }],
  ])('denies %s before acquiring a native lease', async (_name, opts) => {
    const h=harness(opts);
    await expect(h.call()).rejects.toThrow('PAPERCLIP_CORE_DIRECT_SCOPE_NOT_AUTHORIZED');
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('does not mutate PC01 when the shared lease is busy', async () => {
    const h=harness({ leaseMissing: true });
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_BUSY');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
  });

  it('releases but never executes native install when fencing heartbeat is denied', async () => {
    const h=harness({ heartbeatValues: [false] });
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_NOT_FENCED');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('rejects a native false-success and releases the claim', async () => {
    const h=harness({ nativeReceipt: {
      ok: true,data: { installed: false,r07SourceVerified: false,dockerVersion: '' },
    } });
    await expect(h.call()).rejects.toThrow('NATIVE_BROKER_INSTALL_NOT_ACCEPTED');
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('rejects a lease lost after the native action even with a healthy Docker receipt', async () => {
    const h=harness({ heartbeatValues: [true, false] });
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_LOST');
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('fails closed if a successful native action cannot release the owned lease', async () => {
    const h=harness({ releaseOk: false });
    await expect(h.call()).rejects.toThrow('NV06_SHARED_LEASE_RELEASE_UNVERIFIED');
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('redacts raw lease errors rather than leaking the token', async () => {
    const h=harness();
    h.acquire.mockRejectedValue(new Error('remote internal text sensitive-test-lease-token'));
    await expect(h.call()).rejects.toThrow('NV06_INSTALL_OR_LEASE_ERROR');
    expect(h.execute).not.toHaveBeenCalled();
  });
});
