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

const port = async () => {
  const s = net.createServer();
  await new Promise((resolve, reject) => s.once('error', reject).listen(0, '127.0.0.1', resolve));
  const value = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return value;
};
test('direct public sites render without login, sanitize data, block all changes and raw admin APIs', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phonebox-public-'));
  const auth = path.join(dir, 'auth.json');
  await fs.writeFile(auth, JSON.stringify({
    salt: crypto.randomBytes(24).toString('hex'), hash: crypto.randomBytes(32).toString('hex'),
    sessionSecret: crypto.randomBytes(48).toString('hex')
  }));
  const view = await port(), admin = await port(), origin = await port();
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/config')) return res.end(JSON.stringify({
      version: 'private-config', config: {
        lan: { token: 'SECRET_LAN_TOKEN_DO_NOT_LEAK' }, webhooks: { key: 'SECRET_WEBHOOK' },
        display: { accent: '#2dd4bf', language: 'vi' },
        pages: [
          { id: 'home', title: 'Private-owner-name', enabled: true, widgets: [
            { id: 'one', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: { status: true, weather: true } },
            { id: 'two', type: 'stat', x: 1, y: 4, w: 3, h: 2, options: { metric: 'cpu', privateToken: 'PRIVATE' } },
            { id: 'three', type: 'sessions', x: 0, y: 0, w: 6, h: 4, options: { sensitive: 'SESSIONS_PRIVATE' } }
          ]},
          { id: 'secret', title: 'PRIVATE_PROJECT_TITLE', enabled: true, widgets: [
            { type: 'note', options: { text: 'TOP_SECRET_NOTE' } }
          ]}
        ]
      }
    }));
    if (req.url.startsWith('/api/state')) return res.end(JSON.stringify({
      host: 'PRIVATE_COMPUTER_NAME', events: [{ payload: 'PRIVATE_EVENT' }],
      os: 'windows', pc: {
        cpu: 25, ramUsedGb: 32, ramTotalGb: 64,
        gpu: { name: 'PRIVATE_GPU_NAME', util: 37, temp: 45, driver: 'PRIVATE_DRIVER' },
        netDownBps: 1000, netUpBps: 2000, uptimeSec: 12345,
        disks: [{ name: 'C:\\SECRET_DRIVE', usedGb: 10, totalGb: 100 }]
      },
      media: { title: 'PRIVATE_TRACK' },
      work: { conversations: [{ title: 'SECRET_CONVERSATION' }] }
    }));
    if (req.url.startsWith('/api/info')) return res.end(JSON.stringify({
      version: '0.9.27', adb: 'C:\\SECRET_PATH\\adb.exe',
      connected: true, via: 'USB', devices: ['PRIVATE_SERIAL'],
      configPath: 'C:\\SECRET_PATH\\config.json', logPath: 'PRIVATE_LOG'
    }));
    if (req.url.startsWith('/api/lan')) return res.end(JSON.stringify({
      configured: true, active: true, port: 8766, hosts: ['PRIVATE_LAN_IP'],
      fingerprint: 'SECRET_PIN'
    }));
    if (req.url.startsWith('/api/catalog')) return res.end(JSON.stringify({
      cols: 12, rows: 6, widgets: [{ type: 'clock', name: 'Clock' }],
      templates: []
    }));
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/') return res.end('<!doctype html><html><head><title>PhoneBox</title></head><body><div id="pageTabs">UPSTREAM_ORIGINAL_SETTINGS</div></body></html>');
    res.end('<html><title>Original PhoneBox UI</title>static-original-panel</html>');
  });
  await new Promise(resolve => upstream.listen(origin, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['apps/phonebox-web/server.mjs'], {
    env: { ...process.env, PB_PUBLIC_READONLY: '1', PB_VIEW_PORT: String(view),
      PB_ADMIN_PORT: String(admin), PB_AGENT_PORT: String(origin), PB_AUTH_FILE: auth },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let err = '';
  child.stderr.on('data', x => { err += String(x).slice(0, 1000); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => upstream.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const get = (p, route, opts = {}) => fetch('http://127.0.0.1:' + p + route, { redirect: 'manual', ...opts });
  let started = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await get(view, '/healthz')).status === 200) { started = true; break; }
    } catch {}
    await delay(90);
  }
  assert.equal(started, true, 'gateway startup failed: ' + err);
  const viewRoot = await get(view, '/');
  assert.equal(viewRoot.status, 303);
  assert.equal(viewRoot.headers.get('location'), '/panel/');
  const viewPanel = await get(view, '/panel/');
  assert.equal(viewPanel.status, 200);
  assert.match(await viewPanel.text(), /Original PhoneBox UI/);
  const adminPage = await get(admin, '/');
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /UPSTREAM_ORIGINAL_SETTINGS/, 'must serve real upstream settings, not custom replacement');
  assert.match(adminHtml, /PhoneBox gốc trên PC01/);
  assert.match(adminHtml, /Chế độ chỉ xem/);
  assert.match(adminHtml, /tigeriq-readonly-style/);
  assert.doesNotMatch(adminHtml, /SECRET|PRIVATE|name="password"/);
  const originalSettingsResponse = await get(admin, '/api/settings');
  assert.equal(originalSettingsResponse.status, 200, 'original editor must receive sanitized settings data');
  const editorText = await originalSettingsResponse.text();
  assert.doesNotMatch(editorText, /SECRET|PRIVATE|webhookToken.*[A-Za-z0-9]{18}|PRIVATE_PROJECT_TITLE/);
  const editor = JSON.parse(editorText);
  assert.equal(editor.pages.length, 1, 'unknown private pages must not leak');
  assert.equal(editor.pages[0].title, 'Home');
  assert.equal(editor.pages[0].widgets.length, 3);
  assert.deepEqual(editor.pages[0].widgets[2].options, {}, 'session metadata must be stripped');
  assert.equal(editor.lan.token, '');
  assert.equal(editor.lan.webhookToken, '');
  const infoResponse = await get(admin, '/api/info');
  assert.equal(infoResponse.status, 200);
  const infoText = await infoResponse.text();
  assert.doesNotMatch(infoText, /SECRET|PRIVATE/);
  assert.equal(JSON.parse(infoText).via, 'USB');
  const lanResponse = await get(admin, '/api/lan');
  assert.equal(lanResponse.status, 200);
  const lanText = await lanResponse.text();
  assert.doesNotMatch(lanText, /SECRET|PRIVATE/);
  assert.deepEqual(JSON.parse(lanText).hosts, []);
  assert.equal((await get(admin, '/api/catalog')).status, 200);
  const config = await get(view, '/agent/api/config');
  assert.equal(config.status, 200);
  const configText = await config.text();
  assert.doesNotMatch(configText, /SECRET|PRIVATE|webhook|sessions|"lan"|"token"/);
  const cfg = JSON.parse(configText);
  assert.equal(cfg.config.pages.length, 1);
  assert.deepEqual(cfg.config.pages[0].widgets.map(w => w.type), ['clock', 'stat']);
  const state = await get(view, '/agent/api/state');
  assert.equal(state.status, 200);
  const stateText = await state.text();
  assert.doesNotMatch(stateText, /SECRET|PRIVATE|events.*payload|driver|track/i);
  const st = JSON.parse(stateText);
  assert.equal(st.pc.cpu, 25);
  assert.equal(st.pc.disks[0].name, 'Disk 1');
  assert.equal(st.host, 'PC01');
  for (const p of [view, admin]) {
    assert.equal((await get(p, '/__login')).status, 303, 'login must redirect to front page');
    assert.equal((await get(p, '/agent/api/stream')).status, 204);
    for (const path of ['/api/config', '/agent/api/quotas', '/agent/api/work', '/api/restart', '/api/controls/state']) {
      assert.equal((await get(p, path)).status, 404, 'private path leaked: ' + path);
    }
    if (p === view) {
      assert.equal((await get(p, '/api/settings')).status, 404);
      assert.equal((await get(p, '/api/info')).status, 404);
    }
    for (const path of ['/api/settings', '/api/controls/command/restart', '/agent/api/controls/command/power', '/__login']) {
      assert.equal((await get(p, path, { method: 'POST', body: '{}' })).status, 405,
        'mutating path not blocked: ' + path);
    }
  }
});
