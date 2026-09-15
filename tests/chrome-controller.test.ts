import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTO_CONTINUE,
  decideAutoContinue,
  freshAutopilotState,
  validateExternalSnapshot,
  type ExternalAutopilotSnapshot,
} from '../apps/chrome-controller/src/autopilot.js';
import {
  computePlacements,
  isInteractiveDesktopSession,
  isWorkerEnabled,
  validateConfig,
  type ControllerConfig,
} from '../apps/chrome-controller/src/model.js';
import { buildRuntimeEvidence } from '../apps/chrome-controller/src/runtime-evidence.js';
import { SerialQueue } from '../apps/chrome-controller/src/serial-queue.js';
import { allowedUrl, matchesWorker } from '../apps/chrome-controller/extension/url-policy.js';

const OBSERVED_AT='2026-09-15T01:00:00.000Z';
const NOW=Date.parse(OBSERVED_AT)+1000;
function baseConfig():ControllerConfig{return{
  host:'127.0.0.1',port:8798,chromePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir:'%LOCALAPPDATA%\\Google\\Chrome\\User Data',logDir:'D:\\TigerIQ\\Apps\\ChromeController\\Runtime',trustedRuntimeHosts:[],
  layout:{width:500,height:834,gap:8,rightMargin:8,top:0,fallbackWorkAreaWidth:4096,fallbackWorkAreaLeft:0},
  pacing:{betweenWorkerLaunchMs:30000,postReadySettlingMs:10000,minUiActionGapMs:8000,commandTimeoutMs:60000,workerReadyTimeoutMs:180000,maxRetries:1,retryBackoffMs:15000},
  autopilot:{enabled:true,pollIntervalMs:15000,stateUrl:'http://127.0.0.1:8794/api/ui-autopilot/snapshot',requestTimeoutMs:5000,maxSnapshotAgeMs:300000},
  recovery:{heartbeatStaleMs:90000,checkIntervalMs:15000,maxReopenAttempts:2,reopenBackoffMs:15000,startupReadyUrl:'http://127.0.0.1:8795/health',startupReadyTimeoutMs:120000,startupAttachGraceMs:20000},
  workers:[
    {id:'NV02',role:'PRIMARY_AUTOPILOT_UI',profileDirectory:'Profile 5',homeUrl:'https://chatgpt.com/g/test-nv02'},
    {id:'NV03',role:'INDEPENDENT_REVIEW',profileDirectory:'Profile 3',homeUrl:'https://chatgpt.com/g/test-nv03'},
    {id:'NV04',role:'RESEARCH_REVIEW',profileDirectory:'Profile 4',homeUrl:'https://gemini.google.com/notebook/test'},
  ],
};}
function snapshot(overrides:Partial<ExternalAutopilotSnapshot>={}):ExternalAutopilotSnapshot{return{
  source:'GITHUB',observedAt:OBSERVED_AT,revision:'issue-763-v1',
  previousJob:{jobId:'JOB-1',workerId:'NV02',status:'DONE',executable:true,priority:'P0',evidence:[{source:'GITHUB',ref:'https://github.com/newsdayads/tigeriq-ai-lab/issues/763#evidence',verifiedAt:OBSERVED_AT}]},
  nextJob:{jobId:'JOB-2',workerId:'NV02',status:'READY',executable:true,priority:'P0',prompt:'LÀM — NO YAPPING. Execute JOB-2 from authoritative state.'},
  ...overrides,
};}

describe('layout 2-3-4',()=>{
  it('keeps 500x834, gap 8 and right-anchors NV02 | NV03 | NV04',()=>{const p=computePlacements(baseConfig(),{left:0,top:0,width:4096,height:2120});expect(p.NV02).toEqual({left:2572,top:0,width:500,height:834});expect(p.NV03.left).toBe(3080);expect(p.NV04.left).toBe(3588);});
  it('uses the true work-area left/top',()=>{const p=computePlacements(baseConfig(),{left:-1200,top:40,width:3277,height:1688});expect(p.NV02.left).toBe(553);expect(p.NV03.left).toBe(1061);expect(p.NV04.left).toBe(1569);expect(p.NV02.top).toBe(40);});
  it('falls back safely when a heartbeat reports an undersized display',()=>{const p=computePlacements(baseConfig(),{left:0,top:0,width:1024,height:768});expect(p.NV02.left).toBe(2572);expect(p.NV03.left).toBe(3080);expect(p.NV04.left).toBe(3588);});
});

