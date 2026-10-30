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

test('normal MCP bridge uses only a preinstalled persistent highest task', () => {
  const source = readFileSync(repoRoot + '/scripts/pc-worker/run-pc-operator-admin-verify-task.ps1', 'utf8');
  assert.match(source, /TigerIQ PC Operator Admin Verify/);
  assert.match(source, /ADMIN_VERIFY_BROKER_NOT_INSTALLED/);
  assert.match(source, /Get-ScheduledTask/);
  assert.match(source, /Start-ScheduledTask/);
  assert.match(source, /TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V1/);
  assert.match(source, /verify-request\.json/);
  assert.match(source, /taskPersistent=\$TaskPersistent/);
  assert.match(source, /requestDeleted=\$RequestDeleted/);
  assert.doesNotMatch(source, /Register-ScheduledTask/);
  assert.doesNotMatch(source, /Unregister-ScheduledTask/);
  assert.doesNotMatch(source, /-Verb\s+RunAs/i);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /cmd\.exe/i);
});

test('admin principal validation compares Windows SIDs, not local account text', () => {
  const runner = readFileSync(repoRoot + '/scripts/pc-worker/run-pc-operator-admin-verify-task.ps1', 'utf8');
  const installer = readFileSync(repoRoot + '/scripts/pc-worker/install-pc-operator-admin-verify-task.ps1', 'utf8');
  for (const source of [runner, installer]) {
    assert.match(source, /\$ExpectedSid=.*SecurityIdentifier/);
    assert.match(source, /\$TaskSid=.*SecurityIdentifier/);
    assert.match(source, /\$TaskSid -ne \$ExpectedSid/);
    assert.doesNotMatch(source, /\$Task\.Principal\.UserId -ine \$ExpectedUser/);
  }
  assert.match(runner, /GetCurrent\(\)\.User\.Value -ne \$ExpectedSid/);
  assert.match(installer, /\$Identity\.User\.Value -ne \$ExpectedSid/);
  assert.match(installer, /\$ExistingSid -eq \$ExpectedSid/);
  assert.match(installer, /ADMIN_VERIFY_INSTALL_UAC_REQUIRED/);
  assert.match(runner, /ADMIN_VERIFY_TASK_RUNLEVEL_MISMATCH/);
});

test('one-time installer requires real UAC and installs only the fixed broker task', () => {
  const source = readFileSync(repoRoot + '/scripts/pc-worker/install-pc-operator-admin-verify-task.ps1', 'utf8');
  assert.match(source, /ADMIN_VERIFY_INSTALL_UAC_REQUIRED/);
  assert.match(source, /WindowsBuiltInRole\]::Administrator/);
  assert.match(source, /ADMIN_VERIFY_INSTALL_SYSTEM_NOT_ALLOWED/);
  assert.match(source, /pc-operator-admin-verify-broker\.ps1/);
  assert.match(source, /New-ScheduledTaskPrincipal[^\r\n]+RunLevel Highest/);
  assert.match(source, /Register-ScheduledTask[^\r\n]+-ErrorAction Stop/);
  assert.match(source, /TIGERIQ_PC_OPERATOR_ADMIN_BROKER_INSTALL_V1/);
  assert.doesNotMatch(source, /-UserId\s+['"]SYSTEM['"]/i);
  assert.doesNotMatch(source, /-Verb\s+RunAs/i);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /cmd\.exe/i);
});

test('elevated persistent broker accepts only fresh verify_elevation requests and refuses SYSTEM', () => {
  const source = readFileSync(repoRoot + '/scripts/pc-worker/pc-operator-admin-verify-broker.ps1', 'utf8');
  assert.match(source, /TIGERIQ_PC_OPERATOR_ADMIN_REQUEST_V1/);
  assert.match(source, /verify_elevation/);
  assert.match(source, /ADMIN_VERIFY_REQUEST_STALE/);
  assert.match(source, /verify-request\.json/);
  assert.match(source, /fltmc\.exe/);
  assert.match(source, /WindowsBuiltInRole\]::Administrator/);
  assert.match(source, /S-1-5-18/);
  assert.match(source, /ADMIN_VERIFY_BROKER_SYSTEM_NOT_ALLOWED/);
  assert.match(source, /Remove-Item -LiteralPath \$RequestPath/);
  assert.doesNotMatch(source, /Invoke-Expression|-Verb\s+RunAs|Start-Process|cmd\.exe/i);
  assert.doesNotMatch(source, /Set-ExecutionPolicy|net\s+user|sc\.exe\s+(?:create|delete)|reg\.exe\s+(?:add|delete)/i);
});
