import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createPcOperatorMcpHandler, PC_OPERATOR_MCP_TOOLS, pcOperatorTestRunSpec, pcOperatorWorkOrderResponse } from '../apps/tigeriq-core/pc-operator-mcp.mjs';

function parseSsePayload(text) {
  const lines = text.split('\n');
  const dataLine = lines.find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error('No data line found in SSE response: ' + text);
  const json = JSON.parse(dataLine.slice(6));
  if (json.error) return { isRpcError: true, error: json.error };
  const contentText = json.result?.content?.[0]?.text;
  if (!contentText) return json.result;
  try {
    return JSON.parse(contentText);
  } catch {
    return { raw: contentText };
  }
}

describe('TigerIQ PC Operator MCP Server', () => {
  it('exposes exactly the 25 comprehensive tools', () => {
    expect(PC_OPERATOR_MCP_TOOLS.length).toBe(25);
    expect(PC_OPERATOR_MCP_TOOLS).toContain('paperclip_lab_preflight');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('paperclip_lab_health');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('paperclip_lab_broker_install');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_read');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_write');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_list');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_stat');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_search');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('shell_exec');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('process_list');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('task_list');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('task_action');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('service_status');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('docker_status');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('wsl_status');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('ui_window_list');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('ui_screenshot');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('ui_action');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('core_status');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('ollama_status');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('log_read');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('test_run');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('evidence_record');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('rdc_pool_status');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('work_order_status');
  });

  it('handles GET /mcp/health check endpoint', async () => {
    const handler = createPcOperatorMcpHandler();
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.version).toBe('2.0.0');
      expect(json.toolsCount).toBe(25);
      expect(json.tools).toEqual(PC_OPERATOR_MCP_TOOLS);
    } finally {
      server.close();
    }
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
      expect(listText).toContain('file_read');
      expect(listText).toContain('shell_exec');
      expect(listText).toContain('ui_screenshot');

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
      expect(preflightText).toContain('NATIVE_RECEIPT_NOT_ACCEPTED');
      expect(preflightText).not.toContain('PC_OPERATOR_DIRECT_FENCE');
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

  it('never exposes PC01 file or shell actions to legacy unauthenticated clients', async () => {
    const secret = 'a'.repeat(32);
    const handler = createPcOperatorMcpHandler({ existingSecret: secret });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handler(req, res, url))) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
      const blockedCalls = [
        { name: 'file_write', arguments: { path: 'D:\\TigerIQ\\State\\write.txt', content: 'NEVER_WRITTEN' } },
        { name: 'shell_exec', arguments: { command: 'echo MUST_NOT_EXECUTE' } },
        { name: 'ui_action', arguments: { action: 'pad_health' } },
      ];
      for (const { name, arguments: toolArgs } of blockedCalls) {
        const response = await fetch('http://127.0.0.1:' + port + '/mcp', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call',
            params: { name, arguments: toolArgs } }),
        });
        expect(response.status).toBe(200);
        const outcome = parseSsePayload(await response.text());
        expect(outcome.ok).toBe(false);
        expect(outcome.reason).toBe('MCP_EXISTING_AUTH_REQUIRED');
      }
    } finally {
      server.close();
    }
  });

  it('denies authenticated mutations when Core shared lease is unavailable', async () => {
    const secret = 'b'.repeat(32);
    const handler = createPcOperatorMcpHandler({
      existingSecret: secret,
      leaseDb: { query: vi.fn() },
      leaseApi: { acquire: vi.fn().mockResolvedValue(null),
        heartbeat: vi.fn(), release: vi.fn() },
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handler(req, res, url))) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'tools/call',
          params: { name: 'shell_exec', arguments: { command: 'echo MUST_NOT_RUN' } } }),
      });
      expect(response.status).toBe(200);
      const outcome = parseSsePayload(await response.text());
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe('PC_OPERATOR_SHARED_LEASE_BUSY');
    } finally { server.close(); }
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
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { installed: true, r07SourceVerified: true, dockerVersion: '27.0' },
    });
    const leaseDb = { query: vi.fn() };
    const leaseApi = {
      acquire: vi.fn(async (_db, spec) => ({
        resource_id: spec.resourceId,
        work_id: spec.workId,
        lease_token: 'private-token',
        lease_until: new Date(Date.now() + 120000).toISOString(),
      })),
      heartbeat: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
    };
    const handler = createPcOperatorMcpHandler({
      executePcActionImpl: execute,
      existingSecret: secret,
      leaseDb,
      leaseApi,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handler(req, res, url))) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const call = (authorization) =>
      fetch('http://127.0.0.1:' + port + '/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: { name: 'paperclip_lab_broker_install', arguments: {} },
        }),
      }).then((r) => r.text());
    try {
      const denied = await call(null);
      expect(denied).toContain('MCP_EXISTING_AUTH_REQUIRED');
      expect(execute).not.toHaveBeenCalled();

      const accepted = await call('Bearer ' + secret);
      expect(accepted).toContain('leaseVerified');
      expect(accepted).toContain('leaseReleased');
      expect(accepted).toContain('completedStepId');
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

  it('executes file_write, file_read, and file_stat with safety boundaries', async () => {
    const secret = 'a'.repeat(32);
    const leaseDb = { query: vi.fn() };
    const leaseApi = {
      acquire: vi.fn(async (_db, spec) => ({
        resource_id: spec.resourceId, work_id: spec.workId,
        lease_token: 'mock-lease-token',
        lease_until: new Date(Date.now() + 120000).toISOString(),
      })),
      heartbeat: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
    };
    const handler = createPcOperatorMcpHandler({
      existingSecret: secret, leaseDb, leaseApi,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const testFile = 'D:\\TigerIQ\\State\\mcp-test-file.txt';

    try {
      // 1. file_write
      const writeRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'file_write',
            arguments: {
              path: testFile,
              content: 'TigerIQ MCP Test Content 2026',
            },
          },
        }),
      });
      expect(writeRes.status).toBe(200);
      const writePayload = parseSsePayload(await writeRes.text());
      expect(writePayload.ok).toBe(true);
      expect(writePayload.receipt.size).toBeGreaterThan(0);

      // 2. file_read
      const readRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'file_read',
            arguments: {
              path: testFile,
            },
          },
        }),
      });
      expect(readRes.status).toBe(200);
      const readPayload = parseSsePayload(await readRes.text());
      expect(readPayload.ok).toBe(true);
      expect(readPayload.receipt.content).toBe('TigerIQ MCP Test Content 2026');

      // 3. file_stat
      const statRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: {
            name: 'file_stat',
            arguments: {
              path: testFile,
            },
          },
        }),
      });
      expect(statRes.status).toBe(200);
      const statPayload = parseSsePayload(await statRes.text());
      expect(statPayload.ok).toBe(true);
      expect(statPayload.receipt.type).toBe('file');

      // 4. sensitive path denied
      const sensitiveRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 13,
          method: 'tools/call',
          params: {
            name: 'file_read',
            arguments: {
              path: 'D:\\TigerIQ\\secrets\\test.txt',
            },
          },
        }),
      });
      expect(sensitiveRes.status).toBe(200);
      const sensitivePayload = parseSsePayload(await sensitiveRes.text());
      expect(sensitivePayload.ok).toBe(false);
      expect(sensitivePayload.error).toContain('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
    } finally {
      server.close();
      try { await fs.unlink(testFile); } catch {}
    }
  });

  it('records structured evidence via evidence_record tool with sha256', async () => {
    const secret = 'a'.repeat(32);
    const leaseDb = { query: vi.fn() };
    const leaseApi = {
      acquire: vi.fn(async (_db, spec) => ({
        resource_id: spec.resourceId, work_id: spec.workId,
        lease_token: 'mock-lease-token',
        lease_until: new Date(Date.now() + 120000).toISOString(),
      })),
      heartbeat: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
    };
    const handler = createPcOperatorMcpHandler({
      existingSecret: secret, leaseDb, leaseApi,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 20,
          method: 'tools/call',
          params: {
            name: 'evidence_record',
            arguments: {
              category: 'unit-test-verification',
              data: {
                testPass: true,
                target: 'pc01-operator-mcp',
              },
            },
          },
        }),
      });
      expect(res.status).toBe(200);
      const payload = parseSsePayload(await res.text());
      expect(payload.ok).toBe(true);
      expect(payload.receipt.sha256).toBeDefined();
      expect(payload.receipt.record.category).toBe('unit-test-verification');
    } finally {
      server.close();
    }
  });

  it('handles idempotencyKey to prevent duplicate execution', async () => {
    let callCount = 0;
    const mockExecute = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return { count: callCount };
    });

    const secret = 'a'.repeat(32);
    const handler = createPcOperatorMcpHandler({ executePcActionImpl: mockExecute, existingSecret: secret });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const idempotencyKey = 'key-test-dedup-9999';

      // Call 1
      const res1 = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 30,
          method: 'tools/call',
          params: {
            name: 'ollama_status',
            arguments: { idempotencyKey },
          },
        }),
      });
      expect(res1.status).toBe(200);
      const p1 = parseSsePayload(await res1.text());
      expect(p1.ok).toBe(true);

      // Call 2 with same idempotencyKey -> returns cached response
      const res2 = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 31,
          method: 'tools/call',
          params: {
            name: 'ollama_status',
            arguments: { idempotencyKey },
          },
        }),
      });
      expect(res2.status).toBe(200);
      const p2 = parseSsePayload(await res2.text());
      expect(p2.ok).toBe(true);
      expect(p2.jobId).toBe(p1.jobId);
    } finally {
      server.close();
    }
  });

  it('never treats serverAuthorized as a credential and requires per-request bearer', async () => {
    const secret = 's'.repeat(32);
    const handler = createPcOperatorMcpHandler({
      serverAuthorized: true,
      existingSecret: secret,
      leaseDb: null,
      executePcActionImpl: vi.fn().mockResolvedValue({ simulated: true }),
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handler(req, res, url))) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const testFile = 'D:\\TigerIQ\\State\\mcp-server-auth-test.txt';
    const call = (name, args = {}, authorization = null) => fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 50,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    try {
      const denied = await call('file_write', { path: testFile, content: 'SHOULD_NOT_WRITE' });
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toBe('Bearer');
      expect(await denied.json()).toEqual({ ok: false, reason: 'MCP_PER_REQUEST_AUTH_REQUIRED' });
      await expect(fs.stat(testFile)).rejects.toThrow();

      const initDenied = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 51, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'anonymous', version: '1' } },
        }),
      });
      expect(initDenied.status).toBe(401);

      const authorization = 'Bearer ' + secret;
      const accepted = await call('file_write', { path: testFile, content: 'PER_REQUEST_AUTH_OK' }, authorization);
      expect(accepted.status).toBe(200);
      const acceptedPayload = parseSsePayload(await accepted.text());
      expect(acceptedPayload.ok).toBe(true);
      expect(acceptedPayload.completedStepId).toBe('file_write');

      const readBack = await fs.readFile(testFile, 'utf8');
      expect(readBack).toBe('PER_REQUEST_AUTH_OK');
    } finally {
      server.close();
      try { await fs.unlink(testFile); } catch {}
    }
  });

  it('handles docker_status gracefully without throwing ENOENT', async () => {
    const handler = createPcOperatorMcpHandler();
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 60,
          method: 'tools/call',
          params: {
            name: 'docker_status',
            arguments: {},
          },
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('dockerAvailable');
      expect(text).toContain('containerCount');
    } finally {
      server.close();
    }
  });

  it('handles ui_window_list with structured window response', async () => {
    const handler = createPcOperatorMcpHandler({
      executePcActionImpl: async () => ({
        ok: true,
        data: {
          result: [
            { Name: 'Notepad', ProcessId: 1234, Process: 'notepad', X: 10, Y: 10, Width: 400, Height: 300 }
          ]
        }
      })
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 61,
          method: 'tools/call',
          params: {
            name: 'ui_window_list',
            arguments: {},
          },
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Notepad');
      expect(text).toContain('brokerAvailable');
    } finally {
      server.close();
    }
  });

  it('validates pad-ui request parameters for PID, windowTitle, className and CTRL+S', async () => {
    const { assertPadUiRequest } = await import('../apps/openclaw-tigeriq-runtime/pad-ui.mjs');
    expect(assertPadUiRequest({ action: 'pad_keys', key: 'CTRL+S' })).toEqual({ action: 'pad_keys', key: 'CTRL+S' });
    expect(assertPadUiRequest({ action: 'pad_windows', windowTitle: 'Notepad', processId: 1234 })).toEqual({
      action: 'pad_windows',
      windowName: 'Notepad',
      processId: 1234,
    });
    expect(assertPadUiRequest({ action: 'pad_set_value', className: 'Edit', value: 'Hello' })).toEqual({
      action: 'pad_set_value',
      className: 'Edit',
      value: 'Hello',
    });
  });
});


