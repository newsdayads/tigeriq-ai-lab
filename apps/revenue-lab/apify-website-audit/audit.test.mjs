import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { auditWebsite, AuditError, resolveSafeTarget, isBlockedAddress } from './audit-engine.mjs';

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
    const contentTypeFixtures = {
      '/mime-fake-suffix': 'text/html+json',
      '/mime-fake-xml-suffix': 'application/xhtml+xmlp',
      '/mime-fake-parameter': 'application/json; profile="text/html"',
      '/mime-fake-unrelated': 'application/not-text/html',
      '/mime-valid-html': 'TeXt/HtMl; charset=UTF-8',
      '/mime-valid-xhtml': 'application/xhtml+xml; charset=utf-8',
    };
    if (Object.hasOwn(contentTypeFixtures, req.url)) {
      res.writeHead(200, { 'content-type': contentTypeFixtures[req.url] });
      return res.end('<html><head><title>MIME fixture</title></head><body><h1>MIME</h1></body></html>');
    }
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<h1>Missing</h1>');
    }
    if (req.url === '/invalid-redirect-302' || req.url === '/invalid-redirect-307') {
      res.writeHead(req.url.endsWith('302') ? 302 : 307, {
        location: 'http://[invalid',
      });
      return res.end();
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
    if (req.url === '/tag-prefix-only') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><titlex>Fake title</title></head><body><h1fake>Fake heading</h1></body></html>');
    }
    if (req.url === '/tag-prefix-mixed') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><titlex>Fake title</title><title>Real title</title></head><body><h1fake>Fake heading</h1><h1 class="real">Real heading</h1></body></html>');
    }
    if (req.url === '/seo-html-entities') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>R&amp;D &#x2014; &#169; 2026</title><meta name="description" content="Tom &quot;Jerry&quot; &#38; Co."></head><body><h1>4 &lt; 5 &amp; 6 &gt; 3</h1></body></html>');
    }
    if (req.url === '/meta-quoted-greater-than') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Quoted GT</title><meta data-note="7 > 4" name="description" content="Value > threshold"></head><body><h1>Valid</h1></body></html>');
    }
    if (req.url === '/meta-single-quoted-greater-than') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><head><title>Single quote</title><meta name='description' content='One > zero'></head><body><h1>Valid</h1></body></html>");
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
    if (req.url === '/inert-template') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Live Template Page</title><meta name="description" content="Live content"></head><body><template id="component"><h1>Inert Heading</h1><a href="/missing">Inert link</a></template><h1>Live Heading</h1><a href="/page2">Live link</a></body></html>');
    }
    if (req.url === '/nested-template') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Nested Template</title><meta name="description" content="Live"></head><body><template id="outer"><!-- </template> false closing --><template><h1>Inner Ghost</h1></template><h1>Outer Ghost</h1><a href="/missing">Ghost</a></template><h1>Visible Heading</h1><a href="/page2">Visible link</a></body></html>');
    }
    if (req.url === '/inert-links') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><body><!-- <a href=\"/missing\">Ghost Comment</a> -->\n<script>const fake = '<a href=\"/missing\">Ghost Script</a>';</script>\n<style>div:after { content:'<a href=\"/missing\">Ghost Style</a>'; }</style>\n<a href=\"/page2\">Actual Link</a></body></html>");
    }
    if (req.url === '/links-gt-double') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Link GT double</title></head><body><a data-label="9 > 2" href="/page2">Next</a></body></html>');
    }
    if (req.url === '/links-gt-single') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end("<html><head><title>Link GT single</title></head><body><a aria-label='4 > 3' href='/page2'>Next</a></body></html>");
    }
    if (req.url === '/links-unquoted') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Unquoted Links</title></head><body><a href=/page2>Valid link</a></body></html>');
    }
    const escapedAmp = {
      '/links-html-amp': '&amp;',
      '/links-html-decimal': '&#38;',
      '/links-html-hex': '&#x26;',
    }[req.url];
    if (escapedAmp) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Encoded query</title></head><body><a href="/page2?x=1' + escapedAmp + 'y=2">Next</a></body></html>');
    }
    if (req.url === '/page2?x=1&y=2') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Decoded Query Page</title></head><body><h1>Expected page</h1></body></html>');
    }
    if (req.url === '/links-fragment') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Fragment Links</title></head><body><a href="/page2#details">Valid fragment</a></body></html>');
    }
    if (req.url === '/links-decoy') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Decoy Links</title></head><body><a data-href="/missing">Not a link</a><a href="https://external.example/not-ours">External</a></body></html>');
    }
    if (req.url === '/canonical-redirect') {
      res.writeHead(301, {
        location: `http://www.audit.test:${server.address().port}/canonical-home`,
      });
      return res.end();
    }
    if (req.url === '/canonical-home') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        `<html><head><title>Canonical Home</title></head><body><h1>Home</h1>` +
        `<a href="/page2">Allowed canonical link</a>` +
        `<a href="http://audit.test:${server.address().port}/original-origin-trap">Old origin trap</a>` +
        `</body></html>`
      );
    }
    if (req.url === '/original-origin-trap') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Wrong Origin</title></head><body><h1>Bad</h1></body></html>');
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

