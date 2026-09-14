import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTO_CONTINUE, decideAutoContinue, freshAutopilotState, validateExternalSnapshot, type ExternalAutopilotSnapshot } from '../apps/chrome-controller/src/autopilot.js';
import { computePlacements, isWorkerEnabled, validateConfig, type ControllerConfig } from '../apps/chrome-controller/src/model.js';
import { buildRuntimeEvidence } from '../apps/chrome-controller/src/runtime-evidence.js';
import { SerialQueue } from '../apps/chrome-controller/src/serial-queue.js';
import { allowedUrl, matchesWorker } from '../apps/chrome-controller/extension/url-policy.js';

function baseConfig(): ControllerConfig {
  return {
    host: '127.0.0.1', port: 8798,
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
    logDir: 'D:\\TigerIQ\\Apps\\ChromeController\\Runtime',
    layout: { width:500,height:834,gap:8,rightMargin:8,top:0,fallbackWorkAreaWidth:4096,fallbackWorkAreaLeft:0 },
    pacing: { betweenWorkerLaunchMs:30000,postReadySettlingMs:10000,minUiActionGapMs:8000,commandTimeoutMs:60000,workerReadyTimeoutMs:180000,maxRetries:1,retryBackoffMs:15000 },
    autopilot: { enabled:true,pollIntervalMs:15000,requestTimeoutMs:5000 },
    recovery: { heartbeatStaleMs:45000,checkIntervalMs:10000,maxReopenAttempts:2,reopenBackoffMs:15000,startupReadyUrl:'http://127.0.0.1:8795/health',startupReadyTimeoutMs:120000 },
    workers: [
      { id:'NV05', role:'PRIMARY_AUTOPILOT_UI', profileDirectory:'Profile 5', homeUrl:'https://chatgpt.com/g/test-nv05' },
      { id:'NV03', role:'INDEPENDENT_REVIEW', profileDirectory:'Profile 3', homeUrl:'https://chatgpt.com/g/test-nv03' },
      { id:'NV04', role:'RESEARCH_REVIEW', profileDirectory:'Profile 4', homeUrl:'https://gemini.google.com/notebook/test' },
    ],
  };
}

function snapshot(overrides: Partial<ExternalAutopilotSnapshot> = {}): ExternalAutopilotSnapshot {
  return {
    source:'GITHUB',
    observedAt:'2026-09-15T01:00:00.000Z',
    revision:'issue-763-v1',
    previousJob:{jobId:'JOB-1',workerId:'NV05',status:'DONE',executable:true,priority:'P0',evidence:[{source:'GITHUB',ref:'https://github.com/newsdayads/tigeriq-ai-lab/issues/763#evidence'}]},
    nextJob:{jobId:'JOB-2',workerId:'NV05',status:'READY',executable:true,priority:'P0',prompt:'LÀM — NO YAPPING. Execute JOB-2 from authoritative state.'},
    ...overrides,
  };
}

describe('chrome-controller layout',()=>{
  it('places NV05 | NV03 | NV04 at the expected 4096px right-side cluster',()=>{
    const p=computePlacements(baseConfig(),{left:0,top:0,width:4096,height:2120});
    expect(p.NV05).toEqual({left:2572,top:0,width:500,height:834});
    expect(p.NV03).toEqual({left:3080,top:0,width:500,height:834});
    expect(p.NV04).toEqual({left:3588,top:0,width:500,height:834});
  });
  it('anchors to the real work-area left edge rather than assuming zero',()=>{
    const p=computePlacements(baseConfig(),{left:-1200,top:40,width:3277,height:1688});
    expect(p.NV05.left).toBe(549);
    expect(p.NV03.left).toBe(1057);
    expect(p.NV04.left).toBe(1565);
    expect(p.NV05.top).toBe(40);
  });
});

