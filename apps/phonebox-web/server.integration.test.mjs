import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const password = 'TEST_ONLY_password_not_a_production_secret';
const getPort = async () => {
  const s = net.createServer();
  await new Promise((resolve, reject) => s.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = s.address();
  await new Promise(resolve => s.close(resolve));
  return port;
};

test('two-host HTTP gateway: auth, readonly, settings writes, CSRF and API proxy', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phonebox-gateway-test-'));
  const salt = crypto.randomBytes(20).toString('hex');
  const secret = crypto.randomBytes(48).toString('hex');
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 310000, 32, 'sha256').toString('hex');
  const authFile = path.join(dir, 'auth.json');
  await fs.writeFile(authFile, JSON.stringify({ salt, hash, sessionSecret: secret }));
  const view = await getPort(), admin = await getPort(), upstreamPort = await getPort();
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url.startsWith('/api/') ? 'application/json' : 'text/html');
    res.end(req.url.startsWith('/api/') ? JSON.stringify({ method: req.method, path: req.url }) : '<html>Original PhoneBox UI</html>');
  });
  await new Promise(resolve => upstream.listen(upstreamPort, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['apps/phonebox-web/server.mjs'], {
    env: { ...process.env, PB_VIEW_PORT: String(view), PB_ADMIN_PORT: String(admin), PB_AGENT_PORT: String(upstreamPort), PB_AUTH_FILE: authFile },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', v => { stderr += String(v).slice(0, 1000); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => upstream.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const request = (port, resource, opts = {}) => fetch('http://127.0.0.1:' + port + resource, { redirect: 'manual', ...opts });
  let ready = false;
  for (let i = 0; i < 70; i++) {
    if (child.exitCode !== null) break;
    try {
      const r = await request(view, '/healthz');
      if (r.status === 200) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, 'gateway did not start: ' + stderr);
  assert.equal((await request(view, '/panel/')).status, 303, 'view must require login');
  assert.equal((await request(admin, '/')).status, 303, 'admin must require login');
  const login = async (port, origin, site = 'same-origin') => {
    const r = await request(port, '/__login', {
      method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': site, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password }).toString()
    });
    assert.equal(r.status, 303);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.match(cookie, /Secure/);
    return cookie.split(';')[0];
  };
  const viewCookie = await login(view, 'https://pc01.tigeriq.io.vn', 'same-site');
  const adminCookie = await login(admin, 'https://phonebox.tigeriq.io.vn', 'same-site');
  assert.equal((await request(view, '/panel/', { headers: { Cookie: viewCookie } })).status, 200);
  const state = await request(view, '/agent/api/state', { headers: { Cookie: viewCookie } });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).path, '/api/state');
  assert.equal((await request(view, '/agent/api/widget/home/run', { headers: { Cookie: viewCookie } })).status, 403);
  assert.equal((await request(view, '/agent/api/controls/command/system', { headers: { Cookie: viewCookie } })).status, 403);
  assert.equal((await request(view, '/agent/api/settings', { headers: { Cookie: viewCookie } })).status, 403);
  assert.equal((await request(view, '/agent/api/state', { method: 'POST', headers: { Cookie: viewCookie } })).status, 405);
  assert.equal((await request(admin, '/api/settings', { headers: { Cookie: viewCookie } })).status, 303, 'sessions must remain host-scoped');
  assert.equal((await request(admin, '/api/restart', { method: 'POST', headers: { Cookie: adminCookie } })).status, 403);
  assert.equal((await request(admin, '/api/approvals', { headers: { Cookie: adminCookie } })).status, 403);
  assert.equal((await request(admin, '/api/settings', {
    method: 'PUT', headers: { Cookie: adminCookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}'
  })).status, 403);
  const write = await request(admin, '/api/settings', {
    method: 'PUT',
    headers: { Cookie: adminCookie, Origin: 'https://phonebox.tigeriq.io.vn', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    body: '{"layout":[]}'
  });
  assert.equal(write.status, 200);
  assert.deepEqual(await write.json(), { method: 'PUT', path: '/api/settings' });
});
