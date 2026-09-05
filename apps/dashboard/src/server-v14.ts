import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V14 = 'WEB-LOCAL-396-V3.5';
const MAX_BODY_BYTES = 64 * 1024;

export interface OwnerCockpitV14Options {
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

function dedupeSidebars(input: string): string {
  let seen = false;
  return input.replace(/<aside class="sidebar">[\s\S]*?<\/aside>/g, (full) => {
    if (!seen) { seen = true; return full; }
    return '';
  });
}

export function applyLayoutRepairV35(input: string): string {
  let html = dedupeSidebars(input)
    .replace('data-version="WEB-LOCAL-396-V3.4"', `data-version="${WEB_LOCAL_VERSION_V14}" data-layout="v35-repaired"`)
    .replace('data-theme="fluent-executive-v34"', 'data-theme="fluent-executive-v35"');

  const css = `<style id="tq35-layout-repair">
.shell{align-items:start!important}.sidebar{position:sticky!important;top:0!important;align-self:start!important;height:100vh!important;overflow-y:auto!important;overflow-x:hidden!important}.content{min-width:0!important}
#tigeriq-management-v31{grid-template-columns:minmax(0,1.55fr) minmax(340px,.72fr)!important;grid-auto-rows:max-content!important;align-items:start!important}.tq31-kpis,.tq31-grid,.tq34-team-section,.tq34-rights-section{grid-column:1/-1!important}.tq34-team-section{grid-column:1/-1!important}.tq34-system-section{grid-column:1!important}.tq34-owner-section{grid-column:2!important}.tq34-rights-section{grid-column:1/-1!important}.tq31-section{align-self:start!important}.tq31-card{height:auto!important}.tq31-grid{align-items:start!important}.tq31-grid>.tq31-card,.tq31-chart-stack{align-self:start!important}
.tq31-people .tq-person{min-height:142px!important;height:auto!important}.tq31-people .tq-person small{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.tq31-systems{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:9px!important}.tq31-systems .tq-system{display:grid!important;grid-template-columns:40px minmax(0,1fr)!important;gap:9px!important;align-items:center!important;min-height:92px!important;height:auto!important;padding:11px!important}.tq31-systems .tq-system>div{min-width:0!important;display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:6px 8px!important}.tq31-systems .tq-system b{flex:1 1 118px!important;min-width:0!important;white-space:normal!important;word-break:normal!important;overflow-wrap:break-word!important;line-height:1.25!important}.tq31-systems .tq-system .tq-badge{flex:0 0 auto!important;white-space:nowrap!important}.tq31-systems .tq-system small{display:none!important}.tq34-system-icon{flex:none!important}
.tq34-owner-highlight{min-height:0!important}.tq34-owner-body{min-height:68px!important;justify-content:flex-start!important}.tq34-rights-section .tq31-card{min-height:0!important}.tq31-owner-event{overflow-wrap:anywhere}.tq31-tech{max-width:100%;overflow:auto}
@media(max-width:1350px){#tigeriq-management-v31{grid-template-columns:1fr!important}.tq34-system-section,.tq34-owner-section{grid-column:1/-1!important}.tq31-systems{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
@media(max-width:980px){.tq31-systems{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:760px){.sidebar{height:auto!important;overflow:visible!important}.tq31-systems{grid-template-columns:1fr!important}.tq31-systems .tq-system{grid-template-columns:38px minmax(0,1fr)!important}.tq31-people .tq-person{min-height:0!important}}
</style>`;
  html = html.replace('</head>', `${css}</head>`);
  return html;
}

async function proxy(options: OwnerCockpitV14Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && upstream.ok && upstreamType.includes('text/html')) {
    const html = applyLayoutRepairV35(await upstream.text());
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

export async function startOwnerCockpitV14(options: OwnerCockpitV14Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v14_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
