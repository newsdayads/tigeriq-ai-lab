import { afterEach, describe, expect, it, vi } from 'vitest';

function responseJson(value, model) {
  return new Response(JSON.stringify({
    model,
    provider: model.startsWith('google/') ? 'google' : 'openai',
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { total_tokens: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function saveEnv() { return { ...process.env }; }
function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}

describe('Web Control cloud workforce', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('executes, independently reviews, judges, and cryptographically attests server gates', async () => {
    const saved = saveEnv();
    Object.assign(process.env, {
      AI_GATEWAY_API_KEY: 'test-only-gateway-key',
      TIGERIQ_OWNER_SESSION_SECRET: 'test-owner-session-secret',
      TIGERIQ_CLOUD_EXECUTOR: 'on',
    });
    let calls = 0;
    vi.stubGlobal('fetch', async (_input, init = {}) => {
      calls += 1;
      const request = JSON.parse(String(init.body || '{}'));
      const model = String(request.model || 'unknown');
      if (calls === 1) return responseJson({ status: 'completed', result: '42', evidenceSummary: 'Computed answer is present in the result.' }, model);
      if (calls === 2) return responseJson({ pass: true, rationale: 'Result answers the bounded instruction and evidence is present.' }, model);
      if (calls === 3) return responseJson({ pass: true, rationale: 'Reviewer passed and evidence is concrete.' }, model);
      throw new Error('unexpected gateway call');
    });
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudExecutorEnabled()).toBe(true);
      const execution = await workforce.executeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.' });
      expect(execution).toEqual(expect.objectContaining({ status: 'completed', result: '42' }));
      const review = await workforce.reviewCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary });
      expect(review.pass).toBe(true);
      const judge = await workforce.judgeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary, review });
      expect(judge.pass).toBe(true);
      expect(calls).toBe(3);

      const ref = `sha256:${'a'.repeat(64)}`;
      const signed = workforce.signServerGateComment(`REVIEW_PASS\nEVIDENCE_REF ${ref}\nREVIEW_ROLE independent-cloud-reviewer`);
      expect(workforce.verifyServerGateComment(signed)).toBe(true);
      expect(workforce.verifyServerGateComment(signed.replace('REVIEW_PASS', 'JUDGE_PASS'))).toBe(false);
      expect(workforce.verifyServerGateComment(`REVIEW_PASS\nEVIDENCE_REF ${ref}`)).toBe(false);
    } finally { restoreEnv(saved); }
  });

  it('keeps the cloud executor off by default outside Vercel unless explicitly enabled', async () => {
    const saved = saveEnv();
    delete process.env.VERCEL;
    delete process.env.TIGERIQ_CLOUD_EXECUTOR;
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudExecutorEnabled()).toBe(false);
    } finally { restoreEnv(saved); }
  });
});
