import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTO_CONTINUE, decideAutoContinue, freshAutopilotState, validateExternalSnapshot, type ExternalAutopilotSnapshot } from '../apps/chrome-controller/src/autopilot.js';
import { computePlacements, isWorkerEnabled, validateConfig, type ControllerConfig } from '../apps/chrome-controller/src/model.js';
import { buildRuntimeEvidence } from '../apps/chrome-controller/src/runtime-evidence.js';
import { SerialQueue } from '../apps/chrome-controller/src/serial-queue.js';
import { allowedUrl, matchesWorker } from '../apps/chrome-controller/extension/url-policy.js';

function baseConfig(): ControllerConfig {
  return {
    host:'127.0.0.1',port:8798,chromePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',userDataDir:'%LOCALAPPDATA%\\Google\\Chrome\\User Data',logDir:'D:\\TigerIQ\\Apps\\ChromeController\\Runtime',
    layout:{width:500,height:834,gap:8,rightMargin:8,top:0,fallbackWorkAreaWidth:4096,fallbackWorkAreaLeft:0},
    pacing:{betweenWorkerLaunchMs:30000,postReadySettlingMs:10000,minUiActionGapMs:8000,commandTimeoutMs:60000,workerReadyTimeoutMs:180000,maxRetries:1,retryBackoffMs:15000},
    autopilot:{enabled:true,pollIntervalMs:15000,requestTimeoutMs:5000},
    recovery:{heartbeatStaleMs:45000,checkIntervalMs:10000,maxReopenAttempts:2,reopenBackoffMs:15000,startupReadyUrl:'http://127.0.0.1:8795/health',startupReadyTimeoutMs:120000},
    workers:[
      {id:'NV05',role:'PRIMARY_AUTOPILOT_UI',profileDirectory:'Profile 5',homeUrl:'https://chatgpt.com/g/test-nv05'},
      {id:'NV03',role:'INDEPENDENT_REVIEW',profileDirectory:'Profile 3',homeUrl:'https://chatgpt.com/g/test-nv03'},
      {id:'NV04',role:'RESEARCH_REVIEW',profileDirectory:'Profile 4',homeUrl:'https://gemini.google.com/notebook/test'},
    ],
  };
}
function snapshot(overrides:Partial<ExternalAutopilotSnapshot>={}):ExternalAutopilotSnapshot{return{source:'GITHUB',observedAt:'2026-09-15T01:00:00.000Z',revision:'issue-763-v1',previousJob:{jobId:'JOB-1',workerId:'NV05',status:'DONE',executable:true,priority:'P0',evidence:[{source:'GITHUB',ref:'https://github.com/newsdayads/tigeriq-ai-lab/issues/763#evidence'}]},nextJob:{jobId:'JOB-2',workerId:'NV05',status:'READY',executable:true,priority:'P0',prompt:'LÀM — NO YAPPING. Execute JOB-2 from authoritative state.'},...overrides};}

describe('layout 5-3-4',()=>{
  it('keeps 500x834, gap 8 and right-anchors NV05 | NV03 | NV04',()=>{const p=computePlacements(baseConfig(),{left:0,top:0,width:4096,height:2120});expect(p.NV05).toEqual({left:2572,top:0,width:500,height:834});expect(p.NV03.left).toBe(3080);expect(p.NV04.left).toBe(3588);});
  it('uses the true work-area left/top',()=>{const p=computePlacements(baseConfig(),{left:-1200,top:40,width:3277,height:1688});expect(p.NV05.left).toBe(553);expect(p.NV03.left).toBe(1061);expect(p.NV04.left).toBe(1569);expect(p.NV05.top).toBe(40);});
});

describe('config guardrails',()=>{
  it('accepts only canonical order and defaults enabled',()=>{const c=validateConfig(baseConfig());expect(c.workers.map(w=>w.id)).toEqual(['NV05','NV03','NV04']);expect(c.workers.map(w=>w.enabled)).toEqual([true,true,true]);expect(c.workers.every(isWorkerEnabled)).toBe(true);});
  it('adds bounded defaults to older JSON',()=>{const c=baseConfig() as unknown as Record<string,unknown>;delete c.autopilot;delete c.recovery;const v=validateConfig(c);expect(v.autopilot).toMatchObject({enabled:true,pollIntervalMs:15000});expect(v.recovery).toMatchObject({heartbeatStaleMs:45000,maxReopenAttempts:2});});
  it('preserves disabled worker and rejects invalid enabled/order',()=>{const c=baseConfig();c.workers[2].enabled=false;expect(validateConfig(c).workers[2]).toMatchObject({id:'NV04',enabled:false});const bad=baseConfig() as unknown as {workers:Array<Record<string,unknown>>};bad.workers[0].enabled='false';expect(()=>validateConfig(bad)).toThrow('CONFIG_ENABLED_MUST_BE_BOOLEAN:NV05');const old=baseConfig();old.workers=[old.workers[1],old.workers[0],old.workers[2]];expect(()=>validateConfig(old)).toThrow('CONFIG_WORKER_ORDER_MUST_BE_NV05_NV03_NV04');});
  it('requires loopback control plane and bounded pacing',()=>{expect(()=>validateConfig({...baseConfig(),host:'0.0.0.0'} as unknown)).toThrow('CONFIG_HOST_MUST_BE_LOOPBACK');const remote=baseConfig();remote.autopilot.stateUrl='https://example.com/state';expect(()=>validateConfig(remote)).toThrow('CONFIG_AUTOPILOT_STATE_URL_MUST_BE_LOOPBACK');const fast=baseConfig();fast.recovery.heartbeatStaleMs=1000;expect(()=>validateConfig(fast)).toThrow('CONFIG_RECOVERY_PACING_INVALID');});
  it('keeps profile/session and URL isolation',()=>{const collision=baseConfig();collision.workers[0].profileDirectory='Profile 3';expect(()=>validateConfig(collision)).toThrow('CONFIG_PROFILE_HOST_COLLISION:NV03');const url=baseConfig();url.workers[0].homeUrl='https://example.com/';expect(()=>validateConfig(url)).toThrow('CONFIG_HOME_URL_NOT_ALLOWED:NV05');});
});

