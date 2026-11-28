import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createPcOperatorMcpHandler, PC_OPERATOR_MCP_TOOLS, pcOperatorTestRunSpec, pcOperatorWorkOrderResponse, pcOperatorWorkOrderLookup } from '../apps/tigeriq-core/pc-operator-mcp.mjs';
import { cliAnythingWriterSpec, validateCliAnythingWriterRequest } from '../apps/openclaw-tigeriq-runtime/operator.mjs';

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
  it('exposes exactly the 22 comprehensive tools', () => {
    expect(PC_OPERATOR_MCP_TOOLS.length).toBe(23);
    expect(PC_OPERATOR_MCP_TOOLS).not.toContain('paperclip_lab_preflight');
    expect(PC_OPERATOR_MCP_TOOLS).not.toContain('paperclip_lab_health');
    expect(PC_OPERATOR_MCP_TOOLS).not.toContain('paperclip_lab_broker_install');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_read');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_write');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_list');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_stat');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('file_search');
    expect(PC_OPERATOR_MCP_TOOLS).toContain('writer_create_odt');
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
      expect(json.toolsCount).toBe(23);
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
      expect(listText).not.toContain('paperclip_lab_preflight');
      expect(listText).not.toContain('paperclip_lab_health');
      expect(listText).not.toContain('paperclip_lab_broker_install');
      expect(listText).toContain('file_read');
      expect(listText).toContain('shell_exec');
      expect(listText).toContain('ui_screenshot');

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
        { name: 'writer_create_odt', arguments: { request: { id: 'no-auth', title: 'No auth', paragraphs: ['must not execute'] } } },
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

  it('runs typed Writer through the existing authenticated, scoped Core lease', async () => {
    const secret = 'w'.repeat(32);
    const executePcActionImpl = vi.fn().mockResolvedValue({
      ok: true,
      action: 'cli_anything_writer_create',
      data: {
        format: 'odt',
        path: 'D:\\TigerIQ\\State\\cli-anything-writer\\mcp-test.odt',
        bytes: 1234,
        sha256: 'a'.repeat(64),
        verification: 'zip_xml_content_readback',
        upstream_blob: '59a50348b33c878dec576f4e8d6b7591d0a420d5',
        sourceGitBlobSha: 'b6d0fa5a7265c15b0ec8fc0c15ec1b871c0abdb3',
        execution: 'PYTHON_3_12_FIXED_PATH_NO_SHELL',
        readbackBytes: 1234,
        readbackSha256: 'a'.repeat(64),
        readbackVerified: true,
      },
    });
    const leaseApi = {
      acquire: vi.fn(async (_db, spec) => ({
        resource_id: spec.resourceId, work_id: spec.workId,
        lease_token: 'writer-lease-token',
        lease_until: new Date(Date.now() + 120000).toISOString(),
      })),
      heartbeat: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
    };
    const handler = createPcOperatorMcpHandler({
      existingSecret: secret, leaseDb: { query: vi.fn() }, leaseApi, executePcActionImpl,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handler(req, res, url))) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const request = { id: 'mcp-test', title: 'TigerIQ', paragraphs: ['Nội dung thử nghiệm'] };
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'tools/call',
          params: { name: 'writer_create_odt', arguments: { request } } }),
      });
      expect(response.status).toBe(200);
      const outcome = parseSsePayload(await response.text());
      expect(outcome.ok).toBe(true);
      expect(outcome.completedStepId).toBe('writer_create_odt');
      expect(outcome.receipt.readbackVerified).toBe(true);
      expect(executePcActionImpl).toHaveBeenCalledWith({ action: 'cli_anything_writer_create', request });
      expect(leaseApi.acquire).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        employeeId: 'NV06',
        resourceId: 'res:openclaw:operator-local:default:pc01',
        metadata: expect.objectContaining({ resourceScope: 'TIGERIQ_CLI_ANYTHING_SELECTIVE_ADOPTION', action: 'writer_create_odt' }),
      }));
      expect(leaseApi.heartbeat).toHaveBeenCalled();
      expect(leaseApi.release).toHaveBeenCalled();

      executePcActionImpl.mockResolvedValueOnce({
        ok: true, action: 'cli_anything_writer_create',
        data: { readbackVerified: true, readbackSha256: 'b'.repeat(64) },
      });
      const malformed = await fetch('http://127.0.0.1:' + server.address().port + '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({ jsonrpc: '2.0', id: 103, method: 'tools/call',
          params: { name: 'writer_create_odt', arguments: { request: { id: 'bad-receipt', title: 'TigerIQ', paragraphs: ['No false pass'] } } } }),
      });
      const rejected = parseSsePayload(await malformed.text());
      expect(rejected.ok).toBe(false);
      expect(rejected.error).toBe('CLI_ANYTHING_WRITER_TYPED_RECEIPT_REQUIRED');
    } finally { server.close(); }
  });

  it('fails closed for typed Writer when the existing Core lease database is unavailable', async () => {
    const secret = 'x'.repeat(32);
    const executePcActionImpl = vi.fn();
    const handler = createPcOperatorMcpHandler({
      existingSecret: secret, leaseDb: null, executePcActionImpl,
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
        body: JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'tools/call',
          params: { name: 'writer_create_odt', arguments: { request: { id: 'no-lease', title: 'No lease', paragraphs: ['blocked'] } } } }),
      });
      const outcome = parseSsePayload(await response.text());
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe('PC_OPERATOR_WRITER_CORE_LEASE_DB_UNAVAILABLE');
      expect(executePcActionImpl).not.toHaveBeenCalled();
    } finally { server.close(); }
  });

  it('validates the typed Writer request and fixes the executable and output paths', () => {
    const request = { id: 'sample-1', title: 'TigerIQ', paragraphs: ['Tiếng Việt 😀'] };
    expect(validateCliAnythingWriterRequest(request)).toEqual(request);
    const spec = cliAnythingWriterSpec(request);
    expect(spec.exe).toBe('py.exe');
    expect(spec.args).toEqual(['-3.12', 'D:\\TigerIQ\\Runtime\\CoreSource\\apps\\openclaw-tigeriq-runtime\\cli-anything-writer.py']);
    expect(spec.outputPath).toBe('D:\\TigerIQ\\State\\cli-anything-writer\\sample-1.odt');
    expect(spec.shell).toBe(false);
    expect(spec.scriptGitBlobSha).toBe('b6d0fa5a7265c15b0ec8fc0c15ec1b871c0abdb3');
    for (const bad of [
      { ...request, id: '../escape' },
      { ...request, id: 'nul' },
      { ...request, outputPath: 'D:\\unsafe\\x.odt' },
      { ...request, paragraphs: [] },
      { ...request, paragraphs: ['x'.repeat(2001)] },
      { ...request, title: 'x'.repeat(201) },
      { ...request, paragraphs: ['\uD800'] },
      { ...request, paragraphs: ['\u0000'] },
    ]) expect(() => validateCliAnythingWriterRequest(bad)).toThrow();
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
  }, 60000); // Native Docker and WSL each allow a 20-second timeout.

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
  it('does not mislabel a missing Core route as a missing GitHub Work Order', async () => {
    await expect(pcOperatorWorkOrderResponse(new Response('not_found', {status:404}), 'GH-5135'))
      .resolves.toEqual({workOrder:'GH-5135',found:false,status:404,reason:'CORE_STATUS_ROUTE_NOT_FOUND'});
  });
  it('matches a GitHub issue only by explicit source metadata in the Core snapshot', async () => {
    const data={ok:true,objectives:[
      {id:'OBJ-GH-5135-R123',status:'active',metadata:{source:'github',issueNumber:5135,issueUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5135',resourceScope:'ANDROID_V2'}},
      {id:'OBJ-GH-51350-R999',status:'active',metadata:{source:'github',issueNumber:51350}},
      {id:'OBJ-GH-5135-OTHER',status:'blocked',metadata:{source:'manual',issueNumber:5135}},
    ]};
    await expect(pcOperatorWorkOrderResponse(new Response(JSON.stringify(data),{status:200}),'GH-5135'))
      .resolves.toEqual({workOrder:'GH-5135',found:true,status:200,source:'CORE_STATUS_BOUNDED_SNAPSHOT',
        objectives:[{id:'OBJ-GH-5135-R123',status:'active',issueNumber:5135,
          issueUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5135',resourceScope:'ANDROID_V2'}]});
  });
  it('does not confuse a bounded runtime miss with canonical GitHub issue absence', async () => {
    const data={ok:true,objectives:[{id:'OBJ-GH-51350',metadata:{source:'github',issueNumber:51350}}]};
    await expect(pcOperatorWorkOrderResponse(new Response(JSON.stringify(data),{status:200}),'GH-5135'))
      .resolves.toEqual({workOrder:'GH-5135',found:false,status:200,source:'CORE_STATUS_BOUNDED_SNAPSHOT',
        objectives:[],reason:'NOT_VISIBLE_IN_CORE_SNAPSHOT'});
  });
  it('supports Core-native Work Order IDs and unfiltered status snapshots', async () => {
    const data={ok:true,objectives:[{id:'WO-060',status:'active',metadata:{workOrderId:'WO-060'}}]};
    const response=new Response(JSON.stringify(data),{status:200});
    await expect(pcOperatorWorkOrderResponse(response,'WO-060'))
      .resolves.toEqual({workOrder:'WO-060',found:true,status:200,source:'CORE_STATUS_BOUNDED_SNAPSHOT',
        objectives:[{id:'WO-060',status:'active',issueNumber:null,issueUrl:null,resourceScope:null}]});
    await expect(pcOperatorWorkOrderResponse(new Response(JSON.stringify(data),{status:200})))
      .resolves.toEqual({workOrder:null,found:true,data});
  });
  it('resolves visible open work when the bounded objective list misses', async () => {
    const generatedAt='2026-11-26T11:55:59.985Z';
    const row={number:5615,title:'News',status:'WAIT',jobId:'GH-5615',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5615'};
    const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,objectives:[]})))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok:true,projection:{generatedAt,openWork:[row]}})));
    const r=await pcOperatorWorkOrderLookup('GH-5615',fetchImpl,()=>Date.parse(generatedAt));
    expect(r).toMatchObject({found:true,source:'CORE_OPEN_WORK_PROJECTION',data:row,leaseVerified:false,acceptanceVerified:false});
    expect(fetchImpl.mock.calls.map(c=>c[0])).toEqual(['http://127.0.0.1:8795/api/status','http://127.0.0.1:8795/api/health-live-work']);
  });
  it('uses a separate bounded 20s deadline for the slow projection without retrying', async () => {
    const timeout=vi.spyOn(AbortSignal,'timeout');
    try {
      const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,objectives:[]})))
        .mockRejectedValueOnce(new DOMException('deadline','TimeoutError'));
      expect(await pcOperatorWorkOrderLookup('GH-5615',f)).toMatchObject({found:false,status:503,reason:'CORE_WORK_PROJECTION_TIMEOUT'});
      expect(timeout.mock.calls.map(c=>c[0])).toEqual([5000,20000]);
      expect(f).toHaveBeenCalledTimes(2);
      expect(f.mock.calls[1][1].redirect).toBe('error');
    } finally { timeout.mockRestore(); }
  });
  it('distinguishes projection body deadline from malformed JSON', async () => {
    const status=()=>new Response(JSON.stringify({ok:true,objectives:[]}));
    const f=vi.fn().mockResolvedValueOnce(status())
      .mockResolvedValueOnce({ok:true,json:async()=>{throw new DOMException('deadline','TimeoutError');}});
    expect(await pcOperatorWorkOrderLookup('GH-5615',f)).toMatchObject({found:false,status:503,reason:'CORE_WORK_PROJECTION_TIMEOUT'});
    const malformed=vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(new Response('not json'));
    expect(await pcOperatorWorkOrderLookup('GH-5615',malformed)).toMatchObject({found:false,status:502,reason:'CORE_WORK_PROJECTION_INVALID_JSON'});
  });
  it('does not bypass a denied status route', async () => {
    const f=vi.fn().mockResolvedValue(new Response('denied',{status:403}));
    expect(await pcOperatorWorkOrderLookup('GH-5615',f)).toMatchObject({found:false,status:403});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['stale',503,'CORE_WORK_PROJECTION_STALE'],
    ['duplicate',409,'CORE_WORK_PROJECTION_AMBIGUOUS'],
    ['foreign',502,'CORE_WORK_PROJECTION_SOURCE_INVALID'],
    ['missing',404,'WORK_ORDER_NOT_VISIBLE_IN_OPEN_PROJECTION']
  ])('fails closed for %s projection',async (kind,status,reason)=>{
    const generatedAt='2026-11-26T11:55:59.985Z';
    const row={number:5615,title:'News',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5615'};
    const openWork=kind==='duplicate'?[row,row]:kind==='foreign'?[{...row,url:'https://example.com/issues/5615'}]:kind==='missing'?[]:[row];
    const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,objectives:[]})))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok:true,projection:{generatedAt,stale:kind==='stale',openWork}})));
    expect(await pcOperatorWorkOrderLookup('5615',f,()=>Date.parse(generatedAt))).toMatchObject({found:false,status,reason});
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


