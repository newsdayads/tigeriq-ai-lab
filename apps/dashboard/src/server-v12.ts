import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V12 = 'WEB-LOCAL-396-V3.3';
export const TIGERIQ_FUNCTIONAL_SURFACE_ENV = 'TIGERIQ_INTERNAL_V12_URL';
const MAX_BODY_BYTES = 64 * 1024;

export interface OwnerCockpitV12Options {
  cockpitUrl: string;
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

function copyHeaders(upstream: Response, res: ServerResponse, contentType?: string): void {
  const blocked = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding']);
  for (const [key, value] of upstream.headers.entries()) if (!blocked.has(key.toLowerCase())) res.setHeader(key, value);
  if (contentType) res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
}

export function applySegoeUiDefault(input: string): string {
  let html = input
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '')
    .replace(/@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\);?/gi, '')
    .replace('data-version="WEB-LOCAL-396-V3.2"', `data-version="${WEB_LOCAL_VERSION_V12}" data-font="segoe-ui-default"`);
  const css = '<style id="tq33-segoe-ui">html,body,button,input,select,textarea,*{font-family:"Segoe UI",Arial,sans-serif!important}</style>';
  html = html.replace('</head>', `${css}</head>`);
  return html;
}

async function proxy(options: OwnerCockpitV12Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && upstream.ok && upstreamType.includes('text/html')) {
    const html = applySegoeUiDefault(await upstream.text());
    copyHeaders(upstream, res, 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(html);
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  copyHeaders(upstream, res);
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV12(options: OwnerCockpitV12Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v12_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  const url = `http://${address.address}:${address.port}`;
  process.env[TIGERIQ_FUNCTIONAL_SURFACE_ENV] = url;
  return {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => {
      if (process.env[TIGERIQ_FUNCTIONAL_SURFACE_ENV] === url) delete process.env[TIGERIQ_FUNCTIONAL_SURFACE_ENV];
      error ? reject(error) : resolve();
    })),
  };
}
