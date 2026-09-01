import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function makeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') { this.body = String(value); },
  };
}
function postReq(payload, headers = {}) {
  const chunk = Buffer.from(JSON.stringify(payload));
  return { method: 'POST', url: '/api/control', headers: { 'content-type': 'application/json', ...headers }, async *[Symbol.asyncIterator]() { yield chunk; } };
}
function ownerCookie(secret) {
  const payload = Buffer.from(JSON.stringify({ email: 'newsdayads@gmail.com', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `tigeriq_owner_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}
function gate(id, body, created_at) {
  return { id, body, created_at, performed_via_github_app: { slug: 'chatgpt-codex-connector' } };
}
function saveEnv() { return { ...process.env }; }
function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
function configureEnv() {
  delete process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET;
  delete process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI;
  Object.assign(process.env, {
    TIGERIQ_REPO: 'newsdayads/tigeriq-ai-lab', TIGERIQ_GITHUB_TOKEN: 'server-only-token',
    TIGERIQ_COMMAND_SECRET: 'internal-secret', TIGERIQ_OWNER_EMAIL: 'newsdayads@gmail.com',
    TIGERIQ_OWNER_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    TIGERIQ_OWNER_SESSION_SECRET: 'session-secret', TIGERIQ_PC01_CANARY_ISSUE: '58',
  });
}
function googleFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid: 'security-test-key', alg: 'RS256', use: 'sig' });
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: 'client.apps.googleusercontent.com', sub: '123',
    email: 'newsdayads@gmail.com', email_verified: true, iat: now, exp: now + 3600,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return { jwk, token: `${signingInput}.${signature}` };
}

function installGitHubMock({ issueDelayMs = 0 } = {}) {
  const issues = [];
  const comments = new Map([[58, []]]);
  const labels = new Map();
  let issueWrites = 0;
  const canary = { number: 58, title: 'PC01 canonical canary', state: 'open', state_reason: null, body: 'TIGERIQ_COMMAND_V1', updated_at: '2026-08-31T05:00:00Z', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/58' };
  vi.stubGlobal('fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const base = '/repos/newsdayads/tigeriq-ai-lab';
    if (url.pathname === base && method === 'GET') return response({ full_name: 'newsdayads/tigeriq-ai-lab' });
    if (url.pathname === `${base}/labels` && method === 'POST') {
      const payload = JSON.parse(String(init.body || '{}'));
      if (labels.has(payload.name)) return response({ message: 'Validation Failed' }, 422);
      const label = { name: payload.name, description: payload.description || '' };
      labels.set(payload.name, label);
      return response(label, 201);
    }
    if (url.pathname.startsWith(`${base}/labels/`)) {
      const name = decodeURIComponent(url.pathname.slice(`${base}/labels/`.length));
      if (method === 'GET') return labels.has(name) ? response(labels.get(name)) : response({ message: 'not found' }, 404);
      if (method === 'DELETE') { labels.delete(name); return new Response('', { status: 204 }); }
    }
    if (url.pathname === `${base}/issues` && method === 'GET') return response(url.searchParams.get('state') === 'open' ? issues.filter((x) => x.state === 'open') : issues);
    if (url.pathname === `${base}/issues` && method === 'POST') {
      issueWrites += 1;
      if (issueDelayMs) await new Promise((resolve) => setTimeout(resolve, issueDelayMs));
      const payload = JSON.parse(String(init.body || '{}'));
      const issue = { number: 900 + issueWrites, title: payload.title, body: payload.body, state: 'open', state_reason: null, updated_at: new Date().toISOString(), html_url: `https://github.com/newsdayads/tigeriq-ai-lab/issues/${900 + issueWrites}` };
      issues.unshift(issue); comments.set(issue.number, []); return response(issue, 201);
    }
    if (url.pathname === `${base}/issues/58` && method === 'GET') return response(canary);
    if (url.pathname === `${base}/issues/58/comments` && method === 'GET') return response(comments.get(58));
    const issueMatch = url.pathname.match(new RegExp(`^${base}/issues/(\\d+)$`));
    if (issueMatch && method === 'GET') { const number = Number(issueMatch[1]); const hit = issues.find((x) => x.number === number); return response(hit || { message: 'not found' }, hit ? 200 : 404); }
    const commentsMatch = url.pathname.match(new RegExp(`^${base}/issues/(\\d+)/comments$`));
    if (commentsMatch && method === 'GET') return response(comments.get(Number(commentsMatch[1])) || []);
    return response({ message: `unhandled ${method} ${url.pathname}` }, 404);
  });
  return { issues, labels, getIssueWrites: () => issueWrites };
}

