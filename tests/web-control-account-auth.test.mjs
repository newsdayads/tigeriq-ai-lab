import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
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

function saveEnv() { return { ...process.env }; }
function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
function configureEnv() {
  delete process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET;
  delete process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI;
  Object.assign(process.env, {
    TIGERIQ_OWNER_EMAIL: 'newsdayads@gmail.com',
    TIGERIQ_OWNER_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    TIGERIQ_OWNER_SESSION_SECRET: 'session-secret',
  });
}

function googleFixture(overrides = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid: 'test-google-key', alg: 'RS256', use: 'sig' });
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: 'client.apps.googleusercontent.com',
    sub: '1234567890',
    email: 'newsdayads@gmail.com',
    email_verified: true,
    name: 'Nguyễn Trường Sơn',
    picture: 'https://lh3.googleusercontent.com/tigeriq-owner-avatar',
    iat: now,
    exp: now + 3600,
    ...overrides,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return { jwk, token: `${signingInput}.${signature}` };
}

function installGoogleJwks(jwk) {
  vi.stubGlobal('fetch', async (input) => {
    const url = String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return response({ keys: [jwk] }, 200, { 'cache-control': 'public, max-age=3600' });
    return response({ message: `unexpected ${url}` }, 404);
  });
}

function identityReq(token) {
  return {
    method: 'POST',
    url: '/api/owner-auth?action=identity',
    headers: { host: 'preview.example', origin: 'https://preview.example', 'sec-fetch-site': 'same-origin' },
    body: { credential: token },
  };
}

describe('TigerIQ account identity and authorization boundary', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('is configured without a Google client secret and keeps unauthenticated access fail-closed', async () => {
    const saved = saveEnv(); configureEnv();
    try {
      vi.resetModules();
      const { default: handler } = await import('../api/owner-auth.mjs');
      const res = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=status', headers: {} }, res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
        configured: true,
        identityMode: 'google_id_token',
        clientSecretRequired: false,
        googleClientId: 'client.apps.googleusercontent.com',
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

  it('verifies a Google ID token and stores identity while TigerIQ independently assigns Owner', async () => {
    const saved = saveEnv(); configureEnv();
    const fixture = googleFixture(); installGoogleJwks(fixture.jwk);
    try {
      vi.resetModules();
      const { default: handler } = await import('../api/owner-auth.mjs');
      const identity = makeRes();
      await handler(identityReq(fixture.token), identity);
      expect(identity.statusCode).toBe(200);
      expect(JSON.parse(identity.body)).toEqual(expect.objectContaining({
        authenticated: true,
        identity: {
          email: 'newsdayads@gmail.com',
          name: 'Nguyễn Trường Sơn',
          picture: 'https://lh3.googleusercontent.com/tigeriq-owner-avatar',
        },
        authorization: expect.objectContaining({ authority: 'TigerIQ', role: 'Owner', googleControlsAuthorization: false }),
      }));
      expect(identity.headers['set-cookie']).toEqual(expect.arrayContaining([
        expect.stringContaining('tigeriq_owner_session='),
        expect.stringContaining('tigeriq_owner_oauth_state=;'),
      ]));
      const sessionPair = identity.headers['set-cookie'].find((cookie) => cookie.startsWith('tigeriq_owner_session=')).split(';')[0];
      const status = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=status', headers: { cookie: sessionPair } }, status);
      expect(JSON.parse(status.body)).toEqual(expect.objectContaining({ authenticated: true, authorization: expect.objectContaining({ role: 'Owner' }) }));
    } finally { restoreEnv(saved); }
  });

  it('rejects a signed Google token for the wrong audience or wrong Owner email', async () => {
    const saved = saveEnv(); configureEnv();
    try {
      for (const overrides of [{ aud: 'other.apps.googleusercontent.com' }, { email: 'other@example.com' }]) {
        const fixture = googleFixture(overrides); installGoogleJwks(fixture.jwk); vi.resetModules();
        const { default: handler } = await import('../api/owner-auth.mjs');
        const res = makeRes();
        await handler(identityReq(fixture.token), res);
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/google_id_token_audience_invalid|owner_email_not_authorized/);
        vi.unstubAllGlobals();
      }
    } finally { restoreEnv(saved); }
  });

  it('retires the old code-flow endpoints and logs out by clearing both cookies', async () => {
    const saved = saveEnv(); configureEnv();
    try {
      vi.resetModules();
      const { default: handler } = await import('../api/owner-auth.mjs');
      const legacy = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=login', headers: {} }, legacy);
      expect(legacy.statusCode).toBe(410);
      expect(JSON.parse(legacy.body).error).toBe('oauth_code_flow_retired');

      const logout = makeRes();
      await handler({ method: 'GET', url: '/api/owner-auth?action=logout', headers: { cookie: 'tigeriq_owner_session=stale-session' } }, logout);
      expect(logout.statusCode).toBe(302);
      expect(logout.headers.location).toBe('/?owner=disconnected');
      expect(logout.headers['set-cookie']).toEqual(expect.arrayContaining([
        expect.stringContaining('tigeriq_owner_session=;'),
        expect.stringContaining('tigeriq_owner_oauth_state=;'),
      ]));
      for (const cookie of logout.headers['set-cookie']) expect(cookie).toContain('Max-Age=0');
    } finally { restoreEnv(saved); }
  });
});