describe('chrome-controller config guardrails',()=>{
  it('accepts the canonical NV05 | NV03 | NV04 order',()=>expect(validateConfig(baseConfig()).workers.map(w=>w.id)).toEqual(['NV05','NV03','NV04']));
  it('defaults optional autopilot and recovery config for backward-compatible JSON',()=>{
    const c=baseConfig() as unknown as Record<string,unknown>; delete c.autopilot; delete c.recovery;
    const validated=validateConfig(c);
    expect(validated.autopilot).toMatchObject({enabled:true,pollIntervalMs:15000});
    expect(validated.recovery).toMatchObject({heartbeatStaleMs:45000,maxReopenAttempts:2});
  });
  it('defaults worker enabled to true',()=>expect(validateConfig(baseConfig()).workers.map(w=>w.enabled)).toEqual([true,true,true]));
  it('preserves an explicitly disabled worker',()=>{const c=baseConfig();c.workers[2].enabled=false;expect(validateConfig(c).workers[2]).toMatchObject({id:'NV04',enabled:false});});
  it('rejects a non-boolean enabled value',()=>{const c=baseConfig() as unknown as {workers:Array<Record<string,unknown>>};c.workers[0].enabled='false';expect(()=>validateConfig(c)).toThrow('CONFIG_ENABLED_MUST_BE_BOOLEAN:NV05');});
  it('rejects the old 3-5-4 order',()=>{const c=baseConfig();c.workers=[c.workers[1],c.workers[0],c.workers[2]];expect(()=>validateConfig(c)).toThrow('CONFIG_WORKER_ORDER_MUST_BE_NV05_NV03_NV04');});
  it('rejects non-loopback binding and external control-plane URLs',()=>{
    expect(()=>validateConfig({...baseConfig(),host:'0.0.0.0'} as unknown)).toThrow('CONFIG_HOST_MUST_BE_LOOPBACK');
    const c=baseConfig();c.autopilot.stateUrl='https://example.com/state';expect(()=>validateConfig(c)).toThrow('CONFIG_AUTOPILOT_STATE_URL_MUST_BE_LOOPBACK');
  });
  it('rejects same-profile same-host collision',()=>{const c=baseConfig();c.workers[0].profileDirectory='Profile 3';expect(()=>validateConfig(c)).toThrow('CONFIG_PROFILE_HOST_COLLISION:NV03');});
  it('rejects unsupported worker URLs',()=>{const c=baseConfig();c.workers[0].homeUrl='https://example.com/';expect(()=>validateConfig(c)).toThrow('CONFIG_HOME_URL_NOT_ALLOWED:NV05');});
  it('rejects aggressive UI and recovery pacing',()=>{
    const c=baseConfig();c.pacing.betweenWorkerLaunchMs=1000;expect(()=>validateConfig(c)).toThrow('CONFIG_STARTUP_GAP_MIN_5000MS');
    const r=baseConfig();r.recovery.heartbeatStaleMs=1000;expect(()=>validateConfig(r)).toThrow('CONFIG_RECOVERY_PACING_INVALID');
  });
});

describe('NV05 completion watcher and autopilot',()=>{
  it('uses one fixed trigger and dispatches only after terminal external evidence',()=>{
    const decision=decideAutoContinue(snapshot(),freshAutopilotState());
    expect(AUTO_CONTINUE).toBe('AUTO_CONTINUE');
    expect(decision).toMatchObject({kind:'DISPATCH',trigger:'AUTO_CONTINUE',jobId:'JOB-2'});
  });
  it('waits while the previous job is non-terminal',()=>{
    const s=snapshot({previousJob:{jobId:'JOB-1',workerId:'NV05',status:'RUNNING',executable:true,priority:'P0'}});
    expect(decideAutoContinue(s,freshAutopilotState())).toMatchObject({kind:'BUSY'});
  });
  it('requires GitHub/Core evidence after terminal completion',()=>{
    const s=snapshot({previousJob:{jobId:'JOB-1',workerId:'NV05',status:'DONE',executable:true,priority:'P0'}});
    expect(decideAutoContinue(s,freshAutopilotState())).toMatchObject({kind:'WAIT_EVIDENCE'});
  });
  it('does not duplicate an already reserved job',()=>{
    const state={...freshAutopilotState(),lastDispatchedJobId:'JOB-2'};
    expect(decideAutoContinue(snapshot(),state)).toEqual({kind:'DUPLICATE_NOOP',reason:'JOB_ALREADY_DISPATCHED',jobId:'JOB-2'});
  });
  it('idles for no work, P2, non-NV05, or non-executable jobs',()=>{
    expect(decideAutoContinue(snapshot({nextJob:undefined}),freshAutopilotState())).toMatchObject({kind:'IDLE'});
    expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV05',status:'READY',executable:true,priority:'P2',prompt:'x'}}),freshAutopilotState())).toMatchObject({kind:'IDLE'});
    expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV03',status:'READY',executable:true,priority:'P0',prompt:'x'}}),freshAutopilotState())).toMatchObject({kind:'IDLE'});
    expect(decideAutoContinue(snapshot({nextJob:{jobId:'J',workerId:'NV05',status:'READY',executable:false,priority:'P0',prompt:'x'}}),freshAutopilotState())).toMatchObject({kind:'IDLE'});
  });
  it('stops on authorization/security risk flags and rejects untrusted snapshot sources',()=>{
    const risky=snapshot({nextJob:{jobId:'J',workerId:'NV05',status:'READY',executable:true,priority:'P0',prompt:'x',riskFlags:['PRODUCTION_RELEASE']}});
    expect(decideAutoContinue(risky,freshAutopilotState())).toMatchObject({kind:'STOP',reason:'RISK_FLAG_PRODUCTION_RELEASE'});
    expect(()=>validateExternalSnapshot({...snapshot(),source:'CHAT'})).toThrow('AUTOPILOT_SNAPSHOT_SOURCE_MUST_BE_GITHUB_OR_CORE');
  });
});