describe('NV05 completion watcher/autopilot',()=>{
  it('uses fixed AUTO_CONTINUE only after terminal external evidence',()=>{expect(AUTO_CONTINUE).toBe('AUTO_CONTINUE');expect(decideAutoContinue(snapshot(),freshAutopilotState())).toMatchObject({kind:'DISPATCH',trigger:'AUTO_CONTINUE',jobId:'JOB-2'});});
  it('waits for terminal then evidence',()=>{expect(decideAutoContinue(snapshot({previousJob:{jobId:'J1',workerId:'NV05',status:'RUNNING',executable:true,priority:'P0'}}),freshAutopilotState())).toMatchObject({kind:'BUSY'});expect(decideAutoContinue(snapshot({previousJob:{jobId:'J1',workerId:'NV05',status:'DONE',executable:true,priority:'P0'}}),freshAutopilotState())).toMatchObject({kind:'WAIT_EVIDENCE'});});
  it('never duplicates the same job',()=>{expect(decideAutoContinue(snapshot(),{...freshAutopilotState(),lastDispatchedJobId:'JOB-2'})).toEqual({kind:'DUPLICATE_NOOP',reason:'JOB_ALREADY_DISPATCHED',jobId:'JOB-2'});});
  it('idles for no/P2/non-NV05/non-executable work',()=>{expect(decideAutoContinue(snapshot({nextJob:undefined}),freshAutopilotState()).kind).toBe('IDLE');expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV05',status:'READY',executable:true,priority:'P2',prompt:'x'}}),freshAutopilotState()).kind).toBe('IDLE');expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV03',status:'READY',executable:true,priority:'P0',prompt:'x'}}),freshAutopilotState()).kind).toBe('IDLE');expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV05',status:'READY',executable:false,priority:'P0',prompt:'x'}}),freshAutopilotState()).kind).toBe('IDLE');});
  it('stops on gated risks and rejects non-GitHub/Core snapshot',()=>{expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV05',status:'READY',executable:true,priority:'P0',prompt:'x',riskFlags:['PRODUCTION_RELEASE']}}),freshAutopilotState())).toMatchObject({kind:'STOP'});expect(()=>validateExternalSnapshot({...snapshot(),source:'CHAT'})).toThrow('AUTOPILOT_SNAPSHOT_SOURCE_MUST_BE_GITHUB_OR_CORE');});
});

describe('review evidence contract',()=>{
  it('exports layout, queue=1, fixed trigger, bounded recovery and no stealth/output parsing',()=>{const evidence=buildRuntimeEvidence({config:baseConfig(),workArea:{left:0,top:0,width:4096,height:2120},workers:baseConfig().workers.map(w=>({id:w.id,enabled:true,status:'READY',blocked:false})),autopilot:freshAutopilotState(),snapshot:snapshot(),paused:false,killed:false,recoveryAttempts:{NV05:0,NV03:0,NV04:0},startupReady:true});expect(evidence.layout.order).toEqual(['NV05','NV03','NV04']);expect(evidence.layout).toMatchObject({width:500,height:834,gap:8,rightAnchored:true,source:'HEARTBEAT_WORK_AREA'});expect(evidence.queue.globalUiConcurrency).toBe(1);expect(evidence.autopilot).toMatchObject({fixedTrigger:'AUTO_CONTINUE',aiOutputParsed:false});expect(evidence.security).toMatchObject({stealth:false,fakeHuman:false,credentialExtraction:false});expect(evidence.recovery.maxReopenAttempts).toBe(2);});
});

describe('URL policy and badge recovery',()=>{
  it('keeps exact ChatGPT/Gemini routes',()=>{expect(matchesWorker('NV03','https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/c/test')).toBe(true);expect(matchesWorker('NV03','https://chatgpt.com/g/other-project')).toBe(false);expect(matchesWorker('NV04','https://gemini.google.com/app/85001b78fca5a010')).toBe(true);expect(matchesWorker('NV04','https://gemini.google.com/')).toBe(false);expect(allowedUrl('https://example.com/')).toBe(false);});
  it('self-heals overlay and retains toolbar badge fallback',()=>{const content=readFileSync('apps/chrome-controller/extension/content.js','utf8');const background=readFileSync('apps/chrome-controller/extension/background.js','utf8');expect(content).toContain('new MutationObserver');expect(content).toContain('ensureWorkerBadge');expect(content).toContain('TIGERIQ_ROUTE_CHANGED');expect(background).toContain('chrome.action.setBadgeText');expect(background).toContain('workerId.slice(2)');});
});

describe('SerialQueue',()=>{it('runs exactly one task at a time',async()=>{const q=new SerialQueue(0);const order:string[]=[];const a=q.enqueue(async()=>{order.push('a:start');await new Promise(r=>setTimeout(r,20));order.push('a:end');});const b=q.enqueue(async()=>{order.push('b:start');order.push('b:end');});await Promise.all([a,b]);expect(order).toEqual(['a:start','a:end','b:start','b:end']);});});
