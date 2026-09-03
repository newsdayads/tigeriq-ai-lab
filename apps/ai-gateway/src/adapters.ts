import type { RouteCandidate } from './core.js';

export interface AiGatewayRequest {
  requestId:string;
  taskId:string;
  modelId:string;
  providerId:string;
  system?:string;
  prompt:string;
  maxOutputTokens?:number;
  temperature?:number;
  metadata?:Record<string,string|number|boolean>;
}

export interface AiGatewayResponse {
  requestId:string;
  providerId:string;
  modelId:string;
  output:string;
  inputTokens?:number;
  outputTokens?:number;
  latencyMs:number;
  finishReason:'stop'|'length'|'tool'|'error';
}

export interface AiProviderAdapter {
  providerId:string;
  invoke(request:AiGatewayRequest):Promise<AiGatewayResponse>;
}

export interface GatewayAttempt {providerId:string;modelId:string;ok:boolean;reason?:string;}
export interface GatewayExecution {response?:AiGatewayResponse;attempts:GatewayAttempt[];}

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
function assertRequest(request:AiGatewayRequest):void{
  if(!idPattern.test(request.requestId)||!idPattern.test(request.taskId)||!idPattern.test(request.modelId)||!idPattern.test(request.providerId))throw new Error('INVALID_GATEWAY_REQUEST_ID');
  if(!request.prompt.trim()||request.prompt.length>200_000)throw new Error('INVALID_GATEWAY_PROMPT');
  if(request.maxOutputTokens!==undefined&&(!Number.isInteger(request.maxOutputTokens)||request.maxOutputTokens<1||request.maxOutputTokens>200_000))throw new Error('INVALID_MAX_OUTPUT_TOKENS');
  if(request.temperature!==undefined&&(!Number.isFinite(request.temperature)||request.temperature<0||request.temperature>2))throw new Error('INVALID_TEMPERATURE');
}

export class AdapterRegistry {
  private readonly adapters=new Map<string,AiProviderAdapter>();
  register(adapter:AiProviderAdapter):void{
    if(!idPattern.test(adapter.providerId)||this.adapters.has(adapter.providerId))throw new Error('INVALID_OR_DUPLICATE_ADAPTER');
    this.adapters.set(adapter.providerId,adapter);
  }
  get(providerId:string):AiProviderAdapter|undefined{return this.adapters.get(providerId);}
  list():string[]{return [...this.adapters.keys()].sort();}
}

export async function executeWithRoutes(input:{routes:RouteCandidate[];request:Omit<AiGatewayRequest,'providerId'|'modelId'>;registry:AdapterRegistry;maxAttempts?:number}):Promise<GatewayExecution>{
  const maxAttempts=Math.max(1,Math.min(input.maxAttempts??3,8));
  const attempts:GatewayAttempt[]=[];
  for(const route of input.routes.slice(0,maxAttempts)){
    const adapter=input.registry.get(route.provider.providerId);
    if(!adapter){attempts.push({providerId:route.provider.providerId,modelId:route.model.modelId,ok:false,reason:'adapter_missing'});continue;}
    const request:AiGatewayRequest={...input.request,providerId:route.provider.providerId,modelId:route.model.modelId};
    assertRequest(request);
    try{
      const response=await adapter.invoke(request);
      if(response.providerId!==request.providerId||response.modelId!==request.modelId||response.requestId!==request.requestId)throw new Error('ADAPTER_RESPONSE_MISMATCH');
      attempts.push({providerId:request.providerId,modelId:request.modelId,ok:true});
      return {response,attempts};
    }catch(error){
      attempts.push({providerId:request.providerId,modelId:request.modelId,ok:false,reason:error instanceof Error?error.message:'adapter_failed'});
    }
  }
  return {attempts};
}
