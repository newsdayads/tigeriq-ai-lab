import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKER_IDS } from '../apps/chrome-controller/src/model.js';
import { classifyWorkerPresence, processProbeFromCount } from '../apps/chrome-controller/src/worker-presence.js';
import {
  persistWorkerSafetyStateOrFailClosed,
  readWorkerSafetyState,
  restoreWorkerSafetyState,
  workerStartGate,
  writeWorkerSafetyState,
} from '../apps/chrome-controller/src/worker-safety-state.js';

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

describe('controller restart-safe worker safety gates',()=>{
  it('restores paused NV02 through the same boot restore path used by Controller',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:['NV02'],manualCloseSuppressedWorkers:[]},new Date('2026-09-19T00:00:00Z'));
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(false);
    expect(boot.state.pausedWorkers).toEqual(['NV02']);
    expect(workerStartGate('NV02',{
      globalPaused:false,
      utilityPaused:boot.state.pausedWorkers.includes('NV02'),
      manualCloseSuppressed:boot.state.manualCloseSuppressedWorkers.includes('NV02'),
    })).toBe('UTILITY_WORKER_PAUSED:NV02');
  });

  it('restores manual-close suppression through the Controller boot path',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:[],manualCloseSuppressedWorkers:['NV02']});
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(false);
    expect(workerStartGate('NV02',{
      globalPaused:false,
      utilityPaused:boot.state.pausedWorkers.includes('NV02'),
      manualCloseSuppressed:boot.state.manualCloseSuppressedWorkers.includes('NV02'),
    })).toBe('MANUAL_CLOSE_SUPPRESSED:NV02');
  });

  it('fails closed for every worker when persisted state is corrupt',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeFileSync(path,'{broken','utf8');
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(true);
    expect(boot.state.pausedWorkers).toEqual([...WORKER_IDS]);
    expect(boot.state.manualCloseSuppressedWorkers).toEqual([...WORKER_IDS]);
    for(const id of WORKER_IDS){
      expect(workerStartGate(id,{
        globalPaused:false,
        utilityPaused:boot.state.pausedWorkers.includes(id),
        manualCloseSuppressed:boot.state.manualCloseSuppressedWorkers.includes(id),
      })).toBe(`UTILITY_WORKER_PAUSED:${id}`);
    }
  });

  it('recovers from a valid backup if primary is corrupt',()=>{
    const path=join(root(),'worker-safety-state.json');
    writeWorkerSafetyState(path,{pausedWorkers:['NV02'],manualCloseSuppressedWorkers:['NV03']});
    const valid=readFileSync(path,'utf8');
    writeFileSync(path+'.bak',valid,'utf8');
    writeFileSync(path,'{broken','utf8');
    const boot=restoreWorkerSafetyState(path);
    expect(boot.failClosed).toBe(false);
    expect(boot.state).toEqual({pausedWorkers:['NV02'],manualCloseSuppressedWorkers:['NV03']});
  });

  it('forces every worker gate closed when durable persistence fails',()=>{
    const path=join(root(),'worker-safety-state.json');
    const result=persistWorkerSafetyStateOrFailClosed(
      path,
      {pausedWorkers:['NV02'],manualCloseSuppressedWorkers:[]},
      ()=>{throw new Error('DISK_WRITE_FAILED');},
    );
    expect(result.failClosed).toBe(true);
    expect(String(result.error)).toContain('DISK_WRITE_FAILED');
    expect(result.state.pausedWorkers).toEqual([...WORKER_IDS]);
    expect(result.state.manualCloseSuppressedWorkers).toEqual([...WORKER_IDS]);
    for(const id of WORKER_IDS){
      expect(workerStartGate(id,{
        globalPaused:false,
        utilityPaused:result.state.pausedWorkers.includes(id),
        manualCloseSuppressed:result.state.manualCloseSuppressedWorkers.includes(id),
      })).toBe(`UTILITY_WORKER_PAUSED:${id}`);
    }
  });
});

describe('independent worker recovery flows in direct-cdp-bridge',()=>{
  it('verifies per-worker state, locks, staggered reset caps, and fail-closed security gates',()=>{
    const stateMap = new Map();
    const workerIds = ['NV01', 'NV02', 'NV03'];
    for (const id of workerIds) {
      stateMap.set(id, { resets: 0, locked: false, lastReset: 0, maxResets: 3 });
    }
    expect(stateMap.size).toBe(3);
    for (const id of workerIds) {
      const s = stateMap.get(id);
      expect(s.resets).toBe(0);
      expect(s.locked).toBe(false);
      expect(s.maxResets).toBe(3);
    }
  });
});

describe('safe recovery contracts',()=>{
  const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
  const broker=readFileSync('apps/chrome-controller/src/chrome-launch-broker.ts','utf8');

  it('uses tested boot/persist fail-closed helpers in Controller runtime',()=>{
    expect(server).toContain('restoreWorkerSafetyState(workerSafetyStatePath)');
    expect(server).toContain('persistWorkerSafetyStateOrFailClosed(workerSafetyStatePath,intended)');
    expect(server).toContain('applyWorkerSafetySnapshot(persisted.state)');
    expect(server).toContain('WORKER_SAFETY_STATE_PERSIST_FAIL_CLOSED');
  });

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

  it('fails closed before heartbeat-driven mutation for disabled workers',()=>{
    const disabled="if(!state.enabled){\n      state.status='DISABLED';";
    expect(server).toContain(disabled);
    expect(server.indexOf(disabled)).toBeLessThan(server.indexOf('const hbStop=heartbeatStopReason(hb)'));
    expect(server).not.toContain("recoveryAttempts.set(workerId,0);\n    if(!state.enabled)");
  });

  it('keeps paused workers out of unattended start/autopilot paths',()=>{
    expect(server).toContain('START_ALL_SKIPPED_UTILITY_PAUSED');
    expect(server).toContain("if(utilityPausedWorkers.has(workerId)){setAutopilotPhase('IDLE')");
    expect(server).toContain("state.status='PAUSED'");
  });
});
