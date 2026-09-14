import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, computePlacements, isWorkerEnabled, WORKER_IDS, type ControllerConfig, type WorkerId, type WorkArea } from './model.js';
import { delay, SerialQueue } from './serial-queue.js';
import { AUTO_CONTINUE, decideAutoContinue, freshAutopilotState, validateExternalSnapshot, type DurableAutopilotState, type ExternalAutopilotSnapshot } from './autopilot.js';
import { buildRuntimeEvidence } from './runtime-evidence.js';

type Command = { id: string; workerId: WorkerId; action: string; payload?: Record<string, unknown>; createdAt: string };
type Heartbeat = { workerId: WorkerId; url?: string; windowId?: number; state?: string; display?: { workArea?: WorkArea }; at: string };
type WorkerState = { id: WorkerId; enabled: boolean; status: string; blocked: boolean; lastHeartbeat?: Heartbeat; lastError?: string };
type Waiter = { workerId: WorkerId; resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout };

const config = loadConfig(process.argv[2]);
const uiQueue = new SerialQueue(config.pacing.minUiActionGapMs);
const launchQueue = new SerialQueue(config.pacing.betweenWorkerLaunchMs);
const states = new Map<WorkerId, WorkerState>(config.workers.map((worker) => {
  const enabled = isWorkerEnabled(worker);
  return [worker.id, { id: worker.id, enabled, status: enabled ? 'IDLE' : 'DISABLED', blocked: false }];
}));
const commandQueues = new Map<WorkerId, Command[]>(config.workers.map((worker) => [worker.id, []]));
const waiters = new Map<string, Waiter>();
const recoveryAttempts = new Map<WorkerId, number>(WORKER_IDS.map((id) => [id, 0]));
const recoveryInFlight = new Set<WorkerId>();
let paused = false;
let killed = false;
let startAllRunning = false;
let autopilotTicking = false;
let recoveryTicking = false;
let startupReady = false;

mkdirSync(config.logDir, { recursive: true });
const logPath = resolve(config.logDir, 'chrome-controller.jsonl');
const autopilotStatePath = resolve(config.logDir, 'autopilot-state.json');
const autopilotSnapshotPath = resolve(config.logDir, 'autopilot-snapshot.json');
const runtimeEvidencePath = resolve(config.logDir, 'runtime-evidence.json');

function log(event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  appendFileSync(logPath, `${line}\n`, 'utf8');
  console.log(line);
}

function atomicJson(path: string, value: unknown): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function loadJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
  catch (error) { log('DURABLE_STATE_READ_FAILED', { path, error: String(error) }); return undefined; }
}

let autopilotState: DurableAutopilotState = loadJson<DurableAutopilotState>(autopilotStatePath) ?? freshAutopilotState();
let latestSnapshot: ExternalAutopilotSnapshot | undefined;
try {
  const durableSnapshot = loadJson<ExternalAutopilotSnapshot>(autopilotSnapshotPath);
  if (durableSnapshot) latestSnapshot = validateExternalSnapshot(durableSnapshot);
} catch (error) { log('AUTOPILOT_SNAPSHOT_RESTORE_REJECTED', { error: String(error) }); }

