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
    if (req.url === '/json-404') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not found"}');
    }
    if (req.url === '/text-500') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      return res.end('server error');
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
    if (req.url === '/meta-unquoted-name') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Unquoted Name</title><meta name=description content="Quoted content valid"></head><body><h1>Audit</h1></body></html>');
    }
    if (req.url === '/meta-unquoted-content') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><head><title>Unquoted Content</title><meta content=Unquoted name=description></head><body><h1>Audit</h1></body></html>");
    }
    if (req.url === '/meta-decoy') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Decoy</title><meta data-name="description" content="Fake description"><meta content="Actual description" name="description"></head><body><h1>Audit</h1></body></html>');
    }
    if (req.url === '/meta-only-decoy') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Only decoy</title><meta data-name="description" content="Not real"></head><body><h1>Audit</h1></body></html>');
    }
    if (req.url === '/marker-script') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><script>const marker = "<!--";</script><title>Script Marker Live</title><meta name="description" content="script marker valid"></head><body><h1>Script Marker H1</h1><a href="/page2">Go</a><!-- trailing comment --></body></html>');
    }
    if (req.url === '/marker-style') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><head><style>.test::before{content:'<!--'}</style><title>Style Marker Live</title></head><body><h1>Style Marker H1</h1><a href=\"/page2\">Go</a><!-- trailing comment --></body></html>");
    }
    if (req.url === '/marker-comment') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><!-- <script>const injected = "<h1>Fake</h1>";</script><title>Fake</title> --><title>Comment Marker Live</title></head><body><h1>Comment Marker H1</h1><a href="/page2">Go</a></body></html>');
    }
    if (req.url === '/inert-seo') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><head><!-- <title>Comment Title</title><meta name=\"description\" content=\"Decoy\"> -->\n<script>const inject = '<h1>Script Fake</h1><a href=\"/missing\">';</script>\n<style>.rule:after { content:'<h1>Style Fake</h1>'; }</style>\n<title>Actual Title</title><meta name=\"description\" content=\"Actual Description\"></head>\n<body><!-- <h1>Comment Fake</h1> --><h1>Actual H1</h1></body></html>");
    }
    if (req.url === '/inert-links') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><body><!-- <a href=\"/missing\">Ghost Comment</a> -->\n<script>const fake = '<a href=\"/missing\">Ghost Script</a>';</script>\n<style>div:after { content:'<a href=\"/missing\">Ghost Style</a>'; }</style>\n<a href=\"/page2\">Actual Link</a></body></html>");
    }
    if (req.url === '/links-unquoted') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Unquoted Links</title></head><body><a href=/page2>Valid link</a></body></html>');
    }
    if (req.url === '/links-fragment') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Fragment Links</title></head><body><a href="/page2#details">Valid fragment</a></body></html>');
    }
    if (req.url === '/links-decoy') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Decoy Links</title></head><body><a data-href="/missing">Not a link</a><a href="https://external.example/not-ours">External</a></body></html>');
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

test('same-origin crawler discovers valid unquoted href attributes', async () => {
  const result = await auditWebsite(`${baseUrl}/links-unquoted`, {
    maxPages: 2,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.pages[1].seo.title, 'Page Two');
});

test('same-origin crawler strips fragments from valid quoted href links', async () => {
  const result = await auditWebsite(`${baseUrl}/links-fragment`, {
    maxPages: 2,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.pages[1].url.endsWith('/page2'), true);
});

test('same-origin crawler ignores data-href decoys and external destinations', async () => {
  const result = await auditWebsite(`${baseUrl}/links-decoy`, {
    maxPages: 2,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 1);
  assert.equal(result.metrics.errorCount, 0);
});

test('SEO extraction accepts valid unquoted HTML meta description attributes', async () => {
  const name = await auditWebsite(`${baseUrl}/meta-unquoted-name`, { resolveTargetFn: localResolver });
  const content = await auditWebsite(`${baseUrl}/meta-unquoted-content`, { resolveTargetFn: localResolver });
  assert.equal(name.pages[0].seo.metaDescription, 'Quoted content valid');
  assert.equal(content.pages[0].seo.metaDescription, 'Unquoted');
});

test('SEO extraction does not mistake data-name for exact name attribute', async () => {
  const decoy = await auditWebsite(`${baseUrl}/meta-decoy`, { resolveTargetFn: localResolver });
  const onlyDecoy = await auditWebsite(`${baseUrl}/meta-only-decoy`, { resolveTargetFn: localResolver });
  assert.equal(decoy.pages[0].seo.metaDescription, 'Actual description');
  assert.equal(onlyDecoy.pages[0].seo.metaDescription, null);
});

test('literal HTML comment opener inside script and style cannot erase live SEO or links', async () => {
  for (const [path, title, heading] of [
    ['/marker-script', 'Script Marker Live', 'Script Marker H1'],
    ['/marker-style', 'Style Marker Live', 'Style Marker H1'],
  ]) {
    const result = await auditWebsite(`${baseUrl}${path}`, { maxPages: 2, resolveTargetFn: localResolver });
    assert.equal(result.status, 'success');
    assert.equal(result.metrics.pagesAudited, 2);
    assert.equal(result.pages[0].seo.title, title);
    assert.deepEqual(result.pages[0].seo.h1, [heading]);
    assert.equal(result.pages[1].seo.title, 'Page Two');
  }
});

test('HTML comment containing fake script and title remains inert', async () => {
  const result = await auditWebsite(`${baseUrl}/marker-comment`, {
    maxPages: 2, resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.pages[0].seo.title, 'Comment Marker Live');
  assert.deepEqual(result.pages[0].seo.h1, ['Comment Marker H1']);
  assert.equal(result.pages[1].seo.title, 'Page Two');
});

test('SEO extraction ignores commented and script/style fake title, meta and H1', async () => {
  const result = await auditWebsite(`${baseUrl}/inert-seo`, { resolveTargetFn: localResolver });
  const seo = result.pages[0].seo;
  assert.equal(seo.title, 'Actual Title');
  assert.equal(seo.metaDescription, 'Actual Description');
  assert.equal(seo.h1Count, 1);
  assert.deepEqual(seo.h1, ['Actual H1']);
});

test('same-origin crawler ignores fake anchor tags in inert HTML regions', async () => {
  const result = await auditWebsite(`${baseUrl}/inert-links`, {
    maxPages: 3,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.metrics.errorCount, 0);
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

test('preserves HTTP 404/500 errors even for non-HTML error bodies', async () => {
  for (const [url, status] of [['/json-404', 404], ['/text-500', 500]]) {
    await assert.rejects(
      () => auditWebsite(`${baseUrl}${url}`, { resolveTargetFn: localResolver }),
      err => err instanceof AuditError && err.code === 'NON_2XX' && err.detail === status
    );
  }
  await assert.rejects(
    () => auditWebsite(`${baseUrl}/json`, { resolveTargetFn: localResolver }),
    err => err instanceof AuditError && err.code === 'UNSUPPORTED_CONTENT_TYPE'
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
