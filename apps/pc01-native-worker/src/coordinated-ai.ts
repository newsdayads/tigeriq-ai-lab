import path from 'node:path';
import {
  AICoordinator,
  JsonFileCheckpointStore,
  type AIWorkItem,
  type CoordinatorEvidence,
  type ModelProfile,
  type WorkKind,
  type WorkRisk,
} from '../../../packages/ai-coordinator/src/index.js';
import { createGeminiAdapter, createGroqAdapter, createOllamaAdapter, type Provider } from '../../../packages/model-router/src/index.js';
import { asRecord, stringValue, type WorkerJob } from './types.js';

const KINDS = new Set<WorkKind>(['general','coding','analysis','research']);
const RISKS = new Set<WorkRisk>(['low','medium','high']);

export interface CoordinatedAiResult {
  status:'verified';
  content:string;
  executorModel:string;
  reviewerDecision?:'PASS'|'FAIL';
  judgeDecision?:'PASS'|'FAIL';
  verificationMode:'executor-only'|'reviewed'|'reviewed-and-judged';
  evidence:CoordinatorEvidence;
}

export class CoordinatedAiProvider {
  private readonly coordinator:AICoordinator;
  constructor(stateRoot:string,ollamaEndpoint:string){
    const groqReady=process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED?.trim().toLowerCase()==='true'&&Boolean(process.env.GROQ_API_KEY?.trim());
    const geminiReady=process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED?.trim().toLowerCase()==='true'&&Boolean(process.env.GEMINI_API_KEY?.trim());
    const allRoles:['executor','reviewer','judge']=['executor','reviewer','judge'];
    const profiles:ModelProfile[]=[
      {target:{provider:'gemini',model:'gemini-3.5-flash-lite'},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:allRoles,available:geminiReady},
      {target:{provider:'groq',model:'openai/gpt-oss-120b'},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:allRoles,available:groqReady},
      {target:{provider:'ollama',model:'gemma3:4b',local:true},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:allRoles},
      {target:{provider:'ollama',model:'qwen3:8b',local:true},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:allRoles},
      {target:{provider:'ollama',model:'qwen2.5-coder:14b',local:true},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:allRoles},
      {target:{provider:'ollama',model:'qwen3:4b',local:true},costRank:0,qualityRank:2,kinds:['general','coding','analysis'],roles:allRoles},
    ];
    const adapters=[
      createGroqAdapter({model:'openai/gpt-oss-120b'}),
      createGeminiAdapter({model:'gemini-3.5-flash-lite'}),
      createOllamaAdapter({baseUrl:ollamaEndpoint}),
    ];
    this.coordinator=new AICoordinator(
      adapters,
      new JsonFileCheckpointStore(path.join(stateRoot,'ai-coordinator')),
      {profiles,maxAttemptsPerStage:3},
    );
  }

  async run(job:WorkerJob):Promise<CoordinatedAiResult>{
    const prompt=stringValue(job.payload.prompt)??job.objective;
    const kind=this.kind(job.payload.kind??job.payload.taskKind);
    const risk=this.risk(job.payload.risk,job);
    const criteria=Array.isArray(job.payload.acceptanceCriteria)
      ? job.payload.acceptanceCriteria.filter((x):x is string=>typeof x==='string'&&Boolean(x.trim())).map(x=>x.trim()).slice(0,20)
      : undefined;
    const providerPolicy=asRecord(job.payload.providerPolicy);
    if(providerPolicy?.zeroCostOnly===false)throw new Error('AI_PAID_ROUTE_DENIED');
    const preferredProviders=Array.isArray(providerPolicy?.preferredProviders)
      ? providerPolicy.preferredProviders.filter((x):x is Provider=>typeof x==='string'&&['groq','gemini','ollama'].includes(x))
      : undefined;
    const work:AIWorkItem={
      id:job.jobId,prompt,kind,risk,acceptanceCriteria:criteria,preferredProviders,
      reviewPolicy:{independentReview:job.independentReview,judgeRequired:job.judgeRequired},
    };
    const checkpoint=await this.coordinator.run(work);
    const evidence=this.coordinator.evidence(checkpoint);
    if(checkpoint.status!=='verified'||!checkpoint.executor){
      throw new Error(`AI_COORDINATOR_NOT_VERIFIED:${checkpoint.status}:${checkpoint.blocker??'unknown'}`);
    }
    return {
      status:'verified',
      content:checkpoint.executor.text,
      executorModel:`${checkpoint.executor.target.provider}/${checkpoint.executor.target.model}`,
      reviewerDecision:checkpoint.reviewer?.decision,
      judgeDecision:checkpoint.judge?.decision,
      verificationMode:checkpoint.judge?'reviewed-and-judged':checkpoint.reviewer?'reviewed':'executor-only',
      evidence,
    };
  }

  private kind(value:unknown):WorkKind{
    const v=stringValue(value) as WorkKind|undefined;
    return v&&KINDS.has(v)?v:'general';
  }

  private risk(value:unknown,job:WorkerJob):WorkRisk{
    const v=stringValue(value) as WorkRisk|undefined;
    if(v&&RISKS.has(v))return v;
    return job.independentReview||job.judgeRequired?'high':'low';
  }
}