function persistAutopilotState(): void { atomicJson(autopilotStatePath, autopilotState); }
function setAutopilotPhase(phase: DurableAutopilotState['phase']): void {
  if (autopilotState.phase === phase) return;
  autopilotState = { ...autopilotState, phase, updatedAt: new Date().toISOString() };
  persistAutopilotState();
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

function getWorker(id: string): ReturnType<ControllerConfig['workers']['find']> { return config.workers.find((worker) => worker.id === id); }

function heartbeatFresh(state: WorkerState | undefined): boolean {
  const hb = state?.lastHeartbeat;
  return Boolean(hb && Date.now() - Date.parse(hb.at) < config.recovery.heartbeatStaleMs);
}
function recentHeartbeat(id: WorkerId): boolean { const state = states.get(id); return Boolean(state?.enabled && heartbeatFresh(state)); }
function assertWorkerEnabled(workerId: WorkerId): void { if (!states.get(workerId)?.enabled) throw new Error(`WORKER_DISABLED:${workerId}`); }

function setWorkerEnabled(workerId: WorkerId, enabled: boolean): void {
  const state = states.get(workerId)!;
  if (state.enabled === enabled) return;
  state.enabled = enabled;
  recoveryAttempts.set(workerId, 0);
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
  for (const id of WORKER_IDS) {
    const state = states.get(id);
    if (!state?.enabled) continue;
    const area = state.lastHeartbeat?.display?.workArea;
    if (area?.width && area?.height) return area;
  }
  return undefined;
}

function runtimeEvidence() {
  const attempts = Object.fromEntries([...recoveryAttempts.entries()]) as Partial<Record<WorkerId, number>>;
  return buildRuntimeEvidence({
    config,
    workArea: effectiveWorkArea(),
    workers: [...states.values()],
    autopilot: autopilotState,
    snapshot: latestSnapshot,
    paused,
    killed,
    recoveryAttempts: attempts,
    startupReady,
  });
}
function persistRuntimeEvidence(): ReturnType<typeof runtimeEvidence> {
  const evidence = runtimeEvidence();
  atomicJson(runtimeEvidencePath, evidence);
  return evidence;
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
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      waiters.delete(command.id);
      rejectPromise(new Error(`COMMAND_TIMEOUT:${action}:${workerId}`));
    }, config.pacing.commandTimeoutMs);
    waiters.set(command.id, { workerId, resolve: resolvePromise, reject: rejectPromise, timer });
  });
}

async function runWithRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.pacing.maxRetries; attempt += 1) {
    try { return await task(); }
    catch (error) {
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
    recoveryAttempts.set(workerId, 0);
    log('WORKER_READY', { workerId });
    persistRuntimeEvidence();
  });
}

async function dispatch(workerId: WorkerId, text: string, navigate: boolean, action = 'DISPATCH'): Promise<unknown> {
  assertWorkerEnabled(workerId);
  if (!text.trim()) throw new Error('DISPATCH_TEXT_REQUIRED');
  const worker = getWorker(workerId)!;
  states.get(workerId)!.status = action === AUTO_CONTINUE ? 'AUTOPILOT_DISPATCHING' : 'DISPATCHING';
  return uiQueue.enqueue(async () => {
    try {
      assertWorkerEnabled(workerId);
      if (navigate) await runWithRetry(`navigate:${workerId}`, () => sendCommand(workerId, 'NAVIGATE', { url: worker.homeUrl }));
      const result = await runWithRetry(`${action.toLowerCase()}:${workerId}`, () => sendCommand(workerId, action, { text }));
      states.get(workerId)!.status = 'SUBMITTED';
      log(action === AUTO_CONTINUE ? 'AUTO_CONTINUE_SUBMITTED' : 'WORK_ORDER_SUBMITTED', { workerId, chars: text.length });
      persistRuntimeEvidence();
      return result;
    } catch (error) {
      const state = states.get(workerId)!;
      if (state.enabled) state.status = 'ERROR';
      state.lastError = String(error);
      throw error;
    }
  });
}

function snapshotRequiredWorkers(): WorkerId[] { return latestSnapshot?.requiredWorkers?.filter((id) => states.get(id)?.enabled) ?? []; }
function workerNeeded(workerId: WorkerId): boolean {
  if (workerId === 'NV05') return true;
  return snapshotRequiredWorkers().includes(workerId);
}

