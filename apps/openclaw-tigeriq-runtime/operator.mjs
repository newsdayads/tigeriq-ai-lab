import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { PAD_UI_ACTIONS, executePadUiAction } from './pad-ui.mjs';
import { PAPERCLIP_LAB_ACTIONS, executePaperclipLabAction } from './paperclip-lab.mjs';

const win = path.win32;
export const PC_OPERATOR_ROOTS = Object.freeze([
  'D:\\TigerIQ',
  'D:\\OpenClaw',
  'D:\\TigerIQ-OpenClaw',
]);
const DEFAULT_ROOT = PC_OPERATOR_ROOTS[0];
const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_TIMEOUT_SEC = 120;
const ALLOWED_TCP_HOSTS = new Set(['127.0.0.1', 'localhost', '100.97.23.87']);
const ALLOWED_TCP_PORTS = new Set([8793, 8794, 8795, 8796, 8797, 8798, 8799, 11434, 18789]);

const DENIED_PATH_FRAGMENTS = [
  '\\secrets\\',
  '\\.ssh\\',
  '\\windows\\system32\\config\\',
  '\\appdata\\local\\google\\chrome\\user data\\',
  '\\appdata\\local\\microsoft\\edge\\user data\\',
];

export const PC_WRITE_ROOTS = Object.freeze([
  'D:\\TigerIQ\\State',
  'D:\\TigerIQ\\Evidence',
  'D:\\TigerIQ\\Logs',
  'D:\\TigerIQ-OpenClaw\\state',
]);

const SAFE_SHELL_PATTERNS = [
  /^git\s+status(?:\s+--short|\s+--porcelain(?:=v1)?)?$/i,
  /^git\s+branch\s+--show-current$/i,
  /^git\s+rev-parse\s+(?:HEAD|--show-toplevel|--is-inside-work-tree)$/i,
  /^git\s+log\s+-[1-9]\d?(?:\s+--oneline)?$/i,
  /^git\s+show\s+--stat(?:\s+[0-9a-f]{7,40})?$/i,
  /^ollama\s+(?:list|ps)$/i,
  /^(?:"?D:\\OpenClaw\\npm-global\\openclaw\.cmd"?|openclaw(?:\.cmd)?)\s+--version$/i,
  /^(?:"?D:\\OpenClaw\\npm-global\\openclaw\.cmd"?|openclaw(?:\.cmd)?)\s+plugins\s+(?:list|inspect\s+tigeriq-runtime)(?:\s+--json)?$/i,
  /^(?:"?D:\\OpenClaw\\npm-global\\openclaw\.cmd"?|openclaw(?:\.cmd)?)\s+agents\s+list\s+--json$/i,
];

function normalizeWinPath(value) {
  return win.resolve(String(value || DEFAULT_ROOT).replaceAll('/', '\\'));
}

function fencedPath(value) {
  const lower = normalizeWinPath(value).toLowerCase();
  return '\\' + lower.replaceAll('/', '\\') + (lower.endsWith('\\') ? '' : '\\');
}

function isInsideRoots(candidate, roots) {
  const lower = normalizeWinPath(candidate).toLowerCase();
  return roots.some((root) => {
    const base = normalizeWinPath(root).toLowerCase();
    return lower === base || lower.startsWith(base + '\\');
  });
}

function isInsideAllowedRoot(candidate) {
  return isInsideRoots(candidate, PC_OPERATOR_ROOTS);
}