describe('config and session guardrails',()=>{
  it('accepts canonical order and defaults enabled',()=>{const c=validateConfig(baseConfig());expect(c.workers.map(w=>w.id)).toEqual(['NV02','NV03','NV04']);expect(c.workers.map(w=>w.enabled)).toEqual([true,true,true]);expect(c.workers.every(isWorkerEnabled)).toBe(true);expect(c.autopilot.stateUrl).toBe('http://127.0.0.1:8794/api/ui-autopilot/snapshot');});
  it('adds bounded defaults to older JSON',()=>{const c=baseConfig() as unknown as Record<string,unknown>;delete c.autopilot;delete c.recovery;const v=validateConfig(c);expect(v.autopilot).toMatchObject({enabled:true,pollIntervalMs:15000,maxSnapshotAgeMs:300000});expect(v.recovery).toMatchObject({heartbeatStaleMs:90000,maxReopenAttempts:2,startupAttachGraceMs:20000});});
  it('preserves disabled worker and rejects invalid enabled/order',()=>{const c=baseConfig();c.workers[2].enabled=false;expect(validateConfig(c).workers[2]).toMatchObject({id:'NV04',enabled:false});const bad=baseConfig() as unknown as {workers:Array<Record<string,unknown>>};bad.workers[0].enabled='false';expect(()=>validateConfig(bad)).toThrow('CONFIG_ENABLED_MUST_BE_BOOLEAN:NV02');const old=baseConfig();old.workers=[old.workers[1],old.workers[0],old.workers[2]];expect(()=>validateConfig(old)).toThrow('CONFIG_WORKER_ORDER_MUST_BE_NV02_NV03_NV04');});
  it('requires exact trusted runtime hosts',()=>{const remote=baseConfig();remote.autopilot.stateUrl='http://100.97.23.87:8795/state';expect(()=>validateConfig(remote)).toThrow('CONFIG_AUTOPILOT_STATE_URL_NOT_TRUSTED');remote.trustedRuntimeHosts=['100.97.23.87'];expect(validateConfig(remote).autopilot.stateUrl).toBe(remote.autopilot.stateUrl);const internet=baseConfig();internet.recovery.startupReadyUrl='http://8.8.8.8:8795/health';expect(()=>validateConfig(internet)).toThrow('CONFIG_RECOVERY_READY_URL_NOT_TRUSTED');});
  it('forbids Windows Services/Session-0 style launches',()=>{expect(isInteractiveDesktopSession('win32','Services')).toBe(false);expect(isInteractiveDesktopSession('win32','')).toBe(false);expect(isInteractiveDesktopSession('win32','Console')).toBe(true);expect(isInteractiveDesktopSession('linux',undefined)).toBe(true);});
});

describe('NV02 completion watcher/autopilot',()=>{
  it('uses AUTO_CONTINUE as trigger metadata but DISPATCH as the browser action',()=>{expect(AUTO_CONTINUE).toBe('AUTO_CONTINUE');expect(decideAutoContinue(snapshot(),freshAutopilotState(),NOW)).toMatchObject({kind:'DISPATCH',trigger:'AUTO_CONTINUE',jobId:'JOB-2'});});
  it('waits for running or missing evidence',()=>{expect(decideAutoContinue(snapshot({previousJob:{jobId:'J1',workerId:'NV02',status:'RUNNING',executable:true,priority:'P0'}}),freshAutopilotState(),NOW)).toMatchObject({kind:'BUSY'});expect(decideAutoContinue(snapshot({previousJob:{jobId:'J1',workerId:'NV02',status:'DONE',executable:true,priority:'P0'}}),freshAutopilotState(),NOW)).toMatchObject({kind:'WAIT_EVIDENCE'});});
  it('stops after FAILED/BLOCKED/CANCELLED instead of continuing',()=>{for(const status of ['FAILED','BLOCKED','CANCELLED'] as const){expect(decideAutoContinue(snapshot({previousJob:{jobId:'J1',workerId:'NV02',status,executable:true,priority:'P0',evidence:[{source:'GITHUB',ref:'x',verifiedAt:OBSERVED_AT}]}}),freshAutopilotState(),NOW)).toMatchObject({kind:'STOP',reason:`PREVIOUS_JOB_${status}`});}});
  it('fails closed on stale, uncorrelated, pending or uncertain state',()=>{expect(decideAutoContinue(snapshot(),freshAutopilotState(),NOW+600000)).toMatchObject({kind:'STOP',reason:'SNAPSHOT_STALE'});expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),lastDispatchedJobId:'OTHER'},NOW)).toMatchObject({kind:'STOP',reason:'PREVIOUS_JOB_CORRELATION_MISMATCH'});expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),pendingJobId:'JOB-2'},NOW)).toMatchObject({kind:'BUSY'});expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),uncertainJobId:'JOB-2'},NOW)).toMatchObject({kind:'STOP'});});
  it('never duplicates the same job',()=>{expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),lastDispatchedJobId:'JOB-2'},NOW)).toMatchObject({kind:'STOP',reason:'PREVIOUS_JOB_CORRELATION_MISMATCH'});});
  it('stops on gated risks and rejects snapshots without revision',()=>{expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV02',status:'READY',executable:true,priority:'P0',prompt:'x',riskFlags:['PRODUCTION_RELEASE']}}),freshAutopilotState(),NOW)).toMatchObject({kind:'STOP'});expect(()=>validateExternalSnapshot({...snapshot(),revision:''})).toThrow('AUTOPILOT_SNAPSHOT_REVISION_REQUIRED');});
});