async function fetchExternalSnapshot(): Promise<void> {
  if (!config.autopilot.stateUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.autopilot.requestTimeoutMs);
  try {
    const response = await fetch(config.autopilot.stateUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const snapshot = validateExternalSnapshot(await response.json());
    latestSnapshot = snapshot;
    atomicJson(autopilotSnapshotPath, snapshot);
    log('AUTOPILOT_SNAPSHOT_PULLED', { source: snapshot.source, revision: snapshot.revision ?? null });
  } finally { clearTimeout(timer); }
}

async function autopilotTick(): Promise<void> {
  if (autopilotTicking || !config.autopilot.enabled || paused || killed) return;
  autopilotTicking = true;
  try {
    if (config.autopilot.stateUrl) {
      try { await fetchExternalSnapshot(); }
      catch (error) { log('AUTOPILOT_EXTERNAL_STATE_UNAVAILABLE', { error: String(error) }); }
    }
    if (!latestSnapshot) { setAutopilotPhase('IDLE'); persistRuntimeEvidence(); return; }

    const previous = latestSnapshot.previousJob;
    if (previous && previous.jobId === autopilotState.lastDispatchedJobId && ['DONE','FAILED','BLOCKED','CANCELLED'].includes(previous.status)) {
      const evidence = previous.evidence?.find((item) => ['GITHUB','CORE'].includes(item.source) && Boolean(item.ref?.trim()));
      if (evidence && autopilotState.lastCompletedJobId !== previous.jobId) {
        autopilotState = { ...autopilotState, lastCompletedJobId: previous.jobId, lastEvidenceRef: evidence.ref, updatedAt: new Date().toISOString() };
        persistAutopilotState();
        log('COMPLETION_WATCHER_TERMINAL_EVIDENCE', { jobId: previous.jobId, evidenceRef: evidence.ref, source: evidence.source });
      }
    }

    const decision = decideAutoContinue(latestSnapshot, autopilotState);
    if (decision.kind === 'IDLE') { setAutopilotPhase('IDLE'); persistRuntimeEvidence(); return; }
    if (decision.kind === 'BUSY' || decision.kind === 'DUPLICATE_NOOP') { setAutopilotPhase('BUSY'); persistRuntimeEvidence(); return; }
    if (decision.kind === 'WAIT_EVIDENCE') { setAutopilotPhase('WAIT_EVIDENCE'); persistRuntimeEvidence(); return; }
    if (decision.kind === 'STOP') { setAutopilotPhase('STOPPED'); log('AUTOPILOT_STOP', { reason: decision.reason }); persistRuntimeEvidence(); return; }

    const nv05 = states.get('NV05')!;
    if (!nv05.enabled || nv05.blocked || !startupReady) { setAutopilotPhase(nv05.blocked ? 'STOPPED' : 'RECOVERING'); persistRuntimeEvidence(); return; }
    if (!recentHeartbeat('NV05')) { setAutopilotPhase('RECOVERING'); persistRuntimeEvidence(); return; }

    autopilotState = {
      ...autopilotState,
      phase: 'BUSY',
      lastDispatchedJobId: decision.jobId,
      lastEvidenceRef: decision.evidenceRef ?? autopilotState.lastEvidenceRef,
      lastTrigger: AUTO_CONTINUE,
      updatedAt: new Date().toISOString(),
    };
    persistAutopilotState();
    log('AUTO_CONTINUE_RESERVED', { jobId: decision.jobId, trigger: AUTO_CONTINUE, evidenceRef: decision.evidenceRef ?? null });
    try { await dispatch('NV05', decision.text, true, AUTO_CONTINUE); }
    catch (error) {
      setAutopilotPhase('STOPPED');
      log('AUTO_CONTINUE_FAILED_CLOSED', { jobId: decision.jobId, error: String(error) });
    }
    persistRuntimeEvidence();
  } finally { autopilotTicking = false; }
}

async function recoverWorker(workerId: WorkerId): Promise<void> {
  const state = states.get(workerId)!;
  if (!state.enabled || state.blocked || paused || killed || !startupReady || recoveryInFlight.has(workerId)) return;
  if (!workerNeeded(workerId)) return;
  const attempts = recoveryAttempts.get(workerId) ?? 0;
  if (attempts >= config.recovery.maxReopenAttempts) {
    state.status = 'RECOVERY_EXHAUSTED';
    state.lastError = `RECOVERY_EXHAUSTED:${workerId}`;
    log('RECOVERY_EXHAUSTED', { workerId, attempts });
    persistRuntimeEvidence();
    return;
  }
  recoveryInFlight.add(workerId);
  recoveryAttempts.set(workerId, attempts + 1);
  state.status = 'RECOVERING';
  if (workerId === 'NV05') setAutopilotPhase('RECOVERING');
  log('RECOVERY_REOPEN_SCHEDULED', { workerId, attempt: attempts + 1 });
  try {
    await delay(config.recovery.reopenBackoffMs);
    await startWorker(workerId);
    log('RECOVERY_REOPEN_OK', { workerId, attempt: attempts + 1 });
  } catch (error) {
    state.status = 'RECOVERY_ERROR';
    state.lastError = String(error);
    log('RECOVERY_REOPEN_FAILED', { workerId, attempt: attempts + 1, error: String(error) });
  } finally {
    recoveryInFlight.delete(workerId);
    persistRuntimeEvidence();
  }
}

async function recoveryTick(): Promise<void> {
  if (recoveryTicking || paused || killed || !startupReady) return;
  recoveryTicking = true;
  try {
    for (const workerId of WORKER_IDS) {
      const state = states.get(workerId)!;
      if (!state.enabled || state.blocked || !workerNeeded(workerId)) continue;
      if (!recentHeartbeat(workerId)) void recoverWorker(workerId);
    }
  } finally { recoveryTicking = false; }
}

async function waitForStartupRuntime(): Promise<boolean> {
  const url = config.recovery.startupReadyUrl;
  if (!url) return true;
  const deadline = Date.now() + config.recovery.startupReadyTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return true;
    } catch { /* bounded retry while local runtime/network starts */ }
    await delay(3_000);
  }
  return false;
}

