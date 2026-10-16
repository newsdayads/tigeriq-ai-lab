import {randomUUID, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,chmodSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRequiredCodingSkills,runCodingSkillCapabilityCanary} from '../apps/tigeriq-coding-lane/coding-skill-policy.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const modelName='qwen2.5-coder:7b', toolName='docker:node:22-bookworm-slim:network-none';
const sourceSha=process.env.GITHUB_SHA||'', repo=process.env.GITHUB_REPOSITORY||'';
const runId=process.env.GITHUB_RUN_ID||'';
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
if(process.env.GITHUB_ACTIONS!=='true'||repo!=='newsdayads/tigeriq-ai-lab'||
   !/^[a-f0-9]{40}$/.test(sourceSha)||!/^\d+$/.test(runId)||
   process.env.RUNNER_OS!=='Linux'||process.env.GITHUB_REF!=='refs/heads/p0/owner-vy-core-coding-contract-20261016')
  fail('G3_GITHUB_ACTIONS_IDENTITY_MISSING');
const verifiedSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(verifiedSha!==sourceSha) fail('G3_SOURCE_SHA_DRIFT');
execFileSync('docker',['image','inspect','node:22-bookworm-slim'],{stdio:'ignore'});
execFileSync('docker',['image','inspect','ollama/ollama:0.12.11'],{stdio:'ignore'});
const images={
  tool:execFileSync('docker',['image','inspect','node:22-bookworm-slim','--format','{{index .RepoDigests 0}}'],{encoding:'utf8'}).trim(),
  model:execFileSync('docker',['image','inspect','ollama/ollama:0.12.11','--format','{{index .RepoDigests 0}}'],{encoding:'utf8'}).trim()
};
const tags=await fetch('http://127.0.0.1:11435/api/tags',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)fail('G3_OLLAMA_UNAVAILABLE');return r.json();});
if(!Array.isArray(tags.models)||!tags.models.some(x=>x.name===modelName))fail('G3_MODEL_NOT_INSTALLED');
const skills=loadRequiredCodingSkills('P0 #4902 isolated G3 capability', {requiredIds:['spec-first-tdd']});
const scope='https://github.com/'+repo+'/actions/runs/'+runId;
const authority=Object.freeze({
  mode:'live',model:Object.freeze({id:modelName,available:true,allowed:true,new_cost:0}),
  tool:Object.freeze({id:toolName,available:true,allowed:true,isolated:true,source_read_only:true,new_cost:0}),
  permission_receipts:Object.freeze({model:scope+'#model',tool:scope+'#tool'}),
  runner:Object.freeze({repository:repo,sourceSha,runId,images})
});
const modelResponses=new WeakSet(), toolResponses=new WeakSet();
const host={
  inspect:async()=>authority,
  invokeModel:async request=>{
    const schema={type:'object',additionalProperties:false,
      required:['run_id','step_id','source_sha','skill_context_sha256','code'],
      properties:{
        run_id:{type:'string',const:request.run_id},
        step_id:{type:'string',const:request.step_id},
        source_sha:{type:'string',const:request.source_sha},
        skill_context_sha256:{type:'string',const:request.skill_context_sha256},
        code:{type:'string',minLength:30,maxLength:1800}
      }};
    const payload={model:modelName,prompt:request.prompt,stream:false,think:false,
      format:schema,keep_alive:'0s',options:{temperature:0,num_ctx:8192,num_predict:550}};
    const result=await fetch('http://127.0.0.1:11435/api/generate',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
      signal:AbortSignal.timeout(420000)});
    if(!result.ok)fail('G3_MODEL_HTTP_'+result.status);
    const json=await result.json();
    if(json.done!==true||json.model!==modelName||!String(json.response||'').trim())fail('G3_MODEL_RESPONSE_UNVERIFIED');
    const ret={id:randomUUID(),run_id:request.run_id,model_id:modelName,
      source_sha:sourceSha,prompt_sha256:request.prompt_sha256,
      response:json.response,response_sha256:sha(json.response),
      transport:'local-ollama-docker',eval_count:json.eval_count};
    modelResponses.add(ret);return ret;
  },
  runTool:async input=>{
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-g3-'));
    try {
      chmodSync(dir,0o755);
      // No repository mount, tokens, network or writable container filesystem.
      const rawCode=String(input.code||'').trim();
      const plain=/^function\\s+normalizePort\\s*\\(/.test(rawCode);
      const exported=/^export\\s+function\\s+normalizePort\\s*\\(/.test(rawCode);
      if(!plain&&!exported)fail('G3_MODEL_CODE_NOT_FUNCTION_DECLARATION');
      // Preserve the raw model source and hash: the one-line export shim
      // affects only ESM linkage inside the unprivileged Docker evaluator.
      const isolatedModule=rawCode+(plain?'\nexport {normalizePort};\n':'\n');
      writeFileSync(join(dir,'candidate.mjs'),isolatedModule,{mode:0o644});
      writeFileSync(join(dir,'runner.mjs'),
        'import {normalizePort} from "./candidate.mjs";\n'+
        'const inputs='+JSON.stringify(input.cases)+';\n'+
        'const outputs=inputs.map(value=>normalizePort(value));\n'+
        'process.stdout.write(JSON.stringify({outputs}));\n',{mode:0o644});
      const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--pids-limit','32','--memory','256m',
        '--cpus','1','--user','65534:65534','--mount','type=bind,src='+dir+',dst=/work,readonly',
        'node:22-bookworm-slim','node','/work/runner.mjs'];
      const stdout=execFileSync('docker',args,{encoding:'utf8',timeout:20000,maxBuffer:65536});
      const ret={id:randomUUID(),run_id:input.run_id,tool_id:toolName,
        source_sha:sourceSha,model_receipt_id:input.model_receipt_id,
        input_sha256:input.input_sha256,code_sha256:input.code_sha256,
        exit_code:0,stdout,stdout_sha256:sha(stdout)};
      toolResponses.add(ret);return ret;
    } finally {rmSync(dir,{recursive:true,force:true});}
  },
  verifyReceipt:async (kind,obj)=>{
    if(kind==='permission')return obj===authority;
    if(kind==='model')return modelResponses.has(obj);
    if(kind==='tool')return toolResponses.has(obj);
    return false;
  }
};
let result;
try {result=await runCodingSkillCapabilityCanary({sourceSha,skills,host});}
catch(e){result={status:'BLOCKED',code:String(e?.code||e?.message||e)};}
const publicReceipt={
  status:result.status,code:result.code,capability_verified:result.capability_verified,
  source_sha:sourceSha,run_id:result.run_id,step_id:result.step_id,runner_run_id:runId,
  skill_proof:result.skill_proof,model_id:result.model_id,tool_id:result.tool_id,
  model_invoked:result.model_invoked,tool_invoked:result.tool_invoked,
  tested_cases:result.tested_cases||0,model_image:images.model,tool_image:images.tool,
  permission_receipts:authority.permission_receipts,
  prompt_sha256:result.prompt_sha256,response_sha256:result.response_sha256,
  prompt:result.prompt,response:result.response,
  tool_stdout:result.tool_receipt?.stdout||null,
  model_receipt_id:result.model_receipt?.id||null,tool_receipt_id:result.tool_receipt?.id||null,
  model_eval_count:result.model_receipt?.eval_count||null
};
mkdirSync('p0-g3-live-evidence',{recursive:true});
writeFileSync('p0-g3-live-evidence/receipt.json',JSON.stringify(publicReceipt,null,2)+'\n');
console.log('TIGERIQ_G3_LIVE_RECEIPT='+JSON.stringify({...publicReceipt,prompt:undefined,response:undefined}));
if(result.status!=='LIVE_EVIDENCE_VERIFIED'||result.capability_verified!==true)process.exitCode=1;