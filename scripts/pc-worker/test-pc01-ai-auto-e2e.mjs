import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const distRoot=path.resolve(process.env.TIGERIQ_AI_DIST_ROOT||'dist');
const moduleUrl=pathToFileURL(path.join(distRoot,'apps','pc01-native-worker','src','coordinated-ai.js')).href;
const { CoordinatedAiProvider }=await import(moduleUrl);
const ollama=process.env.TIGERIQ_OLLAMA_URL?.trim()||'http://127.0.0.1:11434';
const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-ai-auto-e2e-'));
function job(id){return {
  jobId:id,title:'AI auto E2E',objective:'Return a concise confirmation that TigerIQ AI routing works.',
  payload:{prompt:'Return one concise sentence confirming TigerIQ AI routing works.',risk:'high',kind:'analysis',acceptanceCriteria:['Response is concise and confirms routing works.']},
  requiredCapabilities:['local_ai'],requiredPermissions:[],expectedEvidence:['json'],independentReview:true,judgeRequired:true,
};}
function summary(name,result){return {name,status:result.status,executorModel:result.executorModel,reviewerDecision:result.reviewerDecision,judgeDecision:result.judgeDecision,stages:result.evidence.stages.map(x=>({role:x.role,provider:x.provider,model:x.model,decision:x.decision,outputSha256:x.outputSha256}))};}
const saved={
  groqKey:process.env.GROQ_API_KEY,groqProof:process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED,
  geminiKey:process.env.GEMINI_API_KEY,geminiProof:process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED,
};
let mixed,localOnly;
try{
  if(!saved.groqKey||saved.groqProof?.trim().toLowerCase()!=='true')throw new Error('GROQ_PERSISTENT_ENV_REQUIRED');
  const geminiReady=Boolean(saved.geminiKey)&&saved.geminiProof?.trim().toLowerCase()==='true';
  mixed=await new CoordinatedAiProvider(path.join(root,'mixed'),ollama).run(job(`PC01-AUTO-MIXED-${Date.now()}`));
  if(mixed.executorModel!=='groq/openai/gpt-oss-120b')throw new Error(`MIXED_EXECUTOR_UNEXPECTED:${mixed.executorModel}`);
  const reviewer=mixed.evidence.stages.find(x=>x.role==='reviewer');
  if(geminiReady&&`${reviewer?.provider}/${reviewer?.model}`!=='gemini/gemini-2.5-flash')throw new Error(`GEMINI_REVIEWER_UNEXPECTED:${reviewer?.provider}/${reviewer?.model}`);
  delete process.env.GROQ_API_KEY;delete process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED;
  delete process.env.GEMINI_API_KEY;delete process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED;
  localOnly=await new CoordinatedAiProvider(path.join(root,'local'),ollama).run(job(`PC01-AUTO-LOCAL-${Date.now()}`));
  if(!localOnly.executorModel.startsWith('ollama/'))throw new Error(`LOCAL_EXECUTOR_UNEXPECTED:${localOnly.executorModel}`);
  if(localOnly.evidence.attempts.some(x=>(x.provider==='groq'||x.provider==='gemini')&&x.ok))throw new Error('LOCAL_ONLY_CLOUD_SUCCEEDED_UNEXPECTEDLY');
  console.log(JSON.stringify({test:'PC01_AI_AUTO_E2E_PASS',geminiReady,mixed:summary('mixed',mixed),localFallback:summary('localFallback',localOnly)},null,2));
}finally{
  if(saved.groqKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=saved.groqKey;
  if(saved.groqProof===undefined)delete process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED;else process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED=saved.groqProof;
  if(saved.geminiKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=saved.geminiKey;
  if(saved.geminiProof===undefined)delete process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED;else process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED=saved.geminiProof;
  await rm(root,{recursive:true,force:true});
}