describe('Web Control security, dedupe and completion gates', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('verifies Google ID-token identity, preserves session cookie, and clears legacy OAuth state', async () => {
    const saved = saveEnv(); configureEnv();
    const fixture = googleFixture();
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') return response({ keys: [fixture.jwk] }, 200, { 'cache-control': 'public, max-age=3600' });
      return response({ message: `unexpected ${url}` }, 404);
    });
    try {
      vi.resetModules();
      const { default: authHandler } = await import('../api/owner-auth.mjs');
      const identityRes = makeRes();
      await authHandler({
        method: 'POST', url: '/api/owner-auth?action=identity',
        headers: { host: 'preview.example', origin: 'https://preview.example', 'sec-fetch-site': 'same-origin' },
        body: { credential: fixture.token },
      }, identityRes);
      expect(identityRes.statusCode).toBe(200);
      const cookies = identityRes.headers['set-cookie'];
      expect(Array.isArray(cookies)).toBe(true);
      expect(cookies).toHaveLength(2);
      expect(cookies.some((cookie) => cookie.startsWith('tigeriq_owner_session=') && cookie.includes('Max-Age=28800'))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith('tigeriq_owner_oauth_state=') && cookie.includes('Max-Age=0'))).toBe(true);
      const sessionPair = cookies.find((cookie) => cookie.startsWith('tigeriq_owner_session=')).split(';')[0];
      const statusRes = makeRes();
      await authHandler({ method: 'GET', url: '/api/owner-auth?action=status', headers: { cookie: sessionPair } }, statusRes);
      expect(statusRes.statusCode).toBe(200);
      expect(JSON.parse(statusRes.body)).toEqual(expect.objectContaining({ configured: true, identityMode: 'google_id_token', clientSecretRequired: false, authenticated: true }));
    } finally { restoreEnv(saved); }
  });

  it('blocks unauthenticated browser writes, dedupes sequential/same-process work and reuses canonical canary', async () => {
    const saved = saveEnv(); configureEnv();
    const mock = installGitHubMock();
    try {
      vi.resetModules(); const { default: handler } = await import('../api/control.mjs');
      const browserHeaders = { origin: 'https://tigeriq.example', 'sec-fetch-site': 'same-origin' };
      const tokenAttempt = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: 'Do one deterministic browser write test.' }, { ...browserHeaders, 'x-tigeriq-github-token': 'attacker-client-token' }), tokenAttempt);
      expect(tokenAttempt.statusCode).toBe(401); expect(mock.getIssueWrites()).toBe(0);
      const secretAttempt = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: 'Do one deterministic browser write test.' }, { ...browserHeaders, 'x-tigeriq-secret': process.env.TIGERIQ_COMMAND_SECRET }), secretAttempt);
      expect(secretAttempt.statusCode).toBe(401); expect(mock.getIssueWrites()).toBe(0);
      const cookie = ownerCookie(process.env.TIGERIQ_OWNER_SESSION_SECRET); const ownerHeaders = { ...browserHeaders, cookie };
      const first = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: 'Do one deterministic browser write test.' }, ownerHeaders), first);
      expect(first.statusCode).toBe(201); expect(mock.getIssueWrites()).toBe(1); const firstBody = JSON.parse(first.body);
      const duplicate = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: '  do ONE deterministic browser write test.  ' }, ownerHeaders), duplicate);
      expect(duplicate.statusCode).toBe(200); expect(JSON.parse(duplicate.body).deduplicated).toBe(true); expect(JSON.parse(duplicate.body).issue.number).toBe(firstBody.issue.number); expect(mock.getIssueWrites()).toBe(1);
      const concurrentA = makeRes(); const concurrentB = makeRes();
      await Promise.all([
        handler(postReq({ operation: 'work-order', priority: 'P1', instruction: 'Concurrent same fingerprint probe.' }, ownerHeaders), concurrentA),
        handler(postReq({ operation: 'work-order', priority: 'P1', instruction: ' concurrent SAME fingerprint probe. ' }, ownerHeaders), concurrentB),
      ]);
      expect([concurrentA.statusCode, concurrentB.statusCode].sort()).toEqual([200, 201]);
      expect(JSON.parse(concurrentA.body).issue.number).toBe(JSON.parse(concurrentB.body).issue.number); expect(mock.getIssueWrites()).toBe(2);
      for (let i = 0; i < 2; i += 1) {
        const canaryRes = makeRes(); await handler(postReq({ operation: 'canary' }, ownerHeaders), canaryRes);
        expect(canaryRes.statusCode).toBe(200); const body = JSON.parse(canaryRes.body);
        expect(body.deduplicated).toBe(true); expect(body.canonical).toBe(true); expect(body.issue.number).toBe(58);
      }
      expect(mock.getIssueWrites()).toBe(2);
      expect(mock.labels.size).toBe(0);
    } finally { restoreEnv(saved); }
  });

  it('dedupes a race across two isolated handler module instances using the GitHub distributed lock', async () => {
    const saved = saveEnv(); configureEnv();
    const mock = installGitHubMock({ issueDelayMs: 60 });
    try {
      const browserHeaders = { origin: 'https://tigeriq.example', 'sec-fetch-site': 'same-origin', cookie: ownerCookie(process.env.TIGERIQ_OWNER_SESSION_SECRET) };
      vi.resetModules(); const { default: handlerA } = await import('../api/control.mjs');
      vi.resetModules(); const { default: handlerB } = await import('../api/control.mjs');
      const a = makeRes(); const b = makeRes();
      await Promise.all([
        handlerA(postReq({ operation: 'work-order', priority: 'P1', instruction: 'Cross instance fingerprint race.' }, browserHeaders), a),
        handlerB(postReq({ operation: 'work-order', priority: 'P1', instruction: ' cross INSTANCE fingerprint race. ' }, browserHeaders), b),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      expect(JSON.parse(a.body).issue.number).toBe(JSON.parse(b.body).issue.number);
      expect(mock.getIssueWrites()).toBe(1);
      expect(mock.labels.size).toBe(0);
    } finally { restoreEnv(saved); }
  });

  it('requires one typed evidence ref, trusted separate ordered REVIEW/JUDGE, and the same ref throughout', async () => {
    const { issueStage, issueEvidenceSummary } = await import('../api/control.mjs');
    const closed = { state: 'closed', state_reason: 'completed' };
    const ref = `sha256:${'a'.repeat(64)}`;
    const otherRef = `sha256:${'b'.repeat(64)}`;
    expect(issueStage(closed, [])).toBe('closed_unverified');
    expect(issueStage(closed, [{ body: 'TIGERIQ_JOB_RESULT' }])).toBe('closed_unverified');
    expect(issueStage(closed, [{ body: 'TIGERIQ_JOB_RESULT\nlooks good' }])).toBe('closed_unverified');
    expect(issueStage(closed, [{ body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}` }, gate(2, 'REVIEW_PASS\nreviewed it', '2026-08-31T06:01:00Z'), gate(3, 'JUDGE_PASS\nlooks valid', '2026-08-31T06:02:00Z')])).toBe('closed_unverified');

    const complete = [
      { id: 1, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-31T06:00:00Z' },
      gate(2, `REVIEW_PASS\nEVIDENCE_REF ${ref}`, '2026-08-31T06:01:00Z'),
      gate(3, `JUDGE_PASS\nEVIDENCE_REF ${ref}`, '2026-08-31T06:02:00Z'),
    ];
    expect(issueStage(closed, complete)).toBe('completed');
    expect(issueEvidenceSummary(complete)).toEqual(expect.objectContaining({
      result: true, resultEvidence: true, resultEvidenceRef: ref, reviewPass: true, judgePass: true,
      trustedReviewApp: 'chatgpt-codex-connector', trustedJudgeApp: 'chatgpt-codex-connector', completionReady: true,
    }));

    const mismatched = [
      { id: 4, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-31T06:00:00Z' },
      gate(5, `REVIEW_PASS\nEVIDENCE_REF ${otherRef}`, '2026-08-31T06:01:00Z'),
      gate(6, `JUDGE_PASS\nEVIDENCE_REF ${otherRef}`, '2026-08-31T06:02:00Z'),
    ];
    expect(issueStage(closed, mismatched)).toBe('closed_unverified');
    expect(issueEvidenceSummary(mismatched).completionReady).toBe(false);

    const untrusted = [
      { id: 7, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-31T06:00:00Z' },
      { id: 8, body: `REVIEW_PASS\nEVIDENCE_REF ${ref}`, created_at: '2026-08-31T06:01:00Z' },
      { id: 9, body: `JUDGE_PASS\nEVIDENCE_REF ${ref}`, created_at: '2026-08-31T06:02:00Z' },
    ];
    expect(issueStage(closed, untrusted)).toBe('closed_unverified');
    expect(issueEvidenceSummary(untrusted).completionReady).toBe(false);

    const wrongOrder = [
      gate(10, `REVIEW_PASS\nEVIDENCE_REF ${ref}`, '2026-08-31T05:59:00Z'),
      gate(11, `JUDGE_PASS\nEVIDENCE_REF ${ref}`, '2026-08-31T05:59:30Z'),
      { id: 12, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-31T06:00:00Z' },
    ];
    expect(issueStage(closed, wrongOrder)).toBe('closed_unverified');
    expect(issueEvidenceSummary(wrongOrder).completionReady).toBe(false);
  });
});
