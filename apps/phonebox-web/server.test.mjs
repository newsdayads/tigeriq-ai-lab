import test from 'node:test';
import assert from 'node:assert/strict';
process.env.PB_NO_LISTEN = '1';
const { allowedView, allowedAdmin, sameOrigin } = await import('./server.mjs');

test('dashboard exposes only read-only agent endpoints and panel', () => {
  for (const path of ['/panel/', '/panel/main.js', '/agent/api/state', '/agent/api/config', '/agent/api/stream', '/agent/api/quotas']) assert.equal(allowedView(path), true, path);
  for (const path of ['/api/settings', '/agent/api/settings', '/agent/api/approvals', '/agent/api/proxy', '/agent/api/claude/hook', '/agent/api/controls/command/power', '/agent/api/phone/install']) assert.equal(allowedView(path), false, path);
});
test('admin allows configuration editing, not arbitrary machine control', () => {
  assert.equal(allowedAdmin('/api/settings', 'GET'), true);
  assert.equal(allowedAdmin('/api/settings', 'PUT'), true);
  assert.equal(allowedAdmin('/api/settings/shortcut-icon', 'POST'), true);
  assert.equal(allowedAdmin('/api/settings/shortcut-icon', 'DELETE'), true);
  for (const p of ['/api/restart', '/api/run/1', '/api/phone/install', '/api/console/profile/slot', '/api/controls/command/power', '/api/procs/kill', '/api/update/apply']) assert.equal(allowedAdmin(p, 'POST'), false, p);
});
test('admin writes require same-origin', () => {
  const base = { headers: { origin: 'https://phonebox.tigeriq.io.vn', 'sec-fetch-site': 'same-origin' } };
  assert.equal(sameOrigin(base, 'admin'), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' } }, 'admin'), false);
  assert.equal(sameOrigin({ headers: { origin: 'https://pc01.tigeriq.io.vn', 'sec-fetch-site': 'same-site' } }, 'admin'), false);
});