describe('P0 GH-5417: native PC Operator test runner and Work Order diagnostics', () => {
  it('runs Vitest suites with installed node.exe, not an npm .cmd shim', () => {
    const spec = pcOperatorTestRunSpec('tests/github-coding-intake.test.mjs', {
      runtimeRoot: 'D:\\TigerIQ\\Runtime\\CoreSource',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      testSource: "import { describe, it, expect } from 'vitest';",
    });
    expect(spec.exe).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(spec.runner).toBe('vitest');
    expect(spec.runnerPath).toBe('D:\\TigerIQ\\Runtime\\CoreSource\\node_modules\\vitest\\vitest.mjs');
    expect(spec.args).toEqual([
      'D:\\TigerIQ\\Runtime\\CoreSource\\node_modules\\vitest\\vitest.mjs',
      'run',
      'tests/github-coding-intake.test.mjs',
    ]);
    expect(spec.cwd).toBe('D:\\TigerIQ\\Runtime\\CoreSource');
    expect(spec.args.some(x => x.endsWith('.cmd'))).toBe(false);
  });
  it('ignores a quoted node:test import example inside a Vitest suite', () => {
    const source = [
      "import { describe, it, expect, vi } from 'vitest';",
      "const fixture = \"import test from 'node:test';\";",
      "// import test from 'node:test'; is documentation only",
    ].join('\n');
    const spec = pcOperatorTestRunSpec('tests/pc-operator-mcp.test.mjs', {testSource:source});
    expect(spec.runner).toBe('vitest');
    expect(spec.args[1]).toBe('run');
  });
  it('recognizes a real node:test import without mistaking comment strings', () => {
    const source = [
      "// import { describe } from 'vitest'; commented out",
      "import test from 'node:test';",
      "const fixture = \"import { describe } from 'vitest';\";",
    ].join('\n');
    const spec = pcOperatorTestRunSpec('tests/example.test.mjs', {testSource:source});
    expect(spec.runner).toBe('node:test');
    expect(spec.args).toEqual(['--test', 'tests/example.test.mjs']);
  });
  it('runs node:test suites with node --test instead of forcing Vitest', () => {
    const spec = pcOperatorTestRunSpec('tests/pc-operator-oauth-policy.test.mjs', {
      runtimeRoot: 'D:\\TigerIQ\\Runtime\\CoreSource',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      testSource: "import test from 'node:test';",
    });
    expect(spec.exe).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(spec.runner).toBe('node:test');
    expect(spec.runnerPath).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(spec.args).toEqual(['--test', 'tests/pc-operator-oauth-policy.test.mjs']);
    expect(spec.args.some(x => x.endsWith('.cmd'))).toBe(false);
  });
  it('refuses an absolute path, traversal or executable outside tests/**', () => {
    for (const testPath of ['D:\\unsafe\\test.js', '../secrets.test.mjs', 'tests/../secrets.test.mjs',
      'tests//foo.test.mjs', 'apps/tigeriq-core/core.mjs', 'tests/foo.js', 'tests/nope.test.exe']) {
      expect(() => pcOperatorTestRunSpec(testPath)).toThrow('MCP_TEST_PATH_NOT_ALLOWED');
    }
  });
  it('turns plain-text Core 404 into a structured missing-work-order receipt', async () => {
    await expect(pcOperatorWorkOrderResponse(new Response('not_found', {status:404}), '5417'))
      .resolves.toEqual({workOrder:'5417',found:false,status:404,reason:'WORK_ORDER_NOT_FOUND'});
  });
  it('does not parse untrusted non-JSON Core failures', async () => {
    await expect(pcOperatorWorkOrderResponse(new Response('unavailable', {status:503}), '5417'))
      .resolves.toEqual({workOrder:'5417',found:false,status:503,reason:'CORE_WORK_ORDER_HTTP_ERROR'});
    await expect(pcOperatorWorkOrderResponse(new Response('not json', {status:200}), '5417'))
      .resolves.toEqual({workOrder:'5417',found:false,status:200,reason:'CORE_WORK_ORDER_INVALID_JSON'});
  });
  it('preserves valid Core JSON receipt unchanged', async () => {
    await expect(pcOperatorWorkOrderResponse(new Response(JSON.stringify({ok:true,workOrderId:'WO-1'}), {status:200}), 'WO-1'))
      .resolves.toEqual({workOrder:'WO-1',found:true,data:{ok:true,workOrderId:'WO-1'}});
  });
});
