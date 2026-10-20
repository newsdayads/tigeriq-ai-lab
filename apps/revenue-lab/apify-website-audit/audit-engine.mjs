import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class AuditError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'AuditError';
    this.code = code;
    this.detail = detail;
  }
}

const DEFAULTS = {
  maxPages: 1,
  timeoutMs: 8000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
  requestDelayMs: 0,
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

function ipv4Blocked(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    // Exclude IANA special-purpose/documentation/transition ranges. A URL
    // audit must not treat non-global or reserved destinations as websites.
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6Blocked(ip) {
  // Canonicalize IPv6 hextets: leading zeros can otherwise bypass textual
  // prefix checks (e.g. 2001:0db8::1). The caller already checks net.isIP.
  let lower;
  try {
    lower = new URL('http://[' + ip + ']/').hostname.slice(1, -1).toLowerCase();
  } catch {
    return true;
  }
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')) return true;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  // IANA: fe00::/9 reserved, fe80::/10 link-local and fec0::/10
  // deprecated site-local (RFC 3879). None may be audited as public IPs.
  if (Number.isFinite(first) && first >= 0xfe00 && first <= 0xfeff) return true;
  // IPv4-mapped addresses also have a hex representation (::ffff:7f00:1).
  // Block the entire transition namespace instead of relying on dotted
  // decimal notation or accidentally reaching a loopback/private service.
  if (lower.startsWith('::ffff:')) return true;
  return lower.startsWith('2001:db8:') ||  // RFC 3849 documentation
    lower.startsWith('3fff:') ||         // RFC 9637 documentation
    lower.startsWith('2002:') ||         // 6to4 IPv4 tunnelling
    lower.startsWith('2001::') || lower.startsWith('2001:0:') || // Teredo
    lower.startsWith('64:ff9b::') || lower.startsWith('64:ff9b:1:') || // NAT64
    lower.startsWith('100::');          // discard-only
}

export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  return true;
}

// WHATWG URL.hostname wraps IPv6 literals in [], but node:net.isIP does not
// recognize the brackets. The socket layer treats them as IP literals, so
// unwrap BEFORE safety classification and never route them through DNS.
function normalizedTargetHost(url) {
  const host = url.hostname;
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function parseTarget(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new AuditError('INVALID_URL', 'Malformed URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AuditError('UNSUPPORTED_PROTOCOL', 'Only http and https URLs are supported.');
  }
  if (url.username || url.password) {
    throw new AuditError('CREDENTIALS_REJECTED', 'Credential-bearing URLs are not allowed.');
  }
  const host = normalizedTargetHost(url);
  if (host.toLowerCase() === 'localhost' ||
      (net.isIP(host) && isBlockedAddress(host))) {
    throw new AuditError('PRIVATE_TARGET', 'Localhost, private or reserved IP targets are forbidden.');
  }
  return url;
}

export async function resolveSafeTarget(url, { lookupFn = dns.lookup } = {}) {
  // Revalidate even when the caller supplies a URL object, not only text.
  const parsed = parseTarget(url);
  const literal = normalizedTargetHost(parsed);
  const family = net.isIP(literal);
  if (family) return { address: literal, family };
  let answers;
  try {
    answers = await lookupFn(parsed.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new AuditError('DNS_FAILURE', 'DNS resolution failed.', String(error?.message || error));
  }
  const rows = Array.isArray(answers) ? answers : [answers];
  if (!rows.length || rows.some(row => !row?.address || isBlockedAddress(row.address))) {
    throw new AuditError('PRIVATE_TARGET', 'DNS resolved to a private or unsafe address.');
  }
  return { address: rows[0].address, family: rows[0].family || net.isIP(rows[0].address) };
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

async function requestOnce(url, options) {
  const parsed = parseTarget(url);
  const deadline = Date.now() + options.timeoutMs;
  const resolver = typeof options.resolveTargetFn === 'function'
    ? options.resolveTargetFn
    : (target => resolveSafeTarget(target, { lookupFn: options.lookupFn }));
  // DNS resolution and HTTP response share one bounded per-hop deadline.
  // A resolver that stalls must not evade the configured timeout.
  let resolutionTimer;
  let resolved;
  try {
    resolved = await Promise.race([
      Promise.resolve().then(() => resolver(parsed)),
      new Promise((_, reject) => {
        resolutionTimer = setTimeout(
          () => reject(new AuditError('TIMEOUT', 'Request exceeded the configured timeout.', { timeoutMs: options.timeoutMs })),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(resolutionTimer);
  }
  if (!resolved?.address || !resolved?.family) {
    throw new AuditError('DNS_FAILURE', 'Resolver returned no usable address.');
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'user-agent': 'TigerIQ-RevenueLab-Audit/1.0',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      },
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) return callback(null, [{ address: resolved.address, family: resolved.family }]);
        return callback(null, resolved.address, resolved.family);
      },
      servername: parsed.hostname,
    }, res => {
      const statusCode = Number(res.statusCode || 0);
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        // An untrusted Location may be syntactically invalid. URL parsing
        // must not throw from the HTTP response event handler and crash Node.
        let redirect;
        try {
          redirect = new URL(res.headers.location, parsed).toString();
        } catch {
          res.destroy();
          return done(reject, new AuditError(
            'INVALID_REDIRECT', 'Target returned an invalid redirect location.',
          ));
        }
        res.destroy();
        return done(resolve, {
          redirect,
          statusCode,
          durationMs: Date.now() - started,
        });
      }
      // HTTP failures must preserve their status code even when servers
      // return a JSON or text error page instead of HTML.
      if (statusCode < 200 || statusCode >= 300) {
        res.destroy();
        return done(reject, new AuditError('NON_2XX', 'Target returned a non-success HTTP status.', statusCode));
      }
      const contentType = headerValue(res.headers, 'content-type').toLowerCase();
      // Exact MIME token only: text/html inside a parameter, suffix or
      // unrelated media type must not be treated as fetched HTML evidence.
      const mediaType = contentType.split(';', 1)[0].trim();
      if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') {
        res.destroy();
        return done(reject, new AuditError('UNSUPPORTED_CONTENT_TYPE', 'Response is not HTML.', contentType || null));
      }

      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          const error = new AuditError('OVERSIZED_RESPONSE', 'Response exceeded the configured byte limit.', { maxBytes: options.maxBytes });
          res.destroy();
          req.destroy();
          done(reject, error);
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => done(resolve, {
        statusCode,
        contentType,
        body: Buffer.concat(chunks).toString('utf8'),
        bytes,
        durationMs: Date.now() - started,
        finalUrl: parsed.toString(),
      }));
    });

    const timer = setTimeout(() => req.destroy(new AuditError('TIMEOUT', 'Request exceeded the configured timeout.', { timeoutMs: options.timeoutMs })), Math.max(1, deadline - Date.now()));
    req.on('close', () => clearTimeout(timer));
    req.on('error', error => {
      clearTimeout(timer);
      if (error instanceof AuditError) return done(reject, error);
      done(reject, new AuditError('NETWORK_FAILURE', 'HTTP request failed.', String(error?.message || error)));
    });
    req.end();
  });
}

