import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';

const OWNER_EMAIL = String(process.env.TIGERIQ_OWNER_EMAIL || 'newsdayads@gmail.com').trim().toLowerCase();
const CLIENT_ID = String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_ID || '').trim();
const SESSION_SECRET = String(process.env.TIGERIQ_OWNER_SESSION_SECRET || '').trim();
const SESSION_COOKIE = 'tigeriq_owner_session';
const LEGACY_STATE_COOKIE = 'tigeriq_owner_oauth_state';
const MAX_AGE_SECONDS = 8 * 60 * 60;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
let jwksCache = { expiresAt: 0, keys: new Map() };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function ownerAuthConfigured() {
  return Boolean(OWNER_EMAIL && CLIENT_ID && SESSION_SECRET);
}

export function ownerGoogleClientId() {
  return CLIENT_ID;
}

function cookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter((entry) => entry.length === 2));
}

function sign(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function setCookie(res, name, value, maxAge = MAX_AGE_SECONDS) {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  const current = typeof res.getHeader === 'function' ? res.getHeader('set-cookie') : undefined;
  const next = current === undefined
    ? [cookie]
    : Array.isArray(current)
      ? [...current, cookie]
      : [String(current), cookie];
  res.setHeader('set-cookie', next);
}

function safeIdentity(input = {}) {
  const email = String(input?.email || '').trim().toLowerCase();
  const name = String(input?.name || '').trim().slice(0, 120);
  const pictureRaw = String(input?.picture || '').trim();
  const picture = /^https:\/\//i.test(pictureRaw) ? pictureRaw.slice(0, 1000) : '';
  return { email, name: name || email, picture: picture || null };
}

function sessionValue(identity) {
  const safe = safeIdentity(identity);
  const payload = Buffer.from(JSON.stringify({
    ...safe,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function getOwnerSession(req) {
  if (!ownerAuthConfigured()) return null;
  const raw = cookies(req)[SESSION_COOKIE] || '';
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (String(value?.email || '').trim().toLowerCase() !== OWNER_EMAIL) return null;
    if (Number(value?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return safeIdentity(value);
  } catch {
    return null;
  }
}

export function isOwnerAuthorized(req) {
  return Boolean(getOwnerSession(req));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

function clearOwnerCookies(res) {
  setCookie(res, SESSION_COOKIE, '', 0);
  setCookie(res, LEGACY_STATE_COOKIE, '', 0);
}

function parseMaxAge(header) {
  const match = String(header || '').match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Math.max(60, Math.min(Number(match[1]), 86400)) : 3600;
}

async function fetchGoogleKeys(force = false) {
  const now = Date.now();
  if (!force && jwksCache.expiresAt > now && jwksCache.keys.size) return jwksCache.keys;
  const response = await fetch(GOOGLE_JWKS_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('google_jwks_unavailable');
  const body = await response.json().catch(() => ({}));
  const keys = new Map();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk?.kid && jwk?.kty === 'RSA') keys.set(String(jwk.kid), jwk);
  }
  if (!keys.size) throw new Error('google_jwks_empty');
  jwksCache = {
    keys,
    expiresAt: now + parseMaxAge(response.headers.get('cache-control')) * 1000,
  };
  return keys;
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('google_id_token_malformed');
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { parts, header, payload };
  } catch {
    throw new Error('google_id_token_malformed');
  }
}

async function verifyGoogleIdToken(token) {
  const parsed = parseJwt(token);
  const { parts, header, payload } = parsed;
  if (header?.alg !== 'RS256' || !header?.kid) throw new Error('google_id_token_algorithm_invalid');

  let keys = await fetchGoogleKeys(false);
  let jwk = keys.get(String(header.kid));
  if (!jwk) {
    keys = await fetchGoogleKeys(true);
    jwk = keys.get(String(header.kid));
  }
  if (!jwk) throw new Error('google_id_token_key_unknown');

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new Error('google_id_token_key_invalid');
  }
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  if (!verifySignature('RSA-SHA256', signed, publicKey, signature)) throw new Error('google_id_token_signature_invalid');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload?.aud) ? payload.aud.map(String) : [String(payload?.aud || '')];
  if (!GOOGLE_ISSUERS.has(String(payload?.iss || ''))) throw new Error('google_id_token_issuer_invalid');
  if (!audiences.includes(CLIENT_ID)) throw new Error('google_id_token_audience_invalid');
  if (payload?.azp && String(payload.azp) !== CLIENT_ID) throw new Error('google_id_token_authorized_party_invalid');
  if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= now) throw new Error('google_id_token_expired');
  if (Number.isFinite(Number(payload?.iat)) && Number(payload.iat) > now + 300) throw new Error('google_id_token_issued_at_invalid');
  if (payload?.email_verified !== true) throw new Error('google_email_not_verified');

  const identity = safeIdentity(payload);
  if (!identity.email || identity.email !== OWNER_EMAIL) throw new Error('owner_email_not_authorized');
  return identity;
}

function sameOriginBrowserRequest(req) {
  const site = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) return false;
  const origin = String(req.headers?.origin || '').trim();
  const host = String(req.headers?.host || '').trim();
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  const chunks = [];
  if (req?.[Symbol.asyncIterator]) {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function authorization(identity) {
  return {
    authority: 'TigerIQ',
    role: identity ? 'Owner' : null,
    implementedRoles: ['Owner'],
    requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem'],
    providerInterface: '06-work-management-rbac-required',
    googleControlsAuthorization: false,
  };
}

export default async function handler(req, res) {
  const action = String(new URL(req.url || '/', 'https://localhost').searchParams.get('action') || 'status');

  if (req.method === 'GET' && action === 'status') {
    const identity = getOwnerSession(req);
    return json(res, 200, {
      ok: true,
      configured: ownerAuthConfigured(),
      identityMode: 'google_id_token',
      clientSecretRequired: false,
      googleClientId: CLIENT_ID || null,
      authenticated: Boolean(identity),
      identity,
      authorization: authorization(identity),
    });
  }

  if (req.method === 'GET' && action === 'logout') {
    clearOwnerCookies(res);
    return redirect(res, '/?owner=disconnected');
  }

  if (req.method === 'GET' && (action === 'login' || action === 'callback')) {
    return json(res, 410, { error: 'oauth_code_flow_retired', identityMode: 'google_id_token' });
  }

  if (req.method === 'POST' && action === 'identity') {
    if (!ownerAuthConfigured()) return json(res, 503, { error: 'owner_auth_not_configured' });
    if (!sameOriginBrowserRequest(req)) return json(res, 403, { error: 'cross_origin_identity_rejected' });
    try {
      const body = await readJsonBody(req);
      const credential = String(body?.credential || '');
      if (!credential) return json(res, 400, { error: 'google_credential_missing' });
      const identity = await verifyGoogleIdToken(credential);
      setCookie(res, SESSION_COOKIE, sessionValue(identity));
      setCookie(res, LEGACY_STATE_COOKIE, '', 0);
      return json(res, 200, {
        ok: true,
        authenticated: true,
        identity,
        authorization: authorization(identity),
      });
    } catch (error) {
      return json(res, 403, { error: String(error instanceof Error ? error.message : error).slice(0, 96) });
    }
  }

  return json(res, 405, { error: 'method_not_allowed' });
}
