import { numberValue, Semaphore, stringValue, type OllamaMetrics } from './types.js';

export class OllamaProvider {
  readonly semaphore:Semaphore;
  constructor(readonly endpoint='http://127.0.0.1:11434',readonly model='qwen3:8b',readonly numCtx=4096,maxConcurrency=2,readonly timeoutMs=120_000){this.semaphore=new Semaphore(maxConcurrency);}
  async health():Promise<Record<string,unknown>>{
    const response=await this.fetchWithTimeout('/api/tags',{method:'GET'},10_000);if(!response.ok)throw new Error(`OLLAMA_HEALTH_${response.status}`);
    const body=await response.json() as Record<string,unknown>;return {ok:true,model:this.model,models:Array.isArray(body.models)?body.models.length:undefined};
  }
  async generate(prompt:string,options?:{temperature?:number;json?:boolean;keepAlive?:string}):Promise<{content:string;parsed?:Record<string,unknown>;metrics:OllamaMetrics}>{
    return this.semaphore.use(async()=>{
      const body:Record<string,unknown>={model:this.model,prompt,stream:false,think:false,keep_alive:options?.keepAlive??'15m',options:{num_ctx:this.numCtx,temperature:options?.temperature??0.1}};if(options?.json)body.format='json';
      const response=await this.fetchWithTimeout('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},this.timeoutMs);if(!response.ok)throw new Error(`OLLAMA_HTTP_${response.status}`);
      const result=await response.json() as Record<string,unknown>,content=stringValue(result.response)??'';let parsed:Record<string,unknown>|undefined;
      if(options?.json){try{const value=JSON.parse(content) as unknown;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();parsed=value as Record<string,unknown>;}catch{throw new Error('OLLAMA_INVALID_JSON_RESPONSE');}}
      const metrics:OllamaMetrics={model:this.model},totalDuration=numberValue(result.total_duration),loadDuration=numberValue(result.load_duration),evalDuration=numberValue(result.eval_duration),promptTokens=numberValue(result.prompt_eval_count),evalTokens=numberValue(result.eval_count);
      if(totalDuration!==undefined)metrics.totalDurationMs=totalDuration/1e6;if(loadDuration!==undefined)metrics.loadDurationMs=loadDuration/1e6;if(promptTokens!==undefined)metrics.promptTokens=promptTokens;if(evalTokens!==undefined)metrics.evalTokens=evalTokens;if(evalTokens!==undefined&&evalDuration&&evalDuration>0)metrics.tokensPerSec=evalTokens/(evalDuration/1e9);
      try{Object.assign(metrics,await this.processorInfo());}catch{}
      return {content,parsed,metrics};
    });
  }
  private async processorInfo():Promise<Partial<OllamaMetrics>>{
    const response=await this.fetchWithTimeout('/api/ps',{method:'GET'},5_000);if(!response.ok)return {};const body=await response.json() as {models?:Array<Record<string,unknown>>};
    const model=body.models?.find(item=>stringValue(item.name)===this.model||stringValue(item.model)===this.model)??body.models?.[0];if(!model)return {};
    const size=numberValue(model.size),vram=numberValue(model.size_vram);let processor:string|undefined;if(size&&vram!==undefined)processor=vram>=size*0.95?'100% GPU':vram<=size*0.05?'100% CPU':`${Math.round(vram/size*100)}% GPU`;return {sizeBytes:size,vramBytes:vram,processor};
  }
  private fetchWithTimeout(resource:string,init:RequestInit,timeoutMs:number):Promise<Response>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);return fetch(new URL(resource,this.endpoint),{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));}
}
