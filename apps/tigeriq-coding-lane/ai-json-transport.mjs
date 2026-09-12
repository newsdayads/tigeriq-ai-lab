const AI_HOSTS=['api.groq.com','openrouter.ai','api.mistral.ai','router.huggingface.co','generativelanguage.googleapis.com','api.cohere.com'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function isAiUrl(input){
  try{return AI_HOSTS.includes(new URL(String(input)).hostname)}catch{return false}
}

export function extractModelText(input,data){
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com') return data?.candidates?.[0]?.content?.parts?.map(x=>x?.text||'').join('\n')||'';
  if(host==='api.cohere.com') return data?.message?.content?.map(x=>x?.text||'').join('')||'';
  return data?.choices?.[0]?.message?.content||'';
}

export function parseModelJson(text){
  const clean=String(text||'').replace(/```json|```/gi,'').trim();
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a<0||b<a)return null;
  try{return JSON.parse(clean.slice(a,b+1))}catch{return null}
}

export function looksLikeJsonObject(text){return !!parseModelJson(text)}

export function expectedSchemaFromPrompt(prompt){
  const p=String(prompt||'');
  if(p.includes('"decision":"approve|changes_requested"'))return 'review';
  if(p.includes('"changes":[{"path"'))return 'changes';
  if(p.includes('"status":"continue|blocked"'))return 'manager';
  return 'json';
}

export function matchesExpectedSchema(prompt,text){
  const d=parseModelJson(text); if(!d||typeof d!=='object'||Array.isArray(d))return false;
  const schema=expectedSchemaFromPrompt(prompt);
  if(schema==='review')return ['approve','changes_requested'].includes(d.decision)&&typeof d.summary==='string'&&Array.isArray(d.issues);
  if(schema==='changes')return typeof d.summary==='string'&&Array.isArray(d.changes)&&d.changes.length>0&&d.changes.every(x=>x&&typeof x.path==='string'&&typeof x.content==='string');
  if(schema==='manager')return ['continue','blocked'].includes(d.status)&&typeof d.summary==='string'&&(d.status==='blocked'||(d.job&&typeof d.job.title==='string'&&typeof d.job.instruction==='string'&&Array.isArray(d.job.paths)));
  return true;
}

export function promptFromRequest(input,init={}){
  let body;try{body=JSON.parse(String(init?.body||''))}catch{return ''}
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com')return body?.contents?.flatMap(x=>x?.parts||[]).map(x=>x?.text||'').join('\n')||'';
  if(host==='api.cohere.com')return body?.messages?.map(x=>typeof x?.content==='string'?x.content:(x?.content||[]).map(y=>y?.text||'').join('')).join('\n')||'';
  return body?.messages?.map(x=>x?.content||'').join('\n')||'';
}

export function prepareAiJsonRequest(input,init={}){
  if(!isAiUrl(input)||String(init?.method||'GET').toUpperCase()!=='POST'||!init?.body)return init;
  let body;try{body=JSON.parse(String(init.body))}catch{return init}
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com') body.generationConfig={...(body.generationConfig||{}),responseMimeType:'application/json'};
  else if(['api.groq.com','openrouter.ai','api.cohere.com'].includes(host)) body.response_format={type:'json_object'};
  return {...init,body:JSON.stringify(body)};
}

export function installAiJsonTransport({maxAttempts=3,baseDelayMs=350}={}){
  if(globalThis.__tigeriqAiJsonTransportInstalled)return;
  globalThis.__tigeriqAiJsonTransportInstalled=true;
  const original=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async(input,init={})=>{
    if(!isAiUrl(input))return original(input,init);
    const prepared=prepareAiJsonRequest(input,init);
    const prompt=promptFromRequest(input,prepared);
    let last;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const res=await original(input,prepared); last=res;
      if(!res.ok){
        if(attempt<maxAttempts&&[408,409,429,500,502,503,504].includes(res.status)){await sleep(baseDelayMs*attempt);continue}
        return res;
      }
      try{
        const data=await res.clone().json();
        const text=extractModelText(input,data);
        if(String(text||'').trim()&&matchesExpectedSchema(prompt,text))return res;
      }catch{
        if(attempt===maxAttempts)return res;
      }
      if(attempt<maxAttempts){await sleep(baseDelayMs*attempt);continue}
      return res;
    }
    return last;
  };
}
