import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { executePcAction } from '../openclaw-tigeriq-runtime/operator.mjs';
import { acquireSharedResourceLease, heartbeatSharedResourceLease, releaseSharedResourceLease } from './
const LAB_SCOPE = 'TIGERIQ_PAPERCLIP_LAB_PC01_EXISTING_SANDBOX_20261018';
const NV06_RESOURCE_ID = 'res:openclaw:operator-local:default:pc01';
const leaseApiDefault = { acquire: acquireSharedResourceLease, heartbeat: heartbeatSharedResourceLease, release: releaseSharedResourceLease };
let existingLeasePool;

function existingCoreLeaseDb() {
  // Reuse the Core DB, never create credentials or a competing ownership store.
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) return null;
  if (!existingLeasePool) existingLeasePool = new Pool({ connectionString, max: 2 });
  return existingLeasePool;
}

function allowMcpMutation(headers = {}, secret = '') {
  // This same existing secret protects the gateway's non-MCP endpoints.
  const a = Buffer.from(String(headers.authorization || '').replace(/^Bearer\\s+/i, ''));
  const b = Buffer.from(String(secret || ''));
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}
function nativeOk(action, receipt) {
  if (receipt?.ok !== true || receipt?.data?.ok === false) return false;
  if (action === 'paperclip_lab_preflight') return receipt.data?.docker?.ok === true;
  if (action === 'paperclip_lab_health') return receipt.data?.result?.dockerVerified === true
    && receipt.data?.result?.containerVerified === true && receipt.data?.result?.databaseVerified === true;
  return receipt.data?.installed === true && receipt.data?.r07SourceVerified === true
    && typeof receipt.data?.dockerVersion === 'string' && receipt.data.dockerVersion.length > 0;
}
function mcpReply(value) {
  return { ...(value.ok ? {} : { isError: true }),
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerPcOperatorTools(server, executePcActionImpl = executePcAction, {
  allowMutation = false, leaseDb, leaseApi = leaseApiDefault, now = () => Date.now(),
} = {}) {
  for (const [action, description, targetStepId] of [
    ['paperclip_lab_preflight', 'Paperclip Lab read-only preflight.', 'R01'],
    ['paperclip_lab_health', 'Paperclip Lab read-only health.', 'R02'],
    ['paperclip_lab_broker_install', 'Install Paperclip broker through an exclusive NV06 Core lease.', 'R07'],
  ]) {
    server.tool(action, description, {}, async () => {
      const jobId = 'JOB-MCP-' + randomUUID();
      const common = { jobId, workOrderId: 2054, resourceScope: LAB_SCOPE,
        action, targetStepId, completedStepId: null, executionSurface: 'MCP_PC01_DIRECT' };
      if (action !== 'paperclip_lab_broker_install') {
        try {
          const receipt = await executePcActionImpl({ action });
          const ok = nativeOk(action, receipt);
          return mcpReply({ ...common, ok, receipt, reason: ok ? null : 'NATIVE_RECEIPT_NOT_ACCEPTED' });
        } catch (error) {
          return mcpReply({ ...common, ok: false, reason: 'PC_OPERATOR_READ_ERROR',
            error: String(error?.message || error) });
        }
      }

      if (!allowMutation) return mcpReply({ ...common, ok: false, reason: 'MCP_EXISTING_AUTH_REQUIRED' });
      const db = leaseDb === undefined ? existingCoreLeaseDb() : leaseDb;
      if (!db) return mcpReply({ ...common, ok: false, reason: 'MCP_CORE_SHARED_LEASE_DB_UNAVAILABLE' });

      let lease = null, timer = null, leaseLost = false, receipt = null;
      let reason = null, leaseReleased = false;
      try {
        lease = await leaseApi.acquire(db, { employeeId: 'NV06', resourceId: NV06_RESOURCE_ID,
          workId: jobId, role: 'operator', lane: 'mcp_pc_operator', ttlMs: 600000,
          metadata: { workOrderId: 2054, resourceScope: LAB_SCOPE, action, targetStepId } });
        if (!lease) reason = 'NV06_SHARED_LEASE_BUSY';
        else if (!lease.lease_token || lease.resource_id !== NV06_RESOURCE_ID || lease.work_id !== jobId
          || new Date(lease.lease_until).getTime() <= now() + 30000) {
          reason = 'NV06_SHARED_LEASE_INVALID';
        } else if (!(await leaseApi.heartbeat(db, { resourceId: lease.resource_id,
          leaseToken: lease.lease_token, ttlMs: 600000 }))) {
          reason = 'NV06_SHARED_LEASE_NOT_FENCED';
        } else {
          timer = setInterval(() => {
            void leaseApi.heartbeat(db, { resourceId: lease.resource_id,
              leaseToken: lease.lease_token, ttlMs: 600000 })
              .then(ok => { if (!ok) leaseLost = true; })
              .catch(() => { leaseLost = true; });
          }, 30000);
          timer.unref?.();
          receipt = await executePcActionImpl({ action });
          const stillOwned = await leaseApi.heartbeat(db, { resourceId: lease.resource_id,
            leaseToken: lease.lease_token, ttlMs: 600000 });
          if (leaseLost || !stillOwned) reason = 'NV06_SHARED_LEASE_LOST';
          else if (!nativeOk(action, receipt)) reason = 'NATIVE_BROKER_INSTALL_NOT_ACCEPTED';
        }
      } catch {
        // No automatic replay: the effect may have occurred before this error.
        reason = 'NV06_INSTALL_OR_LEASE_ERROR';
      } finally {
        if (timer) clearInterval(timer);
        if (lease?.lease_token) {
          try {
            leaseReleased = await leaseApi.release(db, { resourceId: lease.resource_id,
              leaseToken: lease.lease_token });
          } catch { leaseReleased = false; }
          if (!leaseReleased) reason = 'NV06_SHARED_LEASE_RELEASE_UNVERIFIED';
        }
      }
      // R07 remains unaccepted until restart/dedup and GitHub checklist readback.
      return mcpReply({ ...common, ok: !reason && leaseReleased && nativeOk(action, receipt),
        reason, leaseVerified: Boolean(lease?.lease_token), leaseReleased,
        leaseWorkId: lease?.work_id || null, receipt });
    });
  }
}

         leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
              error: String(error?.message || error),
            }, null, 2),
          }],
        };
      }
    }
  );
}

export function createPcOperatorMcpHandler({ executePcActionImpl = executePcAction,
  existingSecret = process.env.TIGERIQ_HEALTH_VIEW_KEY, leaseDb, leaseApi,
} = {}) {
  const sseTransports = new Map();

  function createServerInstance(allowMutation = false) {
    const server = new McpServer({
      name: 'TigerIQ PC Operator',
      version: '1.0.0',
    });
    registerPcOperatorTools(server, executePcActionImpl, { allowMutation, leaseDb, leaseApi });
    return server;
  }

  return async function handlePcOperatorMcpRequest(req, res, url) {
    if (!url.pathname.startsWith('/mcp')) return false;

    // Route 1: Classic SSE GET /mcp or /mcp/sse
    const accept = String(req.headers['accept'] || '');
    if (req.method === 'GET' && (url.pathname === '/mcp' || url.pathname === '/mcp/sse') && accept.includes('text/event-stream')) {
      const sseTransport = new SSEServerTransport('/mcp/messages', res);
      const sseServer = createServerInstance(allowMcpMutation(req.headers, existingSecret));
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
      const server = createServerInstance(allowMcpMutation(req.headers, existingSecret));
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
