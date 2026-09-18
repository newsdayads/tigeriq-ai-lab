import { describe, it, expect, vi } from 'vitest';
import { runDirectCdpArchive } from '../apps/chrome-controller/runtime/direct-cdp-archive.mjs';

describe('NV02 Archive Success and Receipt Verification', () => {
  it('successfully sends exact string 'lưu' and verifies fresh durable receipt', async () => {
    const dispatchedTexts: string[] = [];
    const dispatch = async (text: string) => {
      dispatchedTexts.push(text);
      return { ok: true };
    };
    const getJson = async () => ({
      previousJob: {
        workerId: 'NV02',
        status: 'DONE',
        evidence: [{ source: 'GITHUB', ref: 'https://github.com/owner/repo/pull/1', verifiedAt: new Date().toISOString() }]
      }
    });
    const evaluate = async () => ({ ok: true, status: 'ARCHIVED' });
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        receipt: {
          receiptRef: 'https://github.com/owner/repo/issues/788',
          checkpointRef: 'https://github.com/owner/repo/commit/abc',
          verifiedAt: new Date(Date.now() + 5000).toISOString()
        }
      })
    });

    const result = await runDirectCdpArchive({
      workerId: 'NV02',
      target: { url: 'https://chatgpt.com/c/12345' },
      payload: { receiptRef: 'https://github.com/owner/repo/pull/1' },
      getJson,
      dispatch,
      uiState: async () => ({}),
      evaluate,
      fetchImpl,
      sleep: async () => {}
    });

    expect(dispatchedTexts).toEqual(['lưu']);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ARCHIVED');
    expect(result.receiptRef).toBe('https://github.com/owner/repo/issues/788');
  });
});