describe('review evidence and extension lifecycle',()=>{
  it('exports visible-only session policy, owner read-only mode and no stealth/output parsing',()=>{const evidence=buildRuntimeEvidence({config:baseConfig(),workArea:{left:0,top:0,width:4096,height:2120},workers:baseConfig().workers.map(w=>({id:w.id,enabled:true,status:'READY',blocked:false,manualCloseSuppressed:w.id==='NV03'})),autopilot:freshAutopilotState(),snapshot:snapshot(),paused:true,killed:false,recoveryAttempts:{NV02:0,NV03:0,NV04:0},startupReady:true,interactiveSession:true,sessionName:'Console'});expect(evidence.layout.order).toEqual(['NV02','NV03','NV04']);expect(evidence.queue.globalUiConcurrency).toBe(1);expect(evidence.ownerInteractionMode).toBe('READ_ONLY');expect(evidence.autopilot).toMatchObject({fixedTrigger:'AUTO_CONTINUE',browserAction:'DISPATCH',aiOutputParsed:false});expect(evidence.sessionPolicy).toMatchObject({chromeVisibleOnly:true,interactiveSession:true,hiddenChromeAllowed:false,ownerReadOnlyStopsUiMutation:true});expect(evidence.security).toMatchObject({stealth:false,fakeHuman:false,credentialExtraction:false});expect(evidence.workers.find(w=>w.id==='NV03')?.manualCloseSuppressed).toBe(true);});
  it('keeps exact ChatGPT/Gemini routes',()=>{expect(matchesWorker('NV03','https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/c/test')).toBe(true);expect(matchesWorker('NV04','https://gemini.google.com/app/85001b78fca5a010')).toBe(true);expect(allowedUrl('https://example.com/')).toBe(false);});
  it('keeps badge repair idempotent, heartbeat alarm durable, and close events explicit',()=>{const content=readFileSync('apps/chrome-controller/extension/content.js','utf8');const background=readFileSync('apps/chrome-controller/extension/background.js','utf8');expect(content).toContain('badge.textContent !== wantedText');expect(content).not.toContain('characterData: true');expect(background).toContain('ensureTickAlarm');expect(background).toContain("periodInMinutes:0.5");expect(background).toContain("post('/api/window-event',{workerId,event:'CLOSED',windowId:ctx.windowId})");});
  it('persists crash-bubble suppression and manual-close/owner-mode safeguards in controller source',()=>{const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');expect(server).toContain("'--disable-session-crashed-bubble'");expect(server).toContain('manualCloseSuppressed');expect(server).toContain('workerHasActiveJob');expect(server).toContain('recoveryEligible');expect(server).toContain('OWNER_INTERACTION_READ_ONLY');expect(server).toContain("await sendCommand(workerId,'DISPATCH'");expect(server).not.toContain("runWithRetry(`${source.toLowerCase()}:${workerId}`");expect(server).toContain('AUTO_CONTINUE_COMMITTED');expect(server).toContain('pendingJobId');});
});

describe('SerialQueue',()=>{it('runs exactly one task at a time',async()=>{const q=new SerialQueue(0);const order:string[]=[];const a=q.enqueue(async()=>{order.push('a:start');await new Promise(r=>setTimeout(r,20));order.push('a:end');});const b=q.enqueue(async()=>{order.push('b:start');order.push('b:end');});await Promise.all([a,b]);expect(order).toEqual(['a:start','a:end','b:start','b:end']);});});
