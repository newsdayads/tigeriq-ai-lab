import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Web Control V1 UI architecture', () => {
  it('contains all Owner control surfaces requested for V1', async () => {
    const html = await read('public/web-v1/index.html');
    for (const label of ['Tổng quan','Giao mục tiêu','Jobs','Employees','AI Providers','Prompt Architect','Result & Evidence','Blocker & Recovery','Lịch sử','Kết nối']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('PC01 → Tailscale → Workforce Controller');
  });

  it('uses Workforce Controller contract and does not use GitHub/Vercel as runtime queue/state', async () => {
    const client = await read('public/web-v1/controller-client.js');
    const app = await read('public/web-v1/app.js');
    expect(client).toContain('/api/web/v1/snapshot');
    expect(client).toContain('/api/workforce/status');
    for (const forbidden of ['api.github.com','/api/control','/api/web-control-status','TIGERIQ_GITHUB_TOKEN']) {
      expect(client).not.toContain(forbidden);
      expect(app).not.toContain(forbidden);
    }
  });

  it('makes root/operations/workforce views static Web V1 while keeping Vercel outside the control-plane contract', async () => {
    const config = JSON.parse(await read('vercel.json'));
    expect(config.rewrites).toContainEqual({source:'/',destination:'/web-v1/index.html'});
    expect(config.rewrites).toContainEqual({source:'/operations',destination:'/web-v1/index.html'});
    expect(config.rewrites).toContainEqual({source:'/workforce',destination:'/web-v1/index.html'});
  });

  it('keeps mock data visibly non-authoritative and avoids fake runtime PASS', async () => {
    const mock = await read('public/web-v1/mock-data.js');
    expect(mock).toContain("authoritative: false");
    expect(mock).toContain("availability: 'unknown'");
    expect(mock).toContain("status: 'unknown'");
    expect(mock).not.toContain("source: { mode: 'controller', authoritative: true");
  });
});
