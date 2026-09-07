import { isOwnerAuthorized } from './owner-auth.mjs';
import { oneCommandWebControlPlan } from './web-control-loop.mjs';

export function isExactWebControlCommand(value) {
  return String(value ?? '').trim() === '1';
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function serverSecretAuthorized(req) {
  const expected = String(process.env.TIGERIQ_COMMAND_SECRET || '');
  const supplied = String(req.headers?.['x-tigeriq-secret'] || '');
  return Boolean(expected && supplied && expected === supplied);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      lane: 'web-control',
      authenticated: isOwnerAuthorized(req) || serverSecretAuthorized(req),
      state: 'idle',
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  if (!isOwnerAuthorized(req) && !serverSecretAuthorized(req)) {
    return json(res, 401, { ok: false, lane: 'web-control', state: 'authorization-required', error: 'owner_authorization_required' });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  let payload = {};
  try { payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch {
    return json(res, 400, { ok: false, lane: 'web-control', state: 'blocked', error: 'invalid_json' });
  }

  const command = String(payload.command ?? payload.message ?? '').trim();
  if (!isExactWebControlCommand(command)) {
    return json(res, 400, { ok: false, lane: 'web-control', state: 'blocked', error: 'unsupported_command' });
  }

  const plan = oneCommandWebControlPlan({
    command,
    findings: Array.isArray(payload.findings) ? payload.findings : [],
    backlog: Array.isArray(payload.backlog) ? payload.backlog : [],
    authorization: { owner: true, offMain: true },
    currentStage: String(payload.currentStage || 'queued'),
  });

  return json(res, 200, {
    ok: true,
    lane: 'web-control',
    command,
    state: plan.cycle?.state || 'done',
    plan,
    evidence: { source: 'web-control-loop', deterministic: true, offMain: true },
  });
}
