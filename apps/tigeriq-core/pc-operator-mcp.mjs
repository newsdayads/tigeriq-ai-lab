import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import pg from 'pg';
import { z } from 'zod';
import { authorizeVerifiedTool } from './pc-operator-oauth-policy.mjs';
import { executePcAction } from '../openclaw-tigeriq-runtime/operator.mjs';
import {
  acquireSharedResourceLease,
  heartbeatSharedResourceLease,
  releaseSharedResourceLease,
} from './shared-resource-lease.mjs';

const { Pool } = pg;
const win = path.win32;

export const PC_OPERATOR_ROOTS = Object.freeze([
  'D:\\TigerIQ',
  'D:\\OpenClaw',
  'D:\\TigerIQ-OpenClaw',
  'D:\\TigerIQ-Paperclip-Lab',
]);

const DEFAULT_ROOT = PC_OPERATOR_ROOTS[0];
const MAX_READ_BYTES = 1024 * 1024; // 1MB
const MAX_WRITE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_TIMEOUT_SEC = 300;

const DENIED_PATH_FRAGMENTS = [
  '\\secrets\\',
  '\\.ssh\\',
  '\\windows\\system32\\config\\',
  '\\appdata\\local\\google\\chrome\\user data\\',
  '\\appdata\\local\\microsoft\\edge\\user data\\',
];

const LOCAL_ONLY_BOUNDARY = 'D:\\TigerIQ\\Apps\\ChromeController\\LocalOnly';

export const PC_OPERATOR_MCP_TOOLS = Object.freeze([
  // Paperclip Lab Tools (Protected & Gated)
  'paperclip_lab_preflight',
  'paperclip_lab_health',
  'paperclip_lab_broker_install',
  // Files & Directories
  'file_read',
  'file_write',
  'file_list',
  'file_stat',
  'file_search',
  // Terminal & Shell
  'shell_exec',
  // Processes, Tasks & Services
  'process_list',
  'task_list',
  'task_action',
  'service_status',
  'docker_status',
  'wsl_status',
  // Desktop & UI
  'ui_window_list',
  'ui_screenshot',
  'ui_action',
  // Subsystems & Diagnostics
  'core_status',
  'ollama_status',
  'log_read',
  'test_run',
  'evidence_record',
  // Coordination & Workforce
  'rdc_pool_status',
  'work_order_status',
]);

const LAB_SCOPE = 'TIGERIQ_PAPERCLIP_LAB_PC01_EXISTING_SANDBOX_20261018';
const NV06_RESOURCE_ID = 'res:openclaw:operator-local:default:pc01';
const GENERAL_OPERATOR_SCOPE = 'TIGERIQ_PC_OPERATOR_MCP_AUTHENTICATED_MUTATION';
const MUTATING_GENERAL_TOOLS = new Set([
  'file_write', 'shell_exec', 'task_action', 'ui_screenshot',
  'ui_action', 'test_run', 'evidence_record',
]);
const leaseApiDefault = {
  acquire: acquireSharedResourceLease,
  heartbeat: heartbeatSharedResourceLease,
  release: releaseSharedResourceLease,
};
let existingLeasePool;

function existingCoreLeaseDb() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) return null;
  if (!existingLeasePool) existingLeasePool = new Pool({ connectionString, max: 2 });
  return existingLeasePool;
}

function allowMcpMutation(headers = {}, secret = '') {
  const a = Buffer.from(String(headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const b = Buffer.from(String(secret || ''));
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

function nativeOk(action, receipt) {
  if (receipt?.ok !== true || receipt?.data?.ok === false) return false;
  if (action === 'paperclip_lab_preflight') {
    // R01 is not a Docker availability check: require real live loopback,
    // inspected pinned image, existing root, and successful read-only probes.
    const data = receipt.data;
    return data?.rootPresent === true
      && data?.docker?.ok === true
      && data?.container?.attempted === true
      && data?.container?.present === true
      && data?.container?.running === true
      // R01 accepts a digest-only container reference; immutable digest
      // identity is verified by R02 health against release.json.
      && (data?.container?.imagePinMatch === true
        || /^ghcr\.io\/paperclipai\/paperclip@sha256:[a-f0-9]{64}$/.test(String(data?.container?.imageRef || '')))
      && data?.container?.port3210LoopbackBinding === true
      && data?.port3210?.reachable === true
      && data?.pinned?.release === 'v2026.916.1'
      && data?.pinned?.image === 'ghcr.io/paperclipai/paperclip:2026.916.1';
  }
  if (action === 'paperclip_lab_health') {
    // Runtime health alone cannot complete R02 without broker/heartbeat review.
    // The actual native health shape has ok/container/database/http fields;
    // partial DOCKER_UNAVAILABLE diagnostics cannot satisfy this predicate.
    const data = receipt.data;
    return data?.ok === true
      && data?.container?.identityOk === true
      && data?.container?.portBindingOk === true
      && data?.database?.present === true
      && data?.database?.running === true
      && String(data?.database?.healthStatus || '').toLowerCase() === 'healthy'
      && data?.http?.appOk === true
      && data?.port?.reachable === true
      // R02 checklist includes an independently observed, fresh broker
      // heartbeat; a green HTTP/DB response alone cannot close this step.
      && data?.broker?.ready === true
      && data?.broker?.version === '1.7-openai-device-auth'
      && Number.isInteger(data?.broker?.sessionId)
      && data.broker.sessionId > 0
      && data?.broker?.wslKeepaliveRunning === true
      && data?.broker?.sourceVerified === true
      && Number.isFinite(data?.broker?.ageMs)
      && data.broker.ageMs >= 0
      && data.broker.ageMs <= 15000;
  }
  return receipt.data?.installed === true && receipt.data?.r07SourceVerified === true
    && typeof receipt.data?.dockerVersion === 'string' && receipt.data.dockerVersion.length > 0;
}

function mcpReply(value) {
  return {
    ...(value.ok ? {} : { isError: true }),
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

// Anti-duplicate / Idempotency Cache (5 minutes TTL)
const deduplicationCache = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000;

function cleanExpiredDedup() {
  const now = Date.now();
  for (const [k, v] of deduplicationCache.entries()) {
    if (now - v.timestamp > DEDUP_TTL_MS) deduplicationCache.delete(k);
  }
}

function normalizePath(value) {
  return win.resolve(String(value || DEFAULT_ROOT).replaceAll('/', '\\'));
}

function assertPathSafety(candidatePath, { forWrite = false } = {}) {
  const normalized = normalizePath(candidatePath);
  const lower = normalized.toLowerCase();

  const isInsideRoots = PC_OPERATOR_ROOTS.some((root) => {
    const base = normalizePath(root).toLowerCase();
    return lower === base || lower.startsWith(base + '\\');
  });

  if (!isInsideRoots) {
    throw new Error(`TIGERIQ_PC_PATH_NOT_ALLOWED:${normalized}`);
  }

  for (const fragment of DENIED_PATH_FRAGMENTS) {
    if (lower.includes(fragment.toLowerCase())) {
      throw new Error(`TIGERIQ_PC_SENSITIVE_PATH_BLOCKED:${normalized}`);
    }
  }

  if (forWrite && lower.startsWith(LOCAL_ONLY_BOUNDARY.toLowerCase())) {
    throw new Error(`TIGERIQ_PC_LOCAL_ONLY_BOUNDARY_PROTECTED:${normalized}`);
  }

  return normalized;
}

function boundedText(value, maxChars = MAX_OUTPUT_CHARS) {
  const text = String(value || '');
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '\n[TRUNCATED]';
}

async function spawnProcess(exe, args, { cwd = DEFAULT_ROOT, timeoutSec = 60, env = {} } = {}) {
  const safeCwd = assertPathSafety(cwd);
  const effectiveCwd = (process.platform === 'win32' || existsSync(safeCwd)) ? safeCwd : process.cwd();
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Number(timeoutSec) || 60));
  const childEnv = { ...process.env, ...env };

  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: effectiveCwd,
      windowsHide: true,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_CHARS * 2) stdout = stdout.slice(-MAX_OUTPUT_CHARS);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT_CHARS * 2) stderr = stderr.slice(-MAX_OUTPUT_CHARS);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout * 1000);

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        timedOut,
        stdout: boundedText(stdout),
        stderr: boundedText(stderr),
        cwd: safeCwd,
      });
    });
  });
}

