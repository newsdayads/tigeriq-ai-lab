import autoWorkHandler from './auto-work.mjs';
import { verifyGitHubActionsOidc } from './github-actions-oidc.mjs';

export const config = { maxDuration: 60 };

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const COMMAND_SECRET = String(process.env.TIGERIQ_COMMAND_SECRET || '').trim();
const EXPECTED_WORKFLOW_REF = `${REPO}/.github/workflows/auto-work.yml@refs/heads/main`;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.end(JSON.stringify(body));
}

function bearer(req) {
  return String(req?.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!COMMAND_SECRET) return json(res, 503, { error: 'auto_work_internal_secret_unavailable' });

  try {
    const token = bearer(req);
    await verifyGitHubActionsOidc(token, {
      repository: REPO,
      audience: 'tigeriq-auto-work',
      workflowRef: EXPECTED_WORKFLOW_REF,
      ref: 'refs/heads/main',
      eventNames: ['schedule', 'workflow_dispatch'],
    });

    const headers = { ...(req.headers || {}) };
    delete headers.origin;
    delete headers.referer;
    delete headers['sec-fetch-site'];
    delete headers['sec-fetch-mode'];
    headers.authorization = '';
    headers['x-tigeriq-secret'] = COMMAND_SECRET;
    const internalReq = { ...req, method: 'POST', headers };
    return autoWorkHandler(internalReq, res);
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error).startsWith('github_oidc_')
      ? String(error instanceof Error ? error.message : error)
      : 'github_oidc_rejected';
    return json(res, 401, { error: code });
  }
}
