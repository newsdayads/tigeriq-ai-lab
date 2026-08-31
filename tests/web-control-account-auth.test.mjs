import { afterEach, describe, expect, it, vi } from 'vitest';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') { this.body = String(value); },
  };
}

function saveEnv() { return { ...process.env }; }
function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
function configureEnv() {
  Object.assign(process.env, {
    TIGERIQ_OWNER_EMAIL: 'newsdayads@gmail.com',
    TIGERIQ_OWNER_GOOGLE_CLIENT_ID: 'client',
    TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET: 'client-secret',
    TIGERIQ_OWNER_OAUTH_REDIRECT_URI: 'https://preview.example/api/owner-auth?action=callback',
    TIGERIQ_OWNER_SESSION_SECRET: 'session-secret',
  });
}

describe('TigerIQ account identity and authorization boundary', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('keeps unauthenticated access fail-closed with no TigerIQ role assigned', async () => {
    const saved = saveEnv(); configureEnv();
    try {
      vi.resetModules();
      const { default: handler } = await import('../api/owner-auth.mjs');
      const res = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=status', headers: {} }, res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
        configured: true,
        authenticated: false,
        identity: null,
        authorization: expect.objectContaining({
          authority: 'TigerIQ',
          role: null,
          implementedRoles: ['Owner'],
          requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem'],
          providerInterface: '06-work-management-rbac-required',
          googleControlsAuthorization: false,
        }),
      }));
    } finally { restoreEnv(saved); }
  });

  it('stores Google name/avatar as identity while TigerIQ independently assigns current Owner role', async () => {
    const saved = saveEnv(); configureEnv();
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') return response({ access_token: 'google-access-token' });
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return response({
        email: 'newsdayads@gmail.com',
        email_verified: true,
        name: 'Nguyễn Trường Sơn',
        picture: 'https://lh3.googleusercontent.com/tigeriq-owner-avatar',
      });
      return response({ message: `unexpected ${url}` }, 404);
    });
    try {
      vi.resetModules();
      const { default: handler } = await import('../api/owner-auth.mjs');
      const login = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=login', headers: {} }, login);
      const statePair = login.headers['set-cookie'][0].split(';')[0];
      const state = decodeURIComponent(statePair.slice(statePair.indexOf('=') + 1));

      const callback = makeRes();
      await handler({ method: 'GET', url: `/api/owner-auth?action=callback&code=ok&state=${encodeURIComponent(state)}`, headers: { cookie: statePair } }, callback);
      expect(callback.statusCode).toBe(302);
      const sessionPair = callback.headers['set-cookie'].find((cookie) => cookie.startsWith('tigeriq_owner_session=')).split(';')[0];

      const status = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=status', headers: { cookie: sessionPair } }, status);
      expect(status.statusCode).toBe(200);
      expect(JSON.parse(status.body)).toEqual(expect.objectContaining({
        authenticated: true,
        identity: {
          email: 'newsdayads@gmail.com',
          name: 'Nguyễn Trường Sơn',
          picture: 'https://lh3.googleusercontent.com/tigeriq-owner-avatar',
        },
        authorization: expect.objectContaining({
          authority: 'TigerIQ',
          role: 'Owner',
          googleControlsAuthorization: false,
        }),
      }));
    } finally { restoreEnv(saved); }
  });
});