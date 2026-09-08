import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(join(here, 'public', 'copybox-widget.html'), 'utf8');
const MCP_PATH = '/mcp';
const MAX_TEXT = 100_000;

function createCopyBoxServer() {
  const server = new McpServer({
    name: 'tigeriq-copybox',
    version: '0.1.0',
    instructions: 'Dùng công cụ show_copybox khi cần hiển thị nội dung dài để người dùng sao chép trong một khung nhỏ có cuộn. Không tự cắt hoặc rút gọn nội dung đầu vào.',
  });

  registerAppResource(
    server,
    'copybox-widget',
    'ui://tigeriq/copybox/v1.html',
    {},
    async () => ({
      contents: [{
        uri: 'ui://tigeriq/copybox/v1.html',
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: { connectDomains: [], resourceDomains: [] },
          },
        },
      }],
    }),
  );

  registerAppTool(
    server,
    'show_copybox',
    {
      title: 'Hiển thị TigerIQ CopyBox',
      description: 'Hiển thị nguyên văn nội dung cần sao chép trong một khung nhỏ cố định, cuộn bên trong và có nút Sao chép. Dùng cho câu lệnh giao việc, mã lệnh hoặc văn bản dài khi người dùng cần copy.',
      inputSchema: {
        text: z.string().min(1).max(MAX_TEXT),
      },
      outputSchema: {
        text: z.string().min(1).max(MAX_TEXT),
      },
      _meta: {
        ui: { resourceUri: 'ui://tigeriq/copybox/v1.html' },
      },
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: 'Đã mở TigerIQ CopyBox.' }],
      structuredContent: { text },
    }),
  );

  return server;
}

const port = Number(process.env.PORT ?? 8797);
const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    });
    res.end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'tigeriq-copybox', mcp: MCP_PATH }));
    return;
  }
  if (url.pathname === MCP_PATH && req.method && new Set(['POST', 'GET', 'DELETE']).has(req.method)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    const server = createCopyBoxServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('CopyBox MCP error', error);
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
    }
    return;
  }
  res.writeHead(404).end('Not Found');
});

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`TigerIQ CopyBox MCP listening on http://127.0.0.1:${port}${MCP_PATH}`);
});
