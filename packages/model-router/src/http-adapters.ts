import type { ModelRequest,ModelTarget,Provider,ProviderAdapter } from './index.js';

export type SecretResolver=()=>string|undefined;
export interface HttpAdapterBase {apiKey:SecretResolver;fetchImpl?:typeof fetch;timeoutMs?:number;}
export interface ResponsesAdapterOptions extends HttpAdapterBase {provider:'openai'|'xai'|'deepseek'|'openrouter';endpoint:string;extraHeaders?:Record<string,string>;}
export interface GeminiAdapterOptions extends HttpAdapterBase {baseUrl?:string;}
export interface AnthropicAdapterOptions extends HttpAdapterBase {endpoint?:string;anthropicVersion?:string;maxTokens?:number;}

function key(resolve:SecretResolver):string{const value=resolve()?.trim();if(!value)throw new Error('MISSING_PROVIDER_CREDENTIAL');return value;}
async function postJson(fetchImpl:typeof fetch,url:string,init:RequestInit,timeoutMs:number):Promise<unknown>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  const parent=init.signal;
  const onAbort=()=>controller.abort();
  parent?.addEventListener('abort',onAbort,{once:true});
  try{
    const response=await fetchImpl(url,{...init,signal:controller.signal});
    if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}`);
    return await response.json();
  }finally{clearTimeout(timeout);parent?.removeEventListener('abort',onAbort);}
}
function responseText(raw:unknown):string{
  if(!raw||typeof raw!=='object')throw new Error('INVALID_PROVIDER_RESPONSE');
  const root=raw as Record<string,unknown>;
  if(typeof root.output_text==='string'&&root.output_text.trim())return root.output_text;
  if(Array.isArray(root.output)){
    const texts:string[]=[];
    for(const item of root.output){if(!item||typeof item!=='object')continue;const content=(item as Record<string,unknown>).content;if(!Array.isArray(content))continue;for(const part of content){if(part&&typeof part==='object'){const text=(part as Record<string,unknown>).text;if(typeof text==='string'&&text.trim())texts.push(text);}}}
    if(texts.length)return texts.join('\n');
  }
  throw new Error('EMPTY_PROVIDER_RESPONSE');
}

/** OpenAI Responses-compatible provider adapter. Endpoint is explicit so no provider URL is invented at runtime. */
export function createResponsesHttpAdapter(options:ResponsesAdapterOptions):ProviderAdapter{
  const fetchImpl=options.fetchImpl??fetch;
  return {provider:options.provider,async execute(target:ModelTarget,request:ModelRequest){
    const raw=await postJson(fetchImpl,options.endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key(options.apiKey)}`,...options.extraHeaders},body:JSON.stringify({model:target.model,input:request.prompt}),signal:request.signal},options.timeoutMs??120_000);
    return responseText(raw);
  }};
}

export function createGeminiHttpAdapter(options:GeminiAdapterOptions):ProviderAdapter{
  const fetchImpl=options.fetchImpl??fetch;
  const base=(options.baseUrl??'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
  return {provider:'gemini',async execute(target,request){
    const model=target.model.replace(/^models\//,'');
    const raw=await postJson(fetchImpl,`${base}/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key(options.apiKey)},body:JSON.stringify({contents:[{parts:[{text:request.prompt}]}]}),signal:request.signal},options.timeoutMs??120_000) as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
    const text=raw.candidates?.flatMap(candidate=>candidate.content?.parts??[]).map(part=>part.text??'').filter(Boolean).join('\n');
    if(!text?.trim())throw new Error('EMPTY_PROVIDER_RESPONSE');
    return text;
  }};
}

export function createAnthropicHttpAdapter(options:AnthropicAdapterOptions):ProviderAdapter{
  const fetchImpl=options.fetchImpl??fetch;
  const endpoint=options.endpoint??'https://api.anthropic.com/v1/messages';
  return {provider:'anthropic',async execute(target,request){
    const raw=await postJson(fetchImpl,endpoint,{method:'POST',headers:{'content-type':'application/json','x-api-key':key(options.apiKey),'anthropic-version':options.anthropicVersion??'2023-06-01'},body:JSON.stringify({model:target.model,max_tokens:options.maxTokens??4096,messages:[{role:'user',content:request.prompt}]}),signal:request.signal},options.timeoutMs??120_000) as {content?:Array<{type?:string;text?:string}>};
    const text=raw.content?.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');
    if(!text?.trim())throw new Error('EMPTY_PROVIDER_RESPONSE');
    return text;
  }};
}

export function envSecret(name:string,env:NodeJS.ProcessEnv=process.env):SecretResolver{
  if(!/^[A-Z][A-Z0-9_]{2,80}$/.test(name))throw new Error('INVALID_SECRET_ENV_NAME');
  return ()=>env[name];
}

export interface OfficialAdapterConfig {provider:Provider;apiKeyEnv:string;endpoint?:string;}
export function createOfficialHttpAdapter(config:OfficialAdapterConfig,fetchImpl?:typeof fetch):ProviderAdapter{
  const common={apiKey:envSecret(config.apiKeyEnv),fetchImpl};
  if(config.provider==='gemini')return createGeminiHttpAdapter(common);
  if(config.provider==='anthropic')return createAnthropicHttpAdapter({...common,endpoint:config.endpoint});
  if(config.provider==='ollama')throw new Error('OLLAMA_USES_LOCAL_ADAPTER');
  const defaults:Record<'openai'|'xai'|'deepseek'|'openrouter',string>={
    openai:'https://api.openai.com/v1/responses',
    xai:'https://api.x.ai/v1/responses',
    deepseek:'https://api.deepseek.com/responses',
    openrouter:'https://openrouter.ai/api/v1/responses'
  };
  return createResponsesHttpAdapter({...common,provider:config.provider,endpoint:config.endpoint??defaults[config.provider]});
}
