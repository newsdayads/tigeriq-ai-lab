// Owner console: explicit browser-confirmed, LOCAL-only Core objectives.
// Core remains sole scheduler and work/lease authority; this module creates no jobs.
import {randomBytes} from 'node:crypto';

const CORE_STATUS='http://127.0.0.1:8795/api/status';
const CORE_OBJECTIVES='http://127.0.0.1:8795/api/objectives';
const ERR_MAX=100;
const truncate=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';

export function createOwnerActions({fetchImpl=fetch, now=Date.now}={}) {
  const token=randomBytes(32).toString('hex');
  const requests=new Map();
  const requireOrigin=(req,port)=>{
    const origin=String(req.headers.origin||'');
    const expected='http://'+req.headers.host;
    return (origin===expected)&&
      (expected==='http://127.0.0.1:'+port||expected==='http://localhost:'+port)&&
      req.headers['x-tigeriq-action']===token &&
      req.headers['content-type']?.split(';')[0]?.trim()==='application/json';
  };
  async function readBody(req){
    let body='';
    for await(const b of req){
      body+=b;
      if(Buffer.byteLength(body,'utf8')>8192)throw Error('REQUEST_TOO_LARGE');
    }
    try{return JSON.parse(body)}catch{throw Error('INVALID_JSON')}
  }
  async function postObjective(req,port) {
    if(!requireOrigin(req,port))return {status:403,body:{ok:false,reason:'LOCAL_CONFIRMATION_REQUIRED'}};
    const key=truncate(req.headers['x-request-id'],90);
    if(!/^[0-9a-f-]{30,65}$/i.test(key))return {status:400,body:{ok:false,reason:'REQUEST_ID_REQUIRED'}};
    let input;
    try{input=await readBody(req)}catch(e){return {status:400,body:{ok:false,reason:String(e.message).slice(0,ERR_MAX)}}}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       typeof input.objective!=='string'||input.objective.trim().length<12||
       input.objective.trim().length>2000 ||
       input.routingProfile!=='LOCAL'||input.priority!=='P2'||
       Object.keys(input).some(k=>!['objective','priority','routingProfile'].includes(k)))
      return {status:400,body:{ok:false,reason:'LOCAL_P2_OBJECTIVE_ONLY'}};
    const body=JSON.stringify({objective:input.objective.trim(),priority:'P2',
      routingProfile:'LOCAL',source:'animal-city-local'});
    if(requests.has(key)){
      const prior=requests.get(key);
      if(prior.payload!==body)return {status:409,body:{ok:false,reason:'IDEMPOTENCY_CONFLICT'}};
      return prior.task;
    }
    const task=(async()=>{
      try{
        const r=await fetchImpl(CORE_OBJECTIVES,{
          method:'POST',redirect:'error',cache:'no-store',
          headers:{'content-type':'application/json','accept':'application/json'},
          body,signal:AbortSignal.timeout(12000),
        });
        if(r.status!==201)return {status:502,body:{ok:false,reason:'CORE_OBJECTIVE_REJECTED',coreHttp:r.status}};
        const result=await r.json();
        if(result?.ok!==true||!/^OBJ-[a-f0-9-]{36}$/i.test(result.id||''))
          return {status:502,body:{ok:false,reason:'CORE_RECEIPT_UNVERIFIED'}};
        return {status:201,body:{ok:true,objectiveId:result.id,priority:'P2',routingProfile:'LOCAL',
          source:'TigerIQ Core /api/objectives',receiptVerified:true,
          note:'Core đã NHẬN mục tiêu; chưa khẳng định AI đã bắt đầu hoặc đã hoàn tất.'}};
      }catch{return {status:503,body:{ok:false,reason:'CORE_UNAVAILABLE'}}}
    })();
    requests.set(key,{payload:body,task});
    if(requests.size>200)requests.delete(requests.keys().next().value);
    return task;
  }
  async function recentObjectives(){
    try{
      const r=await fetchImpl(CORE_STATUS,{method:'GET',redirect:'error',cache:'no-store',
        headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
      if(r.status!==200)return {status:503,body:{ok:false,reason:'CORE_STATUS_UNAVAILABLE',objectives:[]}};
      const raw=await r.text();
      if(Buffer.byteLength(raw,'utf8')>4_000_000)throw Error('OVERSIZED');
      const data=JSON.parse(raw);
      const at=Date.parse(data?.core?.time||'');
      if(data?.ok!==true||!Number.isFinite(at)||now()-at>30_000||
         at-now()>10_000||!Array.isArray(data.objectives)||!Array.isArray(data.jobs))
        throw Error('UNVERIFIED');
      const objectives=data.objectives.filter(x=>x?.metadata?.source==='animal-city-local')
        .slice(0,12).map(x=>{
          const jobs=data.jobs.filter(j=>j?.objective_id===x.id).slice(0,8);
          return {
            id:truncate(x.id,55),
            objective:truncate(x.objective,220),
            priority:truncate(x.priority,4),
            state:truncate(x.status,50)||'UNKNOWN',
            summary:truncate(x.summary,240),
            jobs:jobs.map(j=>({id:truncate(j.id,70),status:truncate(j.status,50),
              employeeId:truncate(j.employee_id,30),capability:truncate(j.capability,60)})),
            updatedAt:x.updated_at,
          };
        });
      return {status:200,body:{ok:true,source:'TigerIQ Core /api/status',
        verifiedAt:new Date(at).toISOString(),objectives,complete:false,
        note:'Chỉ hiển thị tối đa 12 mục tiêu Animal City mới nhất nằm trong 20 mục tiêu Core trả về.'}};
    }catch{return {status:503,body:{ok:false,reason:'CORE_STATUS_UNVERIFIED',objectives:[]}}}
  }
  return {config:()=>({ok:true,token,mode:'LOCAL_ONLY_P2',writeAllowed:true,
    note:'Chỉ submit mục tiêu LOCAL, phí API đám mây không được phép.'}),
    postObjective,recentObjectives};
}
