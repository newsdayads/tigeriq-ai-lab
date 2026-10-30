import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createOAuthResourceServer } from '../apps/tigeriq-core/pc-operator-oauth-runtime.mjs';

const issuerUrl = 'https://auth.example.test/';
const resourceUrl = 'https://pc01.example.test/mcp';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test-key-1';
jwk.alg = 'RS256';
jwk.use = 'sig';
const config = {
  issuerUrl, resourceUrl, jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
  authorizationEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token',
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(payload = {}, kid = 'test-key-1') {
  const header = encode({ alg: 'RS256', kid, typ: 'JWT' });
  const body = encode({
    iss: issuerUrl, aud: resourceUrl, sub: 'owner', exp: 1800000300,
    scope: 'mcp:read pc01:write', ...payload,
  });
  const input = header + '.' + body;
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
}
function runtime(now = 1800000000) {
  return createOAuthResourceServer({
    config, now: () => now,
    fetchImpl: async url => new Response(JSON.stringify({ keys: url === config.jwksUrl ? [jwk] : [] }), {
      headers: { 'content-type': 'application/json' },
    }),
  });
}

test('runtime publishes protected resource and authorization metadata', () => {
  const r = runtime();
  assert.equal(r.configured(), true);
  assert.deepEqual(r.protectedMetadata(), {
    resource: resourceUrl,
    authorization_servers: [issuerUrl],
    scopes_supported: ['mcp:read', 'pc01:write', 'pc01:execute', 'pc01:ui', 'pc01:admin', 'offline_access'],
    bearer_methods_supported: ['header'],
  });
  assert.equal(r.authorizationMetadata().code_challenge_methods_supported[0], 'S256');
  assert.equal(r.authorizationMetadata().jwks_uri, config.jwksUrl);
});

test('verifies RS256 JWKS token and normalizes scopes', async () => {
  const result = await runtime().verifyBearer({ authorization: 'Bearer ' + token() });
  assert.equal(result.ok, true);
  assert.equal(result.principal.verified, true);
  assert.deepEqual(result.principal.scopes, ['mcp:read', 'pc01:write']);
});

test('fails closed on missing token, wrong audience, expiry, kid and signature', async () => {
  const r = runtime();
  assert.equal((await r.verifyBearer({})).status, 401);
  assert.equal((await r.verifyBearer({ authorization: 'Bearer ' + token({ aud: 'https://other.example/mcp' }) })).status, 401);
  assert.equal((await r.verifyBearer({ authorization: 'Bearer ' + token({ exp: 1800000000 }) })).status, 401);
  assert.equal((await r.verifyBearer({ authorization: 'Bearer ' + token({}, 'other-key') })).status, 401);
  assert.equal((await r.verifyBearer({ authorization: 'Bearer abc.def.ghi' })).status, 401);
});

test('unconfigured runtime returns a deployment blocker, never accepts static input', async () => {
  const r = createOAuthResourceServer({ config: {
    issuerUrl: '', resourceUrl, jwksUrl: '',
    authorizationEndpoint: '', tokenEndpoint: '',
  }});
  assert.equal(r.configured(), false);
  assert.equal((await r.verifyBearer({ authorization: 'Bearer anything' })).status, 503);
});
