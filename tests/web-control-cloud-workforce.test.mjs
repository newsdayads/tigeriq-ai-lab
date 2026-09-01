import { afterEach, describe, expect, it, vi } from 'vitest';

function responseJson(value, model, provider = 'groq') {
  return new Response(JSON.stringify({
    model,
    provider,
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

  it('uses the no-card Groq path to execute, independently review, judge, and attest gates', async () => {
    const saved = saveEnv();
    delete process.env.AI_GATEWAY_API_KEY;
    Object.assign(process.env, {
      GROQ_API_KEY: 'test-only-groq-key',
      TIGERIQ_OWNER_SESSION_SECRET: 'test-owner-session-secret',
      TIGERIQ_CLOUD_EXECUTOR: 'on',
    });
    let calls = 0;
    const seen = [];
    vi.stubGlobal('fetch', async (input, init = {}) => {
      calls += 1;
      const request = JSON.parse(String(init.body || '{}'));
      const model = String(request.model || 'unknown');
      seen.push({ url: String(input), model, auth: init.headers?.authorization, reasoningFormat: request.reasoning_format });
      if (calls === 1) return responseJson({ status: 'completed', result: '42', evidenceSummary: 'Computed answer is present in the result.' }, model);
      if (calls === 2) return responseJson({ pass: true, rationale: 'Result answers the bounded instruction and evidence is present.' }, model);
      if (calls === 3) return responseJson({ pass: true, rationale: 'Reviewer passed and evidence is concrete.' }, model);
      throw new Error('unexpected gateway call');
    });
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudExecutorEnabled()).toBe(true);
      expect(workforce.cloudWorkforceDescriptor()).toEqual(expect.objectContaining({
        gateway: 'groq-free-tier-api',
        executorModel: 'openai/gpt-oss-120b',
        reviewerModel: 'qwen/qwen3.8-27b',
        judgeModel: 'openai/gpt-oss-20b',
      }));
      const execution = await workforce.executeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.' });
      expect(execution).toEqual(expect.objectContaining({ status: 'completed', result: '42' }));
      const review = await workforce.reviewCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary });
      expect(review.pass).toBe(true);
      const judge = await workforce.judgeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary, review });
      expect(judge.pass).toBe(true);
      expect(calls).toBe(3);
      expect(seen.map((entry) => entry.url)).toEqual(Array(3).fill('https://api.groq.com/openai/v1/chat/completions'));
      expect(seen.map((entry) => entry.model)).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']);
      expect(seen.every((entry) => entry.auth === 'Bearer test-only-groq-key')).toBe(true);
      expect(seen.every((entry) => entry.reasoningFormat === 'hidden')).toBe(true);

      const ref = `sha256:${'a'.repeat(64)}`;
      const signed = workforce.signServerGateComment(`REVIEW_PASS\nEVIDENCE_REF ${ref}\nREVIEW_ROLE independent-cloud-reviewer`);
      expect(workforce.verifyServerGateComment(signed)).toBe(true);
      expect(workforce.verifyServerGateComment(signed.replace('REVIEW_PASS', 'JUDGE_PASS'))).toBe(false);
      expect(workforce.verifyServerGateComment(`REVIEW_PASS\nEVIDENCE_REF ${ref}`)).toBe(false);
    } finally { restoreEnv(saved); }
  });

  it('keeps Vercel AI Gateway available only when explicitly selected or keyed', async () => {
    const saved = saveEnv();
    delete process.env.GROQ_API_KEY;
    Object.assign(process.env, {
      AI_GATEWAY_API_KEY: 'test-only-vercel-key',
      TIGERIQ_AI_PROVIDER: 'vercel',
      TIGERIQ_CLOUD_EXECUTOR: 'on',
    });
    vi.stubGlobal('fetch', async (input, init = {}) => {
      const request = JSON.parse(String(init.body || '{}'));
      expect(String(input)).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
      expect(init.headers?.authorization).toBe('Bearer test-only-vercel-key');
      expect(request.reasoning_format).toBeUndefined();
      return responseJson({ status: 'completed', result: '42', evidenceSummary: 'Concrete result.' }, request.model, 'vercel-ai-gateway');
    });
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudWorkforceDescriptor().gateway).toBe('vercel-ai-gateway');
      const execution = await workforce.executeCloudTask({ instruction: 'Return 42.', expectedEvidence: 'Concrete result.' });
      expect(execution.result).toBe('42');
    } finally { restoreEnv(saved); }
  });

  it('fails closed on Groq by default when no cloud credential is configured', async () => {
    const saved = saveEnv();
    delete process.env.GROQ_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.TIGERIQ_AI_PROVIDER;
    Object.assign(process.env, { TIGERIQ_CLOUD_EXECUTOR: 'on' });
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudWorkforceDescriptor().gateway).toBe('groq-free-tier-api');
      await expect(workforce.executeCloudTask({ instruction: 'Return 42.', expectedEvidence: 'Concrete result.' }))
        .rejects.toThrow('groq_authorization_unavailable');
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
