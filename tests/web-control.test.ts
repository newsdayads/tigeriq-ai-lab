import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import server from '../apps/tigeriq-core/web-control-server.mjs';
import http from 'node:http';

const PORT = 3001;

describe('Web Control Server Unit Tests', () => {
  beforeAll((done) => {
    process.env.PORT = String(PORT);
    process.env.NODE_ENV = 'test';
    server.listen(PORT, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('serves health check endpoint', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('serves api status truth endpoint', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('pipelineState');
    expect(data).toHaveProperty('throughput');
  });

  it('serves the HTML dashboard bundle', async () => {
    const res = await fetch(`http://localhost:${PORT}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('TigerIQ Web Control');
  });
});
