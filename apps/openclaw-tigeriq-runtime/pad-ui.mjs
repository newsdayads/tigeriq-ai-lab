import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const win = path.win32;
export const PAD_UI_ACTIONS = Object.freeze([
  'pad_health',
  'pad_launch',
  'pad_windows',
  'pad_tree',
  'pad_invoke',
  'pad_set_value',
  'pad_click',
  'pad_keys',
]);
const PAD_UI_ACTION_SET = new Set(PAD_UI_ACTIONS);
export const PAD_UI_BROKER_ROOT = 'D:\\TigerIQ\\State\\pad-ui-broker';
const REQUESTS_DIR = win.join(PAD_UI_BROKER_ROOT, 'requests');
const RESPONSES_DIR = win.join(PAD_UI_BROKER_ROOT, 'responses');
const HEARTBEAT_PATH = win.join(PAD_UI_BROKER_ROOT, 'heartbeat.json');
const MAX_BROKER_WAIT_MS = 12000;
const MAX_V020_SIGNER_WAIT_MS = 130000;
const INTERNAL_V020_SIGNER_ACTION = 'pad_android_sign_v020';
const INTERNAL_NV07_SESSION_PING = 'nv07_native_session_ping';
const ALLOWED_KEYS = new Set(['ENTER', 'ESC', 'TAB', 'CTRL+A', 'CTRL+F', 'CTRL+N', 'CTRL+S', 'F5']);

function cleanText(value, max, label) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (text.length > max || /[\r\n\0]/.test(text)) throw new Error(label);
  return text;
}

export function assertPadUiRequest(raw = {}) {
  const action = String(raw.action || '');
  if (!PAD_UI_ACTION_SET.has(action)) throw new Error('TIGERIQ_PAD_ACTION_NOT_ALLOWED');
  const out = { action };
  if (raw.windowName !== undefined) out.windowName = cleanText(raw.windowName, 160, 'TIGERIQ_PAD_WINDOW_INVALID');
  else if (raw.windowTitle !== undefined) out.windowName = cleanText(raw.windowTitle, 160, 'TIGERIQ_PAD_WINDOW_INVALID');
  if (raw.processId !== undefined) {
    const pid = Number(raw.processId);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('TIGERIQ_PAD_PID_INVALID');
    out.processId = pid;
  }
  if (raw.pid !== undefined && out.processId === undefined) {
    const pid = Number(raw.pid);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('TIGERIQ_PAD_PID_INVALID');
    out.pid = pid;
  }
  if (raw.processName !== undefined) out.processName = cleanText(raw.processName, 100, 'TIGERIQ_PAD_SELECTOR_INVALID');
  if (raw.className !== undefined) out.className = cleanText(raw.className, 100, 'TIGERIQ_PAD_SELECTOR_INVALID');
  if (raw.name !== undefined) out.name = cleanText(raw.name, 200, 'TIGERIQ_PAD_SELECTOR_INVALID');
  if (raw.automationId !== undefined) out.automationId = cleanText(raw.automationId, 200, 'TIGERIQ_PAD_SELECTOR_INVALID');
  if (raw.controlType !== undefined) out.controlType = cleanText(raw.controlType, 80, 'TIGERIQ_PAD_SELECTOR_INVALID');
  if (raw.match !== undefined) {
    if (!['exact', 'contains'].includes(String(raw.match))) throw new Error('TIGERIQ_PAD_MATCH_INVALID');
    out.match = String(raw.match);
  }
  if (raw.index !== undefined) {
    const index = Number(raw.index);
    if (!Number.isInteger(index) || index < 0 || index > 20) throw new Error('TIGERIQ_PAD_INDEX_INVALID');
    out.index = index;
  }
  if (raw.maxResults !== undefined) {
    const n = Number(raw.maxResults);
    if (!Number.isInteger(n) || n < 1 || n > 400) throw new Error('TIGERIQ_PAD_MAX_RESULTS_INVALID');
    out.maxResults = n;
  }
  if (raw.value !== undefined) out.value = cleanText(raw.value, 500, 'TIGERIQ_PAD_VALUE_INVALID');
  if (raw.key !== undefined) {
    const key = String(raw.key || '').toUpperCase();
    if (!ALLOWED_KEYS.has(key)) throw new Error('TIGERIQ_PAD_KEY_NOT_ALLOWED');
    out.key = key;
  }
  if (['pad_invoke', 'pad_set_value', 'pad_click'].includes(action) && !out.name && !out.automationId && !out.className && !out.controlType) {
    throw new Error('TIGERIQ_PAD_SELECTOR_REQUIRED');
  }
  if (action === 'pad_set_value' && (!Object.hasOwn(out, 'value') || out.value === null)) throw new Error('TIGERIQ_PAD_VALUE_REQUIRED');
  if (action === 'pad_keys' && !out.key) throw new Error('TIGERIQ_PAD_KEY_REQUIRED');
  return out;
}