function wrapTool(server, name, description, schemaObj, handler) {
  const schema = {
    ...(schemaObj || {}),
    idempotencyKey: z.string().optional().describe('Khóa chống thực thi trùng lặp'),
    jobId: z.string().optional().describe('Mã định danh công việc (jobId) tùy chọn'),
  };

  server.tool(name, description, schema, async (args = {}) => {
    cleanExpiredDedup();
    const jobId = String(args.jobId || `JOB-MCP-${randomUUID()}`);
    const dedupKey = args.idempotencyKey ? `${name}:${args.idempotencyKey}` : null;

    if (dedupKey && deduplicationCache.has(dedupKey)) {
      const cached = deduplicationCache.get(dedupKey);
      return cached.result;
    }

    try {
      const started = Date.now();
      const receipt = await handler(args, jobId);
      const result = {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            jobId,
            leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
            completedStepId: name,
            elapsedMs: Date.now() - started,
            receipt,
          }, null, 2),
        }],
      };
      if (dedupKey) deduplicationCache.set(dedupKey, { timestamp: Date.now(), result });
      return result;
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            jobId,
            leasePolicy: 'PC_OPERATOR_DIRECT_FENCE',
            completedStepId: name,
            error: String(error?.message || error),
          }, null, 2),
        }],
      };
    }
  });
}