async function startupRecovery(): Promise<void> {
  startupReady = await waitForStartupRuntime();
  if (!startupReady) {
    log('STARTUP_RUNTIME_WAIT_TIMEOUT', { url: config.recovery.startupReadyUrl ?? null, timeoutMs: config.recovery.startupReadyTimeoutMs });
    persistRuntimeEvidence();
    return;
  }
  log('STARTUP_RUNTIME_READY', { url: config.recovery.startupReadyUrl ?? null });
  const needed = new Set<WorkerId>(['NV05', ...snapshotRequiredWorkers()]);
  for (const workerId of WORKER_IDS) {
    if (!needed.has(workerId) || !states.get(workerId)?.enabled || states.get(workerId)?.blocked) continue;
    try { await startWorker(workerId); }
    catch (error) { log('STARTUP_WORKER_RECOVERY_FAILED', { workerId, error: String(error) }); }
  }
  persistRuntimeEvidence();
  void autopilotTick();
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'OPTIONS') { json(res, 204, {}); return true; }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    json(res, 200, { paused, killed, startAllRunning, startupReady, autopilot: autopilotState, recovery: { attempts: Object.fromEntries(recoveryAttempts), maxReopenAttempts: config.recovery.maxReopenAttempts }, evidencePath: runtimeEvidencePath, workers: [...states.values()] }); return true;
  }
  if (url.pathname === '/api/evidence' && req.method === 'GET') { json(res, 200, persistRuntimeEvidence()); return true; }
  if (url.pathname === '/api/autopilot/state' && req.method === 'GET') { json(res, 200, { state: autopilotState, snapshot: latestSnapshot ?? null }); return true; }
  if (url.pathname === '/api/autopilot/snapshot' && req.method === 'POST') {
    try {
      const snapshot = validateExternalSnapshot(await body(req));
      latestSnapshot = snapshot;
      atomicJson(autopilotSnapshotPath, snapshot);
      log('AUTOPILOT_SNAPSHOT_ACCEPTED', { source: snapshot.source, revision: snapshot.revision ?? null, nextJobId: snapshot.nextJob?.jobId ?? null });
      persistRuntimeEvidence();
      void autopilotTick();
      json(res, 202, { ok: true });
    } catch (error) { json(res, 400, { ok: false, error: String(error) }); }
    return true;
  }
  if (url.pathname === '/api/heartbeat' && req.method === 'POST') {
    const data = await body(req);
    const workerId = data.workerId as WorkerId;
    if (!getWorker(workerId)) { json(res, 400, { ok: false, error: 'UNKNOWN_WORKER' }); return true; }
    const state = states.get(workerId)!;
    const hb: Heartbeat = { ...(data as unknown as Heartbeat), workerId, at: new Date().toISOString() };
    state.lastHeartbeat = hb;
    recoveryAttempts.set(workerId, 0);
    if (!state.enabled) { state.status = 'DISABLED'; json(res, 200, { ok: true, enabled: false }); return true; }
    if (['IDLE','STARTING','RECOVERING','RECOVERY_ERROR'].includes(state.status)) state.status = 'ONLINE';
    json(res, 200, { ok: true, enabled: true }); return true;
  }
  if (url.pathname.startsWith('/api/commands/') && req.method === 'GET') {
    const workerId = decodeURIComponent(url.pathname.split('/').pop()!) as WorkerId;
    if (!getWorker(workerId)) { json(res, 404, { ok: false }); return true; }
    if (!states.get(workerId)!.enabled) { json(res, 200, { command: null, disabled: true, error: `WORKER_DISABLED:${workerId}` }); return true; }
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
      if (workerId === 'NV05') setAutopilotPhase('STOPPED');
      log('SECURITY_STOP', { workerId, status: data.status });
    }
    if (waiter) {
      clearTimeout(waiter.timer);
      waiters.delete(commandId);
      if (data.ok === false) waiter.reject(new Error(String(data.status ?? data.error ?? 'COMMAND_FAILED'))); else waiter.resolve(data);
    }
    log('COMMAND_RESULT', { workerId, commandId, ok: data.ok, status: data.status });
    persistRuntimeEvidence();
    json(res, 200, { ok: true }); return true;
  }
  if (url.pathname === '/api/start-all' && req.method === 'POST') {
    if (startAllRunning) { json(res, 409, { ok: false, error: 'START_ALL_ALREADY_RUNNING' }); return true; }
    startAllRunning = true;
    void (async () => {
      try {
        for (const worker of config.workers) {
          if (!states.get(worker.id)!.enabled) { log('START_ALL_SKIPPED_DISABLED', { workerId: worker.id }); continue; }
          await startWorker(worker.id);
        }
      } catch (error) { log('START_ALL_FAILED', { error: String(error) }); }
      finally { startAllRunning = false; persistRuntimeEvidence(); }
    })();
    json(res, 202, { ok: true }); return true;
  }
  if (url.pathname === '/api/pause' && req.method === 'POST') { paused = true; log('PAUSE'); persistRuntimeEvidence(); json(res, 200, { ok: true }); return true; }
  if (url.pathname === '/api/resume' && req.method === 'POST') { paused = false; killed = false; log('RESUME'); persistRuntimeEvidence(); void autopilotTick(); json(res, 200, { ok: true }); return true; }
  if (url.pathname === '/api/kill' && req.method === 'POST') {
    killed = true; paused = true;
    for (const queue of commandQueues.values()) queue.splice(0);
    log('KILL_SWITCH'); persistRuntimeEvidence(); json(res, 200, { ok: true }); return true;
  }

  const match = url.pathname.match(/^\/api\/workers\/(NV03|NV04|NV05)\/(start|focus|layout|dispatch|close|unblock|enable|disable)$/);
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
        else if (action === 'unblock') { states.get(workerId)!.blocked = false; states.get(workerId)!.status = recentHeartbeat(workerId) ? 'READY' : 'IDLE'; states.get(workerId)!.lastError = undefined; recoveryAttempts.set(workerId, 0); }
        else if (action === 'dispatch') {
          const data = await body(req);
          await dispatch(workerId, String(data.text ?? ''), data.navigate !== false);
        }
      }
      persistRuntimeEvidence();
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
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(dashboard); return; }
    json(res, 404, { ok: false, error: 'NOT_FOUND' });
  } catch (error) {
    log('HTTP_ERROR', { error: String(error) });
    json(res, 500, { ok: false, error: String(error) });
  }
});

server.listen(config.port, config.host, () => {
  log('CONTROLLER_READY', { host: config.host, port: config.port, logPath, workerOrder: WORKER_IDS, fixedTrigger: AUTO_CONTINUE });
  persistRuntimeEvidence();
  void startupRecovery();
});
setInterval(() => void autopilotTick(), config.autopilot.pollIntervalMs).unref();
setInterval(() => void recoveryTick(), config.recovery.checkIntervalMs).unref();
