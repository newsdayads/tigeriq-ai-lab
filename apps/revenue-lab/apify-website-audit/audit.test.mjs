import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { auditWebsite, AuditError, resolveSafeTarget } from './audit-engine.mjs';

let server;
let baseUrl;
const localResolver = async () => ({ address: '127.0.0.1', family: 4 });

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/slow') {
      return setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<title>Slow</title><h1>Slow</h1>');
      }, 400);
    }
    if (req.url === '/large') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<title>Large</title>' + 'x'.repeat(8192));
    }
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<h1>Missing</h1>');
    }
    if (req.url === '/r1') {
      res.writeHead(302, { location: '/r2' });
      return res.end();
    }
    if (req.url === '/r2') {
      res.writeHead(302, { location: '/r3' });
      return res.end();
    }
    if (req.url === '/r3') {
      res.writeHead(302, { location: '/' });
      return res.end();
    }
    if (req.url === '/page2') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Page Two</title></head><body><h1>Second</h1><p>Useful content here.</p></body></html>');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>Audit Home</title><meta name="description" content="Evidence first audit"></head><body><h1>Home</h1><p>One two three four.</p><a href="/page2">Next</a></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://audit.test:${port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('real bounded crawl derives evidence from fetched HTML', async () => {
  const result = await auditWebsite(`${baseUrl}/`, {
    maxPages: 2,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.schemaVersion, '1.0');
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.metrics.externalApiCostUSD, 0);
  assert.equal(result.metrics.platformCostUSD, null);
  assert.equal(result.metrics.platformCostStatus, 'pending_private_apify_run');
  assert.equal(result.pages[0].seo.title, 'Audit Home');
  assert.equal(result.pages[0].seo.metaDescription, 'Evidence first audit');
  assert.equal(result.pages[0].seo.h1Count, 1);
  assert.equal(result.pages[1].seo.title, 'Page Two');
});

test('rejects invalid, unsupported, credential-bearing, and literal private targets', async () => {
  await assert.rejects(() => auditWebsite('not-a-url'), err => err instanceof AuditError && err.code === 'INVALID_URL');
  await assert.rejects(() => auditWebsite('file:///etc/passwd'), err => err instanceof AuditError && err.code === 'UNSUPPORTED_PROTOCOL');
  await assert.rejects(() => auditWebsite('http://user:pass@example.com'), err => err instanceof AuditError && err.code === 'CREDENTIALS_REJECTED');
  await assert.rejects(() => auditWebsite('http://127.0.0.1'), err => err instanceof AuditError && err.code === 'PRIVATE_TARGET');
});

test('rejects DNS answers that resolve to private space', async () => {
  await assert.rejects(
    () => resolveSafeTarget('http://safe-name.test', { lookupFn: async () => [{ address: '10.0.0.5', family: 4 }] }),
    err => err instanceof AuditError && err.code === 'PRIVATE_TARGET'
  );
});

test('enforces response byte limit', async () => {
  await assert.rejects(
    () => auditWebsite(`${baseUrl}/large`, { maxBytes: 1024, resolveTargetFn: localResolver }),
    err => err instanceof AuditError && err.code === 'OVERSIZED_RESPONSE'
  );
});

test('enforces timeout', async () => {
  await assert.rejects(
    () => auditWebsite(`${baseUrl}/slow`, { timeoutMs: 250, resolveTargetFn: localResolver }),
    err => err instanceof AuditError && err.code === 'TIMEOUT'
  );
});

test('rejects non HTML and non-2xx responses with stable codes', async () => {
  await assert.rejects(
    () => auditWebsite(`${baseUrl}/json`, { resolveTargetFn: localResolver }),
    err => err instanceof AuditError && err.code === 'UNSUPPORTED_CONTENT_TYPE'
  );
  await assert.rejects(
    () => auditWebsite(`${baseUrl}/missing`, { resolveTargetFn: localResolver }),
    err => err instanceof AuditError && err.code === 'NON_2XX'
  );
});

test('caps redirects and revalidates each hop', async () => {
  await assert.rejects(
    () => auditWebsite(`${baseUrl}/r1`, { maxRedirects: 2, resolveTargetFn: localResolver }),
    err => err instanceof AuditError && err.code === 'TOO_MANY_REDIRECTS'
  );
  const result = await auditWebsite(`${baseUrl}/r1`, { maxRedirects: 3, resolveTargetFn: localResolver });
  assert.equal(result.status, 'success');
  assert.equal(result.pages[0].redirectCount, 3);
});

test('benchmark: 20 deterministic valid runs achieve at least 95 percent success', async () => {
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const started = Date.now();
    try {
      const result = await auditWebsite(`${baseUrl}/?run=${i}`, {
        maxPages: 1,
        resolveTargetFn: localResolver,
      });
      runs.push({ ok: result.status === 'success', durationMs: Date.now() - started });
    } catch {
      runs.push({ ok: false, durationMs: Date.now() - started });
    }
  }
  const successCount = runs.filter(run => run.ok).length;
  const successRate = successCount / runs.length;
  const durations = runs.map(run => run.durationMs);
  const evidence = {
    runCount: runs.length,
    successCount,
    successRate,
    minDurationMs: Math.min(...durations),
    maxDurationMs: Math.max(...durations),
    avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    externalApiCostUSD: 0,
    platformCostUSD: null,
    platformCostStatus: 'pending_private_apify_run',
  };
  console.log('TIGERIQ_BENCHMARK_EVIDENCE=' + JSON.stringify(evidence));
  assert.equal(runs.length, 20);
  assert.ok(successRate >= 0.95);
});
