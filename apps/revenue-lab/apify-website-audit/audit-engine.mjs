import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { URL } from 'node:url';

function isPrivateIP(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 127) return true;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

async function validateAndFetch(targetUrl, timeoutMs) {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are supported.');
  }
  const hostname = parsed.hostname;
  try {
    const lookup = await dns.lookup(hostname);
    if (isPrivateIP(lookup.address)) {
      throw new Error('Access to private or internal IP addresses is forbidden.');
    }
  } catch (err) {
    if (err.message && err.message.includes('forbidden')) throw err;
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let redirectUrl;
        try {
          redirectUrl = new URL(res.headers.location, targetUrl).toString();
        } catch { 
          return reject(new Error('Invalid redirect location')); 
        }
        return validateAndFetch(redirectUrl, timeoutMs).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data, finalUrl: targetUrl });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', err => {
      reject(new Error(`HTTP request failed: ${err.message}`));
    });
  });
}

export async function auditWebsite(url, options = {}) {
  const startTime = Date.now();
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid or missing URL provided for audit.');
  }
  const maxPages = Math.min(Math.max(Number(options.maxPages) || 1, 1), 10);
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 10000, 1000), 30000);

  const visited = new Set();
  const queue = [url];
  const pages = [];
  let errors = 0;

  const rootParsed = new URL(url);

  while (queue.length > 0 && pages.length < maxPages) {
    const currentUrl = queue.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const fetchStart = Date.now();
      const { statusCode, headers, body, finalUrl } = await validateAndFetch(currentUrl, timeoutMs);
      const fetchDuration = Date.now() - fetchStart;

      const titleMatch = body.match(/<title>([^<]*)</i);
      const title = titleMatch ? titleMatch[1].trim() : null;
      const metaDescMatch = body.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || body.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
      const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : null;
      const h1Matches = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];

      const links = [];
      const linkRegex = /href=["']([^"']+)["']/gi;
      let match;
      while ((match = linkRegex.exec(body)) !== null) {
        try {
          const absolute = new URL(match[1], finalUrl).toString();
          const parsedLink = new URL(absolute);
          if (parsedLink.hostname === rootParsed.hostname && !visited.has(absolute) && links.length < 20) {
            links.push(absolute);
          }
        } catch {}
      }

      for (const link of links) {
        if (queue.length + pages.length < maxPages && !queue.includes(link)) {
          queue.push(link);
        }
      }

      pages.push({
        url: finalUrl,
        statusCode,
        fetchDurationMs: fetchDuration,
        seo: {
          titlePresent: !!title,
          title,
          metaDescriptionPresent: !!metaDescription,
          metaDescription,
          h1Count: h1Matches.length
        },
        contentLength: body.length
      });
    } catch (err) {
      errors++;
      pages.push({
        url: currentUrl,
        status: 'error',
        error: err.message
      });
    }
  }

  const durationMs = Date.now() - startTime;
  return {
    url,
    timestamp: new Date().toISOString(),
    status: errors === pages.length ? 'failed' : 'success',
    metrics: {
      durationMs,
      pagesAudited: pages.length,
      errorCount: errors,
      estimatedCostUSD: 0.00
    },
    pages,
    recommendations: [
      'Ensure all pages have valid title tags and meta descriptions',
      'Verify response times are under 500ms'
    ]
  };
}
