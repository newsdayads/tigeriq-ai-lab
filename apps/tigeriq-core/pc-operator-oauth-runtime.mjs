import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { exactHttpsUrl, protectedResourceMetadata, bearerChallenge } from './pc-operator-oauth-policy.mjs';

function b64url(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(text + '='.repeat((4 - text.length % 4) % 4), 'base64');
}
function jsonPart(value, label) {
  try { return JSON.parse(b64url(value).toString('utf8')); }
  catch { throw new Error(label); }
}
function audienceList(aud) {
  if (typeof aud === 'string') return [aud];
  return Array.isArray(aud) ? aud.filter(v => typeof v === 'string') : [];
}
function scopeList(payload) {
  if (typeof payload.scope === 'string') return payload.scope.split(/\s+/).filter(Boolean);
  return Array.isArray(payload.scopes) ? payload.scopes.filter(v => typeof v === 'string') : [];
}
function requiredConfig(config) {
  const issuerUrl = exactHttpsUrl(config.issuerUrl);
  const resourceUrl = exactHttpsUrl(config.resourceUrl, { resource: true });
  const jwksUrl = exactHttpsUrl(config.jwksUrl);
  return { issuerUrl, resourceUrl, jwksUrl };
}

export function oauthRuntimeConfig(env = process.env) {
  const config = {
    issuerUrl: String(env.TIGERIQ_OAUTH_ISSUER || '').trim(),
    resourceUrl: String(env.TIGERIQ_OAUTH_RESOURCE || '').trim(),
    jwksUrl: String(env.TIGERIQ_OAUTH_JWKS_URL || '').trim(),
    authorizationEndpoint: String(env.TIGERIQ_OAUTH_AUTHORIZATION_ENDPOINT || '').trim(),
    tokenEndpoint: String(env.TIGERIQ_OAUTH_TOKEN_ENDPOINT || '').trim(),
    registrationEndpoint: String(env.TIGERIQ_OAUTH_REGISTRATION_ENDPOINT || '').trim(),
  };
  return Object.freeze(config);
}

export function createOAuthResourceServer({
  config = oauthRuntimeConfig(),
  fetchImpl = fetch,
  now = () => Math.floor(Date.now() / 1000),
  cacheTtlMs = 300000,
  clockSkewSec = 60,
} = {}) {
  let jwksCache = null;
  let jwksFetchedAt = 0;

  function configured() {
    try { requiredConfig(config); return true; } catch { return false; }
  }
  function protectedMetadata() {
    const { issuerUrl, resourceUrl } = requiredConfig(config);
    return protectedResourceMetadata({ resourceUrl, issuerUrl });
  }
  function authorizationMetadata() {
    const { issuerUrl, jwksUrl } = requiredConfig(config);
    const authorizationEndpoint = exactHttpsUrl(config.authorizationEndpoint);
    const tokenEndpoint = exactHttpsUrl(config.tokenEndpoint);
    const metadata = {
      issuer: issuerUrl,
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      jwks_uri: jwksUrl,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    };
    if (config.registrationEndpoint) metadata.registration_endpoint = exactHttpsUrl(config.registrationEndpoint);
    return Object.freeze(metadata);
  }
  async function jwks() {
    const { jwksUrl } = requiredConfig(config);
    if (jwksCache && Date.now() - jwksFetchedAt < cacheTtlMs) return jwksCache;
    const response = await fetchImpl(jwksUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('OAUTH_JWKS_HTTP_ERROR');
    const body = await response.json();
    if (!body || !Array.isArray(body.keys) || body.keys.length === 0) throw new Error('OAUTH_JWKS_INVALID');
    jwksCache = body.keys.filter(key => key && key.kty === 'RSA' && typeof key.kid === 'string'
      && typeof key.n === 'string' && typeof key.e === 'string');
    jwksFetchedAt = Date.now();
    if (jwksCache.length === 0) throw new Error('OAUTH_JWKS_NO_RSA_KEYS');
    return jwksCache;
  }
  async function verifyBearer(headers = {}) {
    if (!configured()) return { ok: false, status: 503, reason: 'OAUTH_RUNTIME_NOT_CONFIGURED' };
    const header = String(headers.authorization || '');
    const match = header.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return { ok: false, status: 401, reason: 'OAUTH_TOKEN_REQUIRED' };
    const token = match[1];
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, status: 401, reason: 'OAUTH_TOKEN_MALFORMED' };
    try {
      const headerPart = jsonPart(parts[0], 'OAUTH_HEADER_INVALID');
      const payload = jsonPart(parts[1], 'OAUTH_PAYLOAD_INVALID');
      if (headerPart.alg !== 'RS256' || typeof headerPart.kid !== 'string') throw new Error('OAUTH_ALGORITHM_OR_KID_INVALID');
      const signingInput = Buffer.from(parts[0] + '.' + parts[1]);
      const signature = b64url(parts[2]);
      const key = (await jwks()).find(candidate => candidate.kid === headerPart.kid);
      if (!key || !verifySignature('RSA-SHA256', signingInput, createPublicKey({ key, format: 'jwk' }), signature))
        throw new Error('OAUTH_SIGNATURE_INVALID');
      const { issuerUrl, resourceUrl } = requiredConfig(config);
      const nowSeconds = Number(now());
      const aud = audienceList(payload.aud);
      if (payload.iss !== issuerUrl || !aud.includes(resourceUrl)
        || typeof payload.sub !== 'string' || !payload.sub
        || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds
        || (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > nowSeconds + clockSkewSec))) {
        throw new Error('OAUTH_CLAIMS_INVALID');
      }
      return { ok: true, status: 200, principal: {
        verified: true, iss: issuerUrl, aud, sub: payload.sub, exp: payload.exp, scopes: scopeList(payload),
      }};
    } catch (error) {
      return { ok: false, status: 401, reason: String(error?.message || error) };
    }
  }
  return Object.freeze({
    config,
    configured,
    protectedMetadata,
    authorizationMetadata,
    verifyBearer,
    challenge({ error = null, scope = null } = {}) {
      return bearerChallenge({ resourceUrl: config.resourceUrl, error, scope });
    },
  });
}
