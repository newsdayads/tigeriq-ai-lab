import { describe, it, expect } from 'vitest';
import { runDirectCdpArchive } from '../apps/chrome-controller/runtime/direct-cdp-archive.mjs';

describe('NV03 Security Challenge Abort and Receipt Mismatch Guard', () => {
  it('aborts with safe-stop on security challenge / captcha', async () => {
    const dispatch = async () => {
      throw new Error('CAPTCHA_DETECTED');
    };
    const getJson = async () => ({
      previousJob: {
        workerId: 'NV03',
        status: 'DONE',
        evidence: [{ source: 'GITHUB', ref: 'https://github.com/owner/repo/pull/1', verifiedAt: new Date().toISOString() }]
      }
    });

    await expect(
      runDirectCdpArchive({
        workerId: 'NV03',
        target: { url: 'https://chatgpt.com/c/12345' },
        payload: { receiptRef: 'https://github.com/owner/repo/pull/1' },
        getJson,
        dispatch,
        uiState: async () => ({}),
        evaluate: async () => ({ ok: true }),
        sleep: async () => {}
      })
    ).rejects.toThrow(/SAFE_STOP_SECURITY_CHALLENGE/);
  });

  it('rejects when job state is forbidden (e.g. WORKING)', async () => {
    const getJson = async () => ({
      previousJob: {
        workerId: 'NV03',
        status: 'WORKING',
        evidence: [{ source: 'GITHUB', ref: 'https://github.com/owner/repo/pull/1', verifiedAt: new Date().toISOString() }]
      }
    });

    await expect(
      runDirectCdpArchive({
        workerId: 'NV03',
        target: { url: 'https://chatgpt.com/c/12345' },
        payload: { receiptRef: 'https://github.com/owner/repo/pull/1' },
        getJson,
        dispatch: async () => ({ ok: true }),
        uiState: async () => ({}),
        evaluate: async () => ({ ok: true }),
        sleep: async () => {}
      })
    ).rejects.toThrow(/ARCHIVE_JOB_STATE_FORBIDDEN|EXTERNAL_DONE_EVIDENCE/);
  });
});
