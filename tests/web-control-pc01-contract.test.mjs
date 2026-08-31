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
    end(value = '') { this.body = String(value); },
  };
}

function postReq(payload, cookie) {
  const chunk = Buffer.from(JSON.stringify(payload));
  return {
    method: 'POST',
    url: '/api/control',
    headers: { cookie, 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield chunk; },
  };
}

function getReq(cookie = '') {
  return { method: 'GET', url: '/api/web-control-status', headers: { cookie } };
}

function ownerCookie(secret) {
  const payload = Buffer.from(JSON.stringify({
    email: 'newsdayads@gmail.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `tigeriq_owner_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}

describe('WO-045 Web Control -> PC01 lifecycle contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('creates a gated Work Order and projects CLAIM/RESULT/REVIEW/JUDGE evidence back to Web Control without Vercel Preview', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      TIGERIQ_REPO: 'newsdayads/tigeriq-ai-lab',
      TIGERIQ_GITHUB_TOKEN: 'test-server-token',
      TIGERIQ_OWNER_EMAIL: 'newsdayads@gmail.com',
      TIGERIQ_OWNER_GOOGLE_CLIENT_ID: 'test-client',
      TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET: 'test-client-secret',
      TIGERIQ_OWNER_OAUTH_REDIRECT_URI: 'https://example.invalid/api/owner-auth?action=callback',
      TIGERIQ_OWNER_SESSION_SECRET: 'test-session-secret',
      TIGERIQ_PC01_CANARY_ISSUE: '58',
    });

    const issues = [];
    const comments = [];
    const canary = {
      number: 58,
      title: 'PC01 AUTONOMY CANARY',
      state: 'open',
      body: 'TIGERIQ_COMMAND_V1',
      updated_at: new Date().toISOString(),
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/58',
    };

    vi.stubGlobal('fetch', async (input, init = {}) => {
      const url = new URL(String(input));
      const method = String(init.method || 'GET').toUpperCase();
      const base = '/repos/newsdayads/tigeriq-ai-lab';

      if (url.pathname === base && method === 'GET') return response({ full_name: 'newsdayads/tigeriq-ai-lab' });
      if (url.pathname === `${base}/issues` && method === 'POST') {
        const payload = JSON.parse(String(init.body || '{}'));
        const issue = {
          number: 900,
          title: payload.title,
          body: payload.body,
          state: 'open',
          updated_at: new Date().toISOString(),
          html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/900',
        };
        issues.unshift(issue);
        return response(issue, 201);
      }
      if (url.pathname === `${base}/issues` && method === 'GET') {
        return response(url.searchParams.get('state') === 'open' ? issues.filter((x) => x.state === 'open') : issues);
      }
      if (url.pathname === `${base}/issues/comments` && method === 'GET') return response(comments);
      if (url.pathname === `${base}/issues/58/comments` && method === 'GET') return response([]);
      if (url.pathname === `${base}/issues/58` && method === 'GET') return response(canary);
      return response({ message: `unhandled ${method} ${url.pathname}${url.search}` }, 404);
    });

    try {
      vi.resetModules();
      const [{ default: controlHandler }, { default: statusHandler }] = await Promise.all([
        import('../api/control.mjs'),
        import('../api/web-control-status.mjs'),
      ]);
      const cookie = ownerCookie(process.env.TIGERIQ_OWNER_SESSION_SECRET);

      const sendRes = makeRes();
      await controlHandler(postReq({
        operation: 'work-order',
        priority: 'P0',
        instruction: 'Contract probe: report deterministic TigerIQ status only.',
      }, cookie), sendRes);

      expect(sendRes.statusCode).toBe(201);
      const sent = JSON.parse(sendRes.body);
      expect(sent.issue.number).toBe(900);
      expect(issues).toHaveLength(1);
      expect(issues[0].body).toContain('TIGERIQ_JOB_V1');
      expect(issues[0].body).toContain('Owner explicitly dispatched this instruction from TigerIQ AI Web Control.');

      comments.push(
        {
          issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/900',
          created_at: '2026-08-31T05:10:00Z',
          body: 'TIGERIQ_JOB_CLAIMED\nPC01 accepted bounded job.',
        },
        {
          issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/900',
          created_at: '2026-08-31T05:11:00Z',
          body: 'TIGERIQ_JOB_RESULT\nstatus=ok\nREVIEW_PASS\nJUDGE_PASS',
        },
      );

      const statusRes = makeRes();
      await statusHandler(getReq(cookie), statusRes);
      expect(statusRes.statusCode).toBe(200);
      const snapshot = JSON.parse(statusRes.body);
      const item = snapshot.work.find((x) => x.number === 900);

      expect(snapshot.owner.writeReady).toBe(true);
      expect(snapshot.pc01.physicalState).toBe('unknown');
      expect(item.stage).toBe('completed');
      expect(item.evidence).toEqual(expect.objectContaining({
        claimed: true,
        result: true,
        failed: false,
        reviewPass: true,
        judgePass: true,
      }));
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
