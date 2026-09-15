import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, computePlacements, isWorkerEnabled, type ControllerConfig, type WorkerId, type WorkArea } from './model.js';
import { delay, SerialQueue } from './serial-queue.js';

type Command = { id: string; workerId: WorkerId; action: string; payload?: Record<string, unknown>; createdAt: string };
type Heartbeat = { workerId: WorkerId; url?: string; windowId?: number; state?: string; display?: { workArea?: WorkArea }; at: string };
type WorkerState = { id: WorkerId; enabled: boolean; status: string; blocked: boolean; lastHeartbeat?: Heartbeat; lastError?: string };

type Waiter = { workerId: WorkerId; resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout };

const config = loadConfig(process.argv[2]);
const uiQueue = new SerialQueue(config.pacing.minUiActionGapMs);
const launchQueue = new SerialQueue(config.pacing.betweenWorkerLaunchMs);
const states = new Map<WorkerId, WorkerState>(config.workers.map((w) => {
  const enabled = isWorkerEnabled(w);
  return [w.id, { id: w.id, enabled, status: enabled ? 'IDLE' : 'DISABLED', blocked: false }];
}));
const commandQueues = new Map<WorkerId, Command[]>(config.workers.map((w) => [w.id, []]));
const waiters = new Map<string, Waiter>();
let paused = false;
let killed = false;
let startAllRunning = false;

mkdirSync(config.logDir, { recursive: true });
const logPath = resolve(config.logDir, 'chrome-controller.jsonl');

function log(event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  appendFileSync(logPath, `${line}\n`, 'utf8');
  console.log(line);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function getWorker(id: string): ReturnType<ControllerConfig['workers']['find']> {
  return config.workers.find((w) => w.id === id);
}

function heartbeatFresh(state: WorkerState | undefined): boolean {
  const hb = state?.lastHeartbeat;
  return Boolean(hb && Date.now() - Date.parse(hb.at) < 60_000);
}

function recentHeartbeat(id: WorkerId): boolean {
  const state = states.get(id);
  return Boolean(state?.enabled && heartbeatFresh(state));
}

function assertWorkerEnabled(workerId: WorkerId): void {
  if (!states.get(workerId)?.enabled) throw new Error(`WORKER_DISABLED:${workerId}`);
}

function setWorkerEnabled(workerId: WorkerId, enabled: boolean): void {
  const state = states.get(workerId)!;
  if (state.enabled === enabled) return;
  state.enabled = enabled;
  if (!enabled) {
    commandQueues.get(workerId)!.splice(0);
    for (const [commandId, waiter] of waiters) {
      if (waiter.workerId !== workerId) continue;
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`WORKER_DISABLED:${workerId}`));
      waiters.delete(commandId);
    }
    state.status = 'DISABLED';
    state.lastError = undefined;
    log('WORKER_DISABLED', { workerId });
    return;
  }
  state.status = state.blocked ? 'BLOCKED' : heartbeatFresh(state) ? 'ONLINE' : 'IDLE';
  if (!state.blocked) state.lastError = undefined;
  log('WORKER_ENABLED', { workerId });
}

function effectiveWorkArea(): WorkArea | undefined {
  for (const id of ['NV02', 'NV03', 'NV04'] as WorkerId[]) {
    const state = states.get(id);
    if (!state?.enabled) continue;
    const area = state.lastHeartbeat?.display?.workArea;
    if (area?.width && area?.height) return area;
  }
  return undefined;
}

function launchChrome(workerId: WorkerId): void {
  assertWorkerEnabled(workerId);
  const worker = getWorker(workerId);
  if (!worker) throw new Error(`UNKNOWN_WORKER:${workerId}`);
  const placement = computePlacements(config, effectiveWorkArea())[workerId];
  const userDataDir = worker.userDataDir ?? config.userDataDir;
  const args: string[] = [];
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  args.push(`--profile-directory=${worker.profileDirectory}`);
  args.push('--new-window');
  args.push(`--window-position=${placement.left},${placement.top}`);
  args.push(`--window-size=${placement.width},${placement.height}`);
  args.push(worker.homeUrl);
  const child = spawn(config.chromePath, args, { detached: false, windowsHide: true, stdio: 'ignore' });
  child.unref();
  states.get(workerId)!.status = 'STARTING';
  log('CHROME_LAUNCH', { workerId, profileDirectory: worker.profileDirectory, placement });
}

