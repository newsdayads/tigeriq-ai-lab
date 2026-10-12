import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createViewRelay } from '../apps/tigeriq-core/health-view-relay.mjs';
import { resolveViewPath } from '../api/pc01-view.mjs';

const TOKEN = 'A'.repeat(48);
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function stop(server) { await new Promise((done, reject) => server.close(e => e ? reject(e) : done())); }

test('PC01 relay forwards ONLY authenticated, allowlisted reads', async () => {
  const seen = [];
  const core = createServer((req, res) => {
    seen.push([req.method, req.url, req.headers.authorization, req.headers.cookie]);
    res.writeHead(200, { 'content-type': req.url === '/' ? 'text/html' : 'application/json' });
    res.end(req.url === '/' ? '<main>PC01</main>' : JSON.stringify({ ok:true, source:'PC01' }));
  });
  const upstream = await listen(core);
  const relay = createViewRelay({ token:TOKEN, upstream });
  const url = await listen(relay);
  const options = { headers: { 'x-tigeriq-origin-token': TOKEN } };
  try {
    assert.equal((await fetch(url + '/')).status, 401);
    assert.equal((await fetch(url + '/api/status', { headers: { 'x-tigeriq-origin-token':'bad' } })).status, 401);
    assert.equal((await fetch(url + '/api/objectives', options)).status, 404);
    assert.equal((await fetch(url + '/api/status?x=1', options)).status, 400);
    assert.equal((await fetch(url + '/api/work-history?number=1&x=2', options)).status, 400);
    assert.equal((await fetch(url + '/api/work-history?number=0', options)).status, 400);
    assert.equal((await fetch(url + '/api/status', { ...options, method:'POST' })).status, 405);
    const html = await fetch(url + '/', options);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /PC01/);
    const json = await fetch(url + '/api/work-history?number=4708',
      {headers: {'x-tigeriq-origin-token':TOKEN, authorization:'Bearer should-not-leak', cookie:'a=b'}});
    assert.equal(json.status, 200);
    assert.equal((await json.json()).source, 'PC01');
    assert.deepEqual(seen.map(v=>v[1]), ['/', '/api/work-history?number=4708']);
    assert.ok(seen.every(v => !v[2] && !v[3]), 'never forward credentials from the web client');
  } finally { await stop(relay); await stop(core); }
});

test('Vercel view routes never allow arbitrary Core paths', () => {
  assert.equal(resolveViewPath('dashboard'), '/');
  assert.equal(resolveViewPath('status'), '/api/status');
  assert.equal(resolveViewPath('history','4708'), '/api/work-history?number=4708');
  assert.equal(resolveViewPath('history','../../control'), null);
  assert.equal(resolveViewPath('health','4708'), null);
  assert.equal(resolveViewPath('history'), null);
});
