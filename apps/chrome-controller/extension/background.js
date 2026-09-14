const CONTROLLER = 'http://127.0.0.1:8798';
const ALLOWED_HOSTS = new Set(['chatgpt.com', 'gemini.google.com']);
let ticking = false;

async function getWorkerId() {
  const { workerId } = await chrome.storage.local.get('workerId');
  return workerId || null;
}

async function activeContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const win = await chrome.windows.getCurrent();
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find((d) => d.isPrimary) || displays[0];
  return {
    url: tab?.url || '',
    tabId: tab?.id,
    windowId: win.id,
    display: primary ? { workArea: primary.workArea } : undefined,
  };
}

async function post(path, data) {
  const response = await fetch(`${CONTROLLER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function heartbeat(workerId) {
  const ctx = await activeContext();
  await post('/api/heartbeat', { workerId, state: 'READY', ...ctx });
}

function allowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function waitForTabComplete(tabId, timeoutMs = 60000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('NAVIGATION_TIMEOUT'));
    }, timeoutMs);
    const listener = (changedTabId, info) => {
      if (changedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function execute(command) {
  const { action, payload = {} } = command;
  if (action === 'FOCUS') {
    const win = await chrome.windows.getCurrent();
    await chrome.windows.update(win.id, { focused: true });
    return { status: 'FOCUSED' };
  }
  if (action === 'LAYOUT') {
    const win = await chrome.windows.getCurrent();
    await chrome.windows.update(win.id, {
      left: Number(payload.left), top: Number(payload.top),
      width: Number(payload.width), height: Number(payload.height), focused: false,
    });
    return { status: 'LAYOUT_APPLIED' };
  }
  if (action === 'CLOSE_WINDOW') {
    const win = await chrome.windows.getCurrent();
    await chrome.windows.remove(win.id);
    return { status: 'WINDOW_CLOSED' };
  }
  if (action === 'NAVIGATE') {
    if (!allowedUrl(payload.url)) throw new Error('BLOCKED_URL');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('NO_ACTIVE_TAB');
    await chrome.tabs.update(tab.id, { url: payload.url });
    await waitForTabComplete(tab.id);
    return { status: 'NAVIGATED' };
  }
  if (action === 'DISPATCH') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !allowedUrl(tab.url || '')) throw new Error('BLOCKED_URL');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'TIGERIQ_DISPATCH', text: String(payload.text || '') });
    if (!response?.ok) {
      const reason = response?.status || 'DISPATCH_FAILED';
      const error = new Error(reason);
      error.status = reason;
      throw error;
    }
    return response;
  }
  throw new Error(`UNKNOWN_ACTION:${action}`);
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const workerId = await getWorkerId();
    if (!workerId) return;
    await heartbeat(workerId);
    const response = await fetch(`${CONTROLLER}/api/commands/${encodeURIComponent(workerId)}`);
    if (!response.ok) return;
    const { command } = await response.json();
    if (!command) return;
    try {
      const result = await execute(command);
      await post('/api/result', { workerId, commandId: command.id, ok: true, ...result });
    } catch (error) {
      const status = error?.status || String(error?.message || error);
      await post('/api/result', { workerId, commandId: command.id, ok: false, status });
    }
  } catch {
    // Controller may be offline; fail quiet and retry on next local tick.
  } finally {
    ticking = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create('tigeriqTick', { periodInMinutes: 0.5 });
  void tick();
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create('tigeriqTick', { periodInMinutes: 0.5 });
  void tick();
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'tigeriqTick') void tick(); });
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'TIGERIQ_CONFIG_UPDATED') void tick();
});
setInterval(() => void tick(), 7000);
void tick();
