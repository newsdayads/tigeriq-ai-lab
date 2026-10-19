import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { createPcOperatorMcpHandler, PC_OPERATOR_MCP_TOOLS } from '../apps/tigeriq-core/pc-operator-mcp.mjs';

describe('TigerIQ PC Operator MCP Server', () => {
  it('exposes exactly the 3 allowed Paperclip Lab tools', () => {
    expect(PC_OPERATOR_MCP_TOOLS).toEqual([
      'paperclip_lab_preflight',
      'paperclip_lab_health',
      'paperclip_lab_broker_install',
    ]);
  });

  it('handles MCP initialize and tools/list via Streamable HTTP POST', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ status: 'ok' });
    const handler = createPcOperatorMcpHandler({ executePcActionImpl: mockExecute });

    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // 1. initialize
      const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-chatgpt', version: '1.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const initText = await initRes.text();
      expect(initText).toContain('TigerIQ PC Operator');

      // 2. tools/list
      const listRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(listRes.status).toBe(200);
      const listText = await listRes.text();
      expect(listText).toContain('paperclip_lab_preflight');
      expect(listText).toContain('paperclip_lab_health');
      expect(listText).toContain('paperclip_lab_broker_install');

      // 3. tools/call paperclip_lab_preflight
      const callPreflight = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'paperclip_lab_preflight',
            arguments: {},
          },
        }),
      });
      expect(callPreflight.status).toBe(200);
      const preflightText = await callPreflight.text();
      expect(preflightText).toContain('JOB-MCP-');
      expect(preflightText).toContain('PC_OPERATOR_DIRECT_FENCE');
      expect(preflightText).toContain('paperclip_lab_preflight');
      expect(mockExecute).toHaveBeenCalledWith({ action: 'paperclip_lab_preflight' });

      // 4. tools/call paperclip_lab_health
      const callHealth = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'paperclip_lab_health',
            arguments: {},
          },
        }),
      });
      expect(callHealth.status).toBe(200);
      const healthText = await callHealth.text();
      expect(healthText).toContain('paperclip_lab_health');
      expect(mockExecute).toHaveBeenCalledWith({ action: 'paperclip_lab_health' });

      // 5. tools/call paperclip_lab_broker_install
      const callBroker = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'paperclip_lab_broker_install',
            arguments: {},
          },
        }),
      });
      expect(callBroker.status).toBe(200);
      const brokerText = await callBroker.text();
      expect(brokerText).toContain('paperclip_lab_broker_install');
      expect(brokerText).toContain('MCP_EXISTING_AUTH_REQUIRED');
      expect(mockExecute).not.toHaveBeenCalledWith({ action: 'paperclip_lab_broker_install' });
    } finally {
      server.close();
    }
  });

  it('handles classic SSE GET handshake', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ status: 'ok' });
    const handler = createPcOperatorMcpHandler({ executePcActionImpl: mockExecute });

    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const sseRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      });
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get('content-type')).toContain('text/event-stream');

      const reader = sseRes.body.getReader();
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain('event: endpoint');
      expect(text).toContain('/mcp/messages?sessionId=');
      reader.cancel();
    } finally {
      server.close();
    }
  });

  it('allows /mcp without secret in createHealthViewGateway while requiring secret for display paths', async () => {
    const { createHealthViewGateway } = await import('../apps/tigeriq-core/api-health-view-gateway.mjs');
    const secret = 'a'.repeat(32);
    const mockMcp = vi.fn().mockImplementation(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ mcp: true }));
      return true;
    });

    const gateway = createHealthViewGateway({
      secret,
      mcpHandler: mockMcp,
      fetchImpl: vi.fn(),
    });

    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const port = gateway.address().port;

    try {
      // 1. Unauthenticated /mcp -> 200 via mcpHandler
      const mcpRes = await fetch(`http://127.0.0.1:${port}/mcp`);
      expect(mcpRes.status).toBe(200);
      expect(await mcpRes.json()).toEqual({ mcp: true });
      expect(mockMcp).toHaveBeenCalled();

      // 2. Unauthenticated /api/status -> 401 unauthorized
      const statusRes = await fetch(`http://127.0.0.1:${port}/api/status`);
      expect(statusRes.status).toBe(401);
    } finally {
      gateway.close();
    }
  });
  it('requires existing gateway bearer and a real shared lease before writing broker', async () => {
    const secret = 'a'.repeat(32);
    const execute = vi.fn().mockResolvedValue({ ok: true,
      data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' } });
    const leaseDb = { query: vi.fn() };
    const leaseApi = {
      acquire: vi.fn(async (_db, spec) => ({
        resource_id: spec.resourceId, work_id: spec.workId, lease_token: 'private-token',
        lease_until: new Date(Date.now() + 120000).toISOString(),
      })),
      heartbeat: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
    };
    const handler = createPcOperatorMcpHandler({
      executePcActionImpl: execute, existingSecret: secret, leaseDb, leaseApi,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handler(req, res, url))) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const call = (authorization) => fetch('http://127.0.0.1:' + port + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json',
        ...(authorization ? { authorization } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: { name: 'paperclip_lab_broker_install', arguments: {} } }),
    }).then(r => r.text());
    try {
      const denied = await call(null);
      expect(denied).toContain('MCP_EXISTING_AUTH_REQUIRED');
      expect(execute).not.toHaveBeenCalled();

      const accepted = await call('Bearer ' + secret);
      expect(accepted).toContain('"leaseVerified": true');
      expect(accepted).toContain('"leaseReleased": true');
      expect(accepted).toContain('"completedStepId": null');
      expect(accepted).not.toContain('private-token');
      expect(leaseApi.acquire).toHaveBeenCalledOnce();
      expect(leaseApi.heartbeat).toHaveBeenCalled();
      expect(leaseApi.release).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({ action: 'paperclip_lab_broker_install' });

      leaseApi.acquire.mockResolvedValueOnce(null);
      const busy = await call('Bearer ' + secret);
      expect(busy).toContain('NV06_SHARED_LEASE_BUSY');
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it('never accepts a missing database or fabricated lease', async () => {
    const execute = vi.fn();
    const server = { tool: vi.fn() };
    const { registerPcOperatorTools } = await import('../apps/tigeriq-core/pc-operator-mcp.mjs');
    registerPcOperatorTools(server, execute, { allowMutation: true, leaseDb: null });
    const install = server.tool.mock.calls.find(([name]) => name === 'paperclip_lab_broker_install')[3];
    const result = await install();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('MCP_CORE_SHARED_LEASE_DB_UNAVAILABLE');
    expect(execute).not.toHaveBeenCalled();
  });

});
