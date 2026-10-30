import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pcOperatorAdminVerifySpec, PC_OPERATOR_MCP_TOOLS } from '../apps/tigeriq-core/pc-operator-mcp.mjs';
import { authorizeVerifiedTool } from '../apps/tigeriq-core/pc-operator-oauth-policy.mjs';

const repoRoot = process.cwd();

test('keeps admin verification inside existing task_action surface', () => {
  assert.equal(PC_OPERATOR_MCP_TOOLS.length, 25);
  assert.equal(PC_OPERATOR_MCP_TOOLS.includes('task_action'), true);
  assert.equal(PC_OPERATOR_MCP_TOOLS.includes('admin_shell'), false);
  const spec = pcOperatorAdminVerifySpec({ nonce: '12345678-1234-1234-1234-1234567890ab' });
  assert.equal(spec.action, 'verify_admin');
  assert.equal(spec.taskName, 'TigerIQ PC Operator Admin Verify');
  assert.equal(spec.bridgePath, 'D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\run-pc-operator-admin-verify-task.ps1');
  assert.equal(spec.receiptPath, 'D:\\TigerIQ\\Evidence\\gh5365-admin-verify-12345678-1234-1234-1234-1234567890ab.json');
  assert.throws(() => pcOperatorAdminVerifySpec({ nonce: '..\\escape' }), /MCP_SCOPED_ADMIN_NONCE_INVALID/);
});

test('task_action still requires the cryptographically verified pc01:admin scope', () => {
  const base = {
    verified: true,
    iss: 'https://pc01.tail35d2f3.ts.net/',
    aud: ['https://pc01.tail35d2f3.ts.net/mcp'],
    sub: 'owner',
    exp: 1900000000,
  };
  const call = scopes => authorizeVerifiedTool({
    verifiedPrincipal: { ...base, scopes },
    toolName: 'task_action',
    issuerUrl: base.iss,
    resourceUrl: base.aud[0],
    nowSeconds: 1800000000,
  });
  assert.equal(call(['mcp:read', 'pc01:admin']).ok, true);
  assert.equal(call(['mcp:read', 'pc01:execute']).ok, false);
});

test('bridge is one-shot highest-runlevel, fixed-runner, and self-cleaning', () => {
  const source = readFileSync(repoRoot + '/scripts/pc-worker/run-pc-operator-admin-verify-task.ps1', 'utf8');
  assert.match(source, /TigerIQ PC Operator Admin Verify/);
  assert.match(source, /RunLevel Highest/);
  assert.match(source, /pc01\\wdragons12x/);
  assert.match(source, /pc-operator-admin-verify\.ps1/);
  assert.match(source, /Unregister-ScheduledTask/);
  assert.match(source, /ADMIN_VERIFY_TASK_CLEANUP_UNVERIFIED/);
  assert.doesNotMatch(source, /-Verb\s+RunAs/i);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /cmd\.exe/i);
});

test('elevated worker is read-only and refuses SYSTEM acceptance', () => {
  const source = readFileSync(repoRoot + '/scripts/pc-worker/pc-operator-admin-verify.ps1', 'utf8');
  assert.match(source, /fltmc\.exe/);
  assert.match(source, /WindowsBuiltInRole\]::Administrator/);
  assert.match(source, /S-1-5-18/);
  assert.match(source, /isSystem=\$IsSystem/);
  assert.match(source, /accepted=\$Accepted/);
  assert.doesNotMatch(source, /Remove-Item|Set-ExecutionPolicy|net\s+user|sc\.exe\s+(?:create|delete)|reg\.exe\s+(?:add|delete)/i);
  assert.doesNotMatch(source, /Invoke-Expression|-Verb\s+RunAs/i);
});
