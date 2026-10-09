import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startDashboard } from '../apps/dashboard/src/server.ts';

const fakeSnapshots = [{
  order: { id: 'WO-GH-4604', project: 'TigerIQ', goal: '[P0] BCCT kiểm tra đầu vào', status: 'blocked' },
  decisions: [], evidence: [],
}, {
  order: { id: 'WO-GH-4569', project: 'TigerIQ', goal: '[P2] Giao tiếp', status: 'verified' },
  decisions: [], evidence: [],
}];

it('GET /bcct on actual release backend returns 6 sections and filter links', async () => {
  const server = await startDashboard({ list: async () => fakeSnapshots }, {
    host: '127.0.0.1', port: 0, repo: 'newsdayads/tigeriq-ai-lab', commandSecret: '',
    serverTelemetry: async () => { throw new Error('not called by BCCT'); },
  });
  try {
    const res = await fetch(server.url + '/bcct');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('6. Mốc kế tiếp');
    expect(html).toContain('RDC05');
    expect(html).toContain('#4604');
    expect(html).toContain('#4569');
    expect(html).toContain('href="/bcct?filter=P0"');

    const filtered = await fetch(server.url + '/bcct?filter=P0');
    const filteredHtml = await filtered.text();
    expect(filtered.status).toBe(200);
    expect(filteredHtml).toContain('#4604');
    expect(filteredHtml).not.toContain('#4569');
  } finally { await server.close(); }
});

it('invalid source fails closed on HTTP path, not a fake green report', async () => {
  const server = await startDashboard({ list: async () => { throw new Error('DATA_UNAVAILABLE'); } }, {
    host: '127.0.0.1', port: 0, commandSecret: '',
  });
  try {
    const res = await fetch(server.url + '/bcct');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('command_center_unavailable');
  } finally { await server.close(); }
});

it('V17 public route forwards BCCT directly to the validated backend', () => {
  const source = readFileSync(new URL('../apps/dashboard/src/server-v17.ts', import.meta.url), 'utf8');
  expect(source).toContain("'/api/executions','/bcct'");
  expect(source).toContain('options.backendUrl');
});
