import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256,verifySandboxReceipt} from './receipt-policy.mjs';
// Policy fixtures explicitly synthetic. These tests never establish live E2E.
function fixture(){
 const source='a'.repeat(40),hash='b'.repeat(64);
 return {source_sha:source,permission:{surface:'GITHUB_BRANCH_ISOLATED_ONLY',new_cost:0,no_pc01_shell:true},
  skill:{id:'spec-first-tdd',version:'1.1.0',bytes:2627,status:'ACTIVE',content_sha256:hash},candidate_sha256:'c'.repeat(64),
  models:['manager','implementer','reviewer','acceptor'].map((role,i)=>{
   const parsed={decision:role==='reviewer'?'approve':'accept'},response=JSON.stringify(parsed),prompt=source+hash+'c'.repeat(64);
   return {role,worker_id:'fixture-'+role,pid:i+1,model_id:'qwen2.5-coder:7b',lease:{role,lease_token:'fixture-'+role},prompt,prompt_sha256:sha256(prompt),response,response_sha256:sha256(response),parsed};
  }),
  tool:{id:'fixture-tool',network:'none',read_only:true,exit_code:0,stdout:JSON.stringify(Array(12).fill(0)),stdout_sha256:sha256(JSON.stringify(Array(12).fill(0))),candidate_sha256:'c'.repeat(64)},
  functional:{pass:true,tested:12,candidate_sha256:'c'.repeat(64),actual:Array(12).fill(0),expected:Array(12).fill(0)}};
}
test('policy fixture is structural only and cannot grant production acceptance',()=>{
 const result=verifySandboxReceipt(fixture());assert.equal(result.pass,true);assert.equal(result.production_runtime_accepted,false);
});
const negatives=[
 ['missing permission',r=>delete r.permission,'G6_PERMISSION_UNVERIFIED'],
 ['paid permission',r=>r.permission.new_cost=1,'G6_PERMISSION_UNVERIFIED'],
 ['PC01 scope',r=>r.permission.no_pc01_shell=false,'G6_PERMISSION_UNVERIFIED'],
 ['missing source',r=>delete r.source_sha,'G6_SOURCE_UNVERIFIED'],
 ['CANDIDATE Skill',r=>r.skill.status='CANDIDATE','G6_ACTIVE_SKILL_UNVERIFIED'],
 ['missing Skill bytes',r=>r.skill.bytes=0,'G6_ACTIVE_SKILL_UNVERIFIED'],
 ['missing hash',r=>delete r.skill.content_sha256,'G6_ACTIVE_SKILL_UNVERIFIED'],
 ['missing model',r=>delete r.models[0].model_id,'G6_MODEL_RECEIPT_UNVERIFIED'],
 ['unapproved model',r=>r.models[0].model_id='paid-model','G6_MODEL_RECEIPT_UNVERIFIED'],
 ['missing lease',r=>delete r.models[1].lease,'G6_MODEL_RECEIPT_UNVERIFIED'],
 ['wrong lease role',r=>r.models[2].lease.role='implementer','G6_MODEL_RECEIPT_UNVERIFIED'],
 ['missing role',r=>r.models.pop(),'G6_MODEL_ROLES_MISSING'],
 ['self review',r=>r.models[2].worker_id=r.models[1].worker_id,'G6_INDEPENDENCE_UNVERIFIED'],
 ['same process review',r=>r.models[2].pid=r.models[1].pid,'G6_INDEPENDENCE_UNVERIFIED'],
 ['tampered prompt',r=>r.models[0].prompt+='x','G6_MODEL_RECEIPT_UNVERIFIED'],
 ['tampered response',r=>r.models[0].response+='x','G6_MODEL_RECEIPT_UNVERIFIED'],
 ['missing tool',r=>delete r.tool,'G6_TOOL_UNVERIFIED'],
 ['network enabled tool',r=>r.tool.network='bridge','G6_TOOL_UNVERIFIED'],
 ['writable tool',r=>r.tool.read_only=false,'G6_TOOL_UNVERIFIED'],
 ['failed tool',r=>r.tool.exit_code=1,'G6_TOOL_UNVERIFIED'],
 ['tampered tool output',r=>r.tool.stdout+='x','G6_TOOL_UNVERIFIED'],
 ['wrong candidate',r=>r.tool.candidate_sha256='d'.repeat(64),'G6_TOOL_UNVERIFIED'],
 ['missing functional evidence',r=>delete r.functional,'G6_FUNCTIONAL_UNVERIFIED'],
 ['false functional PASS',r=>r.functional.actual[0]=42,'G6_FUNCTIONAL_UNVERIFIED'],
 ['altered output rehashed',r=>{r.tool.stdout='[42]';r.tool.stdout_sha256=sha256(r.tool.stdout);},'G6_FUNCTIONAL_UNVERIFIED'],
 ['forged parsed decision',r=>r.models[2].parsed.decision='changes_requested','G6_MODEL_RECEIPT_UNVERIFIED'],
 ['rejected independent review',r=>{const m=r.models[2];m.parsed.decision='changes_requested';m.response=JSON.stringify(m.parsed);m.response_sha256=sha256(m.response);},'G6_REVIEW_OR_ACCEPTANCE_REJECTED'],
 ['rejected acceptance',r=>{const m=r.models[3];m.parsed.decision='reject';m.response=JSON.stringify(m.parsed);m.response_sha256=sha256(m.response);},'G6_REVIEW_OR_ACCEPTANCE_REJECTED']
];
for(const [name,mutate,code] of negatives)test('fail closed: '+name,()=>{const r=fixture();mutate(r);assert.deepEqual(verifySandboxReceipt(r),{pass:false,code});});
