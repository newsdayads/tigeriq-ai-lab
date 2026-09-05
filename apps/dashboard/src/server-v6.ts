import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { ServerTelemetry } from './server.js';

const execFileAsync = promisify(execFile);
const WEB_LOCAL_VERSION = 'WEB-LOCAL-338-V1';
const WEB_LOCAL_SOURCE = 'wo250/command-center-artifact-updater-v3';
const MAX_BODY_BYTES = 64 * 1024;

type Issue = { number?: number; title?: string; body?: string | null; state?: string; html_url?: string; updated_at?: string };
type Comment = { body?: string | null; created_at?: string | null; updated_at?: string | null; html_url?: string };
type Governance = { issue338: Issue | null; latest338: Comment | null; central: Issue | null; installedSha: string | null };

export interface OwnerCockpitV6Options {
  cockpitUrl: string;
  backendUrl: string;
  repo: string;
  host?: string;
  port?: number;
  governance?: () => Promise<Governance>;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function body(req: IncomingMessage): Promise<string | undefined> {
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

async function ghJson<T>(repo: string, endpoint: string): Promise<T> {
  const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}/${endpoint}`], {
    timeout: 15_000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout || '{}') as T;
}

async function installedSha(): Promise<string | null> {
  const currentPath = process.env.TIGERIQ_CURRENT_RELEASE ?? 'F:\\TigerIQ\\CommandCenter\\current-release.txt';
  try {
    const current = (await readFile(currentPath, 'utf8')).trim();
    const leaf = current.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
    return /^[0-9a-f]{40}$/i.test(leaf) ? leaf : null;
  } catch { return null; }
}

async function defaultGovernance(repo: string): Promise<Governance> {
  const [issue338, comments338, central, sha] = await Promise.all([
    ghJson<Issue>(repo, 'issues/338').catch(() => null),
    ghJson<Comment[]>(repo, 'issues/338/comments?per_page=100').catch(() => []),
    ghJson<Issue>(repo, 'issues/280').catch(() => null),
    installedSha(),
  ]);
  const latest338 = [...(Array.isArray(comments338) ? comments338 : [])].sort((a, b) => Date.parse(b.updated_at || b.created_at || '1970-01-01') - Date.parse(a.updated_at || a.created_at || '1970-01-01'))[0] ?? null;
  return { issue338, latest338, central, installedSha: sha };
}

function compact(value: string, max = 180): string {
  const out = value.replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function section(bodyText: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = bodyText.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return (match?.[1] ?? '').trim();
}

function latestState(comment: Comment | null): string {
  const value = String(comment?.body ?? '');
  const matches = [...value.matchAll(/(?:^|\n)state=([^\n]+)/gi)];
  return compact(matches.at(-1)?.[1] ?? 'Đang hoàn thiện Web Local theo #338', 120);
}

export function controlPlaneState(telemetry: ServerTelemetry): { label: string; css: string; note: string } {
  if (!telemetry.available || telemetry.controller === null) return { label: 'CHƯA XÁC MINH', css: 'wait', note: 'Chưa có telemetry Controller' };
  if (telemetry.controller.online !== true) return { label: 'SUY GIẢM / BỊ LỖI', css: 'bad', note: telemetry.controller.port ? `Controller cổng ${telemetry.controller.port} không phản hồi` : 'Controller không phản hồi' };
  return { label: 'ONLINE', css: 'ok', note: telemetry.controller.port ? `Controller cổng ${telemetry.controller.port}` : 'Controller đã phản hồi' };
}

function serverState(telemetry: ServerTelemetry): { label: string; css: string; note: string } {
  if (!telemetry.available) return { label: 'CHƯA XÁC MINH', css: 'wait', note: 'Không có host telemetry' };
  const note = [telemetry.tailscale?.ip ? `Tailscale ${telemetry.tailscale.ip}` : null, telemetry.uptimeSeconds === null ? null : `uptime ${Math.floor(telemetry.uptimeSeconds / 3600)}h`].filter(Boolean).join(' · ');
  return { label: 'ONLINE', css: 'ok', note: note || 'Host telemetry có phản hồi' };
}

function huyState(telemetry: ServerTelemetry): { label: string; css: string; note: string } {
  const roster = telemetry.workforce?.roster ?? [];
  const huy = roster.find((row) => /^(NV03|NV-SYS-01)$/i.test(row.employeeId) || /^Huy\b/i.test(row.displayName));
  if (!huy) return { label: 'CHƯA CÓ BẰNG CHỨNG ACTIVE', css: 'wait', note: `Ollama inventory ${telemetry.ollama?.models?.length ?? 0} model không đồng nghĩa Huy đang làm` };
  if (huy.activeTaskCount > 0 || huy.availability === 'busy') return { label: 'ĐANG LÀM', css: 'run', note: huy.currentTaskIds.join(', ') || 'Có task runtime' };
  if (huy.availability === 'idle') return { label: 'RẢNH', css: 'ok', note: 'Runtime roster xác nhận idle' };
  return { label: huy.availability.toUpperCase(), css: huy.availability === 'degraded' ? 'bad' : 'wait', note: 'Theo Workforce telemetry' };
}

function employeeCards(governance: Governance, telemetry: ServerTelemetry): string {
  const issue338Open = governance.issue338?.state === 'open';
  const ownerHold = /OWNER_HOLD=true/i.test(String(governance.issue338?.body ?? ''));
  const minh = issue338Open && ownerHold
    ? { label: 'SỞ HỮU #338', css: 'run', note: latestState(governance.latest338) }
    : { label: 'CHƯA CÓ BẰNG CHỨNG ACTIVE', css: 'wait', note: 'Không suy diễn trạng thái' };
  const huy = huyState(telemetry);
  const rows = [
    ['Vy (Trợ lý)', 'Điều phối / Chief of Staff', 'ĐIỀU PHỐI', 'muted', 'Không dùng trạng thái này để suy diễn executor'],
    ['Minh (NV01 — Thực thi trực tiếp)', 'Command 1 · Owner foreground', minh.label, minh.css, minh.note],
    ['Khoa (NV02 — Vận hành tự động)', 'Command 2 · Autonomous P0-first', 'CHƯA CÓ BẰNG CHỨNG ACTIVE', 'wait', 'CENTRAL giao lane riêng; không suy diễn heartbeat'],
    ['Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)', 'Command 3 · pc01-local / Ollama', huy.label, huy.css, huy.note],
  ];
  return rows.map(([name, role, state, css, note]) => `<article class="tq-person"><div><b>${esc(name)}</b><small>${esc(role)}</small></div><span class="tq-badge ${esc(css)}">${esc(state)}</span><small>${esc(note)}</small></article>`).join('');
}

export function renderLocalP0Panel(telemetry: ServerTelemetry, governance: Governance, now = new Date()): string {
  const server = serverState(telemetry);
  const control = controlPlaneState(telemetry);
  const ai = huyState(telemetry);
  const body338 = String(governance.issue338?.body ?? '');
  const goal = compact(section(body338, 'Mục tiêu') || 'Hoàn thiện Web Local PC01 để nhìn rõ Server / Control Plane / AI PC01.', 240);
  const step = latestState(governance.latest338);
  const sourceSha = governance.installedSha ?? 'CHƯA XÁC MINH';
  const sourceShort = sourceSha === 'CHƯA XÁC MINH' ? sourceSha : sourceSha.slice(0, 12);
  return `<style>
.tq338{border:1px solid #31506d;background:#0a1723;border-radius:14px;margin-bottom:14px;overflow:hidden}.tq338 *{box-sizing:border-box}.tq338-head{display:flex;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid #21394f}.tq338-head b{font-size:14px}.tq338-head small{display:block;color:#8fa3b8}.tq338-build{text-align:right}.tq-chain{display:grid;grid-template-columns:1.6fr .8fr 1.2fr 1.2fr 1fr;gap:8px;padding:12px}.tq-cell,.tq-layer,.tq-person{border:1px solid #20394f;background:#0d1d2b;border-radius:10px;padding:10px}.tq-cell span,.tq-layer small,.tq-person small{display:block;color:#8fa3b8;font-size:11px}.tq-cell b{display:block;margin-top:4px}.tq-layers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 12px 12px}.tq-layer{display:grid;gap:5px}.tq-layer>div{display:flex;justify-content:space-between;gap:8px}.tq-people{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:0 12px 12px}.tq-person{display:grid;grid-template-columns:1fr auto;gap:4px 8px}.tq-person>small{grid-column:1/3}.tq-badge{border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800;white-space:nowrap;border:1px solid #405269}.tq-badge.ok{color:#82e9b2;border-color:#2d694d}.tq-badge.run{color:#98ceff;border-color:#315e88}.tq-badge.wait{color:#ffd17a;border-color:#6c542b}.tq-badge.bad{color:#ff9da8;border-color:#6b3942}.tq-badge.muted{color:#a7b5c4}@media(max-width:950px){.tq-chain{grid-template-columns:1fr 1fr}.tq-layers,.tq-people{grid-template-columns:1fr}.tq338-build{text-align:left}}@media(max-width:560px){.tq-chain{grid-template-columns:1fr}.tq338-head{display:block}.tq338-build{margin-top:5px}}
</style><section class="tq338" id="tigeriq-p0-338"><div class="tq338-head"><div><b>WEB LOCAL P0 · #338</b><small>Evidence-driven · không suy diễn trạng thái chéo</small></div><div class="tq338-build"><b>${WEB_LOCAL_VERSION}</b><small>Nguồn ${WEB_LOCAL_SOURCE}@${esc(sourceShort)} · ${esc(now.toLocaleString('vi-VN', { hour12: false }))}</small></div></div><div class="tq-chain"><div class="tq-cell"><span>MỤC TIÊU</span><b>${esc(goal)}</b></div><div class="tq-cell"><span>HẠNG MỤC</span><b>#338 · Web Local PC01</b></div><div class="tq-cell"><span>BƯỚC HIỆN TẠI</span><b>${esc(step)}</b></div><div class="tq-cell"><span>MỐC KẾ TIẾP</span><b>Xuất bản local 8787 → tải lại → kiểm chứng evidence</b></div><div class="tq-cell"><span>NGƯỜI PHỤ TRÁCH</span><b>Minh (NV01)</b></div></div><div class="tq-layers"><article class="tq-layer"><div><b>PC01 SERVER</b><span class="tq-badge ${server.css}">${server.label}</span></div><small>${esc(server.note)}</small></article><article class="tq-layer"><div><b>TIGERIQ CONTROL PLANE</b><span class="tq-badge ${control.css}">${control.label}</span></div><small>${esc(control.note)}</small></article><article class="tq-layer"><div><b>AI PC01 — HUY/NV03</b><span class="tq-badge ${ai.css}">${ai.label}</span></div><small>${esc(ai.note)}</small></article></div><div class="tq-people">${employeeCards(governance, telemetry)}</div></section>`;
}

export function injectLocalP0Panel(html: string, panel: string, telemetry: ServerTelemetry): string {
  const control = controlPlaneState(telemetry);
  let out = html;
  if (control.css !== 'ok') {
    out = out.replace(/✓\s*Hệ thống\s+hoạt động/gi, control.css === 'bad' ? '⚠ Control Plane SUY GIẢM' : '⚠ Hệ thống CHƯA XÁC MINH');
  }
  const marker = '</header>';
  const index = out.indexOf(marker);
  return index >= 0 ? `${out.slice(0, index + marker.length)}${panel}${out.slice(index + marker.length)}` : `${panel}${out}`;
}

async function fetchTelemetry(backendUrl: string): Promise<ServerTelemetry> {
  const response = await fetch(`${backendUrl}/api/server`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`telemetry_${response.status}`);
  return response.json() as Promise<ServerTelemetry>;
}

async function proxyResponse(options: OwnerCockpitV6Options, req: IncomingMessage, res: ServerResponse, governanceReader: () => Promise<Governance>): Promise<void> {
  const requestHeaders = new Headers();
  if (req.headers.cookie) requestHeaders.set('cookie', req.headers.cookie);
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') requestHeaders.set('content-type', contentType);
  const upstream = await fetch(`${options.cockpitUrl}${req.url ?? '/'}`, { method: req.method, headers: requestHeaders, body: await body(req), redirect: 'manual' });
  const upstreamType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
  if (req.method === 'GET' && new URL(req.url ?? '/', 'http://local').pathname === '/' && upstream.ok && upstreamType.includes('text/html')) {
    const [html, telemetry, governance] = await Promise.all([upstream.text(), fetchTelemetry(options.backendUrl), governanceReader()]);
    const page = injectLocalP0Panel(html, renderLocalP0Panel(telemetry, governance), telemetry);
    copyHeaders(upstream, res, 'text/html; charset=utf-8');
    res.statusCode = upstream.status;
    res.end(page);
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  copyHeaders(upstream, res);
  res.statusCode = upstream.status;
  res.end(payload);
}

export async function startOwnerCockpitV6(options: OwnerCockpitV6Options) {
  const host = options.host ?? '127.0.0.1';
  if (!isPrivateHost(host)) throw new Error('public_bind_forbidden');
  const governanceReader = options.governance ?? (() => defaultGovernance(options.repo));
  const server = createServer(async (req, res) => {
    try { await proxyResponse(options, req, res, governanceReader); }
    catch (error) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ error: 'owner_cockpit_v6_unavailable', detail: String(error instanceof Error ? error.message : error).slice(0, 160) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); });
  const address = server.address() as AddressInfo;
  return { url: `http://${address.address}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
