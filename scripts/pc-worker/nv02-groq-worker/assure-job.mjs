import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const jobId=process.argv[2];
if(!jobId) throw new Error('JOB_ID_REQUIRED');
const databaseUrl=process.env.TIGERIQ_DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
const autonomyRoot=process.env.TIGERIQ_AUTONOMY_ROOT||'D:\\TigerIQ\\AutonomyRuntime\\tigeriq-fast-20260903-174812';
const workspace=process.env.TIGERIQ_WORKSPACE||'D:\\TigerIQ\\Workspace\\tigeriq-ai-lab';
const dist=path.join(autonomyRoot,'dist','packages','work-state','src');
const {createPgPool}=await import(pathToFileURL(path.join(dist,'pg-driver.js')).href);
const {PostgresOperationalStateRepository}=await import(pathToFileURL(path.join(dist,'postgres-repository.js')).href);
const {OperationalWorkService}=await import(pathToFileURL(path.join(dist,'service.js')).href);
const pool=await createPgPool(databaseUrl,2);
const service=new OperationalWorkService(new PostgresOperationalStateRepository(pool));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');

async function ollama(model,prompt){
  const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,format:'json',options:{temperature:0}})});
  if(!r.ok) throw new Error(`OLLAMA_${model}_${r.status}`);
  const body=await r.json();
  const parsed=JSON.parse(body.response);
  if(!['pass','fail'].includes(parsed.verdict)) throw new Error(`INVALID_VERDICT_${model}`);
  return {model,verdict:parsed.verdict,reason:String(parsed.reason||'').slice(0,2000)};
}
async function evidence(role,data){
  const dir=path.join(workspace,'.tigeriq-runtime','evidence',jobId);
  await mkdir(dir,{recursive:true});
  const file=path.join(dir,`${Date.now()}-${role}.json`);
  const raw=JSON.stringify({jobId,role,...data,createdAt:new Date().toISOString()},null,2);
  await writeFile(file,raw,'utf8');
  return {kind:'json',ref:path.relative(workspace,file).replaceAll('\\','/'),summary:`${role} assurance evidence`,sha256:sha(raw)};
}

try{
  let state=await service.getJob(jobId);
  if(!state||state.job.stage!=='reviewing'||!state.result?.output) throw new Error(`JOB_NOT_REVIEWING:${state?.job.stage||'missing'}`);
  const executor=JSON.stringify(state.result.output);
  const reviewer=await ollama('gemma3:4b',`You are an independent reviewer. Objective: ${state.job.objective}\nExecutor output: ${executor}\nReturn JSON only: {"verdict":"pass"|"fail","reason":"brief"}. Pass only if output directly satisfies the objective.`);
  const reviewEvidence=await evidence('reviewer',{backend:'ollama:gemma3:4b',...reviewer});
  await service.recordReview({jobId,role:'reviewer',reviewerId:'NV06-REVIEWER-GEMMA3',independenceKey:'provider:ollama:gemma3:4b',verdict:reviewer.verdict,conclusion:reviewer.reason,evidence:[reviewEvidence],retriable:true,reviewedAt:new Date().toISOString()});
  state=await service.getJob(jobId);
  if(reviewer.verdict!=='pass'){console.log(JSON.stringify({jobId,stage:state.job.stage,reviewer,judge:null}));process.exit(2);}
  if(state.job.stage!=='judging') throw new Error(`JOB_NOT_JUDGING:${state.job.stage}`);
  const judge=await ollama('qwen3:8b',`You are an independent release judge. Objective: ${state.job.objective}\nExecutor output: ${executor}\nReviewer verdict: ${reviewer.verdict}; reason: ${reviewer.reason}\nReturn JSON only: {"verdict":"pass"|"fail","reason":"brief"}. Pass only when executor output satisfies objective and reviewer conclusion is sound.`);
  const judgeEvidence=await evidence('judge',{backend:'ollama:qwen3:8b',reviewerBackend:'ollama:gemma3:4b',...judge});
  await service.recordReview({jobId,role:'judge',reviewerId:'NV07-JUDGE-QWEN3',independenceKey:'provider:ollama:qwen3:8b',verdict:judge.verdict,conclusion:judge.reason,evidence:[judgeEvidence],retriable:false,reviewedAt:new Date().toISOString()});
  state=await service.getJob(jobId);
  console.log(JSON.stringify({jobId,stage:state.job.stage,executor:'groq:openai/gpt-oss-120b',reviewer,judge,reviews:state.reviews?.length||0,evidence:state.evidence?.length||0}));
  if(state.job.stage!=='done'||judge.verdict!=='pass') process.exit(3);
}finally{
  if(typeof pool.end==='function') await pool.end();
}