function assertNotSensitive(candidate) {
  const fenced = fencedPath(candidate);
  if (DENIED_PATH_FRAGMENTS.some((fragment) => fenced.includes(fragment))) {
    throw new Error('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  }
}

export function resolveOperatorPath(value, { allowRoot = true } = {}) {
  const raw = String(value || DEFAULT_ROOT).trim();
  const candidate = normalizeWinPath(win.isAbsolute(raw) ? raw : win.join(DEFAULT_ROOT, raw));
  if (!isInsideAllowedRoot(candidate) || (!allowRoot && PC_OPERATOR_ROOTS.some((root) => normalizeWinPath(root).toLowerCase() === candidate.toLowerCase()))) {
    throw new Error('TIGERIQ_PC_PATH_NOT_ALLOWED');
  }
  assertNotSensitive(candidate);
  return candidate;
}

export function assertWritePathAllowed(value) {
  const candidate = resolveOperatorPath(value, { allowRoot: false });
  if (!isInsideRoots(candidate, PC_WRITE_ROOTS)) {
    throw new Error('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
  }
  return candidate;
}

async function realPathInsideRoots(candidate, { forWrite = false } = {}) {
  const lexical = forWrite ? assertWritePathAllowed(candidate) : resolveOperatorPath(candidate);
  let probe = lexical;
  if (forWrite) {
    while (true) {
      try {
        await fs.stat(probe);
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const parent = win.dirname(probe);
        if (parent === probe) throw new Error('TIGERIQ_PC_PATH_NOT_ALLOWED');
        probe = parent;
      }
    }
  }
  const realProbe = normalizeWinPath(await fs.realpath(probe));
  if (!isInsideAllowedRoot(realProbe)) throw new Error('TIGERIQ_PC_REALPATH_ESCAPE_BLOCKED');
  assertNotSensitive(realProbe);
  return lexical;
}

export function assertShellCommandAllowed(command) {
  const text = String(command || '').trim();
  if (!text || text.length > 8000) throw new Error('TIGERIQ_PC_COMMAND_INVALID');
  if (/[\r\n;&|><\x60$(){}[\]]/.test(text)) throw new Error('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
  if (!SAFE_SHELL_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
  }
  return text;
}

function boundedText(value) {
  const text = String(value || '');
  return text.length <= MAX_OUTPUT_CHARS ? text : text.slice(0, MAX_OUTPUT_CHARS) + '\n[TRUNCATED]';
}

function safeChildEnv() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[key];
    if (typeof value === 'string' && value) env[key] = value;
  }
  return env;
}

async function spawnBounded(exe, args, { cwd = DEFAULT_ROOT, timeoutSec = 60 } = {}) {
  const safeCwd = await realPathInsideRoots(cwd || DEFAULT_ROOT);
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Number(timeoutSec) || 60));
  return await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: safeCwd,
      windowsHide: true,
      env: safeChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT_CHARS * 2) stdout = stdout.slice(-MAX_OUTPUT_CHARS); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > MAX_OUTPUT_CHARS * 2) stderr = stderr.slice(-MAX_OUTPUT_CHARS); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout * 1000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
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

async function runShell({ command, cwd, shell = 'powershell', timeoutSec = 60 }) {
  const safeCommand = assertShellCommandAllowed(command);
  const useCmd = shell === 'cmd';
  const result = await spawnBounded(
    useCmd ? 'cmd.exe' : 'powershell.exe',
    useCmd
      ? ['/d', '/s', '/c', safeCommand]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', safeCommand],
    { cwd, timeoutSec },
  );
  return { ...result, shell: useCmd ? 'cmd' : 'powershell' };
}

export function assertTigerIQTaskName(value) {
  const taskName = String(value || '').trim();
  if (!/^TigerIQ [A-Za-z0-9 ._()#-]{1,100}$/.test(taskName)) throw new Error('TIGERIQ_PC_TASK_NOT_ALLOWED');
  return taskName;
}

function successfulTaskProcessResult(result) {
  return Boolean(
    result
    && typeof result === 'object'
    && result.timedOut === false
    && typeof result.exitCode === 'number'
    && Number.isInteger(result.exitCode)
    && result.exitCode === 0
  );
}

function trustedTaskVerification(action, taskName, verification) {
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return false;
  if (verification.taskName !== taskName) return false;
  const state = String(verification.state || '').trim().toLowerCase();
  if (!state) return false;
  if (action === 'task_stop') return state !== 'running';
  if (state === 'running') return true;
  const lastRun = String(verification.lastRun ?? '').trim();
  const previousLastRun = String(verification.previousLastRun ?? '').trim();
  return state === 'ready'
    && String(verification.lastResult ?? '').trim() === '0'
    && Boolean(lastRun)
    && Boolean(previousLastRun)
    && lastRun !== previousLastRun;
}

export function trustedTigerIQTaskActionData(action, data) {
  const kind = String(action || '').toLowerCase();
  if (!['task_start', 'task_stop', 'task_restart'].includes(kind) || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  let taskName;
  try { taskName = assertTigerIQTaskName(data.taskName); } catch { return false; }
  const subprocessOk = kind === 'task_restart'
    ? successfulTaskProcessResult(data.stopped) && successfulTaskProcessResult(data.started)
    : successfulTaskProcessResult(data);
  return subprocessOk && trustedTaskVerification(kind, taskName, data.verification);
}

function assertTaskProcessSuccess(result, phase) {
  if (result?.timedOut === true) throw new Error(`TIGERIQ_PC_TASK_${phase}_TIMEOUT`);
  if (!result || Number(result.exitCode) !== 0) throw new Error(`TIGERIQ_PC_TASK_${phase}_FAILED`);
  return result;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '');

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => String(value).length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => String(value).length > 0)) rows.push(row);
  }
  if (quoted) throw new Error('TIGERIQ_PC_TASK_LIST_CSV_INVALID');
  return rows;
}

