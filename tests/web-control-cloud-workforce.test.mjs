import { afterEach, describe, expect, it, vi } from 'vitest';

function responseJson(value, model, provider = 'groq') {
  return new Response(JSON.stringify({
    model,
    provider,
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { total_tokens: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function geminiResponse(value, model = 'gemini-3.7-flash') {
  return new Response(JSON.stringify({
    modelVersion: model,
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
    usageMetadata: { totalTokenCount: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function saveEnv() { return { ...process.env }; }
function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
function clearProviderEnv() {
  for (const key of [
    'GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','AI_GATEWAY_API_KEY',
    'TIGERIQ_AI_PROVIDER','TIGERIQ_EXECUTOR_PROVIDER','TIGERIQ_REVIEWER_PROVIDER','TIGERIQ_JUDGE_PROVIDER',
    'TIGERIQ_GEMINI_FREE_TIER','TIGERIQ_EXECUTOR_MODEL','TIGERIQ_REVIEWER_MODEL','TIGERIQ_JUDGE_MODEL',
  ]) delete process.env[key];
}

describe('Web Control cloud workforce', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('uses the no-card Groq path to execute, independently review, judge, and attest gates', async () => {
    const saved = saveEnv();
    clearProviderEnv();
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
      seen.push({
        url: String(input),
        model,
        auth: init.headers?.authorization,
        reasoningFormat: request.reasoning_format,
        system: String(request.messages?.[0]?.content || ''),
      });
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
        providers: ['groq'],
        executorProvider: 'groq',
        reviewerProvider: 'groq',
        judgeProvider: 'groq',
        executorModel: 'openai/gpt-oss-120b',
        reviewerModel: 'qwen/qwen3.8-27b',
        judgeModel: 'openai/gpt-oss-20b',
      }));
      const execution = await workforce.executeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result plus server-generated SHA256, reviewer and judge.' });
      expect(execution).toEqual(expect.objectContaining({ status: 'completed', result: '42', providerUsed: 'groq' }));
      const review = await workforce.reviewCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary });
      expect(review.pass).toBe(true);
      const judge = await workforce.judgeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary, review });
      expect(judge.pass).toBe(true);
      expect(calls).toBe(3);
      expect(seen.map((entry) => entry.url)).toEqual(Array(3).fill('https://api.groq.com/openai/v1/chat/completions'));
      expect(seen.map((entry) => entry.model)).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']);
      expect(seen.every((entry) => entry.auth === 'Bearer test-only-groq-key')).toBe(true);
      expect(seen.every((entry) => entry.reasoningFormat === 'hidden')).toBe(true);
      expect(seen[0].system).toContain('TigerIQ SERVER responsibilities');
      expect(seen[0].system).toContain('Never attempt to create, verify, or block on those server-side artifacts');

      const ref = `sha256:${'a'.repeat(64)}`;
      const signed = workforce.signServerGateComment(`REVIEW_PASS\nEVIDENCE_REF ${ref}\nREVIEW_ROLE independent-cloud-reviewer`);
      expect(workforce.verifyServerGateComment(signed)).toBe(true);
      expect(workforce.verifyServerGateComment(signed.replace('REVIEW_PASS', 'JUDGE_PASS'))).toBe(false);
      expect(workforce.verifyServerGateComment(`REVIEW_PASS\nEVIDENCE_REF ${ref}`)).toBe(false);
    } finally { restoreEnv(saved); }
  });

  it('spreads Executor, Reviewer, and Judge across Gemini Free, Groq Free, and OpenRouter Free when all are configured', async () => {
    const saved = saveEnv();
    clearProviderEnv();
    Object.assign(process.env, {
      GEMINI_API_KEY: 'test-only-gemini-key',
      TIGERIQ_GEMINI_FREE_TIER: '1',
      GROQ_API_KEY: 'test-only-groq-key',
      OPENROUTER_API_KEY: 'test-only-openrouter-key',
      TIGERIQ_CLOUD_EXECUTOR: 'on',
    });
    const seen = [];
    vi.stubGlobal('fetch', async (input, init = {}) => {
      const url = String(input);
      const request = JSON.parse(String(init.body || '{}'));
      seen.push({ url, headers: init.headers, request });
      if (url.includes('generativelanguage.googleapis.com')) {
        return geminiResponse({ status: 'completed', result: '42', evidenceSummary: 'Gemini computed 6 × 7.' });
      }
      if (url.includes('api.groq.com')) {
        return responseJson({ pass: true, rationale: 'Groq reviewer confirms the result.' }, request.model, 'groq');
      }
      if (url.includes('openrouter.ai')) {
        return responseJson({ pass: true, rationale: 'OpenRouter free judge confirms the gated result.' }, request.model, 'openrouter');
      }
      throw new Error(`unexpected URL ${url}`);
    });
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudWorkforceDescriptor()).toEqual(expect.objectContaining({
        gateway: 'multi-provider-zero-cost',
        providers: ['gemini', 'groq', 'openrouter'],
        executorProvider: 'gemini',
        reviewerProvider: 'groq',
        judgeProvider: 'openrouter',
        executorModel: 'gemini-3.7-flash',
        reviewerModel: 'qwen/qwen3.8-27b',
        judgeModel: 'openrouter/free',
        zeroCostPolicy: 'free-tier-or-free-router-only; no automatic paid upgrade',
      }));
      const execution = await workforce.executeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.' });
      const review = await workforce.reviewCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary });
      const judge = await workforce.judgeCloudTask({ instruction: 'Return the result of 6 * 7.', expectedEvidence: 'Concrete result.', result: execution.result, evidenceSummary: execution.evidenceSummary, review });
      expect(execution).toEqual(expect.objectContaining({ result: '42', providerUsed: 'gemini', modelUsed: 'gemini-3.7-flash' }));
      expect(review).toEqual(expect.objectContaining({ pass: true, providerUsed: 'groq' }));
      expect(judge).toEqual(expect.objectContaining({ pass: true, providerUsed: 'openrouter' }));
      expect(seen).toHaveLength(3);
      expect(seen[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent');
      expect(seen[0].headers['x-goog-api-key']).toBe('test-only-gemini-key');
      expect(seen[0].request.generationConfig.responseMimeType).toBe('application/json');
      expect(seen[1].url).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(seen[1].headers.authorization).toBe('Bearer test-only-groq-key');
      expect(seen[1].request.model).toBe('qwen/qwen3.8-27b');
      expect(seen[2].url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(seen[2].headers.authorization).toBe('Bearer test-only-openrouter-key');
      expect(seen[2].request.model).toBe('openrouter/free');
    } finally { restoreEnv(saved); }
  });

  it('does not auto-use Gemini unless the key is explicitly marked Free Tier', async () => {
    const saved = saveEnv();
    clearProviderEnv();
    Object.assign(process.env, {
      GEMINI_API_KEY: 'gemini-key-with-unknown-billing-state',
      GROQ_API_KEY: 'test-only-groq-key',
      TIGERIQ_CLOUD_EXECUTOR: 'on',
    });
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      const descriptor = workforce.cloudWorkforceDescriptor();
      expect(descriptor.executorProvider).toBe('groq');
      expect(descriptor.providers).toEqual(['groq']);
    } finally { restoreEnv(saved); }
  });

  it('keeps Vercel AI Gateway available only when explicitly selected or keyed', async () => {
    const saved = saveEnv();
    clearProviderEnv();
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
    clearProviderEnv();
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
    clearProviderEnv();
    delete process.env.VERCEL;
    delete process.env.TIGERIQ_CLOUD_EXECUTOR;
    try {
      vi.resetModules();
      const workforce = await import('../api/cloud-workforce.mjs');
      expect(workforce.cloudExecutorEnabled()).toBe(false);
    } finally { restoreEnv(saved); }
  });
});
