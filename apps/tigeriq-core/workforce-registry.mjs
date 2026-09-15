const DEFAULT_REGISTRY_URL = 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/335';
const REGISTRY_URL = process.env.TIGERIQ_REGISTRY_URL?.trim() || DEFAULT_REGISTRY_URL;
const CACHE_MS = Number(process.env.TIGERIQ_REGISTRY_CACHE_MS || 60000);

const fallbackAssignments = new Map([
  ['NV01',{ employee_id:'NV01', name:'Minh', admin_state:'MANUAL_ONLY / READY' }],
  ['NV02',{ employee_id:'NV02', name:'ChatGPT Plus', admin_state:'AVAILABLE_MANUAL / PRIMARY_UI_EXECUTOR / SEPARATE_CHROME_SESSION / NOT_CHIEF_OF_STAFF' }],
  ['NV03',{ employee_id:'NV03', name:'ChatGPT Go', admin_state:'AVAILABLE_MANUAL / SECOND_REVIEW / SUPPORT_UI_ACCOUNT' }],
  ['NV04',{ employee_id:'NV04', name:'Gemini Pro', admin_state:'AVAILABLE_MANUAL / DEEP_RESEARCH / INDEPENDENT_REVIEW / PAID_SUBSCRIPTION_CONFIRMED_2026-09-14' }],
  ['NV06',{ employee_id:'NV06', name:'OpenClaw', admin_state:'PAUSED' }],
  ['NV10',{ employee_id:'NV10', name:'Ollama', admin_state:'ACTIVE_CORE_RESOURCE / ONLINE_IDLE / LOCAL_AI' }],
  ['NV11',{ employee_id:'NV11', name:'Groq', admin_state:'LIVE_PASS / READY_WHEN_CALLED / CORE_RESOURCE' }],
  ['NV12',{ employee_id:'NV12', name:'Gemini', admin_state:'LIVE_PASS / READY_WHEN_CALLED / CORE_RESOURCE / FREE_GUARD' }],
  ['NV13',{ employee_id:'NV13', name:'OpenRouter', admin_state:'LIVE_PASS / READY_WHEN_CALLED / CORE_RESOURCE' }],
  ['NV14',{ employee_id:'NV14', name:'Mistral', admin_state:'CREDENTIAL_INSTALLED / RATE_LIMIT_429 / CORE_COOLDOWN_30M' }],
  ['NV15',{ employee_id:'NV15', name:'Cloudflare Workers AI', admin_state:'LIVE_PASS / READY_WHEN_CALLED / CORE_RESOURCE' }],
  ['NV16',{ employee_id:'NV16', name:'Hugging Face', admin_state:'LIVE_PASS / READY_WHEN_CALLED / CORE_RESOURCE' }],
  ['NV17',{ employee_id:'NV17', name:'Vercel AI Gateway', admin_state:'AUTH_VALID / BLOCKED_INFERENCE_403 / CORE_BLOCKED' }],
  ['NV18',{ employee_id:'NV18', name:'IBM watsonx.ai Lite', admin_state:'CREDENTIAL_INSTALLED / RUNTIME_ASSOCIATION_BLOCKED / CORE_BLOCKED' }],
  ['NV19',{ employee_id:'NV19', name:'Cohere', admin_state:'LIVE_PASS / READY_WHEN_CALLED / CORE_RESOURCE' }],
  ['NV20',{ employee_id:'NV20', name:'NVIDIA NIM', admin_state:'WAIT_KEY / CORE_OFFLINE' }],
]);

const slotId = n => `NV${String(n).padStart(2,'0')}`;

function completeRoster(assignments, retired = new Set(['NV05','NV07','NV08'])) {
  return Array.from({length:20},(_,i)=>{
    const employee_id=slotId(i+1);
    const found=assignments.get(employee_id);
    if(found) return { ...found, assigned:true, retired:false };
    if(retired.has(employee_id)) return { employee_id, name:'Đã ngừng', admin_state:'RETIRED', assigned:false, retired:true };
    return { employee_id, name:'Chưa cấp', admin_state:'UNASSIGNED', assigned:false, retired:false };
  });
}

function parseRegistryBody(body) {
  const assignments=new Map();
  const retired=new Set();
  for(const line of String(body||'').split(/\r?\n/)) {
    const cells=line.split('|').map(x=>x.trim()).filter(Boolean);
    if(cells.length>=3) {
      const code=cells[0].replaceAll('`','').trim();
      if(/^NV\d{2}$/.test(code) && code!=='NV00') {
        assignments.set(code,{ employee_id:code, name:cells[1].replaceAll('`','').trim(), admin_state:cells[2].replaceAll('`','').trim() });
      }
    }
    if(/RETIRED/i.test(line)) {
      for(const match of line.matchAll(/`(?:NV)?(\d{1,2})`/gi)) retired.add(slotId(Number(match[1])));
    }
  }
  if(!assignments.size) throw new Error('REGISTRY_WORKFORCE_TABLE_MISSING');
  const version=String(body||'').match(/REGISTRY_ROOT_VERSION=(\d+)/)?.[1] || null;
  return { workforce:completeRoster(assignments,retired), version };
}

let cache={
  workforce:completeRoster(fallbackAssignments),
  meta:{ source:'registry-335-fallback-v49', version:'49', fetchedAt:null, stale:true, error:null },
  expiresAt:0,
  refreshing:false,
};

export function workforceSnapshot(){
  return { workforce:cache.workforce.map(x=>({...x})), workforceMeta:{...cache.meta} };
}

export async function refreshRegistryWorkforce(force=false){
  const now=Date.now();
  if(cache.refreshing || (!force && now<cache.expiresAt)) return workforceSnapshot();
  cache.refreshing=true;
  try {
    const response=await fetch(REGISTRY_URL,{ headers:{accept:'application/vnd.github+json','user-agent':'TigerIQ-Web-Control/1.0'}, signal:AbortSignal.timeout(3500), cache:'no-store' });
    if(!response.ok) throw new Error(`REGISTRY_HTTP_${response.status}`);
    const issue=await response.json();
    const parsed=parseRegistryBody(issue?.body||'');
    cache={ workforce:parsed.workforce, meta:{source:'registry-335-live',version:parsed.version,fetchedAt:new Date().toISOString(),stale:false,error:null}, expiresAt:now+CACHE_MS, refreshing:false };
  } catch(error) {
    cache.meta={...cache.meta,stale:true,error:String(error?.message||error)};
    cache.expiresAt=now+Math.min(CACHE_MS,15000);
    cache.refreshing=false;
  }
  return workforceSnapshot();
}

export function normalizeRuntimeResources(resources, workforce){
  const roster=new Map((workforce||[]).map(x=>[x.employee_id,x]));
  return (Array.isArray(resources)?resources:[]).map(resource=>{
    if(resource?.employee_id==='NV02' && String(resource?.provider||'').toLowerCase()==='ollama' && roster.get('NV02')?.name==='ChatGPT Plus' && roster.get('NV10')?.name==='Ollama') {
      return {...resource,employee_id:'NV10',runtime_source_employee_id:'NV02',identity_migrated:true};
    }
    return resource;
  });
}

export { parseRegistryBody, completeRoster };
