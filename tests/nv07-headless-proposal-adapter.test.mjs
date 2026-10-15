import { describe, it, expect } from 'vitest';
import { NV07_PROPOSAL_SCHEMA, prepareNv07CliProposal, verifyNv07CliProposal } from '../apps/shared/nv07-headless-proposal-adapter.mjs';

const file = 'docs/implementation/nv07-proposal.md';
const cwd = 'C:\\Users\\wdragons12x\\AppData\\Local\\TigerIQ\\NV07\\proposal-sandbox';
const job = (overrides = {}) => ({employeeId:'NV07', executionHost:'PC01', repository:'newsdayads/tigeriq-ai-lab', priority:'P2', action:'PROPOSE_CHANGE', jobId:'GH-4787:S4', sourceSha:'a'.repeat(40), paths:[file], ...overrides});
const answer = (overrides = {}) => ({job_id:'GH-4787:S4', summary:'Propose a typo fix', proposed_files:[{path:file, change:'Correct text', rationale:'Clarity'}], risks:['Reviewer required'], ...overrides});
const stdout = (result = answer(), wrapper = {}) => JSON.stringify({status:'SUCCESS', structured_output:result, usage:{total_tokens:124}, ...wrapper});
const context = (overrides = {}) => {const j=job();return {job:j, invocation:prepareNv07CliProposal(j,{sandboxCwd:cwd}),exitCode:0,stdout:stdout(),stderr:'',...overrides}};

describe('NV07 CLI proposal adapter (not runtime authorization)',()=>{
  it('builds a bounded invocation without source mutation',()=>{
    const i=prepareNv07CliProposal(job(),{sandboxCwd:cwd});
    expect(i).toMatchObject({accepted:true,executionState:'PREPARED_NOT_RUN',command:'agy',timeoutMs:130000});
    expect(i.args).toContain('--output-format');expect(i.args).toContain('--json-schema');expect(i.args).toContain('--sandbox');
    expect(i.args).not.toContain('--dangerously-skip-permissions');
    expect(JSON.parse(i.args.at(-1))).toMatchObject({job_id:'GH-4787:S4',pinned_source_sha:'a'.repeat(40)});
    expect(i.args.at(-2)).toBe('-p');
    expect(NV07_PROPOSAL_SCHEMA.properties.proposed_files.type).toBe('array');
    expect(prepareNv07CliProposal(job(),{sandboxCwd:'D:\\TigerIQ\\Workspace\\tigeriq-ai-lab'}).accepted).toBe(false);
    expect(prepareNv07CliProposal(job({action:'WRITE_SOURCE'}),{sandboxCwd:cwd}).accepted).toBe(false);
    expect(prepareNv07CliProposal(job({priority:'P0'}),{sandboxCwd:cwd}).accepted).toBe(false);
  });
  it('accepts proposal but never claims GitHub implementation',()=>{
    const v=verifyNv07CliProposal(context());
    expect(v).toMatchObject({accepted:true,executionState:'PROPOSED_NOT_IMPLEMENTED',code:'NV07_PROPOSAL_VERIFIED'});
    expect(v.proposedFiles).toEqual(answer().proposed_files);
    expect(v.outputHash).toMatch(/^[0-9a-f]{64}$/);expect(v.usage.total_tokens).toBe(124);
  });
  it.each([
    ['exit nonzero',{exitCode:1},'NV07_CLI_FAILED'],
    ['timeout',{timedOut:true},'NV07_CLI_TIMEOUT'],
    ['soft denial',{stderr:'Tool command git soft-denied due to permissions'},'NV07_CLI_PERMISSION_OR_DIAGNOSTIC_DENIED'],
    ['login',{stderr:'authentication required'},'NV07_CLI_PERMISSION_OR_DIAGNOSTIC_DENIED'],
    ['approval',{stderr:'requires approval'},'NV07_CLI_PERMISSION_OR_DIAGNOSTIC_DENIED'],
    ['invalid JSON',{stdout:'not json'},'NV07_CLI_JSON_INVALID'],
    ['empty output',{stdout:''},'NV07_CLI_OUTPUT_INVALID'],
    ['error status',{stdout:stdout(answer(),{status:'ERROR',error:'model invalid'})},'NV07_CLI_STATUS_NOT_SUCCESS'],
    ['waiting',{stdout:stdout(answer(),{status:'WAITING'})},'NV07_CLI_STATUS_NOT_SUCCESS'],
    ['missing structured',{stdout:stdout(answer(),{structured_output:null})},'NV07_PROPOSAL_SCHEMA_INVALID'],
    ['wrong job',{stdout:stdout(answer({job_id:'GH-4788:S5'}))},'NV07_PROPOSAL_SCHEMA_INVALID'],
    ['wrong path',{stdout:stdout(answer({proposed_files:[{path:'apps/tigeriq-core/core.mjs',change:'x',rationale:'y'}]}))},'NV07_PROPOSAL_PATH_OUT_OF_SCOPE'],
    ['case mismatch',{stdout:stdout(answer({proposed_files:[{path:'DOCS/implementation/nv07-proposal.md',change:'x',rationale:'y'}]}))},'NV07_PROPOSAL_PATH_OUT_OF_SCOPE'],
    ['traversal',{stdout:stdout(answer({proposed_files:[{path:'../.env',change:'x',rationale:'y'}]}))},'NV07_PROPOSAL_PATH_OUT_OF_SCOPE'],
    ['too many',{stdout:stdout(answer({proposed_files:Array.from({length:13},()=>({path:file,change:'x',rationale:'y'}))}))},'NV07_PROPOSAL_SCHEMA_INVALID'],
    ['invalid item',{stdout:stdout(answer({proposed_files:[{path:file,change:'x'}]}))},'NV07_PROPOSAL_ITEM_INVALID'],
    ['invalid risk',{stdout:stdout(answer({risks:[null]}))},'NV07_PROPOSAL_RISK_INVALID'],
  ])('rejects %s',(_label,change,code)=>{expect(verifyNv07CliProposal(context(change))).toMatchObject({accepted:false,code,executionState:'DENIED'});});
  it('accepts only a strict schema JSON string response from agy, retaining original output digest',()=>{
    const raw=JSON.stringify({status:'SUCCESS',response:JSON.stringify(answer())});
    const verdict=verifyNv07CliProposal(context({stdout:raw}));
    expect(verdict.accepted).toBe(true);
    expect(verdict.proposedFiles).toEqual(answer().proposed_files);
    expect(verifyNv07CliProposal(context({stdout:JSON.stringify({status:'SUCCESS',response:'text '+JSON.stringify(answer())})})).accepted).toBe(false);
    expect(verifyNv07CliProposal(context({stdout:JSON.stringify({status:'SUCCESS',response:JSON.stringify(answer({job_id:'OTHER'}))})})).accepted).toBe(false);
    expect(verifyNv07CliProposal(context({stdout:JSON.stringify({status:'ERROR',response:JSON.stringify(answer())})})).accepted).toBe(false);
  });
  it('rejects cross-job use and unprepared execution',()=>{
    expect(verifyNv07CliProposal(context({job:job({jobId:'GH-4890:OTHER'})})).code).toBe('NV07_JOB_BINDING_MISMATCH');
    expect(verifyNv07CliProposal(context({invocation:{accepted:false}})).code).toBe('NV07_NOT_PREPARED');
  });
});
