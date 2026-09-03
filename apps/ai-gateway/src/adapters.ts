import { ModelRouter, type CircuitBreakerOptions, type ModelTarget, type Provider, type ProviderAdapter, type RoutingPolicy } from '../../../packages/model-router/src/index.js';
import type { RouteCandidate } from './core.js';

export interface AiGatewayRequest {
  requestId:string;
  taskId:string;
  prompt:string;
  signal?:AbortSignal;
}

export interface GatewayAttempt {providerId:string;modelId:string;ok:boolean;reason?:string;circuitOpen?:boolean;}
export interface GatewayExecution {requestId:string;taskId:string;providerId:string;modelId:string;output:string;attempts:GatewayAttempt[];}

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const providers=new Set<Provider>(['gemini','openrouter','ollama','openai','anthropic','xai','deepseek']);

function canonicalProvider(value:string):Provider{
  if(!providers.has(value as Provider))throw new Error(`UNSUPPORTED_PROVIDER:${value}`);
  return value as Provider;
}
function assertRequest(request:AiGatewayRequest):void{
  if(!idPattern.test(request.requestId)||!idPattern.test(request.taskId))throw new Error('INVALID_GATEWAY_REQUEST_ID');
  if(!request.prompt.trim()||request.prompt.length>200_000)throw new Error('INVALID_GATEWAY_PROMPT');
}
function target(route:RouteCandidate):ModelTarget{return {provider:canonicalProvider(route.provider.providerId),model:route.model.modelId,local:route.provider.kind==='local'||undefined};}

/** Converts capability/cost/quota-ranked AI Gateway candidates into the single canonical ModelRouter execution policy. */
export function routingPolicyFromRoutes(routes:RouteCandidate[],maxAttempts=3):RoutingPolicy{
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>8)throw new Error('INVALID_GATEWAY_MAX_ATTEMPTS');
  const selected=routes.slice(0,maxAttempts).map(target);
  if(selected.length===0)throw new Error('NO_GATEWAY_ROUTES');
  return {primary:selected[0],fallbacks:selected.slice(1)};
}

/** One execution layer only: AI Gateway ranks workforce routes; packages/model-router performs adapters, fallback and circuit breaking. */
export class AiGatewayExecutor {
  private readonly router:ModelRouter;
  constructor(adapters:ProviderAdapter[],circuitBreaker: CircuitBreakerOptions={}){
    this.router=new ModelRouter(adapters,undefined,circuitBreaker);
  }
  async execute(routes:RouteCandidate[],request:AiGatewayRequest,maxAttempts=3):Promise<GatewayExecution>{
    assertRequest(request);
    const policy=routingPolicyFromRoutes(routes,maxAttempts);
    const result=await this.router.execute({prompt:request.prompt,signal:request.signal},policy);
    return {
      requestId:request.requestId,
      taskId:request.taskId,
      providerId:result.target.provider,
      modelId:result.target.model,
      output:result.text,
      attempts:result.attempts.map(attempt=>({providerId:attempt.target.provider,modelId:attempt.target.model,ok:attempt.ok,reason:attempt.error,circuitOpen:attempt.circuitOpen}))
    };
  }
}
