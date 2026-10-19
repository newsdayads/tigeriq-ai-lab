import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { executePcAction } from '../openclaw-tigeriq-runtime/operator.mjs';

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
  // 1. Files & Directories
  'file_read',
  'file_write',
  'file_list',
  'file_stat',
  'file_search',
  // 2. Terminal & Execution
  'shell_exec',
  // 3. Processes, Tasks & Services
  'process_list',
  'task_list',
  'task_action',
  'service_status',
  'docker_status',
  'wsl_status',
  // 4. Desktop & UI
  'ui_window_list',
  'ui_screenshot',
  'ui_action',
  // 5. Software & Health Subsystems
  'core_status',
  'ollama_status',
  'paperclip_lab_preflight',
  'paperclip_lab_health',
  'paperclip_lab_broker_install',
  // 6. Logs, Diagnostics & Evidence
  'log_read',
  'test_run',
  'evidence_record',
  // 7. Coordination & Workforce
  'rdc_pool_status',
  'work_order_status',
]);

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
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Number(timeoutSec) || 60));
  const childEnv = { ...process.env, ...env };

  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: safeCwd,
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

export function registerPcOperatorTools(server, executePcActionImpl = executePcAction) {
  // 1. file_read
  wrapTool(
    server,
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

  // 2. file_write
  wrapTool(
    server,
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

  // 3. file_list
  wrapTool(
    server,
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

  // 4. file_stat
  wrapTool(
    server,
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

  // 5. file_search
  wrapTool(
    server,
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

  // 6. shell_exec
  wrapTool(
    server,
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
      const result = await spawnProcess(
        isCmd ? 'cmd.exe' : 'powershell.exe',
        isCmd ? ['/d', '/s', '/c', command] : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { cwd: safeCwd, timeoutSec }
      );
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

  // 7. process_list
  wrapTool(
    server,
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

  // 8. task_list
  wrapTool(
    server,
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

  // 9. task_action
  wrapTool(
    server,
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

  // 10. service_status
  wrapTool(
    server,
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

  // 11. docker_status
  wrapTool(
    server,
    'docker_status',
    'Kiểm tra tình trạng Docker daemon và các container trên PC01.',
    {},
    async () => {
      const psRes = await spawnProcess('docker.exe', ['ps', '-a', '--format', '{{json .}}'], { timeoutSec: 20 });
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
        error: psRes.exitCode !== 0 ? psRes.stderr : null,
      };
    }
  );

  // 12. wsl_status
  wrapTool(
    server,
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

  // 13. ui_window_list
  wrapTool(
    server,
    'ui_window_list',
    'Liệt kê các cửa sổ ứng dụng đang mở trên màn hình PC01 qua PAD UI Broker.',
    {},
    async () => {
      try {
        return await executePcActionImpl({ action: 'pad_windows' });
      } catch (err) {
        const ps = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`;
        const res = await spawnProcess('powershell.exe', ['-NoProfile', '-Command', ps], { timeoutSec: 10 });
        try {
          return { fallback: true, windows: JSON.parse(res.stdout || '[]') };
        } catch {
          throw err;
        }
      }
    }
  );

  // 14. ui_screenshot
  wrapTool(
    server,
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

  // 15. ui_action
  wrapTool(
    server,
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
      name: z.string().optional().describe('Tên phần tử UI'),
      automationId: z.string().optional().describe('AutomationId của phần tử UI'),
      controlType: z.string().optional().describe('Loại phần tử UI (Button, Edit, Text...)'),
      match: z.enum(['exact', 'contains']).optional().describe('Kiểu so khớp tên (exact/contains)'),
      value: z.string().optional().describe('Giá trị cần nhập khi action = pad_set_value'),
      key: z.string().optional().describe('Phím tắt cần bấm khi action = pad_keys (ENTER, ESC, TAB, F5...)'),
    },
    async (args) => {
      return await executePcActionImpl(args);
    }
  );

  // 16. core_status
  wrapTool(
    server,
    'core_status',
    'Xem tình trạng hoạt động của TigerIQ Core 24x7 trên PC01.',
    {},
    async () => {
      const res = await fetch('http://127.0.0.1:8795/health', { signal: AbortSignal.timeout(5000) });
      const health = await res.json();
      return { coreOnline: res.ok, health };
    }
  );

  // 17. ollama_status
  wrapTool(
    server,
    'ollama_status',
    'Xem danh sách các mô hình Ollama cục bộ đã cài đặt và đang chạy trên PC01.',
    {},
    async () => {
      return await executePcActionImpl({ action: 'ollama_status_read' });
    }
  );

  // 18. paperclip_lab_preflight
  wrapTool(
    server,
    'paperclip_lab_preflight',
    'Kiểm tra điều kiện môi trường Paperclip Lab trên PC01 (Docker, container, port 3210 loopback, broker).',
    {},
    async () => {
      return await executePcActionImpl({ action: 'paperclip_lab_preflight' });
    }
  );

  // 19. paperclip_lab_health
  wrapTool(
    server,
    'paperclip_lab_health',
    'Kiểm tra sức khỏe dịch vụ Paperclip Lab trên PC01 (HTTP 200, PostgreSQL database sidecar, container).',
    {},
    async () => {
      return await executePcActionImpl({ action: 'paperclip_lab_health' });
    }
  );

  // 20. paperclip_lab_broker_install
  wrapTool(
    server,
    'paperclip_lab_broker_install',
    'Cài đặt và cấu hình lại Paperclip WSL Interactive Broker trên PC01.',
    {},
    async () => {
      return await executePcActionImpl({ action: 'paperclip_lab_broker_install' });
    }
  );

  // 21. log_read
  wrapTool(
    server,
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

  // 22. test_run
  wrapTool(
    server,
    'test_run',
    'Chạy bộ kiểm thử tự động (Vitest / Node Test) trên PC01.',
    {
      testPath: z.string().describe('Đường dẫn tệp kiểm thử (ví dụ: tests/pc-operator-mcp.test.mjs)'),
      timeoutSec: z.number().optional().describe('Thời gian chờ tối đa (giây, mặc định 120)'),
    },
    async ({ testPath, timeoutSec = 120 }) => {
      const safeTestPath = win.normalize(testPath).replaceAll('\\', '/');
      const result = await spawnProcess('npx.cmd', ['vitest', 'run', safeTestPath], {
        cwd: 'D:\\TigerIQ\\Workspace\\tigeriq-ai-lab',
        timeoutSec,
      });
      return {
        testPath: safeTestPath,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        passed: result.exitCode === 0,
        output: result.stdout || result.stderr,
      };
    }
  );

  // 23. evidence_record
  wrapTool(
    server,
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

  // 24. rdc_pool_status
  wrapTool(
    server,
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

  // 25. work_order_status
  wrapTool(
    server,
    'work_order_status',
    'Kiểm tra tiến độ và trạng thái Work Order trên TigerIQ Core.',
    {
      workOrder: z.string().optional().describe('Mã Work Order (ví dụ: WO-060)'),
    },
    async ({ workOrder }) => {
      const url = workOrder ? `http://127.0.0.1:8795/api/work-order?id=${encodeURIComponent(workOrder)}` : 'http://127.0.0.1:8795/api/status';
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      return { workOrder, data };
    }
  );
}

export function createPcOperatorMcpHandler({
  executePcActionImpl = executePcAction,
  mcpAuthKey = process.env.TIGERIQ_MCP_KEY,
} = {}) {
  const sseTransports = new Map();

  function isAuthorized(req, url) {
    if (!mcpAuthKey) return true; // Khi chưa đặt key, cho phép loopback/local
    const authHeader = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    const queryToken = String(url.searchParams.get('token') || '').trim();
    const provided = authHeader || queryToken;
    if (!provided || provided.length !== mcpAuthKey.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided), Buffer.from(mcpAuthKey));
    } catch {
      return false;
    }
  }

  function createServerInstance() {
    const server = new McpServer({
      name: 'TigerIQ PC Operator',
      version: '2.0.0',
    });
    registerPcOperatorTools(server, executePcActionImpl);
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

    // Authentication check
    if (!isAuthorized(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: false,
        error: 'TIGERIQ_MCP_UNAUTHORIZED',
      }));
      return true;
    }

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
