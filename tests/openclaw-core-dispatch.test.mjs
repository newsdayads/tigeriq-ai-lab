import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  buildOpenClawPrompt,
  compactOpenClawCliResult,
  ensureOpenClawDispatch,
  normalizeOpenClawDispatchEnvelope,
  hasHardGateTextIntent,
  parseOpenClawAgentResult,
  openClawTerminalDecision,
  safeOpenClawFailureMessage,
  trustedBridgeFileReadReceipt,
  trustedStructuredFileReadReceipt,
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

  it('allows explicit negated hard-gate guardrails but still rejects positive or double-negative intent', () => {
    expect(hasHardGateTextIntent('Do not use paid action, Production release, reboot or shutdown.')).toBe(false);
    expect(hasHardGateTextIntent('Never reboot or shutdown this PC.')).toBe(false);
    expect(hasHardGateTextIntent('No paid action.')).toBe(false);
    expect(hasHardGateTextIntent('reboot now')).toBe(true);
    expect(hasHardGateTextIntent('shutdown now')).toBe(true);
    expect(hasHardGateTextIntent('Perform a production deploy now.')).toBe(true);
    expect(hasHardGateTextIntent('Deploy this change to Production now.')).toBe(true);
    expect(hasHardGateTextIntent('Push this commit directly to main now.')).toBe(true);
    expect(hasHardGateTextIntent('Do not deploy this change to Production.')).toBe(false);
    expect(hasHardGateTextIntent('Never push this commit to main.')).toBe(false);
    expect(hasHardGateTextIntent('Do not avoid production deploy.')).toBe(true);
    expect(() => normalizeOpenClawDispatchEnvelope(envelope({
      instruction:'Verify TCP 127.0.0.1:18789. Do not use paid action, Production release, reboot or shutdown.',
    }))).not.toThrow();
  });

  it('matches hard gates under a fresh native Node runtime, not only the test transformer', () => {
    const moduleUrl=new URL('../apps/openclaw-tigeriq-runtime/dispatch.mjs',import.meta.url).href;
    const script=`import {hasHardGateTextIntent} from ${JSON.stringify(moduleUrl)}; const rows=['reboot now','Deploy this change to Production now.','Push this commit directly to main now.'].map(s=>hasHardGateTextIntent(s)); if(rows.some(v=>v!==true)) process.exit(7); process.stdout.write(JSON.stringify(rows));`;
    const out=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}).trim();
    expect(JSON.parse(out)).toEqual([true,true,true]);
  });

  it('never asks OpenClaw to select backlog and makes retry behavior idempotency-aware', () => {
    const prompt=buildOpenClawPrompt(envelope());
    expect(prompt).toContain('FORBIDDEN=backlog selection; P0 selection; new task selection');
    expect(prompt).toContain('On retry/recovery, inspect current state first');
    expect(prompt).toContain('do not repeat the mutation');
    expect(prompt).toContain('action=tcp_probe');
    expect(prompt).toContain('file_write then file_read');
    expect(prompt).toContain('Never invent action names such as tcp_connect');
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

  it('accepts only strict in-root flat file_read evidence as embedded trusted receipt', () => {
    const agentResult={status:'OK',evidence:{action:'file_read',ok:true,path:'D:\\TigerIQ\\State\\core-runtime-updater.json',size:3946},blocker:null};
    expect(trustedStructuredFileReadReceipt(agentResult)).toBe(true);
    expect(openClawTerminalDecision({
      exitCode:1,status:'error',agentResult,successfulToolNames:[],
    },{timedOut:false,parsedPresent:true})).toMatchObject({
      success:true,trustedToolReceipt:true,terminalReceiptTool:false,embeddedFileReadReceipt:true,
    });

    expect(trustedStructuredFileReadReceipt({...agentResult,evidence:{...agentResult.evidence,path:'C:\\Windows\\temp.txt'}})).toBe(false);
    expect(trustedStructuredFileReadReceipt({...agentResult,evidence:{...agentResult.evidence,ok:false}})).toBe(false);
    expect(trustedStructuredFileReadReceipt({...agentResult,evidence:{...agentResult.evidence,action:'file_write'}})).toBe(false);
    expect(trustedStructuredFileReadReceipt({...agentResult,blocker:'blocked'})).toBe(false);
    expect(openClawTerminalDecision({
      exitCode:1,status:'error',agentResult:null,successfulToolNames:[],
    },{timedOut:false,parsedPresent:true}).success).toBe(false);
  });

  it('trusts only a bounded structured tigeriq_pc file_read receipt from bridgeCalls', () => {
    const bridgeCalls=[{tool:'tigeriq_pc',result:{ok:true,action:'file_read',target:'pc01-local',data:{path:'D:\\TigerIQ\\State\\core-runtime-updater.json',size:42,content:'private'}}}];
    expect(trustedBridgeFileReadReceipt(bridgeCalls)).toBe(true);
    const terminal=openClawTerminalDecision({
      exitCode:1,
      status:'error',
      agentResult:{status:'SUCCESS',evidence:{content:'model summary is not itself trusted'}},
      successfulToolNames:[],
      bridgeCalls,
    },{timedOut:false,parsedPresent:true});
    expect(terminal).toMatchObject({success:true,trustedToolReceipt:true,bridgeFileReadReceipt:true});

    expect(trustedBridgeFileReadReceipt([{result:{ok:true,action:'file_write',target:'pc01-local',data:{path:'D:\\TigerIQ\\State\\x.json'}}}])).toBe(false);
    expect(trustedBridgeFileReadReceipt([{result:{ok:true,action:'file_read',target:'pc01-local',data:{path:'C:\\Windows\\x.txt'}}}])).toBe(false);
    expect(trustedBridgeFileReadReceipt([{result:{ok:true,action:'file_read',target:'other',data:{path:'D:\\TigerIQ\\State\\x.json'}}}])).toBe(false);
    expect(openClawTerminalDecision({
      exitCode:1,status:'error',
      agentResult:{status:'SUCCESS',evidence:{content:'not trusted'}},
      successfulToolNames:[],bridgeCalls:null,
    },{timedOut:false,parsedPresent:true}).success).toBe(false);
  });

  it('uses classification-only public failure messages and never raw agent text or stderr', () => {
    const raw='TOP SECRET FILE CONTENT';
    expect(safeOpenClawFailureMessage({
      terminal:{invalidTerminal:true,agentStatus:'success'},
      result:{status:'error',text:raw,stderr:raw},
    })).toBe('OPENCLAW_AGENT_TERMINAL_INVALID:status=success');
    expect(safeOpenClawFailureMessage({rateLimited:true,result:{text:raw}})).toBe('OPENCLAW_RATE_LIMIT');
    expect(safeOpenClawFailureMessage({timedOut:true,result:{text:raw}})).toBe('OPENCLAW_WORKER_TIMEOUT');
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

  it('classifies provider rate-limit text as retryable rate_limit without broadening generic errors', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'tigeriq-oc-1528-rate-'));
    try{
      const env=envelope({idempotencyKey:'core:OBJ-OC-RATE:JOB-OC-RATE-0001',jobId:'JOB-OC-RATE-0001',workOrderId:'OBJ-OC-RATE'});
      const first=await ensureOpenClawDispatch(env,{root,spawnWorker:()=>({pid:401}),processAlive:()=>false});
      await writeOpenClawDispatchRecord(first.recordPath,{...first.record,state:'failed',attempts:1,workerPid:401,failure:{kind:'rate_limit',message:'API rate limit reached'},completedAt:new Date().toISOString()});
      const retried=await ensureOpenClawDispatch(env,{root,retryFailed:true,spawnWorker:()=>({pid:402}),processAlive:()=>false});
      expect(retried.launched).toBe(true);
      expect(retried.record.attempts).toBe(2);
      expect(retried.record.envelope.idempotencyKey).toBe(env.idempotencyKey);
    } finally {
      await rm(root,{recursive:true,force:true});
    }
  });

  it('source classifies API rate-limit text before generic error and Core marks rate_limit retryable', async () => {
    const dispatch=await readFile(new URL('../apps/openclaw-tigeriq-runtime/dispatch.mjs',import.meta.url),'utf8');
    const core=await readFile(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(dispatch).toContain("rateLimited?'rate_limit'");
    expect(dispatch).toContain("'timeout','rate_limit'");
    expect(core).toContain("'busy','rate_limit'");
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
    expect(source).toContain("async function reconcileCoreOpenClawBoundedObjectives()");
    expect(source).toContain("metadata->>'executionSurface'='CORE_OPENCLAW_BOUNDED'");
    expect(source).toContain("j.status in ('done','failed')");
    expect(source).toContain("CORE_OPENCLAW_OBJECTIVE_RECONCILED");
    expect(source).toContain("if(t-lastOpenClawObjectiveReconcile>3000){await reconcileCoreOpenClawBoundedObjectives()");
  });
});