async function fetchBounded(startUrl, options) {
  let current = parseTarget(startUrl).toString();
  for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount++) {
    const result = await requestOnce(current, options);
    if (!result.redirect) return { ...result, redirectCount };
    if (redirectCount === options.maxRedirects) {
      throw new AuditError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded.', { maxRedirects: options.maxRedirects });
    }
    current = parseTarget(result.redirect).toString();
  }
  throw new AuditError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded.');
}

const cleanText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Strip inert regions in DOCUMENT ORDER, not in two independent passes:
// a JS/CSS string can contain literal "<!--" and HTML comments can contain
// mock script/style tags. The leftmost token owns its entire inert region.
// Keep raw response bytes/cost metrics and network validation unchanged.
function stripInertHtml(html) {
  return html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
}

function extractSeo(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  // Extract exact attribute names from <meta>, not substrings such as
  // data-name. HTML permits unquoted attribute values and either order.
  let metaDescription = null;
  // A literal '>' inside an HTML-quoted attribute is not the tag terminator.
  // Keep malformed/unclosed quotes fail-closed instead of inventing metadata.
  for (const tag of html.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || []) {
    const attributes = Object.create(null);
    for (const [, key, doubleQuoted, singleQuoted, unquoted] of
      tag.matchAll(/\s+([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\x60=<>]+))/g)) {
      const normalized = key.toLowerCase();
      if (!Object.hasOwn(attributes, normalized)) {
        attributes[normalized] = doubleQuoted ?? singleQuoted ?? unquoted;
      }
    }
    if (attributes.name?.toLowerCase() === 'description' &&
        Object.hasOwn(attributes, 'content')) {
      metaDescription = attributes.content;
      break;
    }
  }
  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const visible = cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  );
  return {
    title: titleMatch ? cleanText(titleMatch[1]) : null,
    metaDescription: metaDescription === null ? null : cleanText(metaDescription),
    h1Count: h1Matches.length,
    h1: h1Matches.map(match => cleanText(match[1])).filter(Boolean),
    wordCount: visible ? visible.split(/\s+/).length : 0,
  };
}

function extractSameOriginLinks(html, baseUrl, rootOrigin) {
  const links = [];
  const seen = new Set();
  // Require the exact href attribute; HTML also permits unquoted attribute
  // values. An attribute such as data-href must not trigger a crawl.
  // Quoted attribute values can contain literal '>' without closing <a>.
  // Match the complete opening tag before extracting an exact href attribute.
  for (const tag of html.match(/<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || []) {
    let href = null;
    for (const [, name, doubleQuoted, singleQuoted, unquoted] of
      tag.matchAll(/\s+([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\x60=<>]+))/g)) {
      if (name.toLowerCase() === 'href') {
        href = doubleQuoted ?? singleQuoted ?? unquoted;
        break;
      }
    }
    if (!href || href.startsWith('#')) continue;
    try {
      const candidate = new URL(href, baseUrl);
      candidate.hash = '';
      if (candidate.origin !== rootOrigin || !['http:', 'https:'].includes(candidate.protocol)) continue;
      const normalized = candidate.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        links.push(normalized);
      }
    } catch {}
  }
  return links;
}


