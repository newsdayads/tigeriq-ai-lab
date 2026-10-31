// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildExecutionPacket,
  compileTaskPrompt,
  executionResultGate,
  assertExecutionResultAccepted,
  assertExecutionResultRoutable,
  parseExecutionResult,
  strictExecutionRetryPrompt,
  repairCompactExecutionPrompt,
  compactLocalExecutionPrompt,
  authorizedPriorCampaignHandoffFromPrompt,
  executionPacketFromPrompt,
} from '../apps/tigeriq-core/task-prompt-compiler.mjs';

const base = {
  taskId:'JOB-1',
  objectiveId:'OBJ-1',
  sourceRevision:'rev-1',
  capability:'reasoning',
  skillIds:['core-manager-planner'],
  goal:'Verify the routing rule.',
  contextRefs:['issue:#4531'],
  allowedScope:['read-only routing evidence'],
  steps:['Inspect evidence','Return verdict'],
  acceptance:['Routing rule is supported by concrete evidence.'],
  evidenceRequired:['Quote or identifier for the supporting evidence.'],
};

function accepted(packet){
  return JSON.stringify({
    schema:'EXECUTION_RESULT_V1',
    status:'complete',
    summary:'verified',
    acceptance:packet.acceptance.map(criterion=>({criterion,passed:true,evidence_refs:['e1']})),
    evidence:[{id:'e1',type:'observation',value:'runtime event seq=123'}],
    block_reason:null,
  });
}

