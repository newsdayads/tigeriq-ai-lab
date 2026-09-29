import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export class AuditError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'AuditError';
  }
}

function isPrivateIP(hostname) {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('127.')) return true;
  const parts = hostname.split('.');
  if (parts.length === 4 && parts[0] === '172') {
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export async function auditWebsite(url, options = {}) {
  const startTime = Date.now();
  if (!url || typeof url !== 'string') {
    throw new AuditError('Invalid or missing URL provided for audit.', 'INVALID_URL');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    throw new AuditError('Malformed URL provided.', 'INVALID_URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new AuditError('Unsupported protocol. Only http and https are allowed.', 'UNSUPPORTED_PROTOCOL');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new AuditError('Credential-bearing URLs are not allowed.', 'CREDENTIALS_REJECTED');
  }

  if (isPrivateIP(parsedUrl.hostname)) {
    throw new AuditError('Local, private, or loopback targets are forbidden.', 'PRIVATE_IP_REJECTED');
  }

  const timeoutMs = options.timeoutMs || 8000;
  const maxBytes = options.maxBytes || 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'TigerIQ-RevenueLab-AuditEngine/1.0' }
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AuditError(`Audit timed out after ${timeoutMs}ms`, 'TIMEOUT');
    }
    throw new AuditError(`Network failure: ${err.message}`, 'NETWORK_FAILURE');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AuditError(`Non-2xx response status: ${response.status} ${response.statusText}`, 'NON_2XX');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new AuditError(`Unsupported content type: ${contentType}`, 'UNSUPPORTED_CONTENT_TYPE');
  }

  let html = '';
  let bytesRead = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      if (bytesRead > maxBytes) {
        throw new AuditError('Response exceeded maximum allowed size.', 'OVERSIZED_RESPONSE');
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } catch (err) {
    if (err instanceof AuditError) throw err;
    throw new AuditError(`Failed reading response body: ${err.message}`, 'READ_FAILURE');
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i) ||
                          html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["'][^>]*>/i);
  const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];

  const durationMs = Date.now() - startTime;

  return {
    url,
    timestamp: new Date().toISOString(),
    status: 'success',
    responseStatus: response.status,
    metrics: {
      durationMs,
      pagesAudited: 1,
      bytesParsed: bytesRead,
      estimatedCostUSD: 0.00,
      platformCostUSD: null
    },
    seo: {
      titlePresent: !!titleMatch,
      title: titleMatch ? titleMatch[1].trim() : null,
      metaDescriptionPresent: !!metaDescMatch,
      metaDescription: metaDescMatch ? metaDescMatch[1].trim() : null,
      h1Count: h1Matches.length
    },
    recommendations: [
      titleMatch ? 'Title tag present' : 'Add a descriptive <title> tag',
      metaDescMatch ? 'Meta description present' : 'Add a meta description',
      h1Matches.length > 0 ? 'H1 header present' : 'Ensure exactly one primary <h1> header'
    ]
  };
}