// Product-level SEO findings are observations from fetched HTML, not ranking,
// Lighthouse or performance scores. Keep output bounded (four rules per page)
// and independent of network, pricing or authentication.
export function actionableSeoFindings(seo) {
  const findings = [];
  if (!seo.title) findings.push({
    code: 'MISSING_TITLE', severity: 'high',
    recommendation: 'Add a descriptive HTML title for this page.',
  });
  if (!seo.metaDescription) findings.push({
    code: 'MISSING_META_DESCRIPTION', severity: 'medium',
    recommendation: 'Add a concise meta description for search snippets.',
  });
  if (seo.h1Count === 0) findings.push({
    code: 'MISSING_H1', severity: 'medium',
    recommendation: 'Add one meaningful H1 heading describing the page.',
  });
  if (seo.h1Count > 1) findings.push({
    code: 'MULTIPLE_H1', severity: 'low',
    recommendation: 'Review H1 headings and keep the primary heading clear.',
  });
  return findings;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function auditWebsite(inputUrl, options = {}) {
  const started = Date.now();
  const root = parseTarget(inputUrl);
  const maxPages = clamp(options.maxPages, 1, 10, DEFAULTS.maxPages);
  const timeoutMs = clamp(options.timeoutMs, 250, 30000, DEFAULTS.timeoutMs);
  const maxBytes = clamp(options.maxBytes, 1024, 5 * 1024 * 1024, DEFAULTS.maxBytes);
  const maxRedirects = clamp(options.maxRedirects, 0, 5, DEFAULTS.maxRedirects);
  const requestDelayMs = clamp(options.requestDelayMs, 0, 2000, DEFAULTS.requestDelayMs);
  const requestOptions = {
    timeoutMs,
    maxBytes,
    maxRedirects,
    lookupFn: options.lookupFn,
    resolveTargetFn: options.resolveTargetFn,
  };

  const queue = [root.toString()];
  const visited = new Set();
  const pages = [];
  const errors = [];
  let totalBytes = 0;

  while (queue.length && pages.length + errors.length < maxPages) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (visited.size > 1 && requestDelayMs) await sleep(requestDelayMs);

    try {
      const response = await fetchBounded(current, requestOptions);
      const documentHtml = stripInertHtml(response.body);
      const seo = extractSeo(documentHtml);
      totalBytes += response.bytes;
      pages.push({
        url: response.finalUrl,
        statusCode: response.statusCode,
        contentType: response.contentType,
        bytes: response.bytes,
        fetchDurationMs: response.durationMs,
        redirectCount: response.redirectCount,
        seo,
        findings: actionableSeoFindings(seo),
      });
      for (const link of extractSameOriginLinks(documentHtml, response.finalUrl, root.origin)) {
        if (!visited.has(link) && !queue.includes(link) && queue.length + pages.length + errors.length < maxPages) queue.push(link);
      }
    } catch (error) {
      const normalized = error instanceof AuditError
        ? error
        : new AuditError('AUDIT_FAILURE', 'Unexpected audit failure.', String(error?.message || error));
      if (visited.size === 1) throw normalized;
      errors.push({ url: current, code: normalized.code, message: normalized.message, detail: normalized.detail ?? null });
    }
  }

  const first = pages[0] || null;
  return {
    schemaVersion: '1.0',
    status: errors.length ? (pages.length ? 'partial' : 'failed') : 'success',
    requestedUrl: root.toString(),
    completedAt: new Date().toISOString(),
    metrics: {
      durationMs: Date.now() - started,
      pagesAudited: pages.length,
      errorCount: errors.length,
      bytesRead: totalBytes,
      externalApiCostUSD: 0,
      platformCostUSD: null,
      platformCostStatus: 'pending_private_apify_run',
    },
    summary: first ? {
      titlePresent: Boolean(first.seo.title),
      metaDescriptionPresent: Boolean(first.seo.metaDescription),
      h1Count: first.seo.h1Count,
      wordCount: first.seo.wordCount,
    } : null,
    findingsSummary: {
      total: pages.reduce((sum, page) => sum + page.findings.length, 0),
      high: pages.reduce((sum, page) => sum + page.findings.filter(x => x.severity === 'high').length, 0),
      medium: pages.reduce((sum, page) => sum + page.findings.filter(x => x.severity === 'medium').length, 0),
      low: pages.reduce((sum, page) => sum + page.findings.filter(x => x.severity === 'low').length, 0),
      pagesWithFindings: pages.filter(page => page.findings.length > 0).length,
    },
    pages,
    errors,
  };
}
