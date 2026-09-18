import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyWorkerPresence, processProbeFromCount } from '../apps/chrome-controller/src/worker-presence.js';
import { readWorkerSafetyState, workerStartGate, writeWorkerSafetyState } from '../apps/chrome-controller/src/worker-safety-state.js';

const roots:string[]=[];
function root(){const p=mkdtempSync(join(tmpdir(),'tigeriq-recovery-'));roots.push(p);return p;}
afterEach(()=>{while(roots.length)rmSync(roots.pop()!,{recursive:true,force:true});});

describe('worker presence classification',()=>{
  it('treats live CDP as RUNNING',()=>{
    expect(classifyWorkerPresence(true,'UNKNOWN')).toBe('RUNNING');
    expect(classifyWorkerPresence(true,'ABSENT')).toBe('RUNNING');
  });
  it('requires explicit process absence before ABSENT',()=>{
    expect(processProbeFromCount(0,undefined)).toBe('ABSENT');
    expect(processProbeFromCount(1,undefined)).toBe('PRESENT');
    expect(processProbeFromCount(undefined,false)).toBe('UNKNOWN');
    expect(processProbeFromCount(undefined,true)).toBe('PRESENT');
    expect(classifyWorkerPresence(false,'ABSENT')).toBe('ABSENT');
    expect(classifyWorkerPresence(false,'PRESENT')).toBe('AMBIGUOUS');
    expect(classifyWorkerPresence(false,'UNKNOWN')).toBe('AMBIGUOUS');
  });
});

describe('restart-safe worker safety state',()=>{
  it('restores pause after restart and blocks worker start',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:['NV02'],manualCloseSuppressedWorkers:[]},new Date('2026-09-19T00:00:00Z'));
    const restored=readWorkerSafetyState(path);
    expect(restored.pausedWorkers).toEqual(['NV02']);
    expect(workerStartGate('NV02',{globalPaused:false,utilityPaused:restored.pausedWorkers.includes('NV02'),manualCloseSuppressed:false}))
      .toBe('UTILITY_WORKER_PAUSED:NV02');
  });

  it('restores manual-close suppression after restart and blocks worker start',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:[],manualCloseSuppressedWorkers:['NV02']});
    const restored=readWorkerSafetyState(path);
    expect(restored.manualCloseSuppressedWorkers).toEqual(['NV02']);
    expect(workerStartGate('NV02',{globalPaused:false,utilityPaused:false,manualCloseSuppressed:restored.manualCloseSuppressedWorkers.includes('NV02')}))
      .toBe('MANUAL_CLOSE_SUPPRESSED:NV02');
  });

  it('fails closed when persisted safety state is corrupt',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeFileSync(path,'{broken','utf8');
    expect(()=>readWorkerSafetyState(path)).toThrow('WORKER_SAFETY_STATE_CORRUPT');
  });

  it('recovers from a valid backup if primary is corrupt',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:['NV02'],manualCloseSuppressedWorkers:['NV03']});
    const valid=readFileSync(path,'utf8');
    writeFileSync(path+'.bak',valid,'utf8');
    writeFileSync(path,'{broken','utf8');
    expect(readWorkerSafetyState(path)).toEqual({pausedWorkers:['NV02'],manualCloseSuppressedWorkers:['NV03']});
  });
});

describe('safe recovery contracts',()=>{
  const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
  const broker=readFileSync('apps/chrome-controller/src/chrome-launch-broker.ts','utf8');

  it('makes utility pause and manual close hard gates for worker start/recovery',()=>{
    const start=server.slice(server.indexOf('async function startWorker'),server.indexOf('async function dispatch'));
    const recovery=server.slice(server.indexOf('async function recoverWorker'),server.indexOf('async function recoveryTick'));
    expect(start).toContain('workerStartGate');
    expect(recovery).toContain('utilityPausedWorkers.has(workerId)');
    expect(recovery).toContain("presence==='ABSENT'");
    expect(recovery).toContain('RECOVERY_PRESENCE_FAIL_CLOSED');
  });

  it('uses broker presence proof instead of blindly reopening stale windows',()=>{
    expect(server).toContain('/api/presence/');
    expect(broker).toContain('presenceMatch');
    expect(broker).toContain('chrome-launch-broker-state.json');
    expect(broker).toContain('Get-CimInstance Win32_Process');
    expect(broker).toContain('processProbeFromCount(undefined');
    expect(broker).toContain('WORKER_PROCESS_AMBIGUOUS');
  });

  it('keeps paused workers out of unattended start/autopilot paths and persists the gate',()=>{
    expect(server).toContain('START_ALL_SKIPPED_UTILITY_PAUSED');
    expect(server).toContain("if(utilityPausedWorkers.has('NV02')){setAutopilotPhase('IDLE')");
    expect(server).toContain("state.status='PAUSED'");
    expect(server).toContain('worker-safety-state.json');
    expect(server).toContain('WORKER_SAFETY_STATE_FAIL_CLOSED');
    expect(server).toContain('WORKER_SAFETY_STATE_PERSIST_FAIL_CLOSED');
  });
});
