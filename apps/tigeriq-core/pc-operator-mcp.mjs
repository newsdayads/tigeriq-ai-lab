import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { executePcAction } from '../openclaw-tigeriq-runtime/operator.mjs';

export const PC_OPERATOR_MCP_TOOLS = Object.freeze([
  'paperclip_lab_preflight',
  'paperclip_lab_health',
  'paperclip_lab_broker_install',
]);

export function registerPcOperatorTools(server, executePcActionImpl = executePcAction) {
  server.tool(
    'paperclip_lab_preflight',
    'Kiểm tra điều kiện môi trường Paperclip Lab trên PC01 (Docker, container, port 3210 loopback, broker).',
    {},
    async () => {
      const jobId = `JOB-MCP-${randomUUID()}`;
      try {
        const receipt = await executePcActionImpl({ action: 'paperclip_lab_preflight' });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              jobId,
              leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              completedStepId: 'paperclip_lab_preflight',
              receipt,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              jobId,
              leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              error: String(error?.message || error),
            }, null, 2),
          }],
        };
      }
    }
  );

  server.tool(
    'paperclip_lab_health',
    'Kiểm tra sức khỏe dịch vụ Paperclip Lab trên PC01 (HTTP 200, PostgreSQL database sidecar, container).',
    {},
    async () => {
      const jobId = `JOB-MCP-${randomUUID()}`;
      try {
        const receipt = await executePcActionImpl({ action: 'paperclip_lab_health' });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              jobId,
              leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              completedStepId: 'paperclip_lab_health',
              receipt,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              jobId,
              leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              error: String(error?.message || error),
            }, null, 2),
          }],
        };
      }
    }
  );

  server.tool(
    'paperclip_lab_broker_install',
    'Cài đặt và cấu hình lại Paperclip WSL Interactive Broker trên PC01.',
    {},
    async () => {
      const jobId = `JOB-MCP-${randomUUID()}`;
      try {
        const receipt = await executePcActionImpl({ action: 'paperclip_lab_broker_install' });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              jobId,
              leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              completedStepId: 'paperclip_lab_broker_install',
              receipt,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              jobId,
              leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              error: String(error?.message || error),
            }, null, 2),
          }],
        };
      }
    }
  );
}

export function createPcOperatorMcpHandler({ executePcActionImpl = executePcAction } = {}) {
  const sseTransports = new Map();

  function createServerInstance() {
    const server = new McpServer({
      name: 'TigerIQ PC Operator',
      version: '1.0.0',
    });
    registerPcOperatorTools(server, executePcActionImpl);
    return server;
  }

  return async function handlePcOperatorMcpRequest(req, res, url) {
    if (!url.pathname.startsWith('/mcp')) return false;

    // Route 1: Classic SSE GET /mcp or /mcp/sse
    const accept = String(req.headers['accept'] || '');
    if (req.method === 'GET' && (url.pathname === '/mcp' || url.pathname === '/mcp/sse') && accept.includes('text/event-stream')) {
      const sseTransport = new SSEServerTransport('/mcp/messages', res);
      const sseServer = createServerInstance();
      await sseServer.connect(sseTransport);
      sseTransports.set(sseTransport.sessionId, sseTransport);
      res.on('close', () => {
        sseTransports.delete(sseTransport.sessionId);
      });
      return true;
    }

    // Route 2: Classic SSE POST /mcp/messages
    if (req.method === 'POST' && url.pathname === '/mcp/messages') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sseTransports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('SESSION_NOT_FOUND');
        return true;
      }
      await transport.handlePostMessage(req, res);
      return true;
    }

    // Route 3: Streamable HTTP (POST /mcp or GET /mcp)
    if (url.pathname === '/mcp') {
      if (!accept.includes('text/event-stream')) {
        req.headers['accept'] = (accept ? accept + ', ' : '') + 'text/event-stream, application/json';
      }
      const server = createServerInstance();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return true;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('NOT_FOUND');
    return true;
  };
}