// #5417: Execute the installed source's Vitest CLI with node.exe directly.
// Windows child_process.spawn of an .cmd wrapper may fail with spawn EINVAL;
// never shell out, download packages via npx, or run outside tests/**.
export function pcOperatorTestRunSpec(testPath, {
  runtimeRoot = 'D:\\TigerIQ\\Runtime\\CoreSource',
  nodeExecutable = process.execPath,
  testSource = '',
} = {}) {
  const normalized = String(testPath || '').replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (!normalized.startsWith('tests/') || segments.some(p => !p || p === '.' || p === '..')
    || !segments.slice(1, -1).every(p => /^[A-Za-z0-9_.-]+$/.test(p))
    || !/^[A-Za-z0-9_.-]+$/.test(segments.at(-1))
    || !['.test.mjs', '.test.js', '.test.ts', '.test.tsx'].some(ext => segments.at(-1).endsWith(ext)))
    throw new Error('MCP_TEST_PATH_NOT_ALLOWED');

  const source = String(testSource || '');
  // Match actual import statements, not quoted examples in Vitest fixtures.
  // A node:test string anywhere in a Vitest suite must not change the runner.
  const usesNodeTest = /^\s*import\s+(?:[^\r\n;]*?\bfrom\s+)?['"]node:test['"]\s*;?/m.test(source)
    || /^\s*(?:const|let|var)\s+[^\r\n=]+\s*=\s*require\s*\(\s*['"]node:test['"]\s*\)/m.test(source);
  const vitestPath = win.join(runtimeRoot, 'node_modules', 'vitest', 'vitest.mjs');
  return {
    exe: nodeExecutable,
    args: usesNodeTest ? ['--test', normalized] : [vitestPath, 'run', normalized],
    cwd: runtimeRoot,
    testPath: normalized,
    runner: usesNodeTest ? 'node:test' : 'vitest',
    runnerPath: usesNodeTest ? nodeExecutable : vitestPath,
  };
}

export async function pcOperatorWorkOrderResponse(res, workOrder) {
  // Core may answer 404 "not_found" as plain text; never JSON.parse it.
  if (res.status === 404) return { workOrder: workOrder || null, found: false, status: 404, reason: 'WORK_ORDER_NOT_FOUND' };
  if (!res.ok) return { workOrder: workOrder || null, found: false, status: res.status, reason: 'CORE_WORK_ORDER_HTTP_ERROR' };
  try {
    const data = await res.json();
    return { workOrder: workOrder || null, found: true, data };
  } catch {
    return { workOrder: workOrder || null, found: false, status: res.status, reason: 'CORE_WORK_ORDER_INVALID_JSON' };
  }
}

export function registerPcOperatorTools(server, executePcActionImpl = executePcAction, {
  allowMutation = false, leaseDb, leaseApi = leaseApiDefault, now = () => Date.now(),
  verifiedPrincipal = null, issuerUrl, resourceUrl,
} = {}) {
  // The gateway's bearer is a server-side authorization gate, not a ChatGPT
  // "allow all actions" preference. Never expose host files/shell/UI to a
  // caller that can only reach the legacy unauthenticated Paperclip read tools.
  const authorizedTools = {
    tool(name, description, schema, handler) {
      server.tool(name, description, schema, async (args = {}) => {
        if (verifiedPrincipal) {
          const decision = authorizeVerifiedTool({ verifiedPrincipal, toolName: name, issuerUrl, resourceUrl });
          if (!decision.ok) return mcpReply({
            ok: false, action: name, reason: decision.reason, missing: decision.missing || [],
          });
        }
        const isMutating = MUTATING_GENERAL_TOOLS.has(name);
        if (isMutating && !allowMutation) return mcpReply({
          ok: false, action: name, reason: 'MCP_EXISTING_AUTH_REQUIRED',
        });
        if (!isMutating) return handler(args);
        // All mutations share the existing NV06 PC01 operator resource.
        // A new bearer request is not an exclusive Core lease.
        const db = leaseDb === undefined ? existingCoreLeaseDb() : leaseDb;
        if (!db) {
          return handler(args);
        }
        const workId = 'JOB-MCP-' + randomUUID();
        let lease = null, timer = null, leaseLost = false, released = false;
        let reply = null, reason = null;
        try {
          lease = await leaseApi.acquire(db, {
            employeeId: 'NV06', resourceId: NV06_RESOURCE_ID,
            workId, role: 'operator', lane: 'mcp_pc_operator', ttlMs: 600000,
            metadata: { resourceScope: GENERAL_OPERATOR_SCOPE, action: name },
          });
          if (!lease) reason = 'PC_OPERATOR_SHARED_LEASE_BUSY';
          else if (!lease.lease_token || lease.resource_id !== NV06_RESOURCE_ID
              || lease.work_id !== workId || new Date(lease.lease_until).getTime() <= now() + 30000) {
            reason = 'PC_OPERATOR_SHARED_LEASE_INVALID';
          } else if (!(await leaseApi.heartbeat(db, {
            resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
          }))) {
            reason = 'PC_OPERATOR_SHARED_LEASE_NOT_FENCED';
          } else {
            timer = setInterval(() => {
              void leaseApi.heartbeat(db, {
                resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
              }).then(ok => { if (!ok) leaseLost = true; })
                .catch(() => { leaseLost = true; });
            }, 30000);
            timer.unref?.();
            reply = await handler(args);
            const stillOwned = await leaseApi.heartbeat(db, {
              resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000,
            });
            if (leaseLost || !stillOwned) reason = 'PC_OPERATOR_SHARED_LEASE_LOST';
          }
        } catch {
          reason = 'PC_OPERATOR_MUTATION_OR_LEASE_ERROR';
        } finally {
          if (timer) clearInterval(timer);
          if (lease?.lease_token) {
            try {
              released = await leaseApi.release(db, {
                resourceId: lease.resource_id, leaseToken: lease.lease_token,
              });
            } catch { released = false; }
            if (!released) reason = 'PC_OPERATOR_SHARED_LEASE_RELEASE_UNVERIFIED';
          }
        }
        if (reason || !released || !reply) return mcpReply({
          ok: false, action: name, reason: reason || 'PC_OPERATOR_MUTATION_NOT_ACCEPTED',
        });
        return reply;
      });
    },
  };
  // 1. Paperclip Lab Tools (Exact backward-compatible & gated lease logic)
  for (const [action, description, targetStepId] of [
    ['paperclip_lab_preflight', 'Paperclip Lab read-only preflight.', 'R01'],
    ['paperclip_lab_health', 'Paperclip Lab read-only health.', 'R02'],
    ['paperclip_lab_broker_install', 'Install Paperclip broker through an exclusive NV06 Core lease.', 'R07'],
  ]) {
    server.tool(action, description, {}, async () => {
      if (verifiedPrincipal) {
        const decision = authorizeVerifiedTool({ verifiedPrincipal, toolName: action, issuerUrl, resourceUrl });
        if (!decision.ok) return mcpReply({
          ok: false, action, reason: decision.reason, missing: decision.missing || [],
        });
      }
      const jobId = 'JOB-MCP-' + randomUUID();
      const common = {
        jobId,
        workOrderId: 2054,
        resourceScope: LAB_SCOPE,
        action,
        targetStepId,
        completedStepId: null,
        executionSurface: 'MCP_PC01_DIRECT',
      };

      if (action !== 'paperclip_lab_broker_install') {
        try {
          const receipt = await executePcActionImpl({ action });
          const ok = nativeOk(action, receipt);
          return mcpReply({ ...common, ok, completedStepId: ok ? targetStepId : null, receipt, reason: ok ? null : 'NATIVE_RECEIPT_NOT_ACCEPTED' });
        } catch (error) {
          return mcpReply({ ...common, ok: false, reason: 'PC_OPERATOR_READ_ERROR', error: String(error?.message || error) });
        }
      }

      if (!allowMutation) return mcpReply({ ...common, ok: false, reason: 'MCP_EXISTING_AUTH_REQUIRED' });
      const db = leaseDb === undefined ? existingCoreLeaseDb() : leaseDb;
      if (!db) return mcpReply({ ...common, ok: false, reason: 'MCP_CORE_SHARED_LEASE_DB_UNAVAILABLE' });

      let lease = null, timer = null, leaseLost = false, receipt = null;
      let reason = null, leaseReleased = false;
      try {
        lease = await leaseApi.acquire(db, {
          employeeId: 'NV06',
          resourceId: NV06_RESOURCE_ID,
          workId: jobId,
          role: 'operator',
          lane: 'mcp_pc_operator',
          ttlMs: 600000,
          metadata: { workOrderId: 2054, resourceScope: LAB_SCOPE, action, targetStepId },
        });
        if (!lease) reason = 'NV06_SHARED_LEASE_BUSY';
        else if (!lease.lease_token || lease.resource_id !== NV06_RESOURCE_ID || lease.work_id !== jobId
          || new Date(lease.lease_until).getTime() <= now() + 30000) {
          reason = 'NV06_SHARED_LEASE_INVALID';
        } else if (!(await leaseApi.heartbeat(db, { resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000 }))) {
          reason = 'NV06_SHARED_LEASE_NOT_FENCED';
        } else {
          timer = setInterval(() => {
            void leaseApi.heartbeat(db, { resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000 })
              .then((ok) => { if (!ok) leaseLost = true; })
              .catch(() => { leaseLost = true; });
          }, 30000);
          timer.unref?.();
          receipt = await executePcActionImpl({ action });
          const stillOwned = await leaseApi.heartbeat(db, { resourceId: lease.resource_id, leaseToken: lease.lease_token, ttlMs: 600000 });
          if (leaseLost || !stillOwned) reason = 'NV06_SHARED_LEASE_LOST';
          else if (!nativeOk(action, receipt)) reason = 'NATIVE_BROKER_INSTALL_NOT_ACCEPTED';
        }
      } catch {
        reason = 'NV06_INSTALL_OR_LEASE_ERROR';
      } finally {
        if (timer) clearInterval(timer);
        if (lease?.lease_token) {
          try {
            leaseReleased = await leaseApi.release(db, { resourceId: lease.resource_id, leaseToken: lease.lease_token });
          } catch {
            leaseReleased = false;
          }
          if (!leaseReleased) reason = 'NV06_SHARED_LEASE_RELEASE_UNVERIFIED';
        }
      }
      const accepted = !reason && leaseReleased && nativeOk(action, receipt);
      return mcpReply({
        ...common,
        ok: accepted,
        // R07 installation alone does not prove restart persistence and deduplication.
        completedStepId: null,
        reason,
        leaseVerified: Boolean(lease?.lease_token),
        leaseReleased,
        leaseWorkId: lease?.work_id || null,
        receipt,
      });
    });
  }

  // 2. file_read
  wrapTool(
    authorizedTools,
    'file_read',
    'Đọc nội dung tệp văn bản từ PC01 (giới hạn an toàn trong các thư mục được phép).',
    {
      path: z.string().describe('Đường dẫn tệp trên PC01'),
      offset: z.number().optional().describe('Byte offset bắt đầu đọc'),
      limit: z.number().optional().describe('Số byte tối đa cần đọc (mặc định 256KB, tối đa 1MB)'),
    },
    async ({ path: targetPath, offset = 0, limit = 256 * 1024 }) => {
      const safePath = assertPathSafety(targetPath);
      const stat = await fs.stat(safePath);
      if (!stat.isFile()) throw new Error('TIGERIQ_PC_NOT_A_FILE');
      const maxLimit = Math.min(MAX_READ_BYTES, Math.max(1, Number(limit) || 256 * 1024));
      const fileHandle = await fs.open(safePath, 'r');
      try {
        const buffer = Buffer.alloc(maxLimit);
        const { bytesRead } = await fileHandle.read(buffer, 0, maxLimit, offset);
        const content = buffer.subarray(0, bytesRead).toString('utf8');
        return {
          path: safePath,
          size: stat.size,
          offset,
          bytesRead,
          content,
          truncated: stat.size > (offset + bytesRead),
        };
      } finally {
        await fileHandle.close();
      }
    }
  );

  // 3. file_write
  wrapTool(
    authorizedTools,
    'file_write',
    'Ghi nội dung văn bản vào tệp trên PC01 (tự tạo thư mục cha nếu chưa có; bảo vệ biên giới Local-Only).',
    {
      path: z.string().describe('Đường dẫn tệp cần ghi trên PC01'),
      content: z.string().describe('Nội dung văn bản cần ghi'),
      append: z.boolean().optional().describe('Nối vào cuối tệp thay vì ghi đè (mặc định false)'),
    },
    async ({ path: targetPath, content, append = false }) => {
      const safePath = assertPathSafety(targetPath, { forWrite: true });
      const text = String(content ?? '');
      if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) {
        throw new Error('TIGERIQ_PC_WRITE_TOO_LARGE');
      }
      await fs.mkdir(win.dirname(safePath), { recursive: true });
      if (append) {
        await fs.appendFile(safePath, text, 'utf8');
      } else {
        await fs.writeFile(safePath, text, 'utf8');
      }
      const stat = await fs.stat(safePath);
      return {
        path: safePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        mode: append ? 'append' : 'overwrite',
      };
    }
  );

  // 4. file_list
  wrapTool(
    authorizedTools,
    'file_list',
    'Liệt kê danh sách tệp và thư mục trong đường dẫn trên PC01.',
    {
      path: z.string().optional().describe('Đường dẫn thư mục (mặc định D:\\TigerIQ)'),
      maxEntries: z.number().optional().describe('Số lượng mục tối đa trả về (mặc định 200)'),
    },
    async ({ path: dirPath = DEFAULT_ROOT, maxEntries = 200 }) => {
      const safePath = assertPathSafety(dirPath);
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const limit = Math.min(500, Math.max(1, Number(maxEntries) || 200));
      return {
        path: safePath,
        totalEntries: entries.length,
        entries: entries.slice(0, limit).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        })),
        truncated: entries.length > limit,
      };
    }
  );

  // 5. file_stat
  wrapTool(
    authorizedTools,
    'file_stat',
    'Xem thông tin chi tiết (kích thước, loại, thời gian sửa) của tệp hoặc thư mục.',
    {
      path: z.string().describe('Đường dẫn tệp hoặc thư mục cần kiểm tra'),
    },
    async ({ path: targetPath }) => {
      const safePath = assertPathSafety(targetPath);
      const stat = await fs.stat(safePath);
      return {
        path: safePath,
        type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        createdAt: stat.birthtime.toISOString(),
      };
    }
  );

  // 6. file_search
  wrapTool(
    authorizedTools,
    'file_search',
    'Tìm kiếm tệp theo tên hoặc phần mở rộng trong thư mục PC01.',
    {
      path: z.string().optional().describe('Thư mục gốc tìm kiếm (mặc định D:\\TigerIQ)'),
      pattern: z.string().describe('Mẫu tên tệp cần tìm (ví dụ: *.log, *mcp*, package.json)'),
      maxResults: z.number().optional().describe('Số kết quả tối đa (mặc định 50)'),
    },
    async ({ path: dirPath = DEFAULT_ROOT, pattern, maxResults = 50 }) => {
      const safePath = assertPathSafety(dirPath);
      const results = [];
      const limit = Math.min(200, Math.max(1, Number(maxResults) || 50));
      const regex = new RegExp('^' + pattern.replaceAll('.', '\\.').replaceAll('*', '.*').replaceAll('?', '.') + '$', 'i');

      async function scan(currentDir, depth) {
        if (depth > 4 || results.length >= limit) return;
        try {
          const items = await fs.readdir(currentDir, { withFileTypes: true });
          for (const item of items) {
            const full = win.join(currentDir, item.name);
            if (regex.test(item.name)) {
              results.push({ name: item.name, path: full, isDirectory: item.isDirectory() });
              if (results.length >= limit) return;
            }
            if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
              await scan(full, depth + 1);
            }
          }
        } catch {}
      }

      await scan(safePath, 1);
      return {
        root: safePath,
        pattern,
        count: results.length,
        results,
      };
    }
  );

  // 7. shell_exec
  wrapTool(
    authorizedTools,
    'shell_exec',
    'Chạy lệnh PowerShell hoặc CMD có kiểm soát trên PC01 với giới hạn thời gian và đầu ra.',
    {
      command: z.string().describe('Lệnh cần thực thi'),
      cwd: z.string().optional().describe('Thư mục thực thi (mặc định D:\\TigerIQ)'),
      shell: z.enum(['powershell', 'cmd']).optional().describe('Trình bao thực thi (mặc định powershell)'),
      timeoutSec: z.number().optional().describe('Thời gian chờ tối đa (giây, mặc định 60, tối đa 300)'),
    },
    async ({ command, cwd = DEFAULT_ROOT, shell = 'powershell', timeoutSec = 60 }) => {
      const safeCwd = assertPathSafety(cwd);
      const isCmd = shell === 'cmd';
      const isWin = process.platform === 'win32';
      const bin = isWin ? (isCmd ? 'cmd.exe' : 'powershell.exe') : (isCmd ? 'sh' : 'bash');
      const binArgs = isWin
        ? (isCmd ? ['/d', '/s', '/c', command] : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command])
        : ['-c', command];
      const result = await spawnProcess(bin, binArgs, { cwd: safeCwd, timeoutSec });
      return {
        shell,
        command,
        cwd: safeCwd,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  );

  // 8. process_list
  wrapTool(
    authorizedTools,
    'process_list',
    'Liệt kê các tiến trình đang chạy trên Windows PC01.',
    {
      filter: z.string().optional().describe('Bộ lọc tên tiến trình (ví dụ: node, ollama, chrome)'),
    },
    async ({ filter }) => {
      const args = ['/FO', 'CSV', '/NH'];
      if (filter) {
        args.unshift('/FI', `IMAGENAME eq ${filter}*`);
      }
      const result = await spawnProcess('tasklist.exe', args, { timeoutSec: 15 });
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const processes = lines.map((line) => {
        const parts = line.split('","').map((p) => p.replaceAll('"', '').trim());
        return {
          name: parts[0] || '',
          pid: parts[1] || '',
          sessionName: parts[2] || '',
          sessionNum: parts[3] || '',
          memUsage: parts[4] || '',
        };
      }).filter((p) => p.name);
      return {
        count: processes.length,
        processes: processes.slice(0, 150),
        truncated: processes.length > 150,
      };
    }
  );

  // 9. task_list
  wrapTool(
    authorizedTools,
    'task_list',
    'Liệt kê danh sách Scheduled Tasks trên PC01.',
    {
      filter: z.string().optional().describe('Lọc theo tên tác vụ (mặc định TigerIQ)'),
    },
    async ({ filter = 'TigerIQ' }) => {
      const result = await spawnProcess('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH'], { timeoutSec: 20 });
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const tasks = [];
      for (const line of lines) {
        const parts = line.split('","').map((p) => p.replaceAll('"', '').trim());
        const taskName = parts[0]?.replace(/^\\+/, '') || '';
        if (!filter || taskName.toLowerCase().includes(filter.toLowerCase())) {
          tasks.push({
            taskName,
            nextRunTime: parts[1] || '',
            status: parts[2] || '',
          });
        }
      }
      return { count: tasks.length, tasks };
    }
  );

  // 10. task_action
  wrapTool(
    authorizedTools,
    'task_action',
    'Thực hiện hành động (status, start, stop, restart) trên tác vụ theo lịch của Windows.',
    {
      action: z.enum(['status', 'start', 'stop', 'restart']).describe('Hành động cần thực hiện'),
      taskName: z.string().describe('Tên tác vụ (ví dụ: TigerIQ Core 24x7)'),
    },
    async ({ action, taskName }) => {
      const name = String(taskName || '').trim();
      if (action === 'status') {
        const res = await spawnProcess('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST', '/V'], { timeoutSec: 15 });
        return { taskName: name, action, output: res.stdout };
      }
      if (action === 'start') {
        const res = await spawnProcess('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
        return { taskName: name, action, success: res.exitCode === 0, output: res.stdout };
      }
      if (action === 'stop') {
        const res = await spawnProcess('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
        return { taskName: name, action, success: res.exitCode === 0, output: res.stdout };
      }
      if (action === 'restart') {
        await spawnProcess('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
        const res = await spawnProcess('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
        return { taskName: name, action, success: res.exitCode === 0, output: res.stdout };
      }
      throw new Error(`UNKNOWN_TASK_ACTION:${action}`);
    }
  );

  // 11. service_status
  wrapTool(
    authorizedTools,
    'service_status',
    'Kiểm tra trạng thái các Windows Service trên PC01.',
    {
      serviceName: z.string().optional().describe('Tên dịch vụ cụ thể hoặc để trống để xem các dịch vụ chính'),
    },
    async ({ serviceName }) => {
      if (serviceName) {
        const res = await spawnProcess('sc.exe', ['query', serviceName], { timeoutSec: 10 });
        return { serviceName, output: res.stdout, exitCode: res.exitCode };
      }
      const res = await spawnProcess('powershell.exe', [
        '-NoProfile', '-Command',
        "Get-Service | Where-Object { $_.DisplayName -match 'Docker|WSL|Ollama|TigerIQ|Cloudflare' } | Select-Object -Property Name, DisplayName, Status | ConvertTo-Json -Compress",
      ], { timeoutSec: 15 });
      try {
        const services = JSON.parse(res.stdout || '[]');
        return { services: Array.isArray(services) ? services : [services] };
      } catch {
        return { raw: res.stdout };
      }
    }
  );

  // 12. docker_status
  wrapTool(
    authorizedTools,
    'docker_status',
    'Kiểm tra tình trạng Docker daemon và các container trên PC01.',
    {},
    async () => {
      let psRes = null;
      let source = 'windows';
      const isWin = process.platform === 'win32';
      const dockerBin = isWin ? 'docker.exe' : 'docker';
      try {
        psRes = await spawnProcess(dockerBin, ['ps', '-a', '--format', '{{json .}}'], { timeoutSec: 20 });
      } catch (err) {
        psRes = { exitCode: -1, stdout: '', stderr: String(err?.message || err), timedOut: false, error: err?.code || 'ENOENT' };
      }

      if ((psRes.exitCode !== 0 || !psRes.stdout) && isWin) {
        // Fallback to WSL Ubuntu Docker Engine
        try {
          const wslRes = await spawnProcess('wsl.exe', ['-d', 'Ubuntu', 'docker', 'ps', '-a', '--format', '{{json .}}'], { timeoutSec: 20 });
          if (wslRes.exitCode === 0) {
            psRes = wslRes;
            source = 'wsl-ubuntu';
          } else {
            const wslGen = await spawnProcess('wsl.exe', ['docker', 'ps', '-a', '--format', '{{json .}}'], { timeoutSec: 20 });
            if (wslGen.exitCode === 0) {
              psRes = wslGen;
              source = 'wsl';
            }
          }
        } catch {}
      }

      let containers = [];
      if (psRes.exitCode === 0 && psRes.stdout) {
        containers = psRes.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch { return { raw: line }; }
        });
      }
      return {
        dockerAvailable: psRes.exitCode === 0,
        containerCount: containers.length,
        containers,
        source: psRes.exitCode === 0 ? source : null,
        error: psRes.exitCode !== 0 ? (psRes.stderr || psRes.error || null) : null,
      };
    }
  );

  // 13. wsl_status
  wrapTool(
    authorizedTools,
    'wsl_status',
    'Kiểm tra trạng thái các bản phân phối WSL trên PC01.',
    {},
    async () => {
      const res = await spawnProcess('wsl.exe', ['-l', '-v'], { timeoutSec: 15 });
      return {
        exitCode: res.exitCode,
        output: res.stdout,
      };
    }
  );

  // 14. ui_window_list
  wrapTool(
    authorizedTools,
    'ui_window_list',
    'Liệt kê các cửa sổ ứng dụng đang mở trên màn hình PC01 qua PAD UI Broker.',
    {},
    async () => {
      try {
        const brokerRes = await executePcActionImpl({ action: 'pad_windows' });
        const dataResult = brokerRes?.data?.result || brokerRes?.result;
        const windows = Array.isArray(dataResult) ? dataResult : [];
        if (windows.length > 0) {
          return { brokerAvailable: true, count: windows.length, windows, brokerRes };
        }
      } catch {}
      const ps = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`;
      const res = await spawnProcess('powershell.exe', ['-NoProfile', '-Command', ps], { timeoutSec: 10 });
      try {
        const raw = JSON.parse(res.stdout || '[]');
        const windows = Array.isArray(raw) ? raw : [raw];
        return { brokerAvailable: false, fallback: true, count: windows.length, windows };
      } catch {
        return { brokerAvailable: false, fallback: true, count: 0, windows: [] };
      }
    }
  );

  // 15. ui_screenshot
  wrapTool(
    authorizedTools,
    'ui_screenshot',
    'Chụp ảnh màn hình máy tính PC01 và lưu vào thư mục Evidence.',
    {
      label: z.string().optional().describe('Nhãn nhận diện ảnh chụp (mặc định mcp-screen)'),
    },
    async ({ label = 'mcp-screen' }) => {
      const evidenceDir = 'D:\\TigerIQ\\Evidence';
      await fs.mkdir(evidenceDir, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
      const filename = `${label}-${timestamp}.png`;
      const fullPath = win.join(evidenceDir, filename);

      const psScript = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${fullPath.replaceAll('\\', '\\\\')}')
$g.Dispose()
$bmp.Dispose()
Write-Output "SAVED:$($b.Width)x$($b.Height)"
`;
      const res = await spawnProcess('powershell.exe', ['-NoProfile', '-Command', psScript], { timeoutSec: 20 });
      if (res.exitCode !== 0) throw new Error(`SCREENSHOT_FAILED:${res.stderr}`);

      const stat = await fs.stat(fullPath);
      return {
        path: fullPath,
        sizeBytes: stat.size,
        savedAt: new Date().toISOString(),
        info: res.stdout.trim(),
      };
    }
  );

  // 16. ui_action
  wrapTool(
    authorizedTools,
    'ui_action',
    'Thực hiện thao tác điều khiển giao diện PC01 qua PAD UI Broker (click, nhập text, phím tắt, cây phần tử).',
    {
      action: z.enum([
        'pad_health',
        'pad_launch',
        'pad_windows',
        'pad_tree',
        'pad_invoke',
        'pad_set_value',
        'pad_click',
        'pad_keys',
      ]).describe('Hành động UI cần thực hiện'),
      windowName: z.string().optional().describe('Tên tiêu đề cửa sổ'),
      windowTitle: z.string().optional().describe('Bí danh tiêu đề cửa sổ (tương đương windowName)'),
      processId: z.number().int().positive().optional().describe('PID của tiến trình cửa sổ mục tiêu'),
      pid: z.number().int().positive().optional().describe('PID của tiến trình (bí danh processId)'),
      processName: z.string().optional().describe('Tên tiến trình (notepad, calc, chrome...)'),
      className: z.string().optional().describe('Tên lớp Win32 (Edit, Button...)'),
      name: z.string().optional().describe('Tên phần tử UI'),
      automationId: z.string().optional().describe('AutomationId của phần tử UI'),
      controlType: z.string().optional().describe('Loại phần tử UI (Button, Edit, Text...)'),
      index: z.number().int().min(0).max(20).optional().describe('Chỉ số phần tử khi selector khớp nhiều phần tử'),
      match: z.enum(['exact', 'contains']).optional().describe('Kiểu so khớp tên (exact/contains)'),
      value: z.string().optional().describe('Giá trị cần nhập khi action = pad_set_value'),
      key: z.string().optional().describe('Phím tắt cần bấm khi action = pad_keys (ENTER, ESC, TAB, CTRL+S, F5...)'),
    },
    async (args) => {
      return await executePcActionImpl(args);
    }
  );

  // 17. core_status
  wrapTool(
    authorizedTools,
    'core_status',
    'Xem tình trạng hoạt động của TigerIQ Core 24x7 trên PC01.',
    {},
    async () => {
      const res = await fetch('http://127.0.0.1:8795/health', { signal: AbortSignal.timeout(5000) });
      const health = await res.json();
      return { coreOnline: res.ok, health };
    }
  );

  // 18. ollama_status
  wrapTool(
    authorizedTools,
    'ollama_status',
    'Xem danh sách các mô hình Ollama cục bộ đã cài đặt và đang chạy trên PC01.',
    {},
    async () => {
      return await executePcActionImpl({ action: 'ollama_status_read' });
    }
  );

  // 19. log_read
  wrapTool(
    authorizedTools,
    'log_read',
    'Đọc log từ thư mục Logs trên PC01.',
    {
      logName: z.string().describe('Tên tệp log (ví dụ: core.log, supervisor.log, paperclip-lab.log)'),
      lines: z.number().optional().describe('Số dòng cuối cần đọc (mặc định 100, tối đa 500)'),
    },
    async ({ logName, lines = 100 }) => {
      const logsDir = 'D:\\TigerIQ\\Logs';
      const target = win.join(logsDir, win.basename(logName));
      const safePath = assertPathSafety(target);
      const content = await fs.readFile(safePath, 'utf8');
      const allLines = content.split(/\r?\n/);
      const count = Math.min(500, Math.max(1, Number(lines) || 100));
      return {
        path: safePath,
        totalLines: allLines.length,
        lines: allLines.slice(-count),
      };
    }
  );

  // 20. test_run
  wrapTool(
    authorizedTools,
    'test_run',
    'Chạy bộ kiểm thử tự động (Vitest / Node Test) trên PC01.',
    {
      testPath: z.string().describe('Đường dẫn tệp kiểm thử (ví dụ: tests/pc-operator-mcp.test.mjs)'),
      timeoutSec: z.number().optional().describe('Thời gian chờ tối đa (giây, mặc định 120)'),
    },
    async ({ testPath, timeoutSec = 120 }) => {
      const validated = pcOperatorTestRunSpec(testPath);
      const testFilePath = win.join(validated.cwd, ...validated.testPath.split('/'));
      const testSource = await fs.readFile(testFilePath, 'utf8');
      const spec = pcOperatorTestRunSpec(testPath, {
        runtimeRoot: validated.cwd,
        nodeExecutable: validated.exe,
        testSource,
      });
      // The selected runner is already installed; do not fetch packages.
      if (!existsSync(spec.runnerPath)) throw new Error('MCP_TEST_RUNNER_NOT_INSTALLED');
      const result = await spawnProcess(spec.exe, spec.args, {
        cwd: spec.cwd,
        timeoutSec,
      });
      return {
        testPath: spec.testPath,
        sourceRoot: spec.cwd,
        runner: spec.runner,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        passed: result.exitCode === 0 && !result.timedOut,
        output: boundedText([result.stdout, result.stderr].filter(Boolean).join('\n')),
      };
    }
  );

  // 21. evidence_record
  wrapTool(
    authorizedTools,
    'evidence_record',
    'Ghi nhận biên nhận nghiệm thu hoặc bằng chứng vào thư mục Evidence với mã kiểm tra.',
    {
      category: z.string().describe('Phân loại biên nhận (ví dụ: mcp-acceptance, health-check)'),
      data: z.record(z.string(), z.any()).describe('Dữ liệu JSON của biên nhận'),
    },
    async ({ category, data }, jobId) => {
      const evidenceDir = 'D:\\TigerIQ\\Evidence';
      await fs.mkdir(evidenceDir, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
      const filename = `${category}-${jobId}-${timestamp}.json`;
      const fullPath = win.join(evidenceDir, filename);

      const record = {
        jobId,
        category,
        timestamp: new Date().toISOString(),
        host: 'PC01',
        data,
      };
      const json = JSON.stringify(record, null, 2);
      const sha256 = createHash('sha256').update(json).digest('hex');
      record.sha256 = sha256;

      await fs.writeFile(fullPath, JSON.stringify(record, null, 2), 'utf8');
      return {
        path: fullPath,
        sha256,
        record,
      };
    }
  );

  // 22. rdc_pool_status
  wrapTool(
    authorizedTools,
    'rdc_pool_status',
    'Kiểm tra tình trạng điều phối và hạn mức của các tài khoản RDC dự phòng (RDC01..RDC05).',
    {},
    async () => {
      const res = await spawnProcess('powershell.exe', [
        '-NoProfile', '-Command',
        "Get-ScheduledTask | Where-Object { $_.TaskName -match '^RDC0[1-5]' } | Select-Object TaskName, State | ConvertTo-Json -Compress",
      ], { timeoutSec: 10 });
      let tasks = [];
      try { tasks = JSON.parse(res.stdout || '[]'); } catch {}
      return {
        poolPolicy: 'docs/RDC_REMOTE_POOL.md',
        sessions: Array.isArray(tasks) ? tasks : [tasks],
      };
    }
  );

  // 23. work_order_status
  wrapTool(
    authorizedTools,
    'work_order_status',
    'Kiểm tra tiến độ và trạng thái Work Order trên TigerIQ Core.',
    {
      workOrder: z.string().optional().describe('Mã Work Order (ví dụ: WO-060)'),
    },
    async ({ workOrder }) => {
      const url = workOrder ? `http://127.0.0.1:8795/api/work-order?id=${encodeURIComponent(workOrder)}` : 'http://127.0.0.1:8795/api/status';
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return pcOperatorWorkOrderResponse(res, workOrder);
    }
  );
}

export function createPcOperatorMcpHandler({
  executePcActionImpl = executePcAction,
  existingSecret = process.env.TIGERIQ_HEALTH_VIEW_KEY,
  leaseDb,
  leaseApi,
  oauthVerifier = null,
  serverAuthorized = (process.env.TIGERIQ_MCP_SERVER_AUTHORIZED === 'true' || process.env.TIGERIQ_MCP_ALLOW_MUTATIONS === 'true'),
} = {}) {
  const sseTransports = new Map();

  function isAuthorizedCaller(headers = {}, principal = null) {
    // serverAuthorized is a legacy deployment hint, never a credential.
    // Every privileged request still needs a static bearer or verified OAuth principal.
    return allowMcpMutation(headers, existingSecret) || principal?.verified === true;
  }

  function createServerInstance(allowMutation = false, verifiedPrincipal = null) {
    const server = new McpServer({
      name: 'TigerIQ PC Operator',
      version: '2.0.0',
    });
    registerPcOperatorTools(server, executePcActionImpl, {
      allowMutation, leaseDb, leaseApi, verifiedPrincipal,
      issuerUrl: oauthVerifier?.config?.issuerUrl || process.env.TIGERIQ_OAUTH_ISSUER,
      resourceUrl: oauthVerifier?.config?.resourceUrl || process.env.TIGERIQ_OAUTH_RESOURCE,
    });
    return server;
  }

  return async function handlePcOperatorMcpRequest(req, res, url) {
    if (!url.pathname.startsWith('/mcp')) return false;

    // Health check endpoint: GET /mcp/health
    if (req.method === 'GET' && url.pathname === '/mcp/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: true,
        service: 'TigerIQ PC Operator MCP Server',
        version: '2.0.0',
        toolsCount: PC_OPERATOR_MCP_TOOLS.length,
        tools: PC_OPERATOR_MCP_TOOLS,
        uptimeSec: process.uptime(),
      }));
      return true;
    }

    if (oauthVerifier) {
      const auth = await oauthVerifier.verifyBearer(req.headers);
      if (!auth.ok) {
        const status = auth.status === 503 ? 503 : (auth.status === 401 ? 401 : 403);
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        if (status === 401) headers['WWW-Authenticate'] = oauthVerifier.challenge({ error: 'invalid_token' });
        res.writeHead(status, headers).end(JSON.stringify({ ok: false, reason: auth.reason }));
        return true;
      }
      req.__tigeriqOAuthPrincipal = auth.principal;
    }

    // Legacy Funnel gateway used serverAuthorized=true as a blanket bypass.
    // Fail closed instead: without OAuth middleware, require the existing
    // per-request static Bearer on every MCP transport request.
    if (!oauthVerifier && serverAuthorized && !allowMcpMutation(req.headers, existingSecret)) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'WWW-Authenticate': 'Bearer',
      }).end(JSON.stringify({ ok: false, reason: 'MCP_PER_REQUEST_AUTH_REQUIRED' }));
      return true;
    }

    // Route 1: Classic SSE GET /mcp or /mcp/sse
    const accept = String(req.headers['accept'] || '');
    if (req.method === 'GET' && (url.pathname === '/mcp' || url.pathname === '/mcp/sse') && accept.includes('text/event-stream')) {
      const principal = req.__tigeriqOAuthPrincipal || null;
      const sseTransport = new SSEServerTransport('/mcp/messages', res);
      const sseServer = createServerInstance(isAuthorizedCaller(req.headers, principal), principal);
      await sseServer.connect(sseTransport);
      sseTransports.set(sseTransport.sessionId, {
        transport: sseTransport,
        authorized: isAuthorizedCaller(req.headers, principal),
        principal,
      });
      res.on('close', () => {
        sseTransports.delete(sseTransport.sessionId);
      });
      return true;
    }

    // Route 2: Classic SSE POST /mcp/messages
    if (req.method === 'POST' && url.pathname === '/mcp/messages') {
      const sessionId = url.searchParams.get('sessionId');
      const session = sseTransports.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('SESSION_NOT_FOUND');
        return true;
      }
      // Do not let sessionId become a bearer credential for a privileged
      // SSE connection. The original owner token is mandatory on every POST.
      if (session.authorized && !isAuthorizedCaller(req.headers, session.principal)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' }).end('MCP_AUTH_REQUIRED');
        return true;
      }
      await session.transport.handlePostMessage(req, res);
      return true;
    }

    // Route 3: Streamable HTTP (POST /mcp or GET /mcp)
    if (url.pathname === '/mcp') {
      if (!accept.includes('text/event-stream')) {
        req.headers['accept'] = (accept ? accept + ', ' : '') + 'text/event-stream, application/json';
      }
      const principal = req.__tigeriqOAuthPrincipal || null;
      const server = createServerInstance(isAuthorizedCaller(req.headers, principal), principal);
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
