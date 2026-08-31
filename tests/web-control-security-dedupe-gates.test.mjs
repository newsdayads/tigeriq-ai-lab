import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
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

function saveEnv() { return { ...process.env }; }
function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
function configureEnv() {
  Object.assign(process.env, {
    TIGERIQ_REPO: 'newsdayads/tigeriq-ai-lab',
    TIGERIQ_GITHUB_TOKEN: 'server-only-token',
    TIGERIQ_COMMAND_SECRET: 'internal-secret',
    TIGERIQ_OWNER_EMAIL: 'newsdayads@gmail.com',
    TIGERIQ_OWNER_GOOGLE_CLIENT_ID: 'client',
    TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET: 'client-secret',
    TIGERIQ_OWNER_OAUTH_REDIRECT_URI: 'https://example.invalid/api/owner-auth?action=callback',
    TIGERIQ_OWNER_SESSION_SECRET: 'session-secret',
    TIGERIQ_PC01_CANARY_ISSUE: '58',
  });
}

describe('Web Control security, dedupe and completion gates', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('preserves both OAuth session and state-clear cookies and authorizes the resulting Owner session', async () => {
    const saved = saveEnv();
    configureEnv();
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') return response({ access_token: 'google-access-token' });
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return response({ email: 'newsdayads@gmail.com', email_verified: true });
      }
      return response({ message: `unexpected ${url}` }, 404);
    });

    try {
      vi.resetModules();
      const { default: authHandler } = await import('../api/owner-auth.mjs');
      const loginRes = makeRes();
      await authHandler({ method: 'GET', url: '/api/owner-auth?action=login', headers: {} }, loginRes);
      expect(loginRes.statusCode).toBe(302);
      const loginCookies = loginRes.headers['set-cookie'];
      expect(Array.isArray(loginCookies)).toBe(true);
      expect(loginCookies).toHaveLength(1);
      const stateCookiePair = loginCookies[0].split(';')[0];
      const state = decodeURIComponent(stateCookiePair.slice(stateCookiePair.indexOf('=') + 1));

      const callbackRes = makeRes();
      await authHandler({
        method: 'GET',
        url: `/api/owner-auth?action=callback&code=ok&state=${encodeURIComponent(state)}`,
        headers: { cookie: stateCookiePair },
      }, callbackRes);
      expect(callbackRes.statusCode).toBe(302);
      expect(callbackRes.headers.location).toBe('/?owner=connected');
      const callbackCookies = callbackRes.headers['set-cookie'];
      expect(Array.isArray(callbackCookies)).toBe(true);
      expect(callbackCookies).toHaveLength(2);
      expect(callbackCookies.some((cookie) => cookie.startsWith('tigeriq_owner_session=') && cookie.includes('Max-Age=28800'))).toBe(true);
      expect(callbackCookies.some((cookie) => cookie.startsWith('tigeriq_owner_oauth_state=') && cookie.includes('Max-Age=0'))).toBe(true);

      const sessionPair = callbackCookies.find((cookie) => cookie.startsWith('tigeriq_owner_session=')).split(';')[0];
      const statusRes = makeRes();
      await authHandler({ method: 'GET', url: '/api/owner-auth?action=status', headers: { cookie: sessionPair } }, statusRes);
      expect(statusRes.statusCode).toBe(200);
      expect(JSON.parse(statusRes.body)).toEqual(expect.objectContaining({ configured: true, authenticated: true }));
    } finally {
      restoreEnv(saved);
    }
  });

  it('blocks all unauthenticated browser writes, dedupes sequential/concurrent Work Orders, and reuses canonical canary', async () => {
    const saved = saveEnv();
    configureEnv();

    const issues = [];
    const comments = new Map([[58, []]]);
    let issueWrites = 0;
    const canary = { number: 58, title: 'PC01 canonical canary', state: 'open', state_reason: null, body: 'TIGERIQ_COMMAND_V1', updated_at: '2026-08-31T05:00:00Z', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/58' };

    vi.stubGlobal('fetch', async (input, init = {}) => {
      const url = new URL(String(input));
      const method = String(init.method || 'GET').toUpperCase();
      const base = '/repos/newsdayads/tigeriq-ai-lab';
      if (url.pathname === base && method === 'GET') return response({ full_name: 'newsdayads/tigeriq-ai-lab' });
      if (url.pathname === `${base}/issues` && method === 'GET') {
        const state = url.searchParams.get('state');
        return response(state === 'open' ? issues.filter((x) => x.state === 'open') : issues);
      }
      if (url.pathname === `${base}/issues` && method === 'POST') {
        issueWrites += 1;
        const payload = JSON.parse(String(init.body || '{}'));
        const issue = { number: 900 + issueWrites, title: payload.title, body: payload.body, state: 'open', state_reason: null, updated_at: new Date().toISOString(), html_url: `https://github.com/newsdayads/tigeriq-ai-lab/issues/${900 + issueWrites}` };
        issues.unshift(issue);
        comments.set(issue.number, []);
        return response(issue, 201);
      }
      if (url.pathname === `${base}/issues/58` && method === 'GET') return response(canary);
      if (url.pathname === `${base}/issues/58/comments` && method === 'GET') return response(comments.get(58));
      const issueMatch = url.pathname.match(new RegExp(`^${base}/issues/(\\d+)$`));
      if (issueMatch && method === 'GET') {
        const number = Number(issueMatch[1]);
        const hit = issues.find((x) => x.number === number);
        return response(hit || { message: 'not found' }, hit ? 200 : 404);
      }
      const commentsMatch = url.pathname.match(new RegExp(`^${base}/issues/(\\d+)/comments$`));
      if (commentsMatch && method === 'GET') return response(comments.get(Number(commentsMatch[1])) || []);
      return response({ message: `unhandled ${method} ${url.pathname}` }, 404);
    });

    try {
      vi.resetModules();
      const { default: handler } = await import('../api/control.mjs');
      const browserHeaders = { origin: 'https://tigeriq.example', 'sec-fetch-site': 'same-origin' };

      const tokenAttempt = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: 'Do one deterministic browser write test.' }, {
        ...browserHeaders, 'x-tigeriq-github-token': 'attacker-client-token',
      }), tokenAttempt);
      expect(tokenAttempt.statusCode).toBe(401);
      expect(issueWrites).toBe(0);

      const secretAttempt = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: 'Do one deterministic browser write test.' }, {
        ...browserHeaders, 'x-tigeriq-secret': process.env.TIGERIQ_COMMAND_SECRET,
      }), secretAttempt);
      expect(secretAttempt.statusCode).toBe(401);
      expect(issueWrites).toBe(0);

      const cookie = ownerCookie(process.env.TIGERIQ_OWNER_SESSION_SECRET);
      const ownerHeaders = { ...browserHeaders, cookie };
      const first = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: 'Do one deterministic browser write test.' }, ownerHeaders), first);
      expect(first.statusCode).toBe(201);
      expect(issueWrites).toBe(1);
      const firstBody = JSON.parse(first.body);

      const duplicate = makeRes();
      await handler(postReq({ operation: 'work-order', priority: 'P0', instruction: '  do ONE deterministic browser write test.  ' }, ownerHeaders), duplicate);
      expect(duplicate.statusCode).toBe(200);
      expect(JSON.parse(duplicate.body).deduplicated).toBe(true);
      expect(JSON.parse(duplicate.body).issue.number).toBe(firstBody.issue.number);
      expect(issueWrites).toBe(1);

      const concurrentA = makeRes();
      const concurrentB = makeRes();
      await Promise.all([
        handler(postReq({ operation: 'work-order', priority: 'P1', instruction: 'Concurrent same fingerprint probe.' }, ownerHeaders), concurrentA),
        handler(postReq({ operation: 'work-order', priority: 'P1', instruction: ' concurrent SAME fingerprint probe. ' }, ownerHeaders), concurrentB),
      ]);
      expect([concurrentA.statusCode, concurrentB.statusCode].sort()).toEqual([200, 201]);
      expect(JSON.parse(concurrentA.body).issue.number).toBe(JSON.parse(concurrentB.body).issue.number);
      expect(issueWrites).toBe(2);

      for (let i = 0; i < 2; i += 1) {
        const canaryRes = makeRes();
        await handler(postReq({ operation: 'canary' }, ownerHeaders), canaryRes);
        expect(canaryRes.statusCode).toBe(200);
        const body = JSON.parse(canaryRes.body);
        expect(body.deduplicated).toBe(true);
        expect(body.canonical).toBe(true);
        expect(body.issue.number).toBe(58);
      }
      expect(issueWrites).toBe(2);
    } finally {
      restoreEnv(saved);
    }
  });

  it('requires ordered RESULT evidence then REVIEW_PASS then JUDGE_PASS before completed', async () => {
    const { issueStage, issueEvidenceSummary } = await import('../api/control.mjs');
    const closed = { state: 'closed', state_reason: 'completed' };
    expect(issueStage(closed, [])).toBe('closed_unverified');
    expect(issueStage(closed, [{ body: 'TIGERIQ_JOB_RESULT' }])).toBe('closed_unverified');
    expect(issueStage(closed, [{ body: 'TIGERIQ_JOB_RESULT status=ok' }])).toBe('closed_unverified');
    expect(issueStage(closed, [{ body: 'TIGERIQ_JOB_RESULT status=ok\nREVIEW_PASS' }])).toBe('closed_unverified');

    const complete = [{ body: 'TIGERIQ_JOB_RESULT\nartifact=sha256:abc\nREVIEW_PASS\nJUDGE_PASS', created_at: '2026-08-31T06:00:00Z' }];
    expect(issueStage(closed, complete)).toBe('completed');
    expect(issueEvidenceSummary(complete)).toEqual(expect.objectContaining({ result: true, resultEvidence: true, reviewPass: true, judgePass: true, completionReady: true }));

    const wrongOrder = [{ body: 'REVIEW_PASS\nJUDGE_PASS\nTIGERIQ_JOB_RESULT artifact=sha256:abc', created_at: '2026-08-31T06:00:00Z' }];
    expect(issueStage(closed, wrongOrder)).toBe('closed_unverified');
    expect(issueEvidenceSummary(wrongOrder).completionReady).toBe(false);
  });
});
