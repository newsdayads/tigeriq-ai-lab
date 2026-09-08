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
import { createGeminiAdapter, createGroqAdapter, createOllamaAdapter } from '../../../packages/model-router/src/index.js';
import { stringValue, type WorkerJob } from './types.js';

const KINDS = new Set<WorkKind>(['general','coding','analysis','research']);
const RISKS = new Set<WorkRisk>(['low','medium','high']);

export interface CoordinatedAiResult {
  status:'verified';
  content:string;
  executorModel:string;
  reviewerDecision:'PASS'|'FAIL';
  judgeDecision:'PASS'|'FAIL';
  evidence:CoordinatorEvidence;
}

export class CoordinatedAiProvider {
  private readonly coordinator:AICoordinator;
  constructor(stateRoot:string,ollamaEndpoint:string){
    const profiles:ModelProfile[]=[
      {target:{provider:'ollama',model:'qwen3:4b',local:true},costRank:0,qualityRank:2,kinds:['general','coding','analysis'],roles:['executor']},
      {target:{provider:'groq',model:'openai/gpt-oss-120b'},costRank:1,qualityRank:4,kinds:['general','coding','analysis','research'],roles:['executor','judge']},
      {target:{provider:'gemini',model:'gemini-2.5-flash'},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:['reviewer']},
      {target:{provider:'ollama',model:'qwen3:8b',local:true},costRank:2,qualityRank:4,kinds:['general','coding','analysis','research'],roles:['executor','judge']},
      {target:{provider:'ollama',model:'qwen2.5-coder:14b',local:true},costRank:3,qualityRank:4,kinds:['general','coding','analysis','research'],roles:['executor','judge']},
      {target:{provider:'ollama',model:'gemma3:4b',local:true},costRank:0,qualityRank:4,kinds:['general','coding','analysis','research'],roles:['reviewer']},
    ];
    const adapters=[
      createGroqAdapter({model:'openai/gpt-oss-120b'}),
      createGeminiAdapter({model:'gemini-2.5-flash'}),
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
    const work:AIWorkItem={id:job.jobId,prompt,kind,risk,acceptanceCriteria:criteria};
    const checkpoint=await this.coordinator.run(work);
    const evidence=this.coordinator.evidence(checkpoint);
    if(checkpoint.status!=='verified'||!checkpoint.executor||!checkpoint.reviewer||!checkpoint.judge){
      throw new Error(`AI_COORDINATOR_NOT_VERIFIED:${checkpoint.status}:${checkpoint.blocker??'unknown'}`);
    }
    return {
      status:'verified',
      content:checkpoint.executor.text,
      executorModel:`${checkpoint.executor.target.provider}/${checkpoint.executor.target.model}`,
      reviewerDecision:checkpoint.reviewer.decision??'FAIL',
      judgeDecision:checkpoint.judge.decision??'FAIL',
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
    return job.independentReview||job.judgeRequired?'high':'medium';
  }
}
