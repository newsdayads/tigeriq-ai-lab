import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V16 = 'WEB-LOCAL-396-V3.7';
const MAX_BODY_BYTES = 64 * 1024;
const FUNCTIONAL_VIEWS = new Set(['work', 'workforce', 'models', 'evidence', 'reports', 'system', 'settings']);

export interface OwnerCockpitV16Options {
  overviewUrl: string;
  functionalUrl: string;
  host?: string;
  port?: number;
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requestedView(urlValue: string | undefined): string {
  return new URL(urlValue ?? '/', 'http://local').searchParams.get('view') ?? 'overview';
}

export function useFunctionalSurface(method: string | undefined, urlValue: string | undefined): boolean {
  if (method !== 'GET' && method !== 'HEAD') return true;
  const url = new URL(urlValue ?? '/', 'http://local');
  if (url.pathname !== '/') return true;
  return FUNCTIONAL_VIEWS.has(requestedView(urlValue));
}

export function rewriteFunctionalLocation(value: string): string {
  if (!value.startsWith('/')) return value;
  const [pathAndQuery, hash = ''] = value.split('#', 2);
  const url = new URL(pathAndQuery || '/', 'http://local');
  if (url.searchParams.has('view')) return value;
  const fragment = hash.toLowerCase();
  let view: string | null = null;
  if (fragment === 'cong-viec' || fragment === 'chi-tiet' || url.searchParams.has('work')) view = 'work';
  else if (fragment === 'doi-ai') view = 'workforce';
  else if (fragment === 'mo-hinh') view = 'models';
  else if (fragment === 'bang-chung') view = 'evidence';
  else if (fragment === 'bao-cao') view = 'reports';
  else if (fragment === 'he-thong') view = 'system';
  else if (fragment === 'cai-dat') view = 'settings';
  if (!view) return value;
  url.searchParams.set('view', view);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

function copyHeaders(upstream: Response, res: ServerResponse, contentType?: string): void {
  const blocked = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding']);
  for (const [key, value] of upstream.headers.entries()) {
    if (blocked.has(key.toLowerCase())) continue;
    res.setHeader(key, key.toLowerCase() === 'location' ? rewriteFunctionalLocation(value) : value);
  }
  if (contentType) res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
}

export function markFinalSurface(input: string, functional: boolean): string {
  let html = input;
  if (!functional) {
    html = html.replace('data-version="WEB-LOCAL-396-V3.6"', `data-version="${WEB_LOCAL_VERSION_V16}" data-functional-isolation="v37"`);
  }
  const marker = functional ? 'stable-v12-isolated' : 'overview-v36-isolated';
  if (html.includes('<html lang="vi"')) return html.replace('<html lang="vi"', `<html lang="vi" data-runtime="${WEB_LOCAL_VERSION_V16}" data-surface="${marker}"`);
  return html.replace('<html', `<html data-runtime="${WEB_LOCAL_VERSION_V16}" data-surface="${marker}"`);
}

async function proxy(options: OwnerCockpitV16Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const functional = useFunctionalSurface(req.method, req.url);
  const target = functional ? options.functionalUrl : options.overviewUrl;
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${target}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if ((req.method === 'GET' || req.method === 'HEAD') && upstream.ok && upstreamType.includes('text/html')) {
    const html = markFinalSurface(await upstream.text(), functional);
    copyHeaders(upstream, res, 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  copyHeaders(upstream, res);
  res.statusCode = upstream.status;
  res.end(req.method === 'HEAD' ? undefined : payload);
}

export async function startOwnerCockpitV16(options: OwnerCockpitV16Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v16_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
