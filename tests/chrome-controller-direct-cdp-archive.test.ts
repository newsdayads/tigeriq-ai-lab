import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertArchiveAllowed,
  runDirectCdpArchive,
  validateArchiveCommand,
} from '../apps/chrome-controller/runtime/direct-cdp-archive.mjs';

const doneJob = {
  jobId: 'GH-802-TEST', workerId: 'NV02', status: 'DONE',
  evidence: [{ source: 'GITHUB', ref: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/802', verifiedAt: '2026-09-18T00:00:00Z' }],
};

function controllerReader({ state = {}, autopilot = {} }: { state?: any; autopilot?: any } = {}) {
  const stateValue = {
    killed: false, paused: false,
    workers: [{ id: 'NV02', enabled: true, blocked: false, lastHeartbeat: { uiBusy: false, securityBlock: null } }],
    ...state,
  };
  const autopilotValue = {
    state: {}, snapshot: { previousJob: doneJob }, ...autopilot,
  };
  return async (path: string) => path === '/api/state' ? stateValue : autopilotValue;
}

describe('direct CDP archive runtime', () => {
  it('rejects unsupported worker and forged caller receipt before mutation', () => {
    expect(() => validateArchiveCommand('NV04', { receiptRef: 'https://github.com/x/y' })).toThrow('ARCHIVE_SELECTOR_UNVERIFIED:NV04');
    expect(() => validateArchiveCommand('NV02', { receiptRef: 'file:///tmp/fake' })).toThrow('ARCHIVE_DURABLE_RECEIPT_REQUIRED');
  });

  it.each([
    ['killed controller', { state: { killed: true } }, 'ARCHIVE_CONTROLLER_KILLED'],
    ['owner read-only', { state: { paused: true } }, 'ARCHIVE_OWNER_INTERACTION_READ_ONLY'],
    ['disabled worker', { state: { workers: [{ id: 'NV02', enabled: false }] } }, 'ARCHIVE_WORKER_DISABLED:NV02'],
    ['blocked worker', { state: { workers: [{ id: 'NV02', enabled: true, blocked: true, lastHeartbeat: { uiBusy: false } }] } }, 'ARCHIVE_WORKER_BLOCKED:NV02'],
    ['security blocker', { state: { workers: [{ id: 'NV02', enabled: true, blocked: false, lastHeartbeat: { uiBusy: false, securityBlock: 'BLOCKED_REAUTH' } }] } }, 'BLOCKED_REAUTH'],
    ['busy UI', { state: { workers: [{ id: 'NV02', enabled: true, blocked: false, lastHeartbeat: { uiBusy: true } }] } }, 'ARCHIVE_UI_NOT_IDLE'],
    ['pending job', { autopilot: { state: { pendingJobId: 'GH-NEW' } } }, 'ARCHIVE_ACTIVE_JOB_FORBIDDEN'],
    ['running previous job', { autopilot: { snapshot: { previousJob: { jobId: 'GH-RUN', workerId: 'NV02', status: 'RUNNING' } } } }, 'ARCHIVE_ACTIVE_JOB_FORBIDDEN'],
    ['missing DONE evidence', { autopilot: { snapshot: { previousJob: null } } }, 'ARCHIVE_EXTERNAL_DONE_EVIDENCE_REQUIRED'],
  ])('fails closed: %s', async (_name, overrides, expected) => {
    await expect(assertArchiveAllowed('NV02', { getJson: controllerReader(overrides) })).rejects.toThrow(expected);
  });

  it('executes guard -> fresh save -> durable receipt -> re-guard -> archive in order', async () => {
    const events: string[] = [];
    const baseReader = controllerReader();
    const getJson = async (path: string) => { events.push(path === '/api/state' ? 'guard-state' : 'guard-autopilot'); return baseReader(path); };
    const uiValues = [{ uiBusy: true, securityBlock: null }, { uiBusy: false, securityBlock: null }];
    const fetchImpl = async (url: string) => {
      events.push('receipt');
      expect(url).toContain('token=save-token');
      return { ok: true, json: async () => ({ ok: true, status: 'DURABLE', receiptRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/788#issuecomment-test', checkpointRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/802', verifiedAt: '2026-09-18T00:00:10Z' }) } as any;
    };

    const result = await runDirectCdpArchive({
      workerId: 'NV02',
      target: { url: 'https://chatgpt.com/c/802-test' },
      payload: { receiptRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/788#upstream' },
      getJson,
      dispatch: async (text: string) => { events.push('save-dispatch'); expect(text).toContain('TIGERIQ_SAVE_STATUS=DURABLE'); return { ok: true, status: 'SUBMITTED' }; },
      uiState: async () => { events.push('ui-state'); return uiValues.shift() ?? { uiBusy: false, securityBlock: null }; },
      evaluate: async (expression: string) => { events.push('archive-evaluate'); expect(expression).toContain('ARCHIVE_MENU_ITEM_NOT_UNIQUE'); return { ok: true, status: 'ARCHIVED' }; },
      fetchImpl: fetchImpl as any,
      sleep: async () => undefined,
      randomUUID: () => 'save-token',
      saveCompletionOptions: { pollMs: 0, busyObservationPolls: 1, maxPolls: 4 },
      receiptOptions: { delays: [0] },
    });

    expect(result.status).toBe('ARCHIVED');
    expect(result.receiptVerifiedAt).toBe('2026-09-18T00:00:10Z');
    expect(events).toEqual([
      'guard-state', 'guard-autopilot',
      'save-dispatch', 'ui-state', 'ui-state', 'receipt',
      'guard-state', 'guard-autopilot', 'archive-evaluate',
    ]);
  });

  it('blocks missing DONE evidence before save or archive', async () => {
    let mutated = false;
    await expect(runDirectCdpArchive({
      workerId: 'NV02', target: { url: 'https://chatgpt.com/c/802-test' },
      payload: { receiptRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/788' },
      getJson: controllerReader({ autopilot: { snapshot: { previousJob: null } } }),
      dispatch: async () => { mutated = true; return { ok: true }; },
      uiState: async () => ({ uiBusy: false }),
      evaluate: async () => { mutated = true; return { ok: true, status: 'ARCHIVED' }; },
    } as any)).rejects.toThrow('ARCHIVE_EXTERNAL_DONE_EVIDENCE_REQUIRED');
    expect(mutated).toBe(false);
  });

  it('installer preserves credential and atomically rolls bridge + helper back', () => {
    const installer = readFileSync('apps/chrome-controller/runtime/Install-DirectCdpArchive.ps1', 'utf8');
    const module = readFileSync('apps/chrome-controller/runtime/direct-cdp-archive.mjs', 'utf8');
    expect(installer).toContain('BRIDGE_CREDENTIAL_MUTATION_FORBIDDEN');
    expect(installer).toContain('tokenFingerprintBefore');
    expect(installer).toContain('tokenFingerprintAfter');
    expect(installer).toContain('Restore-PreviousFiles');
    expect(installer).toContain('modulePreviouslyExisted');
    expect(installer).toContain("Remove-Item -LiteralPath $moduleTarget");
    expect(installer).toContain('BRIDGE_RESTART_AND_ROLLBACK_HEALTH_FAILED');
    expect(module).not.toContain('NV02_TOKEN');
    expect(module).not.toMatch(/[a-f0-9]{48,}/i);
  });
});
