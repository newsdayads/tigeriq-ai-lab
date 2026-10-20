// GH-2293 — deterministic browser-export regression, no paid APIs or remote site.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startWebsiteAuditUi } from './website-ui.mjs';

test('local UI offers a Markdown download only after a successful audit', async () => {
  const { server, origin } = await startWebsiteAuditUi({
    auditFn: async () => { throw Error('NOT_CALLED_BY_UI_ASSET_GET'); },
  });
  try {
    const response = await fetch(origin + '/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text();
    assert.match(html, /id="download"[^>]*download="tigeriq-website-audit.md"[^>]*hidden/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'browser script is served');

    let onSubmit;
    let requestSucceeds = true;
    const created = [];
    const revoked = [];
    const controls = {
      'audit-form': { addEventListener: (event, callback) => {
        assert.equal(event, 'submit'); onSubmit = callback;
      }},
      submit: { disabled: false },
      status: { textContent: '' },
      report: { textContent: '' },
      download: {
        hidden: true, href: '',
        removeAttribute(name) {
          assert.equal(name, 'href'); this.href = '';
        },
      },
      site: { value: 'https://example.com/' },
      pages: { value: '1' },
    };
    const fakeDocument = { getElementById: name => {
      assert.ok(Object.hasOwn(controls, name), name);
      return controls[name];
    }};
    vm.runInNewContext(script, {
      document: fakeDocument,
      Blob,
      URL: {
        createObjectURL(blob) {
          created.push(blob);
          return 'blob:local-audit-' + created.length;
        },
        revokeObjectURL(value) { revoked.push(value); },
      },
      fetch: async (url, opts) => {
        assert.equal(url, '/api/audit');
        assert.equal(opts.method, 'POST');
        assert.deepEqual(JSON.parse(opts.body), {url:'https://example.com/', maxPages:1});
        return {
          ok: requestSucceeds,
          json: async () => requestSucceeds
            ? {status:'success', markdown:'# TigerIQ Website Audit\n\nReport from HTML.'}
            : {status:'failed', code:'BAD_URL'},
        };
      },
    });

    assert.equal(typeof onSubmit, 'function');
    await onSubmit({ preventDefault() {} });
    assert.equal(controls.download.hidden, false);
    assert.equal(controls.download.href, 'blob:local-audit-1');
    assert.equal(controls.report.textContent, '# TigerIQ Website Audit\n\nReport from HTML.');
    assert.equal(await created[0].text(), controls.report.textContent);
    assert.equal(controls.submit.disabled, false);
    assert.equal(controls.status.textContent, 'Đã tạo báo cáo từ nội dung HTML thực tế.');

    // On a failed audit, clear the old report link so stale results cannot be exported.
    requestSucceeds = false;
    await onSubmit({ preventDefault() {} });
    assert.deepEqual(revoked, ['blob:local-audit-1']);
    assert.equal(controls.download.hidden, true);
    assert.equal(controls.download.href, '');
    assert.equal(controls.report.textContent, 'Không có báo cáo hợp lệ.');
    assert.equal(controls.submit.disabled, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('local origin and JSON gates still reject cross-site POSTs', async () => {
  const { server, origin } = await startWebsiteAuditUi({
    auditFn: async () => { throw Error('MUST_NOT_CALL_AUDIT'); },
  });
  try {
    const crossSite = await fetch(origin + '/api/audit', {
      method:'POST',
      headers:{origin:'https://external.example', 'Content-Type':'application/json'},
      body:JSON.stringify({url:'https://example.com/',maxPages:1}),
    });
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json()).code, 'SAME_ORIGIN_JSON_REQUIRED');
    const badType = await fetch(origin + '/api/audit', {
      method:'POST',
      headers:{origin, 'Content-Type':'text/plain'},
      body:'{}',
    });
    assert.equal(badType.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
