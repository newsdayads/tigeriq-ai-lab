import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePlacements, isWorkerEnabled, validateConfig, type ControllerConfig } from '../apps/chrome-controller/src/model.js';
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
    workers: [
      { id:'NV02', role:'PRIMARY_EXECUTOR', profileDirectory:'Default', homeUrl:'https://chatgpt.com/g/g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab' },
      { id:'NV03', role:'INDEPENDENT_REVIEW', profileDirectory:'Profile 3', homeUrl:'https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab' },
      { id:'NV04', role:'DEEP_RESEARCH_CROSS_CHECK', profileDirectory:'Default', homeUrl:'https://gemini.google.com/notebook/c3a7911e-5a73-41c6-b7db-2e3b17d3983a' },
    ],
  };
}

describe('chrome-controller layout',()=>{
  it('places NV02 | NV03 | NV04 at the expected 4096px right-side cluster',()=>{
    const p=computePlacements(baseConfig(),{left:0,top:0,width:4096,height:2120});
    expect(p.NV02).toEqual({left:2572,top:0,width:500,height:834});
    expect(p.NV03).toEqual({left:3080,top:0,width:500,height:834});
    expect(p.NV04).toEqual({left:3588,top:0,width:500,height:834});
  });
});

describe('chrome-controller config guardrails',()=>{
  it('accepts shared profile when workers use different domains',()=>expect(validateConfig(baseConfig()).host).toBe('127.0.0.1'));
  it('defaults worker enabled to true for backward compatibility',()=>{
    const c=validateConfig(baseConfig());
    expect(c.workers.map(w=>w.enabled)).toEqual([true,true,true]);
    expect(c.workers.every(isWorkerEnabled)).toBe(true);
  });
  it('preserves an explicitly disabled worker',()=>{
    const c=baseConfig();c.workers[2].enabled=false;
    const validated=validateConfig(c);
    expect(validated.workers[2]).toMatchObject({id:'NV04',enabled:false});
    expect(isWorkerEnabled(validated.workers[2])).toBe(false);
  });
  it('rejects a non-boolean enabled value',()=>{
    const c=baseConfig() as unknown as {workers:Array<Record<string,unknown>>};c.workers[0].enabled='false';
    expect(()=>validateConfig(c)).toThrow('CONFIG_ENABLED_MUST_BE_BOOLEAN:NV02');
  });
  it('rejects non-loopback binding',()=>{const c={...baseConfig(),host:'0.0.0.0'} as unknown;expect(()=>validateConfig(c)).toThrow('CONFIG_HOST_MUST_BE_LOOPBACK');});
  it('rejects same-profile same-host collision',()=>{const c=baseConfig();c.workers[1].profileDirectory='Default';expect(()=>validateConfig(c)).toThrow('CONFIG_PROFILE_HOST_COLLISION:NV03');});
  it('rejects unsupported worker URLs',()=>{const c=baseConfig();c.workers[0].homeUrl='https://example.com/';expect(()=>validateConfig(c)).toThrow('CONFIG_HOME_URL_NOT_ALLOWED:NV02');});
  it('rejects pacing that is too aggressive',()=>{const c=baseConfig();c.pacing.betweenWorkerLaunchMs=1000;expect(()=>validateConfig(c)).toThrow('CONFIG_STARTUP_GAP_MIN_5000MS');});
});

describe('chrome-controller worker URL policy',()=>{
  it('keeps ChatGPT workers bound to their exact TigerIQ project',()=>{
    expect(matchesWorker('NV02','https://chatgpt.com/g/g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab/c/test')).toBe(true);
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

describe('chrome-controller popup',()=>{
  it('wires the popup and limits it to status/config UI scope',()=>{
    const manifest=JSON.parse(readFileSync('apps/chrome-controller/extension/manifest.json','utf8')) as { action?: { default_popup?: string } };
    const popup=readFileSync('apps/chrome-controller/extension/popup.js','utf8');
    const html=readFileSync('apps/chrome-controller/extension/popup.html','utf8');
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(html).toContain('id="profileWorkers"');
    expect(html).toContain('id="controllerStatus"');
    expect(html).toContain('id="options"');
    expect(popup).toContain("chrome.storage.local.get(['workerIds'])");
    expect(popup).toContain("/api/state");
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
