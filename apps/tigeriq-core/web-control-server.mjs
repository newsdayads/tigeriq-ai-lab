import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Bundled PC01 runtime may not yet have the shared parser; fail closed, never fake DONE.
const completionModule=await import('../shared/work-center-history.mjs').catch(()=>import('../../apps/shared/work-center-history.mjs').catch(()=>null));
const completionProof=completionModule?.completionProof||(()=>({verified:false,timing:null}));
function sourceCompletionDiagnostic(issue={}){
  const closed=String(issue?.state||'').toLowerCase()==='closed';
  const proof=completionProof(issue);
  const body=String(issue?.body||'');
  const done=/^DONE=true$/mi.test(body);
  const missing=[...(proof?.contract?.missing||[])];
  if(!done)missing.push('DONE_NOT_ACCEPTED');
  if(!proof?.timing?.startVerified)missing.push('START_RECEIPT_MISSING');
  if(!proof?.timing?.finishVerified)missing.push('FINISH_RECEIPT_MISSING');
  if(Number(proof?.checkedSteps||0)<2)missing.push('CHECKLIST_INCOMPLETE');
  else if(proof.checkedEvidenceSteps!==proof.checkedSteps)missing.push('CHECKLIST_STEP_EVIDENCE_MISSING');
  if(proof?.consistent===false)missing.push('PROGRESS_COUNTER_MISMATCH');
  return {
    state:proof.verified?'DONE_ACCEPTED':closed?'VERIFY_EVIDENCE_MISSING':'OPEN_NOT_ACCEPTED',
    sourceDoneDeclared:done,missing:proof.verified?[]:[...new Set(missing)].slice(0,24)
  };
}

// Optional source-only adapter. Missing PC bundle asset must fail closed without breaking Web Control.
const approvalModule=await import('../shared/owner-one-tap-approval.mjs').catch(()=>import('../../apps/shared/owner-one-tap-approval.mjs').catch(()=>import('./owner-one-tap-approval.mjs').catch(()=>null)));
const projectApproval=approvalModule?.projectOwnerApprovalIssue||(()=>({ok:false}));
import { normalizeRuntimeResources, refreshRegistryWorkforce, workforceSnapshot, aggregateWorkforceHealth } from './workforce-registry.mjs';
import { ownerStatusIcon, ownerStatusVectorIcon, ownerStatusLabel } from './owner-facing-vietnamese.mjs';
import { workOrderChecklistSteps } from './work-order-checklist-hard-gate.mjs';
// PC01 Web Control is an isolated atomic bundle: no new static shared import.

