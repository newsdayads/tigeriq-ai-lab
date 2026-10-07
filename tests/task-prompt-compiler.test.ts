// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  buildExecutionPacket,
  compileTaskPrompt,
  executionResultGate,
  parseExecutionResult,
  strictExecutionRetryPrompt,
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
});