test('initial redirect selects canonical origin for subsequent same-origin links', async () => {
  const result = await auditWebsite(`${baseUrl}/canonical-redirect`, {
    maxPages: 3,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.pages.length, 2, 'should ignore the old origin trap after canonical redirect');
  assert.equal(result.pages[0].seo.title, 'Canonical Home');
  assert.equal(result.pages[0].redirectCount, 1);
  assert.equal(result.pages[1].seo.title, 'Page Two');
  assert.ok(result.pages.every(page => new URL(page.url).hostname === 'www.audit.test'));
  assert.ok(result.pages.every(page => !page.url.includes('original-origin-trap')));
  assert.equal(result.requestedUrl, `${baseUrl}/canonical-redirect`);
});

test('later page redirects cannot fetch a different origin while same-origin redirects still work', async () => {
  let foreignGets = 0;
  const auditServer = http.createServer((req, res) => {
    const html = value => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(value);
    };
    if (req.url === '/outside-root') {
      return html('<title>Root</title><h1>Root</h1><a href="/next-outside">Next</a>');
    }
    if (req.url === '/safe-root') {
      return html('<title>Root</title><h1>Root</h1><a href="/next-safe">Next</a>');
    }
    if (req.url === '/next-outside') {
      res.writeHead(302, { location: `http://foreign.audit.test:${auditServer.address().port}/foreign-page` });
      return res.end();
    }
    if (req.url === '/foreign-page') {
      foreignGets++;
      return html('<title>Foreign Page</title><h1>Wrong domain</h1>');
    }
    if (req.url === '/next-safe') {
      res.writeHead(302, { location: '/safe-page' });
      return res.end();
    }
    if (req.url === '/safe-page') {
      return html('<title>Allowed Page</title><h1>Expected domain</h1>');
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(resolve => auditServer.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://canonical.audit.test:${auditServer.address().port}`;
    const guarded = await auditWebsite(origin + '/outside-root', {
      maxPages: 2,
      resolveTargetFn: localResolver,
    });
    assert.equal(guarded.status, 'partial');
    assert.equal(guarded.metrics.pagesAudited, 1);
    assert.deepEqual(guarded.errors.map(error => error.code), ['CROSS_ORIGIN_REDIRECT']);
    assert.equal(foreignGets, 0, 'cross-origin redirect must be rejected before any foreign GET');

    const allowed = await auditWebsite(origin + '/safe-root', {
      maxPages: 2,
      resolveTargetFn: localResolver,
    });
    assert.equal(allowed.status, 'success');
    assert.equal(allowed.metrics.pagesAudited, 2);
    assert.equal(allowed.pages[1].seo.title, 'Allowed Page');
    assert.equal(allowed.pages[1].redirectCount, 1);
  } finally {
    auditServer.closeAllConnections();
    await new Promise(resolve => auditServer.close(resolve));
  }
});

test('same-origin crawler follows href after a greater-than in quoted anchor attributes', async () => {
  for (const path of ['/links-gt-double', '/links-gt-single']) {
    const result = await auditWebsite(`${baseUrl}${path}`, {
      maxPages: 2,
      resolveTargetFn: localResolver,
    });
    assert.equal(result.status, 'success', path);
    assert.equal(result.metrics.pagesAudited, 2, path);
    assert.equal(result.pages[1].url.endsWith('/page2'), true, path);
    assert.equal(result.pages[1].seo.title, 'Page Two', path);
  }
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

test('crawler decodes HTML ampersand entities before requesting same-origin query links', async () => {
  for (const route of ['/links-html-amp', '/links-html-decimal', '/links-html-hex']) {
    const result = await auditWebsite(`${baseUrl}${route}`, {
      maxPages: 2,
      resolveTargetFn: localResolver,
    });
    assert.equal(result.status, 'success', route);
    assert.equal(result.metrics.pagesAudited, 2, route);
    assert.equal(result.pages[1].seo.title, 'Decoded Query Page', route);
    assert.equal(new URL(result.pages[1].url).search, '?x=1&y=2', route);
  }
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

test('SEO extraction ignores tag-name prefix decoys but accepts real title and H1', async () => {
  const decoys = await auditWebsite(`${baseUrl}/tag-prefix-only`, { resolveTargetFn: localResolver });
  assert.equal(decoys.pages[0].seo.title, null);
  assert.equal(decoys.pages[0].seo.h1Count, 0);
  assert.ok(decoys.pages[0].findings.some(finding => finding.code === 'MISSING_TITLE'));
  assert.ok(decoys.pages[0].findings.some(finding => finding.code === 'MISSING_H1'));

  const mixed = await auditWebsite(`${baseUrl}/tag-prefix-mixed`, { resolveTargetFn: localResolver });
  assert.equal(mixed.pages[0].seo.title, 'Real title');
  assert.equal(mixed.pages[0].seo.h1Count, 1);
  assert.deepEqual(mixed.pages[0].seo.h1, ['Real heading']);
  assert.ok(!mixed.pages[0].findings.some(finding => finding.code === 'MULTIPLE_H1'));
});

test('SEO extraction renders HTML character references as readable real-world title, meta and H1', async () => {
  const result = await auditWebsite(`${baseUrl}/seo-html-entities`, {
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.pages[0].seo.title, 'R&D — © 2026');
  assert.equal(result.pages[0].seo.metaDescription, 'Tom "Jerry" & Co.');
  assert.deepEqual(result.pages[0].seo.h1, ['4 < 5 & 6 > 3']);
  assert.deepEqual(result.pages[0].findings, []);
});

test('SEO extraction preserves quoted greater-than characters in meta tag attributes', async () => {
  const doubleQuoted = await auditWebsite(`${baseUrl}/meta-quoted-greater-than`, { resolveTargetFn: localResolver });
  const singleQuoted = await auditWebsite(`${baseUrl}/meta-single-quoted-greater-than`, { resolveTargetFn: localResolver });
  assert.equal(doubleQuoted.pages[0].seo.metaDescription, 'Value > threshold');
  assert.equal(singleQuoted.pages[0].seo.metaDescription, 'One > zero');
  for (const result of [doubleQuoted, singleQuoted]) {
    assert.equal(result.status, 'success');
    assert.equal(result.pages[0].findings.some(finding => finding.code === 'MISSING_META_DESCRIPTION'), false);
  }
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

test('HTML template content cannot fabricate visible H1 or crawl links', async () => {
  const result = await auditWebsite(`${baseUrl}/inert-template`, {
    maxPages: 2,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.metrics.errorCount, 0);
  assert.deepEqual(result.pages[0].seo.h1, ['Live Heading']);
  assert.equal(result.pages[0].seo.h1Count, 1);
  assert.ok(!result.pages[0].findings.some(f => f.code === 'MULTIPLE_H1'));
  assert.equal(result.pages[1].seo.title, 'Page Two');
});

test('nested HTML templates and commented closing tags do not fabricate SEO or crawl pages', async () => {
  const result = await auditWebsite(`${baseUrl}/nested-template`, {
    maxPages: 3,
    resolveTargetFn: localResolver,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.metrics.pagesAudited, 2);
  assert.equal(result.metrics.errorCount, 0);
  assert.deepEqual(result.pages[0].seo.h1, ['Visible Heading']);
  assert.equal(result.pages[0].seo.h1Count, 1);
  assert.equal(result.pages[1].seo.title, 'Page Two');
  assert.ok(!result.pages[0].findings.some(finding => finding.code === 'MULTIPLE_H1'));
});

test('rejects invalid, unsupported, credential-bearing, and literal private targets', async () => {
  await assert.rejects(() => auditWebsite('not-a-url'), err => err instanceof AuditError && err.code === 'INVALID_URL');
  await assert.rejects(() => auditWebsite('file:///etc/passwd'), err => err instanceof AuditError && err.code === 'UNSUPPORTED_PROTOCOL');
  await assert.rejects(() => auditWebsite('http://user:pass@example.com'), err => err instanceof AuditError && err.code === 'CREDENTIALS_REJECTED');
  await assert.rejects(() => auditWebsite('http://127.0.0.1'), err => err instanceof AuditError && err.code === 'PRIVATE_TARGET');
});

test('IANA documentation, transition and reserved IPs are not publicly auditable', () => {
  const nonPublic = [
    '192.0.0.170', '192.0.2.1', '192.88.99.1',
    '198.51.100.30', '203.0.113.9',
    '2001:db8::1', '2001:0db8::1', '3fff::1',
    '2002:7f00:1::', '2001:0:abcd::1',
    '64:ff9b::7f00:1', '64:ff9b:1::7f00:1',
    '100::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
  ];
  for (const address of nonPublic) {
    assert.equal(isBlockedAddress(address), true, 'unexpected public classification: ' + address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isBlockedAddress(address), false, 'unexpected blocked public address: ' + address);
  }
});


test('premature HTTP response body disconnect fails safely instead of crashing the audit', async () => {
  // The server sends valid response headers and a partial HTML body before
  // terminating the socket. Node IncomingMessage emits error/close on res,
  // not reliably on the original request object.
  const source = http.createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': '4096',
    });
    res.flushHeaders();
    res.write('<html><title>TRUNCATED IS NOT SUCCESS</title>');
    setTimeout(() => res.destroy(), 15);
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://audit.test:' + source.address().port + '/premature';
    await assert.rejects(
      () => auditWebsite(url, { timeoutMs: 1000, resolveTargetFn: localResolver }),
      err => err instanceof AuditError && err.code === 'NETWORK_FAILURE',
      'a truncated HTML response must not be mistaken for a successful audit',
    );
  } finally {
    source.closeAllConnections();
    await new Promise(resolve => source.close(resolve));
  }
});

test('IPv6 fe00 reserved, link-local and deprecated fec0 site-local never pass public-target screening', async () => {
  // IANA IPv6 Address Space: fe00::/9 reserved, fe80::/10 link-local,
  // fec0::/10 deprecated site-local (RFC 3879). Include both range edges.
  const nonGlobal = [
    'fe00::1', 'fe7f::1', 'fe80::1', 'febf::1',
    'fec0::1', 'fec0:0000::7', 'fedf::1', 'feff::1',
  ];
  for (const address of nonGlobal) {
    assert.equal(isBlockedAddress(address), true,
      'non-global IPv6 was accepted: ' + address);
  }
  for (const address of ['fe00::1', 'fec0::1', 'feff::1']) {
    await assert.rejects(
      () => resolveSafeTarget('https://public-audit.invalid/', {
        lookupFn: async () => [
          { address: '2606:4700:4700::1111', family: 6 },
          { address, family: 6 },
        ],
      }),
      error => error instanceof AuditError && error.code === 'PRIVATE_TARGET',
      'mixed public + reserved IPv6 DNS answer must fail: ' + address,
    );
  }
});

test('literal IPv6 private and reserved targets reject before any DNS or injected resolver', async () => {
  const blocked = [
    'http://[::1]/', 'http://[fe80::1]/', 'http://[fec0::1]/',
    'http://[::ffff:7f00:1]/', 'https://[2001:db8::1]/',
  ];
  for (const url of blocked) {
    let lookups = 0;
    await assert.rejects(
      () => resolveSafeTarget(url, { lookupFn: async () => {
        lookups++;
        return [{ address: '8.8.8.8', family: 4 }];
      }}),
      e => e instanceof AuditError && e.code === 'PRIVATE_TARGET',
      url + ': DNS lookup cannot authorize an IP literal',
    );
    assert.equal(lookups, 0, url + ': IP literal must not query DNS');
    await assert.rejects(
      () => resolveSafeTarget(new URL(url), { lookupFn: async () => {
        throw new Error('never call this');
      }}),
      e => e instanceof AuditError && e.code === 'PRIVATE_TARGET',
    );
    await assert.rejects(
      () => auditWebsite(url, {
        resolveTargetFn: async () => ({ address: '8.8.8.8', family: 4 }),
      }),
      e => e instanceof AuditError && e.code === 'PRIVATE_TARGET',
      url + ': injected resolver cannot bypass literal IP validation',
    );
  }
});

test('public IPv6 URL literal resolves directly, never using DNS or a mismatched family', async () => {
  let lookups = 0;
  for (const url of [
    'https://[2606:4700:4700::1111]/',
    'https://[2001:4860:4860::8888]/',
  ]) {
    const result = await resolveSafeTarget(new URL(url), { lookupFn: async () => {
      lookups++;
      return [{ address: '127.0.0.1', family: 4 }];
    }});
    assert.equal(result.family, 6);
    assert.equal(result.address, new URL(url).hostname.slice(1, -1));
  }
  assert.equal(lookups, 0, 'IPv6 literals must never be treated as DNS names');
});

test('IPv4 private literal rejects before custom resolver reaches a socket', async () => {
  await assert.rejects(
    () => auditWebsite('http://127.0.0.1/', {
      resolveTargetFn: async () => ({ address: '8.8.8.8', family: 4 }),
    }),
    e => e instanceof AuditError && e.code === 'PRIVATE_TARGET',
  );
});

test('mixed DNS answers fail closed if any resolved address is IANA reserved', async () => {
  for (const address of ['192.0.2.4', '198.51.100.2', '203.0.113.42', '2001:db8::1', '::ffff:7f00:1', '64:ff9b::7f00:1']) {
    await assert.rejects(
      () => resolveSafeTarget('https://trusted-example.invalid/', {
        lookupFn: async () => [{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }],
      }),
      error => error instanceof AuditError && error.code === 'PRIVATE_TARGET',
      'DNS mixed answer should fail: ' + address
    );
  }
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

test('accepts exact HTML MIME types and rejects misleading substrings, suffixes, and parameters', async () => {
  for (const path of ['/mime-fake-suffix', '/mime-fake-xml-suffix', '/mime-fake-parameter', '/mime-fake-unrelated']) {
    await assert.rejects(
      () => auditWebsite(`${baseUrl}${path}`, { resolveTargetFn: localResolver }),
      err => err instanceof AuditError && err.code === 'UNSUPPORTED_CONTENT_TYPE',
      path,
    );
  }
  for (const path of ['/mime-valid-html', '/mime-valid-xhtml']) {
    const result = await auditWebsite(`${baseUrl}${path}`, { resolveTargetFn: localResolver });
    assert.equal(result.status, 'success', path);
    assert.equal(result.metrics.pagesAudited, 1, path);
    assert.equal(result.pages[0].seo.title, 'MIME fixture', path);
  }
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

test('rejects invalid Location on HTTP redirects with a stable error instead of an uncaught exception', async () => {
  for (const path of ['/invalid-redirect-302', '/invalid-redirect-307']) {
    await assert.rejects(
      () => auditWebsite(`${baseUrl}${path}`, { resolveTargetFn: localResolver }),
      err => err instanceof AuditError && err.code === 'INVALID_REDIRECT',
      path,
    );
  }
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


test('streaming HTTP early exits abort discarded response bodies', async () => {
  // A redirect/non-HTML/error response must not keep downloading forever
  // after the audit has either moved to its next URL or rejected the page.
  const scenarios = [
    { label: '302 redirect', statusCode: 302, headers: { location: '/ok', 'content-type': 'text/html' }, error: null },
    { label: '500 non-2xx', statusCode: 500, headers: { 'content-type': 'text/plain' }, error: 'NON_2XX' },
    { label: '200 non-HTML', statusCode: 200, headers: { 'content-type': 'application/json' }, error: 'UNSUPPORTED_CONTENT_TYPE' },
  ];

  for (const scenario of scenarios) {
    let streamClosed = false;
    let streamOpened = false;
    let ticksAfterClose = 0;
    const streamServer = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html><head><title>Redirect OK</title></head><body><h1>OK</h1></body></html>');
      }
      res.writeHead(scenario.statusCode, scenario.headers);
      res.write('first streaming chunk');
      streamOpened = true;
      const ticker = setInterval(() => {
        if (res.destroyed) {
          ticksAfterClose++;
          return;
        }
        res.write('x'.repeat(1024));
      }, 4);
      res.once('close', () => {
        streamClosed = true;
        clearInterval(ticker);
      });
    });
    try {
      await new Promise(resolve => streamServer.listen(0, '127.0.0.1', resolve));
      const url = 'http://audit.test:' + streamServer.address().port + '/stream';
      const result = auditWebsite(url, {
        maxRedirects: 2,
        timeoutMs: 1200,
        resolveTargetFn: localResolver,
      });
      if (scenario.error) {
        await assert.rejects(result, error => error instanceof AuditError && error.code === scenario.error);
      } else {
        const value = await result;
        assert.equal(value.status, 'success');
        assert.equal(value.pages[0].seo.title, 'Redirect OK');
        assert.equal(value.pages[0].redirectCount, 1);
      }
      // An HTTP response 'close' event is asynchronous. The discarded
      // stream must close well within the timeout, not keep downloading.
      const deadline = Date.now() + 400;
      while (!streamClosed && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(streamOpened, true, scenario.label + ': initial streaming response was not observed');
      assert.equal(streamClosed, true, scenario.label + ': discarded HTTP body was left streaming');
      assert.equal(ticksAfterClose, 0, scenario.label + ': streaming interval leaked after close');
    } finally {
      streamServer.closeAllConnections();
      await new Promise(resolve => streamServer.close(resolve));
    }
  }
});

test('DNS resolver stalls are bounded before an HTTP request can exist', async () => {
  const failure = new Error('DNS never returned within audit timeout');
  const deadline = new Promise((_, reject) => setTimeout(() => reject(failure), 450));
  const timed = auditWebsite('http://dns-delay.test/', {
    timeoutMs: 250,
    resolveTargetFn: () => new Promise(() => {}),
  });
  await assert.rejects(Promise.race([timed, deadline]), error =>
    error instanceof AuditError && error.code === 'TIMEOUT',
  );
});

test('one timeout budget covers DNS lookup and subsequent HTTP response', async () => {
  const started = Date.now();
  const timed = auditWebsite(`${baseUrl}/slow`, {
    timeoutMs: 250,
    resolveTargetFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 230));
      return localResolver();
    },
  });
  const failure = new Error('Combined DNS + HTTP exceeded 400ms bound');
  await assert.rejects(
    Promise.race([timed, new Promise((_, reject) => setTimeout(() => reject(failure), 400))]),
    error => error instanceof AuditError && error.code === 'TIMEOUT',
  );
  assert.ok(Date.now() - started < 400, 'Shared budget was not applied before the HTTP response');
});


test('actionable SEO report identifies missing metadata and headings from actual HTML without fake ranking scores', async () => {
  const bad = await auditWebsite(`${baseUrl}/inert-links`, {
    maxPages: 1,
    resolveTargetFn: localResolver,
  });
  assert.equal(bad.status, 'success', 'SEO warnings do not masquerade as fetch failures');
  assert.deepEqual(bad.pages[0].findings.map(x => x.code),
    ['MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'MISSING_H1']);
  assert.deepEqual(bad.findingsSummary, {
    total: 3, high: 1, medium: 2, low: 0, pagesWithFindings: 1,
  });
  for (const finding of bad.pages[0].findings) {
    assert.ok(['high', 'medium', 'low'].includes(finding.severity));
    assert.ok(finding.recommendation.length > 10);
  }
  assert.equal(Object.hasOwn(bad, 'seoScore'), false);
  assert.equal(bad.metrics.externalApiCostUSD, 0);
  assert.equal(bad.metrics.platformCostUSD, null);

  const good = await auditWebsite(`${baseUrl}/inert-seo`, {
    maxPages: 1,
    resolveTargetFn: localResolver,
  });
  assert.deepEqual(good.pages[0].findings, []);
  assert.equal(good.findingsSummary.total, 0);

  const multiple = await auditWebsite(`${baseUrl}/`, {
    maxPages: 2,
    resolveTargetFn: localResolver,
  });
  assert.deepEqual(multiple.pages[0].findings, []);
  assert.deepEqual(multiple.pages[1].findings.map(x => x.code),
    ['MISSING_META_DESCRIPTION']);
  assert.deepEqual(multiple.findingsSummary, {
    total: 1, high: 0, medium: 1, low: 0, pagesWithFindings: 1,
  });
});
