import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WorkOrderSnapshot } from '../../../packages/control-plane/src/index.js';
import { buildDashboard } from './index.js';

export interface DashboardSource {
  list(): WorkOrderSnapshot[] | Promise<WorkOrderSnapshot[]>;
}

export async function startDashboard(source: DashboardSource, options: { host?: string; port?: number } = {}) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method !== 'GET' || (path !== '/' && path !== '/api/status')) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(JSON.stringify({ error: 'not_found' }));
    }
    try {
      const summary = buildDashboard(await source.list());
      if (path === '/api/status') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(JSON.stringify(summary));
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(render(summary));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(JSON.stringify({ error: 'dashboard_unavailable' }));
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

function render(summary: ReturnType<typeof buildDashboard>): string {
  const rows = summary.workOrders.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.goal)}</td><td>${item.status}</td><td>${item.latestGate ?? '-'}</td><td>${item.latestGateStatus ?? '-'}</td><td>${item.evidenceCount}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TigerIQ Control Center</title><style>body{font-family:system-ui;margin:24px;max-width:1100px}header{display:flex;justify-content:space-between;align-items:center}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.kpi{border:1px solid #ddd;border-radius:12px;padding:14px}.kpi b{display:block;font-size:28px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:10px}small{color:#666}</style></head><body><header><div><h1>🐯 TigerIQ Control Center</h1><small>${summary.generatedAt}</small></div><b>${summary.releaseEligible ? 'RELEASE ELIGIBLE' : 'GATED'}</b></header><div class="grid"><div class="kpi">Active<b>${summary.activeWorkOrders}</b></div><div class="kpi">Blocked<b>${summary.blockedWorkOrders}</b></div><div class="kpi">Failing gates<b>${summary.failingGates}</b></div><div class="kpi">Evidence<b>${summary.evidenceCount}</b></div></div><table><thead><tr><th>Work Order</th><th>Goal</th><th>Status</th><th>Gate</th><th>Gate status</th><th>Evidence</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No Work Orders</td></tr>'}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
