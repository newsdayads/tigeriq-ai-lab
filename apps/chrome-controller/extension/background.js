import { WORKER_HOSTS, allowedUrl, hostname, matchesWorker } from './url-policy.js';

const CONTROLLER = 'http://127.0.0.1:8798';
const WORKER_LABELS = {
  NV02:'NV02 · ChatGPT Plus',
  NV03:'NV03 · ChatGPT Go',
  NV04:'NV04 · Gemini Pro'
};
let ticking = false;

function markerWorkerId(value) {
  try {
    const u = new URL(value);
    const match = u.hash.match(/(?:^|[&#])tigeriq-worker=(NV02|NV03|NV04)(?:&|$)/i);
    return match ? match[1].toUpperCase() : null;
  } catch { return null; }
}
function stripWorkerMarker(value) {
  try {
    const u = new URL(value);
    const parts = u.hash.replace(/^#/, '').split('&').filter((p) => p && !/^tigeriq-worker=/i.test(p));
    u.hash = parts.length ? `#${parts.join('&')}` : '';
    return u.toString();
  } catch { return value; }
}
function normalizeWorkerId(id) {
  return id === 'NV05' ? 'NV02' : id;
}

async function bootstrapWorkerIds() {
  const saved = await chrome.storage.local.get(['workerIds','workerId']);
  const rawIds = Array.isArray(saved.workerIds) ? saved.workerIds : (saved.workerId ? [saved.workerId] : []);
  const normalizedIds = rawIds.map(normalizeWorkerId).filter((id) => WORKER_HOSTS[id]);
  const ids = new Set(normalizedIds);
  let changed = normalizedIds.length !== rawIds.length || rawIds.some((id) => normalizeWorkerId(id) !== id) || Boolean(saved.workerId);
  const wins = await chrome.windows.getAll({ populate:true, windowTypes:['normal'] });
  for (const win of wins) {
    for (const tab of win.tabs || []) {
      const id = markerWorkerId(tab.url || '');
      if (!id || !matchesWorker(id, tab.url || '')) continue;
      const sameHostId = [...ids].find((existing) => existing !== id && WORKER_HOSTS[existing] === WORKER_HOSTS[id]);
      if (sameHostId) continue;
      if (!ids.has(id)) { ids.add(id); changed = true; }
      if (tab.id) await chrome.tabs.update(tab.id, { url: stripWorkerMarker(tab.url || '') });
    }
  }
  if (changed) {
    await chrome.storage.local.set({ workerIds:[...ids] });
    await chrome.storage.local.remove('workerId');
  }
  return [...ids];
}

async function getWorkerIds() { return bootstrapWorkerIds(); }

async function findContext(workerId) {
  const wins = await chrome.windows.getAll({ populate:true, windowTypes:['normal'] });
  const exact = [];
  const hostOnly = [];
  for (const win of wins) {
    for (const tab of win.tabs || []) {
      const url = tab.url || '';
      if (hostname(url) !== WORKER_HOSTS[workerId]) continue;
      const item = { windowId:win.id, tabId:tab.id, url, active:Boolean(tab.active) };
      hostOnly.push(item);
      if (matchesWorker(workerId, url)) exact.push(item);
    }
  }
  const choose = (items) => {
    if (!items.length) return null;
    if (items.length === 1) return items[0];
    const active = items.filter((c) => c.active);
    return active.length === 1 ? active[0] : items[0];
  };
  return choose(exact) || choose(hostOnly);
}

async function updateWorkerBadge(workerId, ctx) {
  const exact = matchesWorker(workerId, ctx.url || '');
  const badgeText = exact ? workerId.slice(2) : '';
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setTitle({ title: exact ? `TigerIQ · ${WORKER_LABELS[workerId]}` : 'TigerIQ Chrome Controller' });
  if (!ctx.tabId) return;
  try {
    await chrome.tabs.sendMessage(ctx.tabId, {
      type:'TIGERIQ_WORKER_BADGE',
      workerId: exact ? workerId : null,
      label: exact ? WORKER_LABELS[workerId] : ''
    });
  } catch { /* content script may not be ready yet; next tick retries */ }
}

async function displayInfo() {
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find((d) => d.isPrimary) || displays[0];
  return primary ? { workArea:primary.workArea } : undefined;
}
async function post(path,data) {
  const r = await fetch(`${CONTROLLER}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  if(!r.ok) throw new Error(`HTTP_${r.status}`);
  return r.json();
}
async function heartbeat(workerId,ctx) { await post('/api/heartbeat',{workerId,state:'READY',...ctx,display:await displayInfo()}); }

async function waitForTabComplete(tabId,timeoutMs=60000) {
  const current=await chrome.tabs.get(tabId); if(current.status==='complete') return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error('NAVIGATION_TIMEOUT'));},timeoutMs);
    const listener=(id,info)=>{if(id===tabId&&info.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve();}};
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function execute(workerId,command) {
  const {action,payload={}}=command;
  const ctx=await findContext(workerId);
  if(!ctx) throw new Error('WORKER_WINDOW_AMBIGUOUS_OR_MISSING');
  if(action==='FOCUS'){await chrome.windows.update(ctx.windowId,{focused:true});return{status:'FOCUSED'};}
  if(action==='LAYOUT'){await chrome.windows.update(ctx.windowId,{left:Number(payload.left),top:Number(payload.top),width:Number(payload.width),height:Number(payload.height),focused:false});return{status:'LAYOUT_APPLIED'};}
  if(action==='CLOSE_WINDOW'){await chrome.windows.remove(ctx.windowId);return{status:'WINDOW_CLOSED'};}
  if(action==='NAVIGATE'){
    if(!allowedUrl(payload.url)||!matchesWorker(workerId,payload.url)) throw new Error('BLOCKED_URL');
    await chrome.tabs.update(ctx.tabId,{url:payload.url,active:true}); await waitForTabComplete(ctx.tabId); return{status:'NAVIGATED'};
  }
  if(action==='DISPATCH'){
    if(!matchesWorker(workerId,ctx.url)) throw new Error('BLOCKED_URL');
    await chrome.tabs.update(ctx.tabId,{active:true});
    const response=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_DISPATCH',text:String(payload.text||'')});
    if(!response?.ok){const reason=response?.status||'DISPATCH_FAILED';const error=new Error(reason);error.status=reason;throw error;}
    return response;
  }
  throw new Error(`UNKNOWN_ACTION:${action}`);
}

async function tickWorker(workerId) {
  const ctx=await findContext(workerId); if(!ctx) return;
  await updateWorkerBadge(workerId, ctx);
  await heartbeat(workerId,ctx);
  const r=await fetch(`${CONTROLLER}/api/commands/${encodeURIComponent(workerId)}`); if(!r.ok) return;
  const {command}=await r.json(); if(!command) return;
  try { const result=await execute(workerId,command); await post('/api/result',{workerId,commandId:command.id,ok:true,...result}); }
  catch(error){ const status=error?.status||String(error?.message||error); await post('/api/result',{workerId,commandId:command.id,ok:false,status}); }
}

async function tick(){
  if(ticking) return; ticking=true;
  try { for(const workerId of await getWorkerIds()) await tickWorker(workerId); }
  catch { /* Controller may be offline; retry later. */ }
  finally { ticking=false; }
}
chrome.runtime.onInstalled.addListener(async()=>{await chrome.alarms.create('tigeriqTick',{periodInMinutes:0.5});void tick();});
chrome.runtime.onStartup.addListener(async()=>{await chrome.alarms.create('tigeriqTick',{periodInMinutes:0.5});void tick();});
chrome.alarms.onAlarm.addListener((a)=>{if(a.name==='tigeriqTick')void tick();});
chrome.runtime.onMessage.addListener((m)=>{if(m?.type==='TIGERIQ_CONFIG_UPDATED')void tick();});
setInterval(()=>void tick(),7000); void tick();
