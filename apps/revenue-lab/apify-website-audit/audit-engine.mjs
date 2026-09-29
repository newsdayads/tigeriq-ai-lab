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
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Blocked(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')) return true;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if (Number.isFinite(first) && first >= 0xfe80 && first <= 0xfebf) return true;
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? ipv4Blocked(mapped[1]) : false;
}

export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  return true;
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
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new AuditError('PRIVATE_TARGET', 'Localhost targets are forbidden.');
  }
  return url;
}

export async function resolveSafeTarget(url, { lookupFn = dns.lookup } = {}) {
  const parsed = url instanceof URL ? url : parseTarget(url);
  if (net.isIP(parsed.hostname)) {
    if (isBlockedAddress(parsed.hostname)) {
      throw new AuditError('PRIVATE_TARGET', 'Private, loopback, link-local, carrier-grade NAT, multicast, or reserved targets are forbidden.');
    }
    return { address: parsed.hostname, family: net.isIP(parsed.hostname) };
  }
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
  const resolver = typeof options.resolveTargetFn === 'function'
    ? options.resolveTargetFn
    : (target => resolveSafeTarget(target, { lookupFn: options.lookupFn }));
  const resolved = await resolver(parsed);
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
        res.resume();
        return done(resolve, {
          redirect: new URL(res.headers.location, parsed).toString(),
          statusCode,
          durationMs: Date.now() - started,
        });
      }
      const contentType = headerValue(res.headers, 'content-type').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        res.resume();
        return done(reject, new AuditError('UNSUPPORTED_CONTENT_TYPE', 'Response is not HTML.', contentType || null));
      }
      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        return done(reject, new AuditError('NON_2XX', 'Target returned a non-success HTTP status.', statusCode));
      }

      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          req.destroy(new AuditError('OVERSIZED_RESPONSE', 'Response exceeded the configured byte limit.', { maxBytes: options.maxBytes }));
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

    const timer = setTimeout(() => req.destroy(new AuditError('TIMEOUT', 'Request exceeded the configured timeout.', { timeoutMs: options.timeoutMs })), options.timeoutMs);
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

function extractSeo(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  const visible = cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  );
  return {
    title: titleMatch ? cleanText(titleMatch[1]) : null,
    metaDescription: metaMatch ? cleanText(metaMatch[1]) : null,
    h1Count: h1Matches.length,
    h1: h1Matches.map(match => cleanText(match[1])).filter(Boolean),
    wordCount: visible ? visible.split(/\s+/).length : 0,
  };
}

function extractSameOriginLinks(html, baseUrl, rootOrigin) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi)) {
    try {
      const candidate = new URL(match[1], baseUrl);
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
      const seo = extractSeo(response.body);
      totalBytes += response.bytes;
      pages.push({
        url: response.finalUrl,
        statusCode: response.statusCode,
        contentType: response.contentType,
        bytes: response.bytes,
        fetchDurationMs: response.durationMs,
        redirectCount: response.redirectCount,
        seo,
      });
      for (const link of extractSameOriginLinks(response.body, response.finalUrl, root.origin)) {
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
    pages,
    errors,
  };
}