const HOST = process.env.TIGERIQ_WEB_CONTROL_HOST?.trim() || '0.0.0.0';
const PORT = Number(process.env.TIGERIQ_WEB_CONTROL_PORT || 8796);
const CORE_URL = (process.env.TIGERIQ_CORE_URL?.trim() || 'http://127.0.0.1:8795').replace(/\/$/, '');
const CODING_URL = (process.env.TIGERIQ_CODING_LANE_URL?.trim() || CORE_URL.replace(/:8795$/, ':8797')).replace(/\/$/, '');
const GITHUB_OWNER = process.env.TIGERIQ_GITHUB_OWNER?.trim() || 'newsdayads';
const GITHUB_REPO = process.env.TIGERIQ_GITHUB_REPO?.trim() || 'tigeriq-ai-lab';
const GITHUB_API_BASE = (process.env.TIGERIQ_GITHUB_API_BASE?.trim() || 'https://api.github.com').replace(/\/$/,'');
const GITHUB_TOKEN = process.env.TIGERIQ_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || '';
const GITHUB_WORK_ORDERS_DISABLED = process.env.TIGERIQ_GITHUB_WORK_ORDERS_DISABLE === '1';
const WORK_ORDER_CACHE_MS = 30000;
let workOrderCache = { at: 0, workOrders: [], workOrdersRecent: [], meta: { ok: false, source: 'github', stale: true } };
const baseHtml = readFileSync(new URL('./web-control.html', import.meta.url), 'utf8');
// Read from the source tree for normal execution, from the atomic bundle for PC01.
function sharedWorkAsset(name,required=false){
 try{return readFileSync(new URL('../../public/'+name,import.meta.url),'utf8')}
 catch(sourceError){
  try{return readFileSync(new URL('./'+name,import.meta.url),'utf8')}
  catch{if(required)throw sourceError;return ''}
 }
}
const sharedWorkCenterJs=sharedWorkAsset('work-center.js');
const sharedWorkUiCss=sharedWorkAsset('work-ui.css');
const sharedWorkCenterVisualCss=sharedWorkAsset('work-center-visual.css',true);
const healthModelJs = readFileSync(new URL('./web-control-health-model.js', import.meta.url), 'utf8');
const truthJs = readFileSync(new URL('./web-control-truth.js', import.meta.url), 'utf8');
const unifiedJs = readFileSync(new URL('./web-control-unified.js', import.meta.url), 'utf8');
const workforceJs = readFileSync(new URL('./web-control-workforce.js', import.meta.url), 'utf8');
const routingJs = readFileSync(new URL('./web-control-routing.js', import.meta.url), 'utf8');
const unifiedCss = readFileSync(new URL('./web-control-unified.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('./web-control-mobile.css', import.meta.url), 'utf8');
const workforceCss = readFileSync(new URL('./web-control-workforce.css', import.meta.url), 'utf8');
const routingCss = readFileSync(new URL('./web-control-routing.css', import.meta.url), 'utf8');
const html = baseHtml
  .replace('</head>', '<link rel="stylesheet" href="/web-control-unified.css"><link rel="stylesheet" href="/web-control-mobile.css"><link rel="stylesheet" href="/web-control-workforce.css"><link rel="stylesheet" href="/web-control-routing.css"><link rel="stylesheet" href="/work-ui.css"><link rel="stylesheet" href="/work-center-visual.css"><script src="/work-center.js"></script></head>')
  .replace('</body>', '<script src="/web-control-health-model.js"></script><script src="/web-control-truth.js"></script><script src="/web-control-unified.js"></script><script src="/web-control-workforce.js"></script><script src="/web-control-routing.js"></script></body>');

const securityHeaders = {
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

async function upstream(baseUrl, pathname, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + pathname, { signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    return { status: response.status, contentType: response.headers.get('content-type') || 'application/json', text };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function machineValue(body,key) {
  const match=String(body||'').match(new RegExp('^'+key+'=([^\\r\\n]+)$','m'));
  return match?.[1]?.trim() || '';
}

function systemWorkOrder(issue,body='') {
  const title=String(issue?.title||'').toUpperCase();
  const scope=machineValue(body,'RESOURCE_SCOPE').toUpperCase();
  const labels=(issue?.labels||[]).map(x=>String(x?.name||x).toUpperCase());
  return /\[(CENTRAL|REGISTRY|STATE|POLICY|SYSTEM|QUẢN TRỊ|ĐIỀU PHỐI)\]/.test(title)
      || /(?:^|_)(CENTRAL|REGISTRY|POLICY|SYSTEM)(?:_|$)/.test(scope)
      || labels.some(x=>x.includes('SYSTEM')||x.includes('CENTRAL')||x.includes('POLICY'));
}

// Work Center must include legacy assigned Work Orders without an explicit
// TIGERIQ_EXECUTABLE field; they remain visible, but this grants NO execution.
export function webControlWorkOrderCandidate(issue) {
  if (!issue || typeof issue !== 'object' || issue.pull_request) return false;
  const body = String(issue.body || '');
  if (/(?:^|\n)TIGERIQ_EXECUTABLE=(?:true|false)(?:\r?\n|$)/.test(body)) return true;
  if (systemWorkOrder(issue, body)) return true;
  const checklist = workOrderChecklistSteps(body);
  return Boolean(machineValue(body, 'RESOURCE_SCOPE') &&
    machineValue(body, 'CURRENT_STEP') && checklist.found && checklist.steps.length);
}

export function projectWorkOrder(issue, source = {}) {
  const body=String(issue?.body||'');
  const checklist=workOrderChecklistSteps(body);
  const checkedCount=checklist.steps.filter(s=>s.checked).length;
  const totalCount=checklist.steps.length;
  const progressPercent=totalCount>0?Math.round((checkedCount/totalCount)*100):null;
  const priority=machineValue(body,'PRIORITY') || (String(issue?.title||'').match(/\[(P[0-5])\]/)?.[1] || 'P2');
  const marker=(machineValue(body,'CURRENT_STATE')+' '+machineValue(body,'STATE')).toUpperCase();
  const capability=machineValue(body,'CAPABILITY').toUpperCase();
  const executable=machineValue(body,'TIGERIQ_EXECUTABLE').toLowerCase()==='true';
  const explicitlyNonExecutable=machineValue(body,'TIGERIQ_EXECUTABLE').toLowerCase()==='false';
  const ownerControlled=machineValue(body,'OWNER_CONTROLLED').toLowerCase()==='true';
  const rawOwner=machineValue(body,'MUTATION_OWNER') || machineValue(body,'TARGET_EMPLOYEE') || machineValue(body,'OWNER_PROXY') || issue?.assignee?.login || '—';
  const owner=ownerControlled&&!executable?'OWNER':rawOwner;
  const closed=String(issue?.state||'').toLowerCase()==='closed';
  const proof=closed?completionProof(issue):{verified:false,timing:null};
  const completionSync=sourceCompletionDiagnostic(issue);
  const isSystem=systemWorkOrder(issue,body);
  const ownerGate=/OWNER_GATE|WAIT(?:ING)?_OWNER|WAIT_ANH_SON|CHỜ_ANH_SƠN/.test(marker);
  // Never expose an approval action without a fresh, authenticated Owner-authored GitHub issue.
  const approvalProjection=ownerGate?projectApproval(issue,source):{ok:false};
  const review=!isSystem && (/(?<!NOT_)\b(?:REVIEW|VERIFY|RÀ_SOÁT)\b/.test(marker)||capability==='REVIEW');
  // Match a blocked *state token*, not the harmless substring in UNBLOCKED.
  const blocked=/(?:^|[\s_])(?:BLOCKED|BLOCK|EXTERNAL_WAIT|NO_GO)(?:[_\s]|$)/.test(marker);
  const working=!isSystem && !/\bNOT_(?:EXECUTING|WORKING)\b/.test(marker) && (machineValue(body,'ACTIVE_EXECUTION').toLowerCase()==='true'||/\b(?:CLAIM|WORKING|ACTIVE_EXECUTION|IMPLEMENTING|RUNNING)\b/.test(marker));
  let bucket='CẦN XỬ LÝ';
  if(closed) bucket=proof.verified?'HOÀN THÀNH':'CHỜ NGHIỆM THU';
  else if(isSystem||ownerControlled) bucket='HỆ THỐNG';
  else if(blocked) bucket=ownerStatusLabel('BLOCKED');
  else if(ownerGate) bucket='CHỜ ANH SƠN';
  else if(review) bucket='RÀ SOÁT';
  else if(working&&executable) bucket=ownerStatusLabel('WORKING');
  // Legacy structured Work Orders lack this flag; absence is NOT explicit disable.
  else if(explicitlyNonExecutable) bucket='HỆ THỐNG';
  let state='MỞ';
  if(bucket==='HOÀN THÀNH') state='HOÀN THÀNH';
  else if(bucket==='CHỜ NGHIỆM THU') state='CHỜ NGHIỆM THU';
  else if(bucket===ownerStatusLabel('BLOCKED')) state=ownerStatusLabel('BLOCKED');
  else if(bucket===ownerStatusLabel('WORKING')) state=ownerStatusLabel('WORKING');
  else if(bucket==='RÀ SOÁT') state='RÀ SOÁT';
  else if(bucket==='CHỜ ANH SƠN') state='CHỜ ANH SƠN';
  else if(bucket==='HỆ THỐNG') state='HỆ THỐNG';
  else if(/WAIT|PENDING/.test(marker)) state='CHỜ';
  return {
    issue_number:issue.number,number:issue.number,title:issue.title,priority,effectivePriority:priority,
    status:proof.verified?'DONE':closed?'VERIFY':isSystem?'SYSTEM':review?'REVIEW':blocked?'BLOCKED':working&&executable?'WORKING':ownerGate?'OWNER_GATE':'OPEN',
    state,statusIcon:ownerStatusIcon(state),statusIconName:ownerStatusVectorIcon(state),
    bucket,bucketIcon:ownerStatusIcon(bucket),bucketIconName:ownerStatusVectorIcon(bucket),
    owner,assignee:owner,closed,ownerApproval:approvalProjection.ok?approvalProjection.card:null,
    completionVerified:proof.verified,lifecycleTiming:proof.timing,workKind:isSystem?'SYSTEM':'WORK',
    completionSyncState:completionSync.state,completionMissing:closed?completionSync.missing:[],sourceDoneDeclared:completionSync.sourceDoneDeclared,
    projectName:machineValue(body,'PROJECT_NAME')||machineValue(body,'PROJECT_ID')||'TigerIQ',
    workstreamName:machineValue(body,'WORKSTREAM_NAME')||machineValue(body,'WORKSTREAM_ID')||'Công việc',
    currentStep:machineValue(body,'CURRENT_STEP')||null,
    nextAction:machineValue(body,'NEXT_ACTION')||null,
    resourceScope:machineValue(body,'RESOURCE_SCOPE')||null,
    progressSteps:checklist.steps,
    progressCompleted:checkedCount,
    progressTotal:totalCount,
    progressPercent,
    updated_at:issue.updated_at,updatedAt:issue.updated_at,url:issue.html_url
  };
}

async function githubWorkOrders() {
  if (GITHUB_WORK_ORDERS_DISABLED) return { workOrders: [], workOrdersRecent: [], meta: { ok: true, source: 'github', disabled: true, stale: false } };
  const now=Date.now();
  if (now-workOrderCache.at < WORK_ORDER_CACHE_MS) return workOrderCache;
  const controller=new AbortController();
  // Owner decisions must not vanish because the GitHub issues read took >1.5s.
  // Keep a finite timeout; failure remains stale (no actions), never a fake approval.
  const timer=setTimeout(()=>controller.abort(),6000);
  try {
    const headers={Accept:'application/vnd.github+json','User-Agent':'TigerIQ-Web-Control/1'};
    if(GITHUB_TOKEN) headers.Authorization='Bearer '+GITHUB_TOKEN;
    const response=await fetch(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?state=all&per_page=100&sort=updated&direction=desc`,{headers,signal:controller.signal,cache:'no-store'});
    if(!response.ok) throw new Error('GITHUB_HTTP_'+response.status);
    const rows=await response.json();
    const candidates=(Array.isArray(rows)?rows:[])
      .filter(webControlWorkOrderCandidate)
      .map(issue=>projectWorkOrder(issue,{verified:true,fresh:true}));
    const rank={P0:0,P1:1,P2:2,P3:3,P4:4,P5:5};
    const workOrders=candidates.filter(x=>!x.closed)
      .sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||String(b.updated_at).localeCompare(String(a.updated_at)));
    const workOrdersRecent=candidates.filter(x=>x.closed).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,30);
    workOrderCache={at:now,workOrders,workOrdersRecent,meta:{ok:true,source:'github',stale:false,refreshed_at:new Date(now).toISOString()}};
  } catch(error) {
    workOrderCache={...workOrderCache,at:now,meta:{ok:false,source:'github',stale:true,error:String(error?.name==='AbortError'?'GITHUB_TIMEOUT':error?.message||error),refreshed_at:new Date(now).toISOString()}};
  } finally { clearTimeout(timer); }
  return workOrderCache;
}

async function codingStatus() {
  try {
    const response = await upstream(CODING_URL, '/api/status', 3000);
    if (response.status !== 200) return { ok: false, status: response.status };
    const data = safeJson(response.text, null);
    return data && typeof data === 'object' ? data : { ok: false, error: 'CODING_INVALID_JSON' };
  } catch (error) {
    return { ok: false, error: String(error?.name === 'AbortError' ? 'CODING_TIMEOUT' : error?.message || error) };
  }
}

void refreshRegistryWorkforce(true);
const registryTimer=setInterval(()=>void refreshRegistryWorkforce(),60000);
registryTimer.unref?.();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/web-control')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') return res.end();
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'public, max-age=86400' });
      return res.end();
    }
    if(req.method==='GET'&&url.pathname==='/work-center.js'){res.writeHead(sharedWorkCenterJs?200:503,{'content-type':'text/javascript; charset=utf-8'});return res.end(sharedWorkCenterJs)}
    if(req.method==='GET'&&url.pathname==='/work-ui.css'){res.writeHead(sharedWorkUiCss?200:503,{'content-type':'text/css; charset=utf-8'});return res.end(sharedWorkUiCss)}
    if(req.method==='GET'&&url.pathname==='/work-center-visual.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8'});return res.end(sharedWorkCenterVisualCss)}
    if(req.method==='GET'&&url.pathname==='/api/work-history'){
      const number=url.searchParams.get('number')||'';
      if(!/^[1-9]\d{0,7}$/.test(number)){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'INVALID_NUMBER'}))}
      try{const response=await upstream(CORE_URL,'/api/work-history?number='+number,7000);res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});return res.end(response.text)}
      catch{res.writeHead(503,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'WORK_HISTORY_UNAVAILABLE'}))}
    }
    if (req.method === 'GET' && url.pathname === '/web-control-health-model.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(healthModelJs);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-truth.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(truthJs);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-unified.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(unifiedJs);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-workforce.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(workforceJs);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-routing.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(routingJs);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-unified.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(unifiedCss);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-mobile.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(mobileCss);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-workforce.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(workforceCss);
    }
    if (req.method === 'GET' && url.pathname === '/web-control-routing.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(routingCss);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const coreResponse = await upstream(CORE_URL, '/api/status', 4000);
      if (coreResponse.status !== 200) {
        res.writeHead(coreResponse.status, { 'content-type': coreResponse.contentType });
        return res.end(coreResponse.text);
      }
      const core = safeJson(coreResponse.text, null);
      if (!core || typeof core !== 'object') {
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'CORE_INVALID_JSON' }));
      }
      const {workforce,workforceMeta}=workforceSnapshot();
      const resources=normalizeRuntimeResources(core.resources,workforce);
      const [codingLane,workOrderSnapshot] = await Promise.all([codingStatus(),githubWorkOrders()]);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...core, resources, workforce, workforceMeta, codingLane, workOrders: workOrderSnapshot.workOrders, workOrdersRecent: workOrderSnapshot.workOrdersRecent, workOrdersMeta: workOrderSnapshot.meta }));
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      let core = { ok: false };
      try {
        const response = await upstream(CORE_URL, '/health', 1500);
        core = response.status === 200 ? safeJson(response.text, { ok: false }) : { ok: false, status: response.status };
      } catch (error) {
        core = { ok: false, error: String(error?.name === 'AbortError' ? 'CORE_TIMEOUT' : error?.message || error) };
      }
      let coding = { ok: false };
      try {
        const response = await upstream(CODING_URL, '/health', 1500);
        coding = response.status === 200 ? safeJson(response.text, { ok: false }) : { ok: false, status: response.status };
      } catch (error) {
        coding = { ok: false, error: String(error?.name === 'AbortError' ? 'CODING_TIMEOUT' : error?.message || error) };
      }
      const isValidUrl = (u) => { try { const parsed = new URL(u); return parsed.protocol === 'http:' || parsed.protocol === 'https:'; } catch { return false; } };
      const rawChromeUrl = process.env.TIGERIQ_CHROME_CONTROLLER_URL?.trim() || 'http://127.0.0.1:9222';
      const chromeControllerUrl = isValidUrl(rawChromeUrl) ? rawChromeUrl : 'http://127.0.0.1:9222';
      let chromeController = { ok: false, source_type: 'Automation' };
      try {
        const response = await upstream(chromeControllerUrl, '/json/version', 500);
        if (response.status === 200) {
          const parsedDetails = safeJson(response.text, {});
          const sanitizedDetails = parsedDetails && typeof parsedDetails === 'object' ? { Browser: parsedDetails.Browser, 'Protocol-Version': parsedDetails['Protocol-Version'] } : {};
          chromeController = { ok: true, source_type: 'Automation', details: sanitizedDetails };
        } else {
          chromeController = { ok: false, source_type: 'Automation', status: response.status };
        }
      } catch (error) {
        chromeController = { ok: false, source_type: 'Automation', error: String(error?.message || error) };
      }
      const rawOpenclawUrl = process.env.TIGERIQ_OPENCLAW_GATEWAY_URL?.trim() || 'http://127.0.0.1:8798';
      const openclawUrl = isValidUrl(rawOpenclawUrl) ? rawOpenclawUrl : 'http://127.0.0.1:8798';
      let openclaw = { ok: false, source_type: 'API' };
      try {
        const response = await upstream(openclawUrl, '/health', 500);
        if (response.status === 200) {
          const parsedOpenclaw = safeJson(response.text, {});
          const sanitizedOpenclaw = parsedOpenclaw && typeof parsedOpenclaw === 'object' ? { ok: parsedOpenclaw.ok, status: parsedOpenclaw.status } : {};
          openclaw = { ok: true, source_type: 'API', ...sanitizedOpenclaw };
        } else {
          openclaw = { ok: false, source_type: 'API', status: response.status };
        }
      } catch (error) {
        openclaw = { ok: false, source_type: 'API', error: String(error?.message || error) };
      }
      const ok = core?.ok === true;
      const wfSnap = workforceSnapshot();
      const unifiedWorkforceHealth = aggregateWorkforceHealth(wfSnap?.workforce, core?.resources);
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok, service: 'tigeriq-web-control', host: HOST, port: PORT, core, coding, workforceHealth: unifiedWorkforceHealth, sources: { chromeController, openclaw } }));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not_found');
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: String(error?.name === 'AbortError' ? 'CORE_TIMEOUT' : error?.message || error) }));
  }
});

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });
  console.log(JSON.stringify({ event: 'TIGERIQ_WEB_CONTROL_STARTED', host: HOST, port: PORT, coreUrl: CORE_URL, codingUrl: CODING_URL, pid: process.pid }));

  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}
