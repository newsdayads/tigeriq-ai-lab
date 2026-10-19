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
      expect(mockExecute).toHaveBeenCalledWith({ action: 'paperclip_lab_broker_install' });
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
});