function nullableCell(row, index) {
  const value = String(row[index] ?? '').trim();
  return value || null;
}

export function parseTaskListCsv(text) {
  const tasks = [];
  for (const row of parseCsvRows(text)) {
    if (row.length < 9) continue;
    const rawName = String(row[1] ?? '').trim();
    const taskName = rawName.replace(/^\\+/, '');
    if (!taskName.startsWith('TigerIQ ')) continue;

    assertTigerIQTaskName(taskName);
    const triggerParts = row
      .slice(17)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);

    tasks.push({
      taskName,
      state: nullableCell(row, 3),
      lastRun: nullableCell(row, 5),
      lastResult: nullableCell(row, 6),
      action: nullableCell(row, 8),
      trigger: triggerParts.length > 0 ? triggerParts.join(' | ') : null,
    });
  }
  return tasks;
}

export function parseCompactTaskListCsv(text) {
  const tasks = [];
  for (const row of parseCsvRows(text)) {
    const rawName = String(row[0] ?? '').trim();
    const taskName = rawName.replace(/^\\+/, '');
    if (!taskName.startsWith('TigerIQ ')) continue;
    tasks.push({ taskName: assertTigerIQTaskName(taskName) });
  }
  return tasks;
}

async function listTigerIQTasks() {
  const result = await spawnBounded(
    'schtasks.exe',
    ['/Query', '/FO', 'CSV', '/NH'],
    { timeoutSec: 30 },
  );
  if (result.timedOut) throw new Error('TIGERIQ_PC_TASK_LIST_TIMEOUT');
  if (result.exitCode !== 0) throw new Error('TIGERIQ_PC_TASK_LIST_FAILED');
  if (result.stdout.includes('[TRUNCATED]')) throw new Error('TIGERIQ_PC_TASK_LIST_TRUNCATED');
  const tasks = parseCompactTaskListCsv(result.stdout);
  return {
    readOnly: true,
    scope: 'TigerIQ',
    count: tasks.length,
    taskNames: tasks.map((task) => task.taskName),
    releaseTaskNames: tasks.map((task) => task.taskName).filter((name) => /(?:android|worker|release|sign|apk|build|stable|elevated)/i.test(name)),
    tasks,
  };
}

async function queryTigerIQTaskVerification(taskName) {
  const name = assertTigerIQTaskName(taskName);
  const result = await spawnBounded('schtasks.exe', ['/Query', '/TN', name, '/FO', 'CSV', '/V', '/NH'], { timeoutSec: 15 });
  assertTaskProcessSuccess(result, 'VERIFY');
  if (result.stdout.includes('[TRUNCATED]')) throw new Error('TIGERIQ_PC_TASK_VERIFY_TRUNCATED');
  const task = parseTaskListCsv(result.stdout).find((item) => item.taskName === name);
  if (!task) throw new Error('TIGERIQ_PC_TASK_VERIFY_MISSING');
  return {
    taskName: name,
    state: task.state,
    lastRun: task.lastRun,
    lastResult: task.lastResult,
  };
}

