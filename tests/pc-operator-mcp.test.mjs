import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createPcOperatorMcpHandler, PC_OPERATOR_MCP_TOOLS } from '../apps/tigeriq-core/pc-operator-mcp.mjs';

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
    expect(PC_OPERATOR_MCP_TOOLS).toContain('paperclip_lab_preflight');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('paperclip_lab_health');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('paperclip_lab_broker_install');
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

  it('enforces authentication when mcpAuthKey is configured', async () => {
    const authKey = 'secret-token-12345678901234567890123456';
    const handler = createPcOperatorMcpHandler({ mcpAuthKey: authKey });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const handled = await handler(req, res, url);
      if (!handled) res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // 1. Unauthenticated -> 401
      const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(unauth.status).toBe(401);

      // 2. Authenticated via Header -> 200
      const authed = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${authKey}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      expect(authed.status).toBe(200);

      // 3. Authenticated via query token -> 200
      const authedQuery = await fetch(`http://127.0.0.1:${port}/mcp?token=${authKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
      });
      expect(authedQuery.status).toBe(200);
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
            clientInfo: { name: 'chatgpt-vy', version: '2.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const initText = await initRes.text();
      expect(initText).toContain('TigerIQ PC Operator');
      expect(initText).toContain('2.0.0');

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
      for (const tool of PC_OPERATOR_MCP_TOOLS) {
        expect(listText).toContain(tool);
      }

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
      const preflightPayload = parseSsePayload(await callPreflight.text());
      expect(preflightPayload.ok).toBe(true);
      expect(preflightPayload.jobId).toContain('JOB-MCP-');
      expect(preflightPayload.leasePolicy).toBe('PC_OPERATOR_DIRECT_FENCE');
      expect(preflightPayload.completedStepId).toBe('paperclip_lab_preflight');
      expect(mockExecute).toHaveBeenCalledWith({ action: 'paperclip_lab_preflight' });
    } finally {
      server.close();
    }
  });

  it('executes file_write, file_read, and file_stat with safety boundaries', async () => {
    const handler = createPcOperatorMcpHandler();
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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

    const handler = createPcOperatorMcpHandler({ executePcActionImpl: mockExecute });
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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 30,
          method: 'tools/call',
          params: {
            name: 'paperclip_lab_health',
            arguments: { idempotencyKey },
          },
        }),
      });
      expect(res1.status).toBe(200);
      const p1 = parseSsePayload(await res1.text());
      expect(p1.ok).toBe(true);
      expect(callCount).toBe(1);

      // Call 2 with same idempotencyKey -> returns cached response without incrementing callCount
      const res2 = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 31,
          method: 'tools/call',
          params: {
            name: 'paperclip_lab_health',
            arguments: { idempotencyKey },
          },
        }),
      });
      expect(res2.status).toBe(200);
      const p2 = parseSsePayload(await res2.text());
      expect(p2.ok).toBe(true);
      expect(callCount).toBe(1);
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
});
