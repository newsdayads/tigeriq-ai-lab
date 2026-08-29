import { createServer } from 'node:http';
import type { AddressInfo, ServerResponse } from 'node:http';
import type { WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';
import { buildDashboard } from './index.js';

export interface DashboardSource {
  list(): WorkOrderSnapshot[] | Promise<WorkOrderSnapshot[]>;
}

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function respond(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { ...securityHeaders, 'content-type': contentType });
  response.end(body);
}

export async function startDashboard(source: DashboardSource, options: { host?: string; port?: number } = {}) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method !== 'GET' || (path !== '/' && path !== '/api/status')) {
      return respond(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
    }
    try {
      const summary = buildDashboard(await source.list());
      if (path === '/api/status') {
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(summary));
      }
      return respond(response, 200, 'text/html; charset=utf-8', render(summary));
    } catch {
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'dashboard_unavailable' }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Nháp',
    planned: 'Đã lên kế hoạch',
    active: 'AI đang làm',
    review: 'Đang kiểm tra',
    blocked: 'Đang vướng',
    verified: 'Hoàn thành',
  };
  return labels[status] ?? status;
}

function render(summary: ReturnType<typeof buildDashboard>): string {
  const rows = summary.workOrders.map((item) => `<tr><td><strong>${escapeHtml(item.id)}</strong></td><td>${escapeHtml(item.goal)}</td><td>${escapeHtml(statusText(item.status))}</td><td>${escapeHtml(item.latestGate ?? '-')}</td><td>${escapeHtml(item.latestGateStatus ?? '-')}</td><td>${item.evidenceCount}</td></tr>`).join('');
  const gateLabel = summary.releaseEligible ? 'ĐỦ ĐIỀU KIỆN RELEASE' : 'ĐANG BỊ GATE CHẶN';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>TigerIQ Control Center</title><style>:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0;background:Canvas;color:CanvasText}.wrap{max-width:1180px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}.gate{border:1px solid currentColor;border-radius:999px;padding:8px 12px;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}.kpi{border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:14px;padding:16px}.kpi b{display:block;font-size:30px;margin-top:4px}.table-wrap{overflow:auto;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:14px}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;border-bottom:1px solid color-mix(in srgb,CanvasText 14%,transparent);padding:11px 12px}th{position:sticky;top:0;background:Canvas}small{opacity:.7}</style></head><body><main class="wrap"><header><div><h1>🐯 TigerIQ Control Center</h1><small>Cập nhật: ${escapeHtml(summary.generatedAt)} · tự làm mới mỗi 15 giây</small></div><div class="gate">${gateLabel}</div></header><section class="grid"><div class="kpi">Đang xử lý<b>${summary.activeWorkOrders}</b></div><div class="kpi">Đang vướng<b>${summary.blockedWorkOrders}</b></div><div class="kpi">Gate lỗi/chặn<b>${summary.failingGates}</b></div><div class="kpi">Evidence<b>${summary.evidenceCount}</b></div></section><div class="table-wrap"><table><thead><tr><th>Work Order</th><th>Mục tiêu</th><th>Trạng thái</th><th>Gate gần nhất</th><th>Kết quả gate</th><th>Evidence</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Chưa có Work Order</td></tr>'}</tbody></table></div></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
