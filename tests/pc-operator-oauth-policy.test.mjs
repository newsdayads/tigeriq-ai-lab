import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MCP_RESOURCE_PATH, OAUTH_SCOPES, TOOL_SCOPE_POLICY,
  exactHttpsUrl, protectedResourceMetadata, bearerChallenge, authorizeVerifiedTool,
} from '../apps/tigeriq-core/pc-operator-oauth-policy.mjs';

const resourceUrl = 'https://pc01.tail35d2f3.ts.net/mcp';
const issuerUrl = 'https://auth.example.com/';
const nowSeconds = 1800000000;
const valid = (scopes = OAUTH_SCOPES) => ({
  verified: true, iss: issuerUrl, aud: [resourceUrl], sub: 'owner-subject',
  exp: nowSeconds + 300, scopes,
});
const call = (toolName, verifiedPrincipal) => authorizeVerifiedTool({
  toolName, verifiedPrincipal, issuerUrl, resourceUrl, nowSeconds,
});

test('25 existing tool names are covered exactly once; all default to a scoped decision', () => {
  assert.equal(Object.keys(TOOL_SCOPE_POLICY).length, 25);
  assert.equal(new Set(Object.keys(TOOL_SCOPE_POLICY)).size, 25);
  assert.equal(MCP_RESOURCE_PATH, '/mcp');
});
test('resource metadata has exact audience, valid issuer and advertised scope list', () => {
  const m = protectedResourceMetadata({ resourceUrl, issuerUrl });
  assert.equal(m.resource, resourceUrl);
  assert.deepEqual(m.authorization_servers, [issuerUrl]);
  assert.deepEqual(m.scopes_supported, OAUTH_SCOPES);
});
test('rejects insecure, injected, secret-bearing or non-canonical endpoints', () => {
  for (const value of ['http://pc01.example/mcp', 'https://u:p@pc01.example/mcp',
    'https://pc01.example/mcp?token=abc', 'https://pc01.example/mcp#x',
    'https://pc01.example/mcp\r\nX-Evil: 1', 'https://pc01.example/other']) {
    assert.throws(() => exactHttpsUrl(value, { resource: true }));
  }
});
test('401 challenge points at path-aware OAuth metadata; never includes secret', () => {
  const c = bearerChallenge({ resourceUrl, error: 'invalid_token' });
  assert.match(c, /^Bearer resource_metadata="https:\/\/pc01\.tail35d2f3\.ts\.net\/\.well-known\/oauth-protected-resource\/mcp", error="invalid_token"$/);
  assert.doesNotMatch(c, /TIGERIQ_HEALTH_VIEW_KEY/i);
});
test('rejects challenge header injection', () => {
  assert.throws(() => bearerChallenge({ resourceUrl, error: 'x\r\n' }));
  assert.throws(() => bearerChallenge({ resourceUrl, scope: 'shell;admin' }));
});
test('missing/unverified principal always denied', () => {
  assert.equal(call('file_list', null).ok, false);
  assert.equal(call('file_list', { ...valid(), verified: false }).ok, false);
});
test('wrong issuer and audience denied even if role and scopes appear valid', () => {
  assert.equal(call('core_status', { ...valid(), iss: 'https://evil.example/' }).ok, false);
  assert.equal(call('core_status', { ...valid(), aud: ['https://other.example/mcp'] }).ok, false);
});
test('missing subject and expired principal denied', () => {
  assert.equal(call('file_read', { ...valid(), sub: '' }).ok, false);
  assert.equal(call('file_read', { ...valid(), exp: nowSeconds }).ok, false);
});
test('read-only principal can access read metadata only', () => {
  assert.equal(call('file_list', valid(['mcp:read'])).ok, true);
  assert.equal(call('file_list', valid(['mcp:read'])).requiresCoreLease, false);
  assert.equal(call('shell_exec', valid(['mcp:read'])).ok, false);
  assert.equal(call('ui_action', valid(['mcp:read'])).ok, false);
});
test('writing requires its own scope and a separate Core lease', () => {
  const result = call('file_write', valid(['mcp:read', 'pc01:write']));
  assert.equal(result.ok, true);
  assert.equal(result.requiresCoreLease, true);
  assert.equal(call('task_action', valid(['mcp:read', 'pc01:write'])).ok, false);
});
test('elevated tool is not authorized by generic write or shell scope', () => {
  assert.deepEqual(call('task_action', valid(['mcp:read', 'pc01:write'])).missing, ['pc01:admin']);
  assert.equal(call('task_action', valid(['mcp:read', 'pc01:admin'])).ok, true);
  assert.equal(call('paperclip_lab_broker_install', valid(['mcp:read', 'pc01:admin'])).requiresCoreLease, true);
});
test('malformed scopes and unknown tool fail closed', () => {
  assert.equal(call('file_list', { ...valid(), scopes: 'mcp:read' }).ok, false);
  assert.equal(call('file_list', { ...valid(), scopes: ['mcp:read', null] }).ok, false);
  assert.equal(call('new_unsafe_tool', valid()).reason, 'UNKNOWN_MCP_TOOL');
});
