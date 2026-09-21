const AI_HOSTS=['api.groq.com','openrouter.ai','api.mistral.ai','router.huggingface.co','generativelanguage.googleapis.com','api.cohere.com','integrate.api.nvidia.com','api.cloudflare.com'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function isAiUrl(input){
  try{return AI_HOSTS.includes(new URL(String(input)).hostname)}catch{return false}
}

export function extractModelText(input,data){
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com') return data?.candidates?.[0]?.content?.parts?.map(x=>x?.text||'').join('\n')||'';
  if(host==='api.cohere.com') return data?.message?.content?.map(x=>x?.text||'').join('')||'';
  if(host==='api.cloudflare.com') return data?.result?.response||'';
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
  if(p.includes('"edits":[{"path"'))return 'edits';
  if(p.includes('"changes":[{"path"'))return 'changes';
  if(p.includes('"status":"continue|blocked"'))return 'manager';
  return 'json';
}

export function matchesExpectedSchema(prompt,text){
  const d=parseModelJson(text); if(!d||typeof d!=='object'||Array.isArray(d))return false;
  const schema=expectedSchemaFromPrompt(prompt);
  if(schema==='review')return ['approve','changes_requested'].includes(d.decision)&&typeof d.summary==='string'&&Array.isArray(d.issues);
  if(schema==='edits')return typeof d.summary==='string'&&Array.isArray(d.edits)&&d.edits.length>0&&d.edits.every(x=>x&&typeof x.path==='string'&&typeof x.old==='string'&&x.old.length>0&&typeof x.new==='string');
  if(schema==='changes')return typeof d.summary==='string'&&Array.isArray(d.changes)&&d.changes.length>0&&d.changes.every(x=>x&&typeof x.path==='string'&&typeof x.content==='string');
  if(schema==='manager')return Boolean(['continue','blocked'].includes(d.status)&&typeof d.summary==='string'&&(d.status==='blocked'||(d.job&&typeof d.job.title==='string'&&typeof d.job.instruction==='string'&&Array.isArray(d.job.paths))));
  return true;
}

export function promptFromRequest(input,init={}){
  let body;try{body=JSON.parse(String(init?.body||''))}catch{return ''}
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com')return body?.contents?.flatMap(x=>x?.parts||[]).map(x=>x?.text||'').join('\n')||'';
  if(host==='api.cohere.com')return body?.messages?.map(x=>typeof x?.content==='string'?x.content:(x?.content||[]).map(y=>y?.text||'').join('')).join('\n')||'';
  if(host==='api.cloudflare.com')return String(body?.prompt||'');
  return body?.messages?.map(x=>x?.content||'').join('\n')||'';
}

export function prepareAiJsonRequest(input,init={}){
  if(!isAiUrl(input)||String(init?.method||'GET').toUpperCase()!=='POST'||!init?.body)return init;
  let body;try{body=JSON.parse(String(init.body))}catch{return init}
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com') body.generationConfig={...(body.generationConfig||{}),responseMimeType:'application/json'};
  else if(['api.groq.com','openrouter.ai','api.cohere.com','integrate.api.nvidia.com'].includes(host)) body.response_format={type:'json_object'};
  return {...init,body:JSON.stringify(body)};
}

export function compactCurrentFilesForModel(prompt,maxTotalChars=12000){
  const p=String(prompt||'');
  const start=p.indexOf('CURRENT FILES:\n');
  if(start<0)return p;
  const bodyStart=start+'CURRENT FILES:\n'.length;
  const after=p.slice(bodyStart);
  const end=after.lastIndexOf('\nReturn ONLY');
  if(end<0)return p;
  const block=after.slice(0,end);
  const suffix=after.slice(end);
  const chunks=block.split('\n\n---\n\n');
  const fileCount=Math.max(1,chunks.filter(x=>x.startsWith('FILE ')).length);
  const budget=Math.max(1800,Math.floor(maxTotalChars/fileCount));  const compacted=chunks.map(chunk=>{
    if(!chunk.startsWith('FILE '))return chunk;
    const nl=chunk.indexOf('\n');
    if(nl<0)return chunk;
    const header=chunk.slice(0,nl+1),content=chunk.slice(nl+1);
    if(content.length<=budget)return chunk;
    const head=Math.max(700,Math.floor(budget*0.25));
    const tail=Math.max(700,budget-head);
    const omitted=Math.max(0,content.length-head-tail);
    return header+content.slice(0,head)+`\n/* ... ${omitted} chars omitted from model context; full file retained locally ... */\n`+content.slice(-tail);
  }).join('\n\n---\n\n');
  return p.slice(0,bodyStart)+compacted+suffix;
}
export function compactPromptForChanges(prompt,{maxContextChars=12000,maxOutputChars=6000}={}){
  const p=String(prompt||'');
  if(expectedSchemaFromPrompt(p)!=='changes')return p;
  const old='Return ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.';
  const compact=`Return ONLY compact JSON {"summary":"short","edits":[{"path":"exact allowed path","search":"exact existing UTF-8 snippet","replace":"replacement UTF-8 snippet"}]}. For a new or empty small file you may use {"path":"exact allowed path","content":"complete UTF-8 file content"}. Keep the ENTIRE JSON response under ${maxOutputChars} characters. For existing files, each search snippet must be <=1200 characters and each replacement <=2400 characters; prefer several small exact edits over one large edit. Each search must match exactly once. Do not return full existing files or copy omitted context blocks. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep edits minimal and testable.`;
  const rewritten=p.includes(old)?p.replace(old,compact):`${p}\n\nIMPORTANT: ${compact}`;
  return compactCurrentFilesForModel(rewritten,maxContextChars);
}

export function compactPromptForEdits(prompt,{maxContextChars=7000,maxOutputChars=3500}={}){
  const p=String(prompt||'');
  if(expectedSchemaFromPrompt(p)!=='edits')return p;
  const guard=`Keep the ENTIRE JSON response under ${maxOutputChars} characters. Each old snippet must be exact, unique and <=800 characters; each new snippet must be <=1600 characters. Prefer multiple small edits over copying large functions or files. Never include omitted context blocks.`;
  const rewritten=p.includes(guard)?p:`${p}\n\nREPAIR PATCH LIMITS: ${guard}`;
  return compactCurrentFilesForModel(rewritten,maxContextChars);
}

export function currentFilesFromPrompt(prompt){
  const p=String(prompt||'');
  const start=p.indexOf('CURRENT FILES:\n');
  if(start<0)return new Map();
  const after=p.slice(start+'CURRENT FILES:\n'.length);
  const end=after.lastIndexOf('\nReturn ONLY JSON');
  const block=end>=0?after.slice(0,end):after;
  const chunks=block.split('\n\n---\n\n');
  const files=new Map();
  for(const chunk of chunks){
    if(!chunk.startsWith('FILE '))continue;
    const nl=chunk.indexOf('\n');
    if(nl<0)continue;
    const path=chunk.slice(5,nl).trim();
    if(path)files.set(path,chunk.slice(nl+1));
  }
  return files;
}

export function expandCompactChanges(prompt,text){
  const d=parseModelJson(text);
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('COMPACT_EDIT_JSON_INVALID');
  const files=currentFilesFromPrompt(prompt);
  if(Array.isArray(d.changes)&&d.changes.length>0){
    for(const change of d.changes){
      const path=String(change?.path||'').trim();
      const existing=files.get(path);
      if(files.has(path)&&String(existing||'').length>0)throw new Error(`COMPACT_EDIT_FULL_CONTENT_FOR_EXISTING:${path}`);
    }
    return d;
  }
  if(typeof d.summary!=='string'||!Array.isArray(d.edits)||!d.edits.length)throw new Error('COMPACT_EDIT_SCHEMA_INVALID');
  const changed=new Map();
  for(const edit of d.edits){
    const path=String(edit?.path||'').trim();
    if(!path||!files.has(path))throw new Error(`COMPACT_EDIT_PATH_UNKNOWN:${path}`);
    let content=changed.has(path)?changed.get(path):files.get(path);
    if(typeof edit?.content==='string'){
      if(content&&content.length>0)throw new Error(`COMPACT_EDIT_FULL_CONTENT_FOR_EXISTING:${path}`);
      content=edit.content;
    }else{
      const search=String(edit?.search??'');
      const replace=String(edit?.replace??'');
      if(!search)throw new Error(`COMPACT_EDIT_SEARCH_EMPTY:${path}`);
      const first=content.indexOf(search);
      if(first<0)throw new Error(`COMPACT_EDIT_SEARCH_MISSING:${path}`);
      if(content.indexOf(search,first+search.length)>=0)throw new Error(`COMPACT_EDIT_SEARCH_AMBIGUOUS:${path}`);
      content=content.slice(0,first)+replace+content.slice(first+search.length);
    }
    changed.set(path,content);
  }
  for(const [path,content] of changed){
    const original=String(files.get(path)??'');
    const next=String(content??'');
    if(original.length>=4000){
      const removed=original.length-next.length;
      if(removed>10000&&next.length<Math.floor(original.length*0.75))throw new Error(`COMPACT_EDIT_DESTRUCTIVE_SHRINK:${path}`);
    }
  }
  return {summary:d.summary,changes:[...changed].map(([path,content])=>({path,content}))};
}

function rewritePromptInRequest(input,init,prompt){
  let body;try{body=JSON.parse(String(init?.body||''))}catch{return init}
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com') body.contents=[{role:'user',parts:[{text:prompt}]}];
  else if(host==='api.cloudflare.com') body.prompt=prompt;
  else body.messages=[{role:'user',content:prompt}];
  return {...init,body:JSON.stringify(body)};
}

function replaceModelText(input,data,text){
  const host=new URL(String(input)).hostname;
  if(host==='generativelanguage.googleapis.com'){
    if(!data.candidates?.[0])data.candidates=[{content:{parts:[]}}];
    if(!data.candidates[0].content)data.candidates[0].content={};
    data.candidates[0].content.parts=[{text}];
  }else if(host==='api.cohere.com'){
    if(!data.message)data.message={};
    data.message.content=[{type:'text',text}];
  }else if(host==='api.cloudflare.com'){
    if(!data.result||typeof data.result!=='object')data.result={};
    data.result.response=text;
  }else{
    if(!data.choices?.[0])data.choices=[{message:{}}];
    if(!data.choices[0].message)data.choices[0].message={};
    data.choices[0].message.content=text;
  }
  return data;
}

function responseWithJson(res,data){
  return new Response(JSON.stringify(data),{status:res.status,statusText:res.statusText,headers:res.headers});
}

export function installAiJsonTransport({maxAttempts=3,baseDelayMs=350,attemptTimeoutMs=180000}={}){
  if(globalThis.__tigeriqAiJsonTransportInstalled)return;
  globalThis.__tigeriqAiJsonTransportInstalled=true;
  const original=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async(input,init={})=>{
    if(!isAiUrl(input))return original(input,init);
    const jsonPrepared=prepareAiJsonRequest(input,init);
    const originalPrompt=promptFromRequest(input,jsonPrepared);
    const schema=expectedSchemaFromPrompt(originalPrompt);
    let last;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      let res;
      const request=schema==='changes'
        ?rewritePromptInRequest(input,jsonPrepared,compactPromptForChanges(originalPrompt,{
          maxContextChars:attempt===1?12000:7000,
          maxOutputChars:attempt===1?6000:3500,
        }))
        :schema==='edits'
          ?rewritePromptInRequest(input,jsonPrepared,compactPromptForEdits(originalPrompt,{
            maxContextChars:attempt===1?7000:4500,
            maxOutputChars:attempt===1?3500:2400,
          }))
          :jsonPrepared;
      const attemptRequest={...request,signal:AbortSignal.timeout(attemptTimeoutMs)};
      try{res=await original(input,attemptRequest);last=res;}
      catch(error){
        const transient=error?.name==='AbortError'||/aborted|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(String(error?.message||error));
        if(transient&&attempt<maxAttempts){await sleep(baseDelayMs*attempt);continue}
        throw error;
      }
      if(!res.ok){
        if(attempt<maxAttempts&&[408,409,429,500,502,503,504].includes(res.status)){await sleep(baseDelayMs*attempt);continue}
        return res;
      }
      try{
        const data=await res.clone().json();
        const text=extractModelText(input,data);
        if(String(text||'').trim()){
          if(schema==='changes'){
            const expanded=expandCompactChanges(originalPrompt,text);
            if(matchesExpectedSchema(originalPrompt,JSON.stringify(expanded)))return responseWithJson(res,replaceModelText(input,data,JSON.stringify(expanded)));
          }else if(matchesExpectedSchema(originalPrompt,text))return res;
        }
      }catch{
        if(attempt===maxAttempts)return res;
      }
      if(attempt<maxAttempts){await sleep(baseDelayMs*attempt);continue}
      return res;
    }
    return last;
  };
}

