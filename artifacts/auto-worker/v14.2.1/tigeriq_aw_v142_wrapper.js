'use strict';
/* TIQ142_WRAPPER — TEST CANDIDATE / PHYSICAL PENDING */
(() => {
  const VERSION = '14.2.1';
  const EXTENSION_ID = 'leidfhbpdillakmcbijagelghhilbnpc';
  const LEGACY_REL = '__LEGACY_REL__';
  const TOKEN_TTL_MS = 90000;
  const expectedTabs = new Map();
  const expectedWindows = new Map();
  const recentlyClosedManagedTabs = new Map();
  const recentlyClosedManagedWindows = new Map();
  let managedWindowId = null;
  let managedTabId = null;

  const purge = (map) => {
    const t = Date.now();
    for (const [id, expires] of map.entries()) if (expires <= t) map.delete(id);
  };
  const mark = (map, id) => { if (Number.isInteger(Number(id))) map.set(Number(id), Date.now() + TOKEN_TTL_MS); };
  const consume = (map, id) => { purge(map); id = Number(id); if (!map.has(id)) return false; map.delete(id); return true; };
  const isChatUrl = (u) => typeof u === 'string' && /^https:\/\/chatgpt\.com\//i.test(u);
  const urlsOf = (x) => Array.isArray(x) ? x : (x == null ? [] : [x]);

  const realWindowCreate = chrome.windows.create.bind(chrome.windows);
  const realWindowGet = chrome.windows.get.bind(chrome.windows);
  const realWindowRemove = chrome.windows.remove.bind(chrome.windows);
  const realWindowsOnRemovedAdd = chrome.windows.onRemoved.addListener.bind(chrome.windows.onRemoved);
  const realTabCreate = chrome.tabs.create.bind(chrome.tabs);
  const realTabGet = chrome.tabs.get.bind(chrome.tabs);
  const realTabQuery = chrome.tabs.query.bind(chrome.tabs);
  const realTabRemove = chrome.tabs.remove.bind(chrome.tabs);
  const realTabsOnRemovedAdd = chrome.tabs.onRemoved.addListener.bind(chrome.tabs.onRemoved);

  const stateReady = (async () => {
    try {
      const s = await chrome.storage.local.get(['tigeriq_v142_managed_window_id','tigeriq_v142_managed_tab_id']);
      if (Number.isInteger(Number(s.tigeriq_v142_managed_window_id))) {
        try {
          const w = await realWindowGet(Number(s.tigeriq_v142_managed_window_id), { populate: true });
          managedWindowId = w.id;
          const chatTab = (w.tabs || []).find(t => isChatUrl(t.url));
          managedTabId = chatTab?.id ?? (Number(s.tigeriq_v142_managed_tab_id) || null);
        } catch (_) {
          await chrome.storage.local.remove(['tigeriq_v142_managed_window_id','tigeriq_v142_managed_tab_id']);
        }
      }
      await chrome.storage.local.set({
        tigeriq_v142_candidate_version: VERSION,
        tigeriq_v142_activation_state: 'PRE_ACTIVATION',
        tigeriq_v142_active_background_employees: ['NV02'],
        tigeriq_v142_nv04_state: 'PENDING_OWNER_ACTIVATION',
        tigeriq_v142_nv05_state: 'COMMAND_PENDING_ACTIVATION'
      });
    } catch (e) {
      console.error('[TIQ142] state init failed', e);
    }
  })();

  function isManagedWindowCreate(data) {
    if (!data || typeof data !== 'object') return false;
    const urls = urlsOf(data.url);
    return data.type === 'popup' || urls.some(isChatUrl);
  }

  async function primaryWorkArea() {
    const displays = await chrome.system.display.getInfo();
    const d = (displays || []).find(x => x.isPrimary) || (displays || [])[0];
    if (!d || !d.workArea) throw new Error('DISPLAY_WORKAREA_UNAVAILABLE');
    const wa = d.workArea;
    const width = 504, height = 834, top = Number(wa.top) + 5, left = Number(wa.left) + Number(wa.width) - 5 - width;
    if (left < Number(wa.left) || top < Number(wa.top) || left + width > Number(wa.left) + Number(wa.width) || top + height > Number(wa.top) + Number(wa.height)) {
      throw new Error('DISPLAY_WORKAREA_INSUFFICIENT');
    }
    return { left, top, width, height };
  }

  async function createManagedWindow(data) {
    await stateReady;
    if (managedWindowId != null) {
      try {
        await realWindowGet(managedWindowId);
        throw new Error('PREACTIVATION_ONLY_NV02_WINDOW_ALLOWED');
      } catch (e) {
        if (String(e?.message || e).includes('PREACTIVATION_ONLY_NV02')) throw e;
        managedWindowId = null; managedTabId = null;
      }
    }
    const bounds = await primaryWorkArea();
    const createData = Object.assign({}, data, bounds, { type: data.type || 'popup', focused: data.focused !== false });
    const w = await realWindowCreate(createData);
    managedWindowId = w?.id ?? null;
    const chatTab = (w?.tabs || []).find(t => isChatUrl(t.url));
    managedTabId = chatTab?.id ?? (w?.tabs || [])[0]?.id ?? null;
    await chrome.storage.local.set({ tigeriq_v142_managed_window_id: managedWindowId, tigeriq_v142_managed_tab_id: managedTabId });
    return w;
  }

  chrome.windows.create = function(data, callback) {
    if (!isManagedWindowCreate(data)) return realWindowCreate(data, callback);
    const p = createManagedWindow(data);
    if (typeof callback === 'function') { p.then(callback).catch(e => { console.error('[TIQ142] managed create blocked', e); callback(undefined); }); return; }
    return p;
  };

  chrome.windows.remove = function(windowId, callback) {
    const p = (async () => {
      await stateReady;
      mark(expectedWindows, windowId);
      return realWindowRemove(windowId);
    })();
    if (typeof callback === 'function') { p.then(() => callback()).catch(e => { console.error('[TIQ142] expected window close failed', e); callback(); }); return; }
    return p;
  };

  chrome.tabs.remove = function(tabIds, callback) {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    const p = (async () => {
      await stateReady;
      for (const id of ids) {
        mark(expectedTabs, id);
        try {
          const tab = await realTabGet(Number(id));
          if (tab?.windowId != null && Number(id) === Number(managedTabId)) mark(expectedWindows, tab.windowId);
        } catch (_) {}
      }
      return realTabRemove(tabIds);
    })();
    if (typeof callback === 'function') { p.then(() => callback()).catch(e => { console.error('[TIQ142] expected tab close failed', e); callback(); }); return; }
    return p;
  };

  chrome.tabs.create = function(createProperties, callback) {
    const p = (async () => {
      await stateReady;
      const targetWindowId = Number(createProperties?.windowId);
      if (targetWindowId && targetWindowId === Number(managedWindowId) && isChatUrl(createProperties?.url)) {
        const tabs = await realTabQuery({ windowId: targetWindowId });
        if ((tabs || []).some(t => isChatUrl(t.url))) throw new Error('PREACTIVATION_ONLY_ONE_CHATGPT_WORKER_TAB');
      }
      return realTabCreate(createProperties);
    })();
    if (typeof callback === 'function') { p.then(callback).catch(e => { console.error('[TIQ142] tab create blocked', e); callback(undefined); }); return; }
    return p;
  };

  const originalTabsAdd = chrome.tabs.onRemoved.addListener.bind(chrome.tabs.onRemoved);
  chrome.tabs.onRemoved.addListener = function(listener) {
    return originalTabsAdd((tabId, removeInfo) => {
      const expected = consume(expectedTabs, tabId);
      purge(recentlyClosedManagedTabs);
      const managed = Number(tabId) === Number(managedTabId) || recentlyClosedManagedTabs.has(Number(tabId));
      if (expected || managed) {
        console.info('[TIQ142] suppress legacy TAB_RECOVERY', expected ? 'EXPECTED_CLOSE' : 'USER_OR_EXTERNAL_CLOSE', tabId);
        return;
      }
      return listener(tabId, removeInfo);
    });
  };

  const originalWindowsAdd = chrome.windows.onRemoved.addListener.bind(chrome.windows.onRemoved);
  chrome.windows.onRemoved.addListener = function(listener) {
    return originalWindowsAdd((windowId) => {
      const expected = consume(expectedWindows, windowId);
      purge(recentlyClosedManagedWindows);
      const managed = Number(windowId) === Number(managedWindowId) || recentlyClosedManagedWindows.has(Number(windowId));
      if (expected || managed) {
        console.info('[TIQ142] suppress legacy WINDOW_RECOVERY', expected ? 'EXPECTED_CLOSE' : 'USER_OR_EXTERNAL_CLOSE', windowId);
        return;
      }
      return listener(windowId);
    });
  };

  realTabsOnRemovedAdd((tabId) => {
    if (Number(tabId) === Number(managedTabId)) {
      mark(recentlyClosedManagedTabs, tabId);
      managedTabId = null;
      chrome.storage.local.remove('tigeriq_v142_managed_tab_id').catch(() => {});
    }
  });
  realWindowsOnRemovedAdd((windowId) => {
    if (Number(windowId) === Number(managedWindowId)) {
      mark(recentlyClosedManagedWindows, windowId);
      managedWindowId = null; managedTabId = null;
      chrome.storage.local.remove(['tigeriq_v142_managed_window_id','tigeriq_v142_managed_tab_id']).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'TIQ142_RUNTIME_SEEN' && msg?.version === VERSION) {
      chrome.storage.local.set({ tigeriq_v142_runtime_seen: { version: VERSION, at: Date.now(), tabId: sender?.tab?.id ?? null } }).catch(() => {});
      return false;
    }
    if (msg?.type !== 'TIQ142_ROUTE_DIAG') return false;
    (async () => {
      const reg = await fetch(chrome.runtime.getURL('registry_seed.json'), { cache: 'no-store' }).then(r => r.json());
      const command = String(msg.command ?? '');
      const profile = (reg.employees || []).find(p => (p.command_aliases || []).map(String).includes(command));
      if (!profile) return sendResponse({ ok:false, error:'COMMAND_UNREGISTERED', candidate:VERSION });
      if (profile.employee_id === 'NV05' && profile.activation_state !== 'ACTIVE') return sendResponse({ ok:false, error:'COMMAND_PENDING_ACTIVATION', employee_id:'NV05', candidate:VERSION });
      const background = !!(profile.registered && profile.enabled && profile.background_auto_allowed && profile.activation_state === 'ACTIVE' && profile.runtime_active && profile.mode === 'background_auto');
      sendResponse({ ok:true, employee_id:profile.employee_id, display_name:profile.display_name, mode:profile.mode, background, activation_state:profile.activation_state, registry_issue:335, central_issue:280, candidate:VERSION });
    })().catch(e => sendResponse({ ok:false, error:String(e?.message || e), candidate:VERSION }));
    return true;
  });

  importScripts(chrome.runtime.getURL(LEGACY_REL));
})();