async function runTaskAction(action, taskName) {
  const name = assertTigerIQTaskName(taskName);
  if (action === 'task_status') {
    return { taskName: name, ...(await spawnBounded('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST', '/V'], { timeoutSec: 15 })) };
  }
  if (action === 'task_start') {
    const before = await queryTigerIQTaskVerification(name);
    const result = await spawnBounded('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(result, 'START');
    const verification = { ...(await queryTigerIQTaskVerification(name)), previousLastRun: before.lastRun };
    return { taskName: name, ...result, verification };
  }
  if (action === 'task_stop') {
    const result = await spawnBounded('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(result, 'STOP');
    return { taskName: name, ...result, verification: await queryTigerIQTaskVerification(name) };
  }
  if (action === 'task_restart') {
    const before = await queryTigerIQTaskVerification(name);
    const stopped = await spawnBounded('schtasks.exe', ['/End', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(stopped, 'RESTART_STOP');
    const started = await spawnBounded('schtasks.exe', ['/Run', '/TN', name], { timeoutSec: 15 });
    assertTaskProcessSuccess(started, 'RESTART_START');
    const verification = { ...(await queryTigerIQTaskVerification(name)), previousLastRun: before.lastRun };
    return { taskName: name, stopped, started, verification };
  }
  throw new Error('TIGERIQ_PC_TASK_ACTION_NOT_ALLOWED');
}

async function tcpProbe(host, port, timeoutMs = 2500) {
  const safeHost = String(host || '127.0.0.1').toLowerCase();
  const safePort = Number(port);
  if (!ALLOWED_TCP_HOSTS.has(safeHost) || !ALLOWED_TCP_PORTS.has(safePort)) {
    throw new Error('TIGERIQ_PC_TCP_TARGET_NOT_ALLOWED');
  }
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ host: safeHost, port: safePort, reachable: ok, reason });
    };
    socket.setTimeout(Math.max(250, Math.min(5000, Number(timeoutMs) || 2500)));
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.code || 'error'));
    socket.connect(safePort, safeHost);
  });
}

async function readTextFile(filePath) {
  const safePath = await realPathInsideRoots(filePath);
  const stat = await fs.stat(safePath);
  if (!stat.isFile()) throw new Error('TIGERIQ_PC_NOT_A_FILE');
  if (stat.size > MAX_READ_BYTES) throw new Error('TIGERIQ_PC_FILE_TOO_LARGE');
  return { path: safePath, size: stat.size, content: await fs.readFile(safePath, 'utf8') };
}

async function writeTextFile(filePath, content) {
  const safePath = await realPathInsideRoots(filePath, { forWrite: true });
  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) throw new Error('TIGERIQ_PC_WRITE_TOO_LARGE');
  await fs.mkdir(win.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, text, 'utf8');
  const stat = await fs.stat(safePath);
  return { path: safePath, size: stat.size };
}

async function listPath(dirPath) {
  const safePath = await realPathInsideRoots(dirPath || DEFAULT_ROOT);
  const entries = await fs.readdir(safePath, { withFileTypes: true });
  return {
    path: safePath,
    entries: entries.slice(0, 250).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    })),
    truncated: entries.length > 250,
  };
}

