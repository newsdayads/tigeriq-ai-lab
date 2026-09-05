import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WEB_LOCAL_VERSION_V11 = 'WEB-LOCAL-396-V3.2';
const MAX_BODY_BYTES = 64 * 1024;

type View = 'overview' | 'work' | 'workforce' | 'models' | 'evidence' | 'reports' | 'system' | 'settings';

export interface OwnerCockpitV11Options {
  cockpitUrl: string;
  host?: string;
  port?: number;
}

const views: View[] = ['overview', 'work', 'workforce', 'models', 'evidence', 'reports', 'system', 'settings'];
const sectionForView: Record<Exclude<View, 'overview'>, string[]> = {
  work: ['cong-viec', 'chi-tiet'],
  workforce: ['doi-ai'],
  models: ['mo-hinh'],
  evidence: ['bang-chung', 'chi-tiet'],
  reports: ['bao-cao'],
  system: ['he-thong'],
  settings: ['cai-dat'],
};
const allLegacySectionIds = ['cong-viec', 'chi-tiet', 'doi-ai', 'mo-hinh', 'bang-chung', 'bao-cao', 'he-thong', 'cai-dat'];

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

function resolvedView(urlValue: string | undefined): View {
  const value = new URL(urlValue ?? '/', 'http://local').searchParams.get('view') ?? 'overview';
  return views.includes(value as View) ? value as View : 'overview';
}

function copyHeaders(upstream: Response, res: ServerResponse): void {
  const blocked = new Set(['content-length', 'transfer-encoding', 'connection', 'content-encoding']);
  for (const [key, value] of upstream.headers.entries()) {
    if (blocked.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === 'location' && value.includes('#he-thong') && !value.includes('view=system')) {
      res.setHeader(key, value.replace('/?', '/?view=system&'));
      continue;
    }
    res.setHeader(key, value);
  }
  res.setHeader('cache-control', 'no-store');
}

function removeSectionById(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`<section class="[^"]*" id="${escaped}">[\\s\\S]*?<\\/section>`, 'g'), '');
}

function removeLegacyCommand(html: string): string {
  return html
    .replace(/<form class="assign"[\s\S]*?<\/form>/g, '')
    .replace(/<form class="login"[\s\S]*?<\/form>/g, '')
    .replace(/<div class="notice(?: [^"]*)?">[\s\S]*?<\/div>/g, '');
}

function navLink(html: string, hash: string, view: View): string {
  const active = `class="${view === resolvedCurrentView ? 'on' : ''}"`;
  return html.replace(`<a href="#${hash}">`, `<a ${active} href="/?view=${view}">`);
}

let resolvedCurrentView: View = 'overview';

export function applyOverviewV32(input: string, view: View = 'overview'): string {
  resolvedCurrentView = view;
  let html = input;
  html = html.replace('data-version="WEB-LOCAL-396-V3.1"', `data-version="${WEB_LOCAL_VERSION_V11}" data-overview="single-dashboard-v32"`);
  html = html.replace(':root{font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif;', ':root{font-family:"Open Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;');

  html = navLink(html, 'tong-quan', 'overview');
  html = navLink(html, 'cong-viec', 'work');
  html = navLink(html, 'doi-ai', 'workforce');
  html = navLink(html, 'mo-hinh', 'models');
  html = navLink(html, 'bang-chung', 'evidence');
  html = navLink(html, 'bao-cao', 'reports');
  html = navLink(html, 'he-thong', 'system');
  html = navLink(html, 'cai-dat', 'settings');

  html = html.replace('<form class="search" method="get">', `<form class="search" method="get"><input type="hidden" name="view" value="${view}">`);
  html = html.replaceAll('href="/?work=', 'href="/?view=work&work=');
  html = html.replace('href="/#cong-viec"', 'href="/?view=work#cong-viec"');

  html = html.replace(/<section class="kpis">[\s\S]*?<\/section>/g, '');
  if (view !== 'work') html = removeLegacyCommand(html);
  if (view !== 'overview') html = html.replace(/<section id="tigeriq-management-v31"[\s\S]*?<\/section>/, '');

  const keep = view === 'overview' ? new Set<string>() : new Set(sectionForView[view as Exclude<View, 'overview'>]);
  for (const id of allLegacySectionIds) if (!keep.has(id)) html = removeSectionById(html, id);

  const title: Record<View, [string, string]> = {
    overview: ['Xin chào anh Sơn', 'Đây là tình hình TigerIQ hiện tại.'],
    work: ['Công việc', 'Giao mục tiêu, theo dõi tiến độ và mở chi tiết công việc.'],
    workforce: ['Đội AI', 'Trạng thái và tải công việc của đội AI.'],
    models: ['Mô hình AI', 'Các mô hình AI cục bộ đang có trên hệ thống.'],
    evidence: ['Bằng chứng', 'Lifecycle và bằng chứng kỹ thuật theo công việc.'],
    reports: ['Báo cáo', 'Tóm tắt vận hành từ dữ liệu hiện hành.'],
    system: ['Hệ thống', 'Sức khỏe PC01 và các dịch vụ chính.'],
    settings: ['Cài đặt', 'Thông tin kênh phát hành và trạng thái chỉ đọc.'],
  };
  html = html.replace(/<h1>Xin chào anh Sơn<\/h1><p>Đây là tình hình TigerIQ hiện tại\.<\/p>/, `<h1>${title[view][0]}</h1><p>${title[view][1]}</p>`);

  const css = `<style id="tq32-view-style">.nav a:first-child{background:transparent;color:#94a6b8;box-shadow:none}.nav a.on,.nav a.on:first-child{background:#112235;color:#fff;box-shadow:inset 3px 0 0 var(--orange)}#tigeriq-management-v31{margin-bottom:0}.content{padding-bottom:24px}</style>`;
  html = html.replace('</head>', `${css}</head>`);
  html = html.replace('<body>', `<body class="tq-view-${view}">`);
  return html;
}

async function proxy(options: OwnerCockpitV11Options, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers, body: await readBody(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  copyHeaders(upstream, res);
  if (req.method === 'GET' && new URL(req.url ?? '/', 'http://local').pathname === '/' && upstream.ok && upstreamType.includes('text/html')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(applyOverviewV32(await upstream.text(), resolvedView(req.url)));
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV11(options: OwnerCockpitV11Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const server = createServer(async (req, res) => {
    try { await proxy(options, req, res); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v11_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
