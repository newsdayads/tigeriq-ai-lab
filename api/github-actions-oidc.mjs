import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const MAX_TOKEN_BYTES = 20_000;
const CLOCK_SKEW_SECONDS = 30;

function decodeJsonPart(value, label) {
  try {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
  } catch {
    throw new Error(`github_oidc_invalid_${label}`);
  }
}

function audienceMatches(value, expected) {
  if (typeof value === 'string') return value === expected;
  return Array.isArray(value) && value.includes(expected);
}

export function validateGitHubActionsClaims(claims, {
  repository,
  audience = 'tigeriq-auto-work',
  workflowRef,
  ref = 'refs/heads/main',
  eventNames = ['schedule', 'workflow_dispatch'],
  nowMs = Date.now(),
} = {}) {
  if (!claims || typeof claims !== 'object') throw new Error('github_oidc_claims_required');
  const now = Math.floor(Number(nowMs) / 1000);
  if (claims.iss !== ISSUER) throw new Error('github_oidc_bad_issuer');
  if (!audienceMatches(claims.aud, audience)) throw new Error('github_oidc_bad_audience');
  if (!repository || claims.repository !== repository) throw new Error('github_oidc_bad_repository');
  if (!workflowRef || claims.workflow_ref !== workflowRef) throw new Error('github_oidc_bad_workflow_ref');
  if (claims.ref !== ref) throw new Error('github_oidc_bad_ref');
  if (!eventNames.includes(String(claims.event_name || ''))) throw new Error('github_oidc_bad_event');
  if (claims.runner_environment !== 'github-hosted') throw new Error('github_oidc_bad_runner');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < now - CLOCK_SKEW_SECONDS) throw new Error('github_oidc_expired');
  if (Number.isFinite(Number(claims.nbf)) && Number(claims.nbf) > now + CLOCK_SKEW_SECONDS) throw new Error('github_oidc_not_yet_valid');
  if (Number.isFinite(Number(claims.iat)) && Number(claims.iat) > now + CLOCK_SKEW_SECONDS) throw new Error('github_oidc_future_issued');
  return claims;
}

export async function verifyGitHubActionsOidc(token, options = {}) {
  const text = String(token || '').trim();
  if (!text || Buffer.byteLength(text) > MAX_TOKEN_BYTES) throw new Error('github_oidc_invalid_token');
  const parts = text.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('github_oidc_invalid_token');
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJsonPart(encodedHeader, 'header');
  const claims = decodeJsonPart(encodedClaims, 'claims');
  if (header.alg !== 'RS256' || !header.kid) throw new Error('github_oidc_bad_header');

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(JWKS_URL, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'tigeriq-github-oidc' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response?.ok) throw new Error('github_oidc_jwks_unavailable');
  const jwks = await response.json();
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find((item) => item?.kid === header.kid && item?.kty === 'RSA') : null;
  if (!jwk) throw new Error('github_oidc_unknown_key');

  let key;
  try { key = createPublicKey({ key: jwk, format: 'jwk' }); }
  catch { throw new Error('github_oidc_invalid_key'); }
  const verified = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    key,
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!verified) throw new Error('github_oidc_bad_signature');

  return validateGitHubActionsClaims(claims, options);
}