async function statPath(targetPath) {
  const safePath = await realPathInsideRoots(targetPath);
  const stat = await fs.stat(safePath);
  return {
    path: safePath,
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}


const GATE_C_VERSION = '0.19.0-core-mobile-jobs';
const GATE_C_TASK_COUNT = 10;

async function coreMobileJson(pathname,{method='GET',body=null}={}) {
  const token=String(process.env.TIGERIQ_CORE_TOKEN||'').trim();
  if(!token) throw new Error('TIGERIQ_ANDROID_GATE_C_CORE_TOKEN_MISSING');
  const response=await fetch('http://127.0.0.1:8795'+pathname,{
    method,
    headers:{
      authorization:'Bearer '+token,
      ...(body?{'content-type':'application/json'}:{})
    },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const raw=await response.text();
  let parsed={};
  try{parsed=raw?JSON.parse(raw):{}}catch{throw new Error('TIGERIQ_ANDROID_GATE_C_CORE_RESPONSE_INVALID')}
  if(!response.ok){
    const reason=String(parsed?.error||'http_'+response.status).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80);
    throw new Error('TIGERIQ_ANDROID_GATE_C_CORE_'+response.status+'_'+reason);
  }
  return parsed;
}

function gateCEligibleDevices(payload,{requireOnline=true}={}) {
  const devices=Array.isArray(payload?.devices)?payload.devices:[];
  return devices.filter((device)=>
    device?.revoked!==true
    && String(device?.agentVersion||'')===GATE_C_VERSION
    && (!requireOnline||device?.online===true)
  );
}

async function gateCDevice({requireOnline=true}={}) {
  const payload=await coreMobileJson('/api/mobile/devices/status');
  const eligible=gateCEligibleDevices(payload,{requireOnline});
  if(eligible.length!==1)throw new Error(requireOnline?'TIGERIQ_ANDROID_GATE_C_ONLINE_DEVICE_COUNT_INVALID':'TIGERIQ_ANDROID_GATE_C_DEVICE_COUNT_INVALID');
  return eligible[0];
}

function gateCExpectedToken(index) {
  return 'TIGERIQ_GATE_C_OK_'+String(index);
}

function gateCIdempotencyKey(employeeId,index) {
  return 'gate-c-v019-'+String(employeeId)+'-'+String(index).padStart(2,'0');
}

async function startAndroidMobileGateC() {
  const device=await gateCDevice({requireOnline:true});
  const tasks=[];
  for(let index=1;index<=GATE_C_TASK_COUNT;index+=1){
    const expectedToken=gateCExpectedToken(index);
    const prompt='Bài kiểm tra TigerIQ Gate C chu kỳ '+index+'/'+GATE_C_TASK_COUNT+'. Hãy ghép đúng năm phần sau thành một chuỗi duy nhất và chỉ trả lời chuỗi kết quả, không thêm nội dung khác: TIGERIQ_ + GATE_ + C_ + OK_ + '+index;
    const response=await coreMobileJson('/api/mobile/tasks/enqueue',{
      method:'POST',
      body:{
        employeeId:device.employeeId,
        idempotencyKey:gateCIdempotencyKey(device.employeeId,index),
        prompt,
        expectedToken
      }
    });
    tasks.push({
      index,
      taskId:String(response?.task?.taskId||''),
      runId:String(response?.task?.runId||''),
      status:String(response?.task?.status||''),
      idempotent:Boolean(response?.idempotent)
    });
  }
  if(tasks.length!==GATE_C_TASK_COUNT||tasks.some((task)=>!task.taskId||!task.runId))throw new Error('TIGERIQ_ANDROID_GATE_C_ENQUEUE_INCOMPLETE');
  return {
    status:'ANDROID_GATE_C_10JOB_ENQUEUED',
    employeeId:String(device.employeeId||''),
    nodeId:String(device.nodeId||''),
    agentVersion:String(device.agentVersion||''),
    online:Boolean(device.online),
    count:tasks.length,
    tasks
  };
}

function gateCTaskValid(task,index) {
  const result=task?.result&&typeof task.result==='object'?task.result:{};
  const output=result?.output&&typeof result.output==='object'?result.output:{};
  return String(task?.status||'')==='completed'
    && String(output.validatedToken||'')===gateCExpectedToken(index)
    && String(output.runState||'')==='COMPLETE'
    && Number(output.sendCount)===1
    && Number(output.duplicateSendCount)===0;
}

async function readAndroidMobileGateCStatus() {
  const device=await gateCDevice({requireOnline:false});
  const payload=await coreMobileJson('/api/mobile/tasks/status?employeeId='+encodeURIComponent(String(device.employeeId||''))+'&limit=100');
  const prefix='gate-c-v019-'+String(device.employeeId||'')+'-';
  const tasks=(Array.isArray(payload?.tasks)?payload.tasks:[])
    .filter((task)=>String(task?.idempotency_key||'').startsWith(prefix))
    .sort((a,b)=>String(a.idempotency_key||'').localeCompare(String(b.idempotency_key||'')))
    .slice(0,GATE_C_TASK_COUNT);
  let valid=0,completed=0,failed=0,queued=0,leased=0,totalDuplicateSends=0,totalSends=0;
  const compact=tasks.map((task)=>{
    const suffix=String(task.idempotency_key||'').slice(prefix.length);
    const index=Number(suffix);
    const output=task?.result?.output&&typeof task.result.output==='object'?task.result.output:{};
    const isValid=Number.isInteger(index)&&index>=1&&index<=GATE_C_TASK_COUNT&&gateCTaskValid(task,index);
    if(isValid)valid+=1;
    if(task.status==='completed')completed+=1;
    else if(task.status==='failed')failed+=1;
    else if(task.status==='queued')queued+=1;
    else if(task.status==='leased')leased+=1;
    totalSends+=Number(output.sendCount||0);
    totalDuplicateSends+=Number(output.duplicateSendCount||0);
    return {
      index,taskId:String(task.task_id||''),runId:String(task.run_id||''),status:String(task.status||''),
      attempts:Number(task.attempts||0),sendCount:Number(output.sendCount||0),
      duplicateSendCount:Number(output.duplicateSendCount||0),validatedToken:String(output.validatedToken||''),
      valid:isValid
    };
  });
  const pass=tasks.length===GATE_C_TASK_COUNT&&valid===GATE_C_TASK_COUNT&&failed===0&&totalSends===GATE_C_TASK_COUNT&&totalDuplicateSends===0;
  return {
    status:pass?'ANDROID_GATE_C_10JOB_PASS':'ANDROID_GATE_C_10JOB_PENDING',
    pass,
    employeeId:String(device.employeeId||''),
    nodeId:String(device.nodeId||''),
    agentVersion:String(device.agentVersion||''),
    online:Boolean(device.online),
    lastSeenAt:device.lastSeenAt||null,
    count:tasks.length,completed,failed,queued,leased,valid,totalSends,totalDuplicateSends,
    tasks:compact
  };
}


async function buildAndroidWorkerStableRelease() {
  const repoRoot = 'D:\\TigerIQ\\Runtime\\CoreSource';
  const script = 'D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\build-android-worker-release.ps1';
  const secretsDir = 'D:\\TigerIQ\\Secrets\\AndroidSigning';
  const releaseRoot = 'D:\\TigerIQ\\Releases\\AndroidWorker\\signed';
  const runtimeStatePath = 'D:\\TigerIQ\\State\\core-runtime-updater.json';
  await realPathInsideRoots(script);
  const runtimeState = JSON.parse(await fs.readFile(await realPathInsideRoots(runtimeStatePath), 'utf8'));
  const installedSha = String(runtimeState?.installedSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(installedSha)) throw new Error('TIGERIQ_ANDROID_RELEASE_INSTALLED_SHA_MISSING');
  const result = await spawnBounded(
    'powershell.exe',
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-RepoRoot',repoRoot,'-SecretsDir',secretsDir,'-ReleaseRoot',releaseRoot],
    { cwd: repoRoot, timeoutSec: 120 },
  );
  if (result.timedOut) throw new Error('TIGERIQ_ANDROID_RELEASE_BUILD_TIMEOUT');
  if (Number(result.exitCode) !== 0) throw new Error('TIGERIQ_ANDROID_RELEASE_BUILD_FAILED');
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let receipt = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && parsed.status === 'ANDROID_WORKER_STABLE_RELEASE_READY') { receipt = parsed; break; }
    } catch {}
  }
  if (!receipt) throw new Error('TIGERIQ_ANDROID_RELEASE_RECEIPT_MISSING');
  const expectedSigner = '63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293';
  if (String(receipt.certificateSha256 || '').replaceAll(':','').toUpperCase() !== expectedSigner) {
    throw new Error('TIGERIQ_ANDROID_RELEASE_SIGNER_MISMATCH');
  }
  if (receipt.secretsPrinted !== false) throw new Error('TIGERIQ_ANDROID_RELEASE_SECRET_OUTPUT_UNSAFE');
  const sourceSha = String(receipt.sourceSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('TIGERIQ_ANDROID_RELEASE_SOURCE_SHA_MISSING');
  if (sourceSha !== installedSha) throw new Error('TIGERIQ_ANDROID_RELEASE_SOURCE_SHA_MISMATCH');
  return {
    status: receipt.status,
    version: String(receipt.version || ''),
    apk: String(receipt.apk || ''),
    manifest: String(receipt.manifest || ''),
    apkSha256: String(receipt.apkSha256 || '').toUpperCase(),
    certificateSha256: expectedSigner,
    sourceSha,
    installedSha,
    secretsPrinted: false,
  };
}

