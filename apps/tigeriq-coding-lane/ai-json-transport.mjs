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

export function looksLikeJsonObject(text){
  const clean=String(text||'').replace(/```json|```/gi,'').trim();
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a<0||b<a)return false;
  try{JSON.parse(clean.slice(a,b+1));return true}catch{return false}
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
        if(String(text||'').trim()&&looksLikeJsonObject(text))return res;
      }catch{return res}
      if(attempt<maxAttempts){await sleep(baseDelayMs*attempt);continue}
      return res;
    }
    return last;
  };
}
