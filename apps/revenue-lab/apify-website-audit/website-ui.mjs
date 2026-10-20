// GH-2293: local-only web experience for the real zero-paid-API Website Audit.
// Never binds a public interface, changes credentials, or invokes private Apify.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { auditWebsite } from './audit-engine.mjs';
import { renderWebsiteAuditMarkdown } from './website-report.mjs';

const LOCAL_HOST = '127.0.0.1';
const BODY_LIMIT_BYTES = 4096;
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const UI_HTML = "<!doctype html>\n<html lang=\"vi\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>TigerIQ Website Audit — Local Preview</title>\n<style>\n:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#142333;background:#f5f8fc}*{box-sizing:border-box}\nbody{max-width:860px;margin:0 auto;padding:26px 18px}h1{font-size:1.7rem;margin-bottom:5px}\np{color:#42526a;line-height:1.5}.panel{background:white;border:1px solid #d8e2ee;border-radius:16px;padding:22px;margin:16px 0}\nlabel{display:block;font-weight:600;margin:14px 0 7px}input,select,button{font:inherit}\ninput,select{width:100%;border:1px solid #93a9c1;border-radius:9px;padding:12px;background:white}\nbutton{background:#144e9b;border:0;color:white;border-radius:9px;padding:12px 18px;margin-top:16px;cursor:pointer}\nbutton:disabled{background:#8095ac;cursor:wait}\npre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f5fa;padding:18px;border-radius:12px;line-height:1.5;font-size:.88rem}\na#download{display:inline-block;margin-top:16px;color:#144e9b;font-weight:600}a#download[hidden]{display:none}small{color:#526079}#status{min-height:1.4rem;color:#163e79;font-weight:600}\n</style>\n</head>\n<body>\n<h1>TigerIQ Website Audit</h1>\n<p>Kiểm tra HTML thật, phát hiện lỗi SEO và nhận hướng khắc phục. Bản dùng thử chạy <strong>chỉ trên máy này</strong>, không sử dụng Apify hoặc API trả phí.</p>\n<section class=\"panel\">\n<form id=\"audit-form\">\n<label for=\"site\">Địa chỉ website</label>\n<input id=\"site\" name=\"site\" type=\"url\" required maxlength=\"2000\" placeholder=\"https://example.com/\" value=\"https://example.com/\">\n<label for=\"pages\">Số trang tối đa</label>\n<select id=\"pages\" name=\"pages\"><option value=\"1\">1 trang</option><option value=\"2\">2 trang</option><option value=\"3\">3 trang</option></select>\n<button id=\"submit\" type=\"submit\">Kiểm tra website</button>\n</form>\n<p id=\"status\" role=\"status\" aria-live=\"polite\"></p>\n<small>Không cung cấp đường dẫn chứa mật khẩu hoặc token. Không có dữ liệu nào được lưu trên máy chủ.</small>\n</section>\n<section class=\"panel\">\n<h2>Kết quả kiểm tra</h2>\n<pre id=\"report\" aria-live=\"polite\">Nhập website và chọn Kiểm tra website.</pre>\n<a id=\"download\" href=\"#\" download=\"tigeriq-website-audit.md\" hidden>Tải báo cáo Markdown</a>\n</section>\n<script>\nconst form = document.getElementById(\"audit-form\");\nconst button = document.getElementById(\"submit\");\nconst status = document.getElementById(\"status\");\nconst report = document.getElementById(\"report\");\nconst download = document.getElementById(\"download\");\nform.addEventListener(\"submit\", async (event) => {\n  event.preventDefault();\n  button.disabled = true;\n  status.textContent = \"Đang kiểm tra website qua HTTP thật…\";\n  report.textContent = \"\";\n  if (download.href?.startsWith(\"blob:\")) URL.revokeObjectURL(download.href);\n  download.removeAttribute(\"href\");\n  download.hidden = true;\n  try {\n    const response = await fetch(\"/api/audit\", {\n      method: \"POST\",\n      headers: {\"Content-Type\":\"application/json\"},\n      body: JSON.stringify({url: document.getElementById(\"site\").value, maxPages: Number(document.getElementById(\"pages\").value)})\n    });\n    const result = await response.json();\n    if (!response.ok || result.status !== \"success\") throw Error(\"AUDIT_NOT_COMPLETED\");\n    report.textContent = result.markdown;\n    download.href = URL.createObjectURL(new Blob([result.markdown], { type: \"text/markdown;charset=utf-8\" }));\n    download.hidden = false;\n    status.textContent = \"Đã tạo báo cáo từ nội dung HTML thực tế.\";\n  } catch {\n    status.textContent = \"Không kiểm tra được URL này. Kiểm tra địa chỉ hoặc thử lại.\";\n    report.textContent = \"Không có báo cáo hợp lệ.\";\n  } finally {\n    button.disabled = false;\n  }\n});\n</script>\n</body>\n</html>";

function sendJson(res, statusCode, result) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(result));
}

function deny(res, statusCode, code) {
  sendJson(res, statusCode, { status: 'failed', code });
}

export function createWebsiteAuditUiServer({ auditFn = auditWebsite } = {}) {
  return http.createServer(async (req, res) => {
    const serverOrigin = 'http://' + LOCAL_HOST + ':' + req.socket.localPort;
    if (req.headers.host !== new URL(serverOrigin).host) {
      deny(res, 403, 'LOCAL_HOST_REQUIRED');
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(UI_HTML);
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok', mode: 'local_only', apifyActorRan: false });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/audit') {
      deny(res, 404, 'ROUTE_NOT_FOUND');
      return;
    }
    // A page on another origin must not commandeer this localhost audit.
    // JSON + exact Origin blocks cross-origin form posts and CSRF.
    if (req.headers.origin !== serverOrigin ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      deny(res, 403, 'SAME_ORIGIN_JSON_REQUIRED');
      return;
    }
    let bodyBytes = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        bodyBytes += chunk.length;
        if (bodyBytes > BODY_LIMIT_BYTES) {
          deny(res, 413, 'INPUT_TOO_LARGE');
          return;
        }
        chunks.push(chunk);
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const target = parsed?.url;
      const maxPages = parsed?.maxPages ?? 1;
      if (typeof target !== 'string' || !target.trim() || target.length > 2000 ||
          !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 3) {
        deny(res, 422, 'INVALID_AUDIT_INPUT');
        return;
      }
      const result = await auditFn(target, {
        maxPages, timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 3,
        requestDelayMs: 0,
      });
      const markdown = renderWebsiteAuditMarkdown(result);
      sendJson(res, 200, {
        status: 'success', format: 'markdown', markdown,
        apifyActorRan: false, platformBillingVerified: false,
      });
    } catch {
      // Never return untrusted input, exception, raw URL or DNS details.
      if (!res.headersSent) deny(res, 422, 'WEBSITE_AUDIT_FAILED');
    }
  });
}

export async function startWebsiteAuditUi({ port = 0, auditFn = auditWebsite } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Error('INVALID_LOCAL_PORT');
  }
  const server = createWebsiteAuditUiServer({ auditFn });
  server.requestTimeout = 40000;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, LOCAL_HOST, resolve);
    });
    return { server, origin: 'http://' + LOCAL_HOST + ':' + server.address().port };
  } catch (error) {
    server.close();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startWebsiteAuditUi({ port: 4179 })
    .then(({ origin }) => process.stdout.write('Website Audit local: ' + origin + '\n'))
    .catch(() => {
      process.stderr.write('LOCAL_AUDIT_UI_START_FAILED\n');
      process.exitCode = 1;
    });
}