describe('GH-5291 PAD UI broker targeted selector fast path', () => {
  it('resolves PID directly before broad desktop enumeration', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('function Get-PadWindowByProcessId($Request)');
    expect(source).toContain('Get-Process -Id $pidValue -ErrorAction Stop');
    expect(source).toContain('[System.Windows.Automation.AutomationElement]::FromHandle($handle)');

    const topStart = source.indexOf('function Get-TopWindowElement($Request)');
    const topEnd = source.indexOf('function Element-ToObject($e)');
    const topWindow = source.slice(topStart, topEnd);
    expect(topWindow.indexOf('Get-PadWindowByProcessId $Request')).toBeGreaterThanOrEqual(0);
    expect(topWindow.indexOf('Get-PadWindowByProcessId $Request')).toBeLessThan(topWindow.indexOf('RootElement'));
  });

  it('uses exact UIAutomation property conditions before descendant filtering', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('function Get-PadSearchCondition($Request, [string]$Mode)');
    expect(source).toContain('AutomationIdProperty');
    expect(source).toContain('NameProperty');
    expect(source).toContain('$searchCondition = Get-PadSearchCondition $Request $mode');
    expect(source).toContain('$window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $searchCondition)');
  });

  it('combines exact name and control type in the provider-side selector', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('function Get-PadControlTypeValue([string]$ControlTypeName)');
    expect(source).toContain('ControlTypeProperty');
    expect(source).toContain('[System.Windows.Automation.AndCondition]::new');
    expect(source).toContain('[System.Windows.Automation.Condition[]]$conditions');
  });
});

