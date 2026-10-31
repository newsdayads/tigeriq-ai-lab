// #5365 — Source-only, fail-closed OAuth resource-server contract.
// IMPORTANT: This module neither issues tokens nor authenticates a request.
// A future HTTP adapter MUST cryptographically validate each access token
// against a trusted issuer/JWKS, audience, expiry and subject BEFORE passing
// its verified principal here. Never treat a caller-provided `verified` flag
// as authentication. A successful policy check is not a Core write lease.

export const MCP_RESOURCE_PATH = '/mcp';
export const OAUTH_SCOPES = Object.freeze([
  'mcp:read', 'pc01:write', 'pc01:execute', 'pc01:ui', 'pc01:admin', 'offline_access',
]);

const readTools = [
  'paperclip_lab_preflight', 'paperclip_lab_health',
  'file_read', 'file_list', 'file_stat', 'file_search',
  'process_list', 'task_list', 'service_status', 'docker_status',
  'wsl_status', 'ui_window_list', 'core_status', 'ollama_status',
  'log_read', 'rdc_pool_status', 'work_order_status',
];
const restrictedTools = {
  file_write: ['pc01:write'],
  shell_exec: ['pc01:execute'],
  task_action: ['pc01:admin'],
  ui_screenshot: ['pc01:ui'],
  ui_action: ['pc01:ui'],
  test_run: ['pc01:execute'],
  evidence_record: ['pc01:write'],
  paperclip_lab_broker_install: ['pc01:admin'],
};
export const TOOL_SCOPE_POLICY = Object.freeze({
  ...Object.fromEntries(readTools.map(name => [name, Object.freeze(['mcp:read'])])),
  ...Object.fromEntries(Object.entries(restrictedTools).map(([name, scopes]) =>
    [name, Object.freeze(['mcp:read', ...scopes])])),
});

export function exactHttpsUrl(input, { resource = false } = {}) {
  if (typeof input !== 'string' || input.length > 2048 || /[\r\n\x00-\x1f]/.test(input))
    throw new Error('OAUTH_URL_INVALID');
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error('OAUTH_URL_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.hostname.endsWith('.') ||
      (resource && parsed.pathname !== MCP_RESOURCE_PATH))
    throw new Error('OAUTH_URL_NOT_ALLOWED');
  return parsed.href;
}

export function protectedResourceMetadata({ resourceUrl, issuerUrl }) {
  return Object.freeze({
    resource: exactHttpsUrl(resourceUrl, { resource: true }),
    authorization_servers: [exactHttpsUrl(issuerUrl)],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
  });
}

export function bearerChallenge({ resourceUrl, error = null, scope = null }) {
  const resource = new URL(exactHttpsUrl(resourceUrl, { resource: true }));
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource/mcp`;
  if (error !== null && !['invalid_token', 'insufficient_scope'].includes(error))
    throw new Error('OAUTH_ERROR_NOT_ALLOWED');
  if (scope !== null && !OAUTH_SCOPES.includes(scope))
    throw new Error('OAUTH_SCOPE_NOT_ALLOWED');
  const details = [`resource_metadata="${metadataUrl}"`];
  if (error) details.push(`error="${error}"`);
  if (scope) details.push(`scope="${scope}"`);
  return `Bearer ${details.join(', ')}`;
}

// Precondition: verifiedPrincipal originated from cryptographically validated
// transport middleware, NEVER directly from a request or MCP tool arguments.
// No method here may create, renew, or replace an actual Core lease.
export function authorizeVerifiedTool({ verifiedPrincipal, toolName, issuerUrl,
  resourceUrl, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const required = TOOL_SCOPE_POLICY[toolName];
  if (!required) return { ok: false, reason: 'UNKNOWN_MCP_TOOL' };
  let issuer, resource;
  try {
    issuer = exactHttpsUrl(issuerUrl);
    resource = exactHttpsUrl(resourceUrl, { resource: true });
  } catch { return { ok: false, reason: 'OAUTH_CONFIGURATION_INVALID' }; }
  const p = verifiedPrincipal;
  if (!p || p.verified !== true || typeof p.sub !== 'string' || !p.sub ||
      p.iss !== issuer || !Number.isFinite(p.exp) || p.exp <= nowSeconds ||
      !Number.isFinite(nowSeconds) || !Array.isArray(p.aud) ||
      !p.aud.includes(resource)) return { ok: false, reason: 'OAUTH_PRINCIPAL_INVALID' };
  // Strictly a validated string-array of scopes, not an untrusted scope claim.
  if (!Array.isArray(p.scopes) || p.scopes.some(s => typeof s !== 'string'))
    return { ok: false, reason: 'OAUTH_SCOPES_INVALID' };
  const missing = required.filter(s => !p.scopes.includes(s));
  if (missing.length) return { ok: false, reason: 'OAUTH_INSUFFICIENT_SCOPE', missing };
  return { ok: true, requiresCoreLease: toolName in restrictedTools,
    principalSubject: p.sub };
}
