import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const OWNER_EMAIL = String(process.env.TIGERIQ_OWNER_EMAIL || 'newsdayads@gmail.com').trim().toLowerCase();
const CLIENT_ID = String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET || '').trim();
const REDIRECT_URI = String(process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI || '').trim();
const SESSION_SECRET = String(process.env.TIGERIQ_OWNER_SESSION_SECRET || '').trim();
const SESSION_COOKIE = 'tigeriq_owner_session';
const STATE_COOKIE = 'tigeriq_owner_oauth_state';
const MAX_AGE_SECONDS = 8 * 60 * 60;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function configured() {
  return Boolean(OWNER_EMAIL && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI && SESSION_SECRET);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
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
  if (!configured()) return null;
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
  setCookie(res, STATE_COOKIE, '', 0);
}

function safeProviderErrorCode(value) {
  const code = String(value || 'unknown_error').trim().toLowerCase();
  return code.replace(/[^a-z0-9_.-]/g, '_').slice(0, 64) || 'unknown_error';
}

async function exchangeCode(code) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    throw new Error(`google_token_exchange_failed:${safeProviderErrorCode(tokens?.error)}`);
  }
  const accessToken = String(tokens?.access_token || '');
  if (!accessToken) throw new Error('google_access_token_missing');
  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) throw new Error('google_userinfo_failed');
  const user = await userResponse.json();
  const identity = safeIdentity(user);
  if (identity.email !== OWNER_EMAIL || user?.email_verified !== true) throw new Error('owner_email_not_authorized');
  return identity;
}

export default async function handler(req, res) {
  const action = String(new URL(req.url || '/', 'https://localhost').searchParams.get('action') || 'status');
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  if (action === 'status') {
    const identity = getOwnerSession(req);
    return json(res, 200, {
      ok: true,
      configured: configured(),
      authenticated: Boolean(identity),
      identity,
      authorization: {
        authority: 'TigerIQ',
        role: identity ? 'Owner' : null,
        implementedRoles: ['Owner'],
        requestedRoles: ['Owner', 'Admin', 'Nhân viên', 'Chỉ xem'],
        providerInterface: '06-work-management-rbac-required',
        googleControlsAuthorization: false,
      },
    });
  }

  if (action === 'logout') {
    clearOwnerCookies(res);
    return redirect(res, '/?owner=disconnected');
  }

  if (!configured()) return json(res, 503, { error: 'owner_auth_not_configured' });

  if (action === 'login') {
    const nonce = randomBytes(24).toString('base64url');
    const state = `${nonce}.${sign(nonce)}`;
    setCookie(res, STATE_COOKIE, state, 600);
    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.search = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    }).toString();
    return redirect(res, authorize.toString());
  }

  if (action === 'callback') {
    const url = new URL(req.url || '/', 'https://localhost');
    const expected = cookies(req)[STATE_COOKIE] || '';
    const state = url.searchParams.get('state') || '';
    const [nonce, signature] = state.split('.');
    if (!nonce || !signature || !safeEqual(state, expected) || !safeEqual(sign(nonce), signature)) return json(res, 400, { error: 'invalid_oauth_state' });
    try {
      const identity = await exchangeCode(String(url.searchParams.get('code') || ''));
      setCookie(res, SESSION_COOKIE, sessionValue(identity));
      setCookie(res, STATE_COOKIE, '', 0);
      return redirect(res, '/?owner=connected');
    } catch (error) {
      return json(res, 403, { error: String(error instanceof Error ? error.message : error).slice(0, 96) });
    }
  }

  return json(res, 400, { error: 'unsupported_action' });
}