describe('GH-5291 PAD UI broker no-broad-scan recovery', () => {
  it('uses GW_ENABLEDPOPUP for owned modal resolution instead of desktop-wide FindAll', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    const start = source.indexOf('function Get-PadOwnedModalWindow($OwnerWindow)');
    const end = source.indexOf('function Get-TopWindowElement($Request)');
    const modal = source.slice(start, end);
    expect(modal).toContain('GetWindow($ownerHandle, 6)');
    expect(modal).not.toContain('RootElement');
    expect(modal).not.toContain('FindAll');
  });

  it('uses FindFirst for explicit exact index zero selectors', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain("if ($index -eq 0 -and $null -ne $Request.index");
    expect(source).toContain('$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $searchCondition)');
    expect(source).toContain('function Test-PadElementMatch($Element, $Request, [string]$Mode)');
  });
});


describe('GH-5291 PAD Console selection contract', () => {
  it('prefers SelectionItemPattern for clickable rows without InvokePattern', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    const start = source.indexOf('function Invoke-PadElement($Request, [bool]$AllowClickFallback)');
    const end = source.indexOf('function Set-PadValue($Request)');
    const invoke = source.slice(start, end);
    expect(invoke).toContain('SelectionItemPattern]::Pattern');
    expect(invoke).toContain('$selection.Select()');
    expect(invoke.indexOf('$selection.Select()')).toBeLessThan(invoke.indexOf('SetCursorPos'));
  });
});


describe('GH-5291 selector-bound double click', () => {
  it('emits two bounded clicks only for the explicit pad_click double-click path', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain("$forceDoubleClick = $AllowClickFallback -and ([string]$Request.value -eq 'double')");
    expect(source).toContain("$clickCount = if ($forceDoubleClick) { 2 } else { 1 }");
    expect(source).toContain("ElementCenterDoubleClick");
    expect(source).toContain('Start-Sleep -Milliseconds 80');
  });
});


describe('GH-5291 PAD action-row double click precedence', () => {
  it('forces selector-bound double click before InvokePattern when requested', async () => {
    const source = await fs.readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    const start = source.indexOf('function Invoke-PadElement($Request, [bool]$AllowClickFallback)');
    const end = source.indexOf('function Set-PadValue($Request)');
    const invoke = source.slice(start, end);
    expect(invoke).toContain("$forceDoubleClick = $AllowClickFallback -and ([string]$Request.value -eq 'double')");
    expect(invoke.indexOf('$forceDoubleClick')).toBeLessThan(invoke.indexOf('InvokePattern]::Pattern'));
    expect(invoke).toContain("$clickCount = if ($forceDoubleClick) { 2 } else { 1 }");
  });
});