describe('machine-readable runtime evidence',()=>{
  it('exports canonical layout, queue concurrency, no-AI-output parsing, and bounded recovery',()=>{
    const evidence=buildRuntimeEvidence({config:baseConfig(),workArea:{left:0,top:0,width:4096,height:2120},workers:baseConfig().workers.map(w=>({id:w.id,enabled:true,status:'READY',blocked:false})),autopilot:freshAutopilotState(),snapshot:snapshot(),paused:false,killed:false,recoveryAttempts:{NV05:0,NV03:0,NV04:0},startupReady:true});
    expect(evidence.layout.order).toEqual(['NV05','NV03','NV04']);
    expect(evidence.layout).toMatchObject({width:500,height:834,gap:8,rightAnchored:true,source:'HEARTBEAT_WORK_AREA'});
    expect(evidence.queue.globalUiConcurrency).toBe(1);
    expect(evidence.autopilot).toMatchObject({fixedTrigger:'AUTO_CONTINUE',aiOutputParsed:false});
    expect(evidence.security).toMatchObject({stealth:false,fakeHuman:false,credentialExtraction:false});
    expect(evidence.recovery.maxReopenAttempts).toBe(2);
  });
});

describe('chrome-controller worker URL policy',()=>{
  it('keeps ChatGPT workers bound to their exact TigerIQ project',()=>{
    expect(matchesWorker('NV03','https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/c/test')).toBe(true);
    expect(matchesWorker('NV03','https://chatgpt.com/g/other-project')).toBe(false);
  });
  it('accepts Gemini notebook and live app conversation routes for NV04',()=>{
    expect(matchesWorker('NV04','https://gemini.google.com/notebook/c3a7911e-5a73-41c6-b7db-2e3b17d3983a')).toBe(true);
    expect(matchesWorker('NV04','https://gemini.google.com/app/85001b78fca5a010')).toBe(true);
  });
  it('fails closed for bare or unrelated Gemini routes',()=>{
    expect(matchesWorker('NV04','https://gemini.google.com/app/')).toBe(false);
    expect(matchesWorker('NV04','https://gemini.google.com/')).toBe(false);
    expect(matchesWorker('NV04','https://example.com/app/85001b78fca5a010')).toBe(false);
    expect(allowedUrl('https://example.com/app/85001b78fca5a010')).toBe(false);
  });
});

describe('worker badges and popup',()=>{
  it('keeps NV04 overlay self-healing after SPA rerenders with toolbar badge fallback',()=>{
    const content=readFileSync('apps/chrome-controller/extension/content.js','utf8');
    const background=readFileSync('apps/chrome-controller/extension/background.js','utf8');
    expect(content).toContain('new MutationObserver');
    expect(content).toContain('ensureWorkerBadge');
    expect(content).toContain('TIGERIQ_ROUTE_CHANGED');
    expect(background).toContain('chrome.action.setBadgeText');
    expect(background).toContain("workerId.slice(2)");
  });
  it('wires the popup and limits it to status/config UI scope',()=>{
    const manifest=JSON.parse(readFileSync('apps/chrome-controller/extension/manifest.json','utf8')) as { action?: { default_popup?: string } };
    const popup=readFileSync('apps/chrome-controller/extension/popup.js','utf8');
    const html=readFileSync('apps/chrome-controller/extension/popup.html','utf8');
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(html).toContain('id="profileWorkers"');
    expect(html).toContain('id="controllerStatus"');
    expect(html).toContain('id="options"');
    expect(popup).toContain("chrome.storage.local.get(['workerIds'])");
    expect(popup).toContain('/api/state');
    expect(popup).toContain('chrome.runtime.openOptionsPage');
    expect(popup).not.toMatch(/cookies|password|token|stealth|anti-bot/i);
  });
});

describe('SerialQueue',()=>{
  it('runs tasks one at a time in submission order',async()=>{
    const q=new SerialQueue(0);const order:string[]=[];
    const a=q.enqueue(async()=>{order.push('a:start');await new Promise(r=>setTimeout(r,20));order.push('a:end');});
    const b=q.enqueue(async()=>{order.push('b:start');order.push('b:end');});
    await Promise.all([a,b]);expect(order).toEqual(['a:start','a:end','b:start','b:end']);
  });
});
