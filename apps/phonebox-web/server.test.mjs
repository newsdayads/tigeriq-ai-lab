import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
const tmp = mkdtempSync(join(tmpdir(), 'phonebox-web-test-'));
const salt = 'aa'.repeat(16);
const pass = 'local-test-password';
const hash = pbkdf2Sync(pass, Buffer.from(salt, 'hex'), 210000, 32, 'sha256').toString('hex');
const panel = join(tmp, 'assets');
mkdirSync(panel);
writeFileSync(join(panel, 'index.html'), '<!doctype html><title>Original PhoneBox Panel</title>');
writeFileSync(join(tmp, 'auth.json'), JSON.stringify({ method: 'pbkdf2-sha256', iterations: 210000, salt, hash }));
process.env.PHONEBOX_PANEL_ROOT = panel;
process.env.PHONEBOX_WEB_AUTH_FILE = join(tmp, 'auth.json');
const { createApplication, viewAllowed, redact } = await import('./server.mjs');

test('read-only API explicitly denies mutations and unsafe GET actions', () => {
  assert.equal(viewAllowed('GET', '/api/state'), true);
  assert.equal(viewAllowed('GET', '/api/config'), true);
  assert.equal(viewAllowed('GET', '/api/procs/detail'), true);
  assert.equal(viewAllowed('POST', '/api/state'), false);
  assert.equal(viewAllowed('GET', '/api/restart'), false);
  assert.equal(viewAllowed('GET', '/api/volume'), false);
  assert.equal(viewAllowed('GET', '/api/controls/command/volume'), false);
  assert.equal(viewAllowed('GET', '/api/phone/install'), false);
});
test('recursive config redaction keeps layout while hiding tokens', () => {
  assert.deepEqual(redact({ config: { pages: [{ widgets: [{ type: 'stat' }] }], lan: { token: 'private', enabled: false }, password: 'hidden' } }), { config: { pages: [{ widgets: [{ type: 'stat' }] }], lan: { enabled: false } } });
});
test('both frontends require login; only view serves original panel', async () => {
  const run = async (mode) => {
    const server = createApplication(mode);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
      const health = await fetch(base + '/healthz');
      assert.equal(health.status, 200);
      const unauthorized = await fetch(base + '/');
      assert.equal(unauthorized.status, 200);
      assert.match(await unauthorized.text(), /Đăng nhập/);
      const privateApi = await fetch(base + (mode === 'view' ? '/agent/api/state' : '/api/state'));
      assert.equal(privateApi.status, 401);
      const denied = await fetch(base + '/login', { method: 'POST', body: 'password=incorrect', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      assert.equal(denied.status, 401);
      const auth = await fetch(base + '/login', { method: 'POST', body: 'password=' + encodeURIComponent(pass), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
      assert.equal(auth.status, 303);
      const cookie = auth.headers.get('set-cookie').split(';')[0];
      const page = await fetch(base + '/', { headers: { cookie } });
      if (mode === 'view') {
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Original PhoneBox Panel/);
      } else {
        // With a live PhoneBox agent, admin proxy must render the original settings UI;
        // CI runners without the agent return a safe 502, not unauthenticated content.
        assert.ok([200, 502].includes(page.status));
        if (page.status === 200) assert.match(await page.text(), /PhoneBox Settings/);
      }
      if (mode === 'view') {
        const action = await fetch(base + '/agent/api/restart', { headers: { cookie } });
        assert.equal(action.status, 405);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
  await run('view');
  await run('admin');
});
test('cleanup', () => rmSync(tmp, { recursive: true, force: true }));