async function waitForHeartbeat(workerId: WorkerId): Promise<void> {
  assertWorkerEnabled(workerId);
  const deadline = Date.now() + config.pacing.workerReadyTimeoutMs;
  while (Date.now() < deadline) {
    assertWorkerEnabled(workerId);
    if (recentHeartbeat(workerId)) return;
    await delay(1_000);
  }
  throw new Error(`WORKER_HEARTBEAT_TIMEOUT:${workerId}`);
}

function sendCommand(workerId: WorkerId, action: string, payload?: Record<string, unknown>): Promise<unknown> {
  const state = states.get(workerId)!;
  assertWorkerEnabled(workerId);
  if (killed) return Promise.reject(new Error('CONTROLLER_KILLED'));
  if (paused) return Promise.reject(new Error('CONTROLLER_PAUSED'));
  if (state.blocked && !['FOCUS', 'LAYOUT'].includes(action)) return Promise.reject(new Error(`WORKER_BLOCKED:${workerId}`));
  const command: Command = { id: randomUUID(), workerId, action, payload, createdAt: new Date().toISOString() };
  commandQueues.get(workerId)!.push(command);
  log('COMMAND_QUEUED', { workerId, commandId: command.id, action });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(command.id);
      reject(new Error(`COMMAND_TIMEOUT:${action}:${workerId}`));
    }, config.pacing.commandTimeoutMs);
    waiters.set(command.id, { workerId, resolve, reject, timer });
  });
}

async function runWithRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.pacing.maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      log('ACTION_RETRY', { label, attempt, error: String(error) });
      if (attempt < config.pacing.maxRetries) await delay(config.pacing.retryBackoffMs * (attempt + 1));
    }
  }
  throw lastError;
}

async function layoutWorker(workerId: WorkerId): Promise<unknown> {
  assertWorkerEnabled(workerId);
  const placement = computePlacements(config, effectiveWorkArea())[workerId];
  return uiQueue.enqueue(() => runWithRetry(`layout:${workerId}`, () => sendCommand(workerId, 'LAYOUT', placement as unknown as Record<string, unknown>)));
}

async function startWorker(workerId: WorkerId): Promise<void> {
  assertWorkerEnabled(workerId);
  await launchQueue.enqueue(async () => {
    assertWorkerEnabled(workerId);
    if (!recentHeartbeat(workerId)) launchChrome(workerId);
    await waitForHeartbeat(workerId);
    await delay(config.pacing.postReadySettlingMs);
    assertWorkerEnabled(workerId);
    await layoutWorker(workerId);
    states.get(workerId)!.status = 'READY';
    log('WORKER_READY', { workerId });
  });
}

