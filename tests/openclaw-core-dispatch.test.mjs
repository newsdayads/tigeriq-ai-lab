import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildOpenClawPrompt,
  compactOpenClawCliResult,
  ensureOpenClawDispatch,
  normalizeOpenClawDispatchEnvelope,
  parseOpenClawAgentResult,
  readOpenClawDispatchRecord,
  writeOpenClawDispatchRecord,
} from '../apps/openclaw-tigeriq-runtime/dispatch.mjs';
import { parseManagerJson } from '../apps/tigeriq-core/manager-json.mjs';

function envelope(overrides={}) {
  return {
    jobId:'JOB-OC-TEST-0001',
    workOrderId:'OBJ-OC-TEST-0001',
    resourceScope:'core/objective/OBJ-OC-TEST-0001',
    idempotencyKey:'core:OBJ-OC-TEST-0001:JOB-OC-TEST-0001',
    instruction:'Write the bounded canary marker through the approved TigerIQ runtime tool and verify it.',
    acceptance:'Read the marker back through the approved TigerIQ runtime tool and return evidence.',
    authority:{production:false,paid:false,credentialSecurity:false,destructiveIrreversible:false,sourceMutation:false,arbitraryShell:false},
    ...overrides,
  };
}

describe('Core -> OpenClaw bounded dispatch #1528', () => {
  it('normalizes a fixed authority envelope and rejects hard gates', () => {
    const normalized=normalizeOpenClawDispatchEnvelope(envelope());
    expect(normalized.schema).toBe('TIGERIQ_OPENCLAW_DISPATCH_V1');
    expect(normalized.agentId).toBe('operator-local');
    expect(normalized.sessionKey).toMatch(/^agent:operator-local:tigeriq-/);
    expect(normalized.envelopeHash).toMatch(/^[a-f0-9]{64}$/);

    expect(() => normalizeOpenClawDispatchEnvelope(envelope({
      instruction:'Deploy this change to Production now.',
    }))).toThrow('OPENCLAW_HARD_GATE_TEXT_REFUSED');
    expect(() => normalizeOpenClawDispatchEnvelope(envelope({
      authority:{production:false,paid:false,credentialSecurity:false,destructiveIrreversible:false,sourceMutation:true,arbitraryShell:false},
    }))).toThrow('OPENCLAW_HARD_GATE_REFUSED');
  });

  it('never asks OpenClaw to select backlog and makes retry behavior idempotency-aware', () => {
    const prompt=buildOpenClawPrompt(envelope());
    expect(prompt).toContain('FORBIDDEN=backlog selection; P0 selection; new task selection');
    expect(prompt).toContain('On retry/recovery, inspect current state first');
    expect(prompt).toContain('do not repeat the mutation');
  });

  it('durably admits once, dedupes a live worker, and bounds orphan recovery', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'tigeriq-oc-1528-'));
    try{
      const spawn1=vi.fn(()=>({pid:101}));
      const first=await ensureOpenClawDispatch(envelope(),{root,spawnWorker:spawn1,processAlive:()=>false});
      expect(first.launched).toBe(true);
      expect(first.record.attempts).toBe(1);
      expect(spawn1).toHaveBeenCalledTimes(1);

      const live=await ensureOpenClawDispatch(envelope(),{root,spawnWorker:vi.fn(),processAlive:pid=>pid===101});
      expect(live.launched).toBe(false);
      expect(live.record.workerPid).toBe(101);

      const spawn2=vi.fn(()=>({pid:202}));
      const recovered=await ensureOpenClawDispatch(envelope(),{root,spawnWorker:spawn2,processAlive:()=>false});
      expect(recovered.launched).toBe(true);
      expect(recovered.record.attempts).toBe(2);
      expect(recovered.record.recoveryCount).toBe(1);

      const current=await readOpenClawDispatchRecord(recovered.recordPath);
      await writeOpenClawDispatchRecord(recovered.recordPath,{...current,state:'running',workerPid:202,attempts:2});
      const exhausted=await ensureOpenClawDispatch(envelope(),{root,spawnWorker:vi.fn(),processAlive:()=>false});
      expect(exhausted.launched).toBe(false);
      expect(exhausted.record.state).toBe('failed');
      expect(exhausted.record.failure.kind).toBe('orphaned_worker_retry_exhausted');
    } finally {
      await rm(root,{recursive:true,force:true});
    }
  });

  it('requires structured agent terminal evidence before treating CLI success as dispatch success', () => {
    expect(parseOpenClawAgentResult('{"status":"PASS","evidence":{"marker":"ok"},"blocker":null}')).toEqual(
      expect.objectContaining({status:'PASS'}),
    );
    const ok=compactOpenClawCliResult({
      status:'ok',
      result:{payloads:[{text:'{"status":"PASS","evidence":{"marker":"ok"},"blocker":null}'}],meta:{agentMeta:{}}},
    },0,'');
    expect(ok.agentResult.status).toBe('PASS');

    const bad=compactOpenClawCliResult({
      status:'ok',
      result:{payloads:[{text:'plain prose without terminal json'}],meta:{agentMeta:{}}},
    },0,'');
    expect(bad.agentResult).toBeNull();
  });

  it('retries one failed durable dispatch with the same idempotency record and then stops', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'tigeriq-oc-1528-retry-'));
    try{
      const env=envelope({idempotencyKey:'core:OBJ-OC-RETRY:JOB-OC-RETRY-0001',jobId:'JOB-OC-RETRY-0001',workOrderId:'OBJ-OC-RETRY'});
      const first=await ensureOpenClawDispatch(env,{root,spawnWorker:()=>({pid:301}),processAlive:()=>false});
      const failed={...first.record,state:'failed',attempts:1,workerPid:301,failure:{kind:'agent_terminal_invalid',message:'no structured tool evidence'},result:{status:'ok'},completedAt:new Date().toISOString()};
      await writeOpenClawDispatchRecord(first.recordPath,failed);

      const second=await ensureOpenClawDispatch(env,{root,retryFailed:true,spawnWorker:()=>({pid:302}),processAlive:()=>false});
      expect(second.launched).toBe(true);
      expect(second.record.attempts).toBe(2);
      expect(second.record.recoveryCount).toBe(1);
      expect(second.record.envelope.idempotencyKey).toBe(env.idempotencyKey);

      await writeOpenClawDispatchRecord(second.recordPath,{...second.record,state:'failed',failure:{kind:'agent_terminal_invalid',message:'still invalid'},completedAt:new Date().toISOString()});
      const exhausted=await ensureOpenClawDispatch(env,{root,retryFailed:true,spawnWorker:vi.fn(),processAlive:()=>false});
      expect(exhausted.launched).toBe(false);
      expect(exhausted.record.state).toBe('failed');
      expect(exhausted.record.attempts).toBe(2);
    } finally {
      await rm(root,{recursive:true,force:true});
    }
  });

  it('classifies exit-zero prose without structured terminal evidence as invalid', () => {
    const result=compactOpenClawCliResult({
      status:'ok',
      result:{payloads:[{text:'I would call the tool next, but no structured terminal evidence is present.'}],meta:{agentMeta:{}}},
    },0,'');
    expect(result.agentResult).toBeNull();
  });

  it('manager schema accepts pc_operator but still rejects unknown capabilities', () => {
    const decision=parseManagerJson(JSON.stringify({
      status:'continue',
      summary:'bounded pc action required',
      jobs:[{title:'PC canary',prompt:'Perform the already-assigned bounded PC runtime canary and return evidence.',capability:'pc_operator'}],
    }));
    expect(decision.jobs[0].capability).toBe('pc_operator');

    expect(() => parseManagerJson(JSON.stringify({
      status:'continue',
      summary:'bad',
      jobs:[{title:'bad',prompt:'bad bad bad',capability:'arbitrary_shell'}],
    }))).toThrow('MANAGER_SCHEMA_INVALID');
  });

  it('Core source routes pc_operator through OpenClaw without exposing it as a normal provider call', async () => {
    const source=await readFile(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(source).toContain("capabilities:['pc_operator']");
    expect(source).toContain("if(j.capability==='pc_operator'){await runOpenClawOperatorJob(j);return;}");
    expect(source).toContain("OPENCLAW_DISPATCH_ADMITTED");
    expect(source).toContain("OPENCLAW_JOB_RECOVERED_AFTER_CORE_RESTART");
    expect(source).toContain("update tigeriq_ai_resources set enabled=$2");
    expect(source).toContain("general|reasoning|review|pc_operator");
    expect(source).toContain("function pcOperatorJobId(objectiveId,phaseIndex,ordinal)");
    expect(source).toContain("max_attempts) values($1,$2,$3,$4,$5,$6,2) on conflict(id) do nothing");
    expect(source).toContain("OPENCLAW_JOB_DEDUPED");
    expect(source).toContain("OPENCLAW_JOB_RETRY_QUEUED");
    expect(source).toContain("retryFailed:true");
  });
});