export function parsePadBrokerJson(text) {
  return JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''));
}

async function readJson(filePath) {
  return parsePadBrokerJson(await fs.readFile(filePath, 'utf8'));
}

export async function getPadUiBrokerHealth() {
  try {
    const heartbeat = await readJson(HEARTBEAT_PATH);
    const at = Date.parse(String(heartbeat?.at || ''));
    const ageMs = Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY;
    return {
      available: ageMs >= 0 && ageMs <= 5000,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      sessionId: heartbeat?.sessionId ?? null,
      user: heartbeat?.user ?? null,
      version: heartbeat?.version ?? null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { available: false, ageMs: null, sessionId: null, user: null, version: null };
    throw error;
  }
}

async function waitForResponse(responsePath, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { return await readJson(responsePath); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('TIGERIQ_PAD_BROKER_TIMEOUT');
}

async function executePadBrokerRequest(request, timeoutMs = MAX_BROKER_WAIT_MS) {
  const health = await getPadUiBrokerHealth();
  if (!health.available) throw new Error('TIGERIQ_PAD_BROKER_UNAVAILABLE');

  await fs.mkdir(REQUESTS_DIR, { recursive: true });
  await fs.mkdir(RESPONSES_DIR, { recursive: true });
  const id = randomUUID();
  const requestPath = win.join(REQUESTS_DIR, `request-${id}.json`);
  const responsePath = win.join(RESPONSES_DIR, `response-${id}.json`);
  const envelope = { schema: 'TIGERIQ_PAD_UI_REQUEST_V1', id, requestedAt: new Date().toISOString(), ...request };
  await fs.writeFile(requestPath, JSON.stringify(envelope), { encoding: 'utf8', flag: 'wx' });
  try {
    const response = await waitForResponse(responsePath, timeoutMs);
    if (response?.id !== id) throw new Error('TIGERIQ_PAD_BROKER_RESPONSE_MISMATCH');
    if (response?.ok !== true) throw new Error(String(response?.error || 'TIGERIQ_PAD_BROKER_ACTION_FAILED'));
    return { broker: health, result: response.data ?? null, completedAt: response.completedAt ?? null };
  } finally {
    await fs.unlink(requestPath).catch(() => {});
    await fs.unlink(responsePath).catch(() => {});
  }
}

export async function executePadUiAction(raw = {}) {
  const request = assertPadUiRequest(raw);
  if (request.action === 'pad_health') return await getPadUiBrokerHealth();
  return await executePadBrokerRequest(request);
}

export async function executePadV020Signer() {
  return await executePadBrokerRequest({ action: INTERNAL_V020_SIGNER_ACTION }, MAX_V020_SIGNER_WAIT_MS);
}

/**
 * Send a challenge to the *existing* Windows InteractiveToken PAD broker.
 * This verifies a real Core/SYSTEM -> user-session IPC round trip only.
 * OS process owner/session verification and scoped Core lease remain separate.
 */
export async function probeNv07NativeUserSession() {
  const nonce=randomUUID();
  try {
    const {broker,result}=await executePadBrokerRequest({
      action:INTERNAL_NV07_SESSION_PING,nonce,
    });
    const pid=Number(result?.pid);
    const sessionId=Number(result?.sessionId);
    const ready=result?.nonce===nonce && result?.windowsUser==='wdragons12x'
      && Number.isSafeInteger(pid) && pid>0
      && Number.isInteger(sessionId) && sessionId>0
      && Number(broker?.sessionId)===sessionId
      && String(broker?.user||'').toLowerCase()==='wdragons12x';
    return Object.freeze({
      ready,code:ready?'NV07_NATIVE_SESSION_IPC_RESPONDED':'NV07_NATIVE_SESSION_PROOF_INVALID',
      windowsUser:ready?'wdragons12x':null,
      sessionId:ready?sessionId:null,pid:ready?pid:null,
      attestationVerified:false,coreLeaseVerified:false,nv07Active:false,
    });
  } catch {
    return Object.freeze({ready:false,code:'NV07_NATIVE_SESSION_BROKER_UNAVAILABLE',
      attestationVerified:false,coreLeaseVerified:false,nv07Active:false});
  }
}
