import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouterServer, resolveRoute } from '../apps/tigeriq-subdomain-router/server.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
function stop(server) { return new Promise((resolve) => server.close(resolve)); }

test('wildcard router defaults to 404, dynamically registers one-label hosts and isolates origin', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tigeriq-subdomain-'));
  const registry = join(dir, 'subdomains.json');
  writeFileSync(registry, '{"version":1,"routes":{}}');
  const origin = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, forwardedHost: req.headers['x-forwarded-host'] }));
  });
  const originPort = await listen(origin);
  const router = createRouterServer({ registryPath: registry });
  const routerPort = await listen(router);
  t.after(async () => { await stop(router); await stop(origin); rmSync(dir, { recursive: true, force: true }); });
  const send = (host, path = '/x') => new Promise((resolve, reject) => {
    // Node fetch ignores caller-specified Host; use raw HTTP request to test virtual hosting.
    const req = httpRequest({ hostname: '127.0.0.1', port: routerPort, path, headers: { Host: host } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end();
  });

  assert.equal((await send('unregistered.tigeriq.io.vn')).status, 404);
  assert.equal((await send('evil.com')).status, 404);
  assert.equal((await send('a.b.tigeriq.io.vn')).status, 404);
  assert.equal((await send('tigeriq.io.vn')).status, 404);
  assert.equal((await send('localhost')).status, 404);
  assert.equal((await send('localhost', '/__router/healthz')).status, 200);

  writeFileSync(registry, JSON.stringify({ version: 1, routes: { 'my-app.tigeriq.io.vn': { port: originPort } } }));
  const success = await send('my-app.tigeriq.io.vn', '/hello?ready=1');
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { path: '/hello?ready=1', forwardedHost: 'my-app.tigeriq.io.vn' });
  assert.equal((await send('unknown.tigeriq.io.vn')).status, 404);
  assert.equal((await send('MY-APP.tigeriq.io.vn')).status, 200);
  assert.equal(resolveRoute('my-app.tigeriq.io.vn', registry)?.port, originPort);

  writeFileSync(registry, '{"version":1,"routes":{"my-app.tigeriq.io.vn":{"port":1}}}');
  assert.equal((await send('my-app.tigeriq.io.vn')).status, 404);
  writeFileSync(registry, 'INVALID_JSON');
  assert.equal((await send('my-app.tigeriq.io.vn')).status, 404);
});