export async function executePcAction(input, options = {}) {
  const started = Date.now();
  const action = String(input?.action || '');
  let data;
  let capabilityEvidence = null;
  if (action === 'shell_exec') {
    data = await runShell(input || {});
  } else if (action === 'task_list') {
    data = await listTigerIQTasks();
  } else if (action === 'android_worker_release_build') {
    data = await buildAndroidWorkerStableRelease();
  } else if (action === 'android_mobile_gate_c_start') {
    data = await startAndroidMobileGateC();
  } else if (action === 'android_mobile_gate_c_status') {
    data = await readAndroidMobileGateCStatus();
  } else if (['task_status', 'task_start', 'task_stop', 'task_restart'].includes(action)) {
    data = await runTaskAction(action, input?.taskName);
  } else if (action === 'process_list') {
    data = await spawnBounded('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeoutSec: 15 });
  } else if (action === 'tcp_probe') {
    data = await tcpProbe(input?.host, input?.port);
  } else if (action === 'file_read') {
    data = await readTextFile(input?.path);
  } else if (action === 'file_write') {
    data = await writeTextFile(input?.path, input?.content);
  } else if (action === 'file_list') {
    data = await listPath(input?.path);
  } else if (action === 'file_stat') {
    data = await statPath(input?.path);
  } else if (PAPERCLIP_LAB_ACTIONS.includes(action)) {
    const result = await executePaperclipLabAction(input || {}, { signal: options?.signal });
    data = result.data;
    capabilityEvidence = result.evidence;
  } else if (PAD_UI_ACTIONS.includes(action)) {
    data = await executePadUiAction(input || {});
  } else {
    throw new Error('TIGERIQ_PC_ACTION_NOT_ALLOWED');
  }
  return {
    ok: true,
    action,
    target: 'pc01-local',
    elapsedMs: Date.now() - started,
    data,
    evidence: {
      transport: 'local-process',
      shell: action === 'shell_exec',
      shellMode: action === 'shell_exec' ? 'strict-allowlist' : 'none',
      fileAccess: action.startsWith('file_'),
      allowedRoots: PC_OPERATOR_ROOTS,
      inheritedSecretEnvironment: false,
      destructiveDelete: false,
      taskListReadOnly: action === 'task_list',
      androidReleaseBuild: action === 'android_worker_release_build',
      androidGateC: action === 'android_mobile_gate_c_start' || action === 'android_mobile_gate_c_status',
      coreCredentialInternal: action === 'android_mobile_gate_c_start' || action === 'android_mobile_gate_c_status',
      taskListScope: action === 'task_list' ? 'TigerIQ only' : 'none',
      writeRoots: PC_WRITE_ROOTS,
      sourceWriteBlocked: true,
      sensitivePathsBlocked: true,
      productionMutationBlocked: true,
      interactiveUiBroker: PAD_UI_ACTIONS.includes(action),
      interactiveUiScope: PAD_UI_ACTIONS.includes(action) ? 'Power Automate Desktop only' : 'none',
      paperclipLabCapability: PAPERCLIP_LAB_ACTIONS.includes(action),
      paperclipLabScope: PAPERCLIP_LAB_ACTIONS.includes(action) ? 'D:\\TigerIQ-Paperclip-Lab + 127.0.0.1:3210 only' : 'none',
      ...(capabilityEvidence ? { paperclipLab: capabilityEvidence } : {}),
      arbitraryCoordinates: false,
    },
  };
}
