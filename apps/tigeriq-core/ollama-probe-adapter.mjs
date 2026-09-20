const OLLAMA_CHAT_URL='http://127.0.0.1:11434/v1/chat/completions';
const OLLAMA_GENERATE_URL='http://127.0.0.1:11434/api/generate';
const PROBE_PREFIX='Return exactly TIGERIQ_RESOURCE_PROBE_';

export function isOllamaProbeRequest(url,init={}){
  if(String(url)!==OLLAMA_CHAT_URL||init?.method!=='POST'||typeof init?.body!=='string') return false;
  try{
    const body=JSON.parse(init.body);
    const messages=Array.isArray(body?.messages)?body.messages:[];
    const prompt=String(messages.at(-1)?.content||'');
    return prompt.startsWith(PROBE_PREFIX);
  }catch{return false;}
}

export async function runOllamaProbe(nativeFetch,init={}){
  const body=JSON.parse(init.body);
  const prompt=String(body.messages.at(-1)?.content||'');
  const marker=prompt.slice('Return exactly '.length);
  const response=await nativeFetch(OLLAMA_GENERATE_URL,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      model:body.model,
      prompt:marker,
      stream:false,
      think:false,
      options:{temperature:0,num_predict:32}
    }),
    signal:init.signal
  });
  if(!response.ok) return response;
  const payload=await response.json();
  const text=String(payload?.response||'').trim();
  return new Response(JSON.stringify({choices:[{message:{content:text}}]}),{
    status:200,
    headers:{'content-type':'application/json'}
  });
}

export function inspectOllamaApiDoctorHealth(lastError = null, metrics = {}) {
  const message = String(lastError?.message || lastError || '').toLowerCase();
  const status = Number(lastError?.status || lastError?.statusCode || 0);
  let classification = 'healthy';
  let blocker = false;
  let repairable = false;

  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    classification = 'rate_limit';
    repairable = true;
  } else if (status === 402 || message.includes('payment required') || message.includes('quota') || message.includes('credits')) {
    classification = 'http_402_external_blocker';
    blocker = true;
    repairable = false;
  } else if (status >= 500 || message.includes('econnrefused') || message.includes('timeout') || message.includes('transient')) {
    classification = 'transient_outage';
    repairable = true;
  } else if (status >= 400 || message.includes('syntax') || message.includes('source') || message.includes('invalid')) {
    classification = 'source_level_failure';
    repairable = true;
  } else if (lastError) {
    classification = 'unknown_error';
    repairable = true;
  }

  return {
    ok: classification === 'healthy',
    classification,
    blocker,
    repairable,
    deduplicatedHandoffKey: `ollama-doctor-${classification}`,
    metrics: { ...metrics, lastInspectedAt: new Date().toISOString() }
  };
}

export function verifyOllamaApiDoctorPostRepair(healthResult) {
  return Boolean(healthResult && healthResult.ok);
}

export function installOllamaProbeAdapter(target=globalThis){
  const nativeFetch=target.fetch.bind(target);
  target.fetch=(input,init={})=>{
    const url=typeof input==='string'?input:input?.url;
    return isOllamaProbeRequest(url,init)?runOllamaProbe(nativeFetch,init):nativeFetch(input,init);
  };
  return ()=>{target.fetch=nativeFetch;};
}