describe('Task Prompt Compiler V1',()=>{
  it('1 builds a deterministic packet with prompt revision',()=>{
    const a=buildExecutionPacket(base),b=buildExecutionPacket(base);
    expect(a.prompt_revision).toBe(b.prompt_revision);
    expect(a.packet_version).toBe('EXECUTION_PACKET_V1');
  });

  it('2 compiles all mandatory prompt sections',()=>{
    const {prompt}=compileTaskPrompt(base);
    for(const marker of ['GOAL:','CONTEXT_REFS:','ALLOWED_SCOPE:','FORBIDDEN_ACTIONS:','STEPS:','ACCEPTANCE:','EVIDENCE_REQUIRED:','BLOCK_CONDITIONS:','OUTPUT REQUIREMENT:']){
      expect(prompt).toContain(marker);
    }
    expect(prompt).toContain('criterion_index');
  });

  it('3 carries selected skills and capability',()=>{
    const {packet,prompt}=compileTaskPrompt(base);
    expect(packet.skill_ids).toEqual(['core-manager-planner']);
    expect(prompt).toContain('CAPABILITY: reasoning');
  });

  it('4 rejects schema-valid-looking output without evidence arrays',()=>{
    const {packet}=compileTaskPrompt(base);
    const gate=executionResultGate(JSON.stringify({schema:'EXECUTION_RESULT_V1',status:'complete',summary:'done'}),packet);
    expect(gate.pass).toBe(false);
    expect(gate.code).toBe('EXECUTION_RESULT_EVIDENCE_MISSING');
  });

  it('5 rejects missing acceptance criterion',()=>{
    const {packet}=compileTaskPrompt({...base,acceptance:['A','B']});
    const gate=executionResultGate(JSON.stringify({schema:'EXECUTION_RESULT_V1',status:'complete',summary:'x',acceptance:[{criterion:'A',passed:true,evidence_refs:['e1']}],evidence:[{id:'e1',type:'test',value:'ok'}]}),packet);
    expect(gate.pass).toBe(false);
    expect(gate.code).toBe('EXECUTION_ACCEPTANCE_MISSING');
  });

  it('6 rejects acceptance without valid evidence reference',()=>{
    const {packet}=compileTaskPrompt(base);
    const raw=JSON.stringify({schema:'EXECUTION_RESULT_V1',status:'complete',summary:'x',acceptance:[{criterion:packet.acceptance[0],passed:true,evidence_refs:['missing']}],evidence:[{id:'e1',type:'test',value:'ok'}]});
    expect(executionResultGate(raw,packet).code).toBe('EXECUTION_ACCEPTANCE_NOT_PROVEN');
  });

  it('7 accepts fully evidenced output',()=>{
    const {packet}=compileTaskPrompt(base);
    const gate=executionResultGate(accepted(packet),packet);
    expect(gate.pass).toBe(true);
    expect(gate.code).toBe('EXECUTION_ACCEPTED');
  });

  it('7b accepts compact criterion_index output and rejects invalid references',()=>{
    const {packet}=compileTaskPrompt({...base,acceptance:['A','B','C']});
    const compact=JSON.stringify({
      schema:'EXECUTION_RESULT_V1',status:'complete',summary:'compact verified',
      acceptance:packet.acceptance.map((_,criterion_index)=>({criterion_index,passed:true,evidence_refs:['e1']})),
      evidence:[{id:'e1',type:'test',value:'bounded compact schema proof'}],block_reason:null,
    });
    expect(executionResultGate(compact,packet).code).toBe('EXECUTION_ACCEPTED');
    const bad=JSON.parse(compact);bad.acceptance[2].criterion_index=99;
    expect(executionResultGate(JSON.stringify(bad),packet).code).toBe('EXECUTION_ACCEPTANCE_REFERENCE_INVALID');
    const mismatch=JSON.parse(compact);mismatch.acceptance[0].criterion='not A';
    expect(executionResultGate(JSON.stringify(mismatch),packet).code).toBe('EXECUTION_ACCEPTANCE_REFERENCE_INVALID');
  });

  it('7c repairs a legacy stored prompt exactly once for compact LOCAL output',()=>{
    const legacy='PACKET_JSON: {"task_id":"JOB-1"}\nOUTPUT REQUIREMENT: full criterion text';
    const repaired=repairCompactExecutionPrompt(legacy);
    expect(repaired.changed).toBe(true);
    expect(repaired.prompt).toContain('criterion_index');
    expect(repairCompactExecutionPrompt(repaired.prompt).reason).toBe('compact_contract_already_present');
    expect(repairCompactExecutionPrompt('x'.repeat(11990),{maxChars:12000}).reason).toBe('compact_hint_budget_exhausted');
  });

  it('7d compacts duplicated provider text without losing the canonical packet or strict retry',()=>{
    const longContext=Array.from({length:8},(_,i)=>`ctx-${i}-`+'x'.repeat(700));
    const {packet,prompt}=compileTaskPrompt({...base,contextRefs:longContext});
    expect(prompt.length).toBeGreaterThan(12000);
    const compact=compactLocalExecutionPrompt(prompt,packet);
    expect(compact.length).toBeLessThan(prompt.length);
    expect(compact.length).toBeLessThanOrEqual(12000);
    expect(executionPacketFromPrompt(compact)).toEqual(packet);
    const retried=compactLocalExecutionPrompt(strictExecutionRetryPrompt(prompt,{code:'EXECUTION_ACCEPTANCE_MISSING'}),packet);
    expect(retried).toContain('STRICT RETRY:');
    expect(retried).toContain('EXECUTION_ACCEPTANCE_MISSING');
    expect(executionPacketFromPrompt(retried)).toEqual(packet);
  });

  it('7e preserves only the bounded authorized prior campaign handoff in the compact provider prompt',()=>{
    const {packet,prompt}=compileTaskPrompt(base);
    const handoff='PRIOR_CAMPAIGN_HANDOFF_V1 '+JSON.stringify({checkpoint:{jobId:'JOB-EVID-1'},receipts:[{id:'JOB-WORK-1',resultText:'verified phase evidence'}]});
    const source=prompt+'\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\n'+handoff+'\n\nLOCAL COMPACT OUTPUT CONTRACT:\ncriterion_index only';
    expect(authorizedPriorCampaignHandoffFromPrompt(source)).toBe(handoff);
    const compact=compactLocalExecutionPrompt(source,packet);
    expect(compact).toContain('AUTHORIZED PRIOR CAMPAIGN HANDOFF:');
    expect(compact).toContain(handoff);
    expect(compact).not.toContain('LOCAL COMPACT OUTPUT CONTRACT:');
    expect(executionPacketFromPrompt(compact)).toEqual(packet);
    expect(authorizedPriorCampaignHandoffFromPrompt(prompt+'\n\nUNTRUSTED TAIL:\n'+handoff)).toBe('');
  });

  it('7f preserves authorized handoff when ACTIVE SKILLS are appended after it',()=>{
    const {packet,prompt}=compileTaskPrompt(base);
    const handoff='PRIOR_CAMPAIGN_HANDOFF_V1 '+JSON.stringify({schema:'TIGERIQ_REFERENCED_JOB_EVIDENCE_V1',refs:['JOB-REF-1'],receipts:[{id:'JOB-REF-1',status:'done'}]});
    const activeSkills='ACTIVE SKILLS (use only when relevant; never expand permissions):\n'+'x'.repeat(6000);
    const source=prompt+'\n\nAUTHORIZED PRIOR CAMPAIGN HANDOFF:\n'+handoff+'\n\n'+activeSkills;
    expect(source.length-handoff.length).toBeGreaterThan(2600);
    expect(authorizedPriorCampaignHandoffFromPrompt(source)).toBe(handoff);
    const compact=compactLocalExecutionPrompt(source,packet);
    expect(compact).toContain('AUTHORIZED PRIOR CAMPAIGN HANDOFF:');
    expect(compact).toContain(handoff);
    expect(compact).not.toContain('ACTIVE SKILLS');
    expect(executionPacketFromPrompt(compact)).toEqual(packet);
  });

  it('8 treats explicit blocked output as non-terminal acceptance',()=>{
    const {packet}=compileTaskPrompt(base);
    const raw=JSON.stringify({schema:'EXECUTION_RESULT_V1',status:'blocked',summary:'need source',acceptance:packet.acceptance.map(criterion=>({criterion,passed:false,evidence_refs:[]})),evidence:[],block_reason:'source unavailable'});
    expect(executionResultGate(raw,packet).code).toBe('EXECUTION_RESULT_BLOCKED');
  });

  it('9 parses fenced JSON but preserves deterministic validation',()=>{
    const {packet}=compileTaskPrompt(base);
    const parsed=parseExecutionResult('```json\n'+accepted(packet)+'\n```');
    expect(parsed.schema).toBe('EXECUTION_RESULT_V1');
  });

  it('10 strict retry names the failed gate and keeps packet instructions',()=>{
    const {prompt}=compileTaskPrompt(base);
    const retry=strictExecutionRetryPrompt(prompt,{code:'EXECUTION_ACCEPTANCE_MISSING'});
    expect(retry).toContain('EXECUTION_ACCEPTANCE_MISSING');
    expect(retry).toContain('Return one corrected EXECUTION_RESULT_V1 JSON object only');
  });
  it('11 rejects invalid provider text before resource success and permits verified alternative',()=>{
    const {packet}=compileTaskPrompt(base);
    const wrong=()=>assertExecutionResultAccepted('not-json',packet);
    expect(wrong).toThrow('EXECUTION_RESULT_JSON_INVALID');
    try{ wrong(); }catch(error){expect(error.kind).toBe('invalid_response');}
    expect(assertExecutionResultAccepted(accepted(packet),packet).pass).toBe(true);
  });

  it('12 routes a valid blocked result to Core correction but still rejects malformed compiled output',()=>{
    const {packet}=compileTaskPrompt(base);
    const blocked=JSON.stringify({
      schema:'EXECUTION_RESULT_V1',
      status:'blocked',
      summary:'need one correction',
      acceptance:packet.acceptance.map(criterion=>({criterion,passed:false,evidence_refs:[]})),
      evidence:[],
      block_reason:'needs corrected evidence',
    });
    expect(assertExecutionResultRoutable(blocked,packet).code).toBe('EXECUTION_RESULT_BLOCKED');
    expect(()=>assertExecutionResultRoutable('not-json',packet)).toThrow('EXECUTION_RESULT_JSON_INVALID');
    expect(assertExecutionResultRoutable(accepted(packet),packet).pass).toBe(true);
  });

  it('13 Core router validates malformed compiled output before marking the provider healthy while allowing blocked correction',()=>{
    const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const start=source.indexOf('async function invokeRouted(');
    const stop=source.indexOf('function buildNv09CanaryPrompt(',start);
    const router=source.slice(start,stop);
    expect(start).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(start);
    expect(router).toMatch(/options\.validateText\(text\).*?markResourceSuccess/s);
    expect(source).toContain('const validateText=compiledPacket?(text)=>assertExecutionResultRoutable(text,compiledPacket):null;');
    expect(source).toContain('employeeAllowlist,validateText,compiledPacket}');
    expect(source.split('employeeAllowlist,validateText,compiledPacket});').length-1).toBe(2);
  });

});