async function dispatch(workerId: WorkerId, text: string, navigate: boolean): Promise<unknown> {
  assertWorkerEnabled(workerId);
  if (!text.trim()) throw new Error('DISPATCH_TEXT_REQUIRED');
  const worker = getWorker(workerId)!;
  states.get(workerId)!.status = 'DISPATCHING';
  return uiQueue.enqueue(async () => {
    try {
      assertWorkerEnabled(workerId);
      if (navigate) await runWithRetry(`navigate:${workerId}`, () => sendCommand(workerId, 'NAVIGATE', { url: worker.homeUrl }));
      const result = await runWithRetry(`dispatch:${workerId}`, () => sendCommand(workerId, 'DISPATCH', { text }));
      states.get(workerId)!.status = 'SUBMITTED';
      log('WORK_ORDER_SUBMITTED', { workerId, chars: text.length });
      return result;
    } catch (error) {
      const state = states.get(workerId)!;
      if (state.enabled) state.status = 'ERROR';
      state.lastError = String(error);
      throw error;
    }
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'OPTIONS') { json(res, 204, {}); return true; }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    json(res, 200, { paused, killed, startAllRunning, workers: [...states.values()] }); return true;
  }
  if (url.pathname === '/api/heartbeat' && req.method === 'POST') {
    const data = await body(req);
    const workerId = data.workerId as WorkerId;
    if (!getWorker(workerId)) { json(res, 400, { ok: false, error: 'UNKNOWN_WORKER' }); return true; }
    const state = states.get(workerId)!;
    const hb: Heartbeat = { ...(data as unknown as Heartbeat), workerId, at: new Date().toISOString() };
    state.lastHeartbeat = hb;
    if (!state.enabled) {
      state.status = 'DISABLED';
      json(res, 200, { ok: true, enabled: false }); return true;
    }
    if (state.status === 'IDLE' || state.status === 'STARTING') state.status = 'ONLINE';
    json(res, 200, { ok: true, enabled: true }); return true;
  }
  if (url.pathname.startsWith('/api/commands/') && req.method === 'GET') {
    const workerId = decodeURIComponent(url.pathname.split('/').pop()!) as WorkerId;
    if (!getWorker(workerId)) { json(res, 404, { ok: false }); return true; }
    if (!states.get(workerId)!.enabled) {
      json(res, 200, { command: null, disabled: true, error: `WORKER_DISABLED:${workerId}` }); return true;
    }
    json(res, 200, { command: commandQueues.get(workerId)!.shift() ?? null }); return true;
  }
  if (url.pathname === '/api/result' && req.method === 'POST') {
    const data = await body(req);
    const commandId = String(data.commandId ?? '');
    const workerId = data.workerId as WorkerId;
    const waiter = waiters.get(commandId);
    if (String(data.status ?? '').startsWith('BLOCKED')) {
      const state = states.get(workerId);
      if (state) {
        state.blocked = true;
        if (state.enabled) state.status = 'BLOCKED';
        state.lastError = String(data.status);
      }
    }
    if (waiter) {
      clearTimeout(waiter.timer);
      waiters.delete(commandId);
      if (data.ok === false) waiter.reject(new Error(String(data.status ?? data.error ?? 'COMMAND_FAILED'))); else waiter.resolve(data);
    }
    log('COMMAND_RESULT', { workerId, commandId, ok: data.ok, status: data.status });
    json(res, 200, { ok: true }); return true;
  }
  if (url.pathname === '/api/start-all' && req.method === 'POST') {
    if (startAllRunning) { json(res, 409, { ok: false, error: 'START_ALL_ALREADY_RUNNING' }); return true; }
    startAllRunning = true;
    void (async () => {
      try {
        for (const worker of config.workers) {
          if (!states.get(worker.id)!.enabled) {
            log('START_ALL_SKIPPED_DISABLED', { workerId: worker.id });
            continue;
          }
          await startWorker(worker.id);
        }
      }
      catch (error) { log('START_ALL_FAILED', { error: String(error) }); }
      finally { startAllRunning = false; }
    })();
    json(res, 202, { ok: true }); return true;
  }
  if (url.pathname === '/api/pause' && req.method === 'POST') { paused = true; log('PAUSE'); json(res, 200, { ok: true }); return true; }
  if (url.pathname === '/api/resume' && req.method === 'POST') { paused = false; killed = false; log('RESUME'); json(res, 200, { ok: true }); return true; }
  if (url.pathname === '/api/kill' && req.method === 'POST') {
    killed = true; paused = true;
    for (const queue of commandQueues.values()) queue.splice(0);
    log('KILL_SWITCH'); json(res, 200, { ok: true }); return true;
  }

  const match = url.pathname.match(/^\/api\/workers\/(NV02|NV03|NV04)\/(start|focus|layout|dispatch|close|unblock|enable|disable)$/);
  if (match && req.method === 'POST') {
    const workerId = match[1] as WorkerId;
    const action = match[2];
    try {
      if (action === 'enable') setWorkerEnabled(workerId, true);
      else if (action === 'disable') setWorkerEnabled(workerId, false);
      else {
        assertWorkerEnabled(workerId);
        if (action === 'start') await startWorker(workerId);
        else if (action === 'focus') await uiQueue.enqueue(() => sendCommand(workerId, 'FOCUS'));
        else if (action === 'layout') await layoutWorker(workerId);
        else if (action === 'close') await uiQueue.enqueue(() => sendCommand(workerId, 'CLOSE_WINDOW'));
        else if (action === 'unblock') { states.get(workerId)!.blocked = false; states.get(workerId)!.status = 'READY'; states.get(workerId)!.lastError = undefined; }
        else if (action === 'dispatch') {
          const data = await body(req);
          await dispatch(workerId, String(data.text ?? ''), data.navigate !== false);
        }
      }
      json(res, 200, { ok: true, enabled: states.get(workerId)!.enabled });
    } catch (error) { json(res, 409, { ok: false, error: String(error) }); }
    return true;
  }
  return false;
}

const dashboardPath = resolve(process.cwd(), 'apps/chrome-controller/public/index.html');
const dashboard = readFileSync(dashboardPath, 'utf8');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${config.host}:${config.port}`);
    if (await handleApi(req, res, url)) return;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(dashboard); return;
    }
    json(res, 404, { ok: false, error: 'NOT_FOUND' });
  } catch (error) {
    log('HTTP_ERROR', { error: String(error) });
    json(res, 500, { ok: false, error: String(error) });
  }
});

server.listen(config.port, config.host, () => log('CONTROLLER_READY', { host: config.host, port: config.port, logPath }));