import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const NV04_IDLE_AUDIT_PATHS=Object.freeze([
  'apps/tigeriq-core/core-ui-assignment.mjs',
  'apps/tigeriq-core/work-routing-policy.mjs',
  'apps/tigeriq-core/autonomous-rca.mjs',
  'apps/tigeriq-core/self-audit.mjs',
]);
export const NV04_IDLE_AUDIT_HEARTBEAT_FILE='D:\\TigerIQ\\Apps\\ChromeController\\Runtime\\runtime-evidence.json';

function exactSha(value){return /^[a-f0-9]{40}$/i.test(String(value||''));}
function sourceHeaders(token=''){return {accept:'application/vnd.github+json','user-agent':'TigerIQ-NV04-Idle-Audit/1.0',...(token?{authorization:'Bearer '+token}:{})};}

export function nv04IdleAuditGate({enabled=false,worker=null,normalJobPending=false,coreAvailable=true,now=Date.now()}={}){
  if(!enabled)return {eligible:false,reason:'IDLE_AUDIT_DISABLED'};
  if(!coreAvailable)return {eligible:false,reason:'CORE_UNAVAILABLE'};
  if(normalJobPending)return {eligible:false,reason:'NORMAL_WORK_PRIORITY'};
  if(!worker||worker.id!=='NV04')return {eligible:false,reason:'NV04_HEARTBEAT_MISSING'};
  const stamp=Date.parse(String(worker.heartbeatAt||''));
  if(!Number.isFinite(stamp)||Math.abs(now-stamp)>90000)return {eligible:false,reason:'NV04_HEARTBEAT_STALE'};
  if(worker.status!=='READY'||worker.uiPhase!=='READY'||worker.uiBusy!==false||worker.blocked===true||
    worker.securityBlock||worker.windowState!=='OPEN'||worker.composerReady!==true||
    !/^https:\/\/gemini\.google\.com\/app(?:\/|$)/.test(String(worker.url||''))){
    return {eligible:false,reason:'NV04_NOT_IDLE_READY'};
  }
  return {eligible:true,reason:'NV04_IDLE_READY'};
}

export function readNv04IdleHeartbeat(path=NV04_IDLE_AUDIT_HEARTBEAT_FILE){
  try{
    const value=JSON.parse(readFileSync(path,'utf8'));
    return (Array.isArray(value?.workers)?value.workers:[]).find(worker=>worker?.id==='NV04')||null;
  }catch{return null;}
}

async function json(fetchImpl,url,token){
  const response=await fetchImpl(url,{headers:sourceHeaders(token),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('NV04_IDLE_SOURCE_HTTP_'+response.status);
  return response.json();
}

export async function nv04IdleSourcePacket({fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',paths=NV04_IDLE_AUDIT_PATHS,refSha=''}={}){
  const base='https://api.github.com/repos/'+owner+'/'+repo;
  const commit=refSha?null:await json(fetchImpl,base+'/commits/main',token);
  const sha=String(refSha||commit?.sha||'').toLowerCase();
  if(!exactSha(sha))throw new Error('NV04_IDLE_MAIN_SHA_UNVERIFIED');
  const ordered=paths.filter(path=>NV04_IDLE_AUDIT_PATHS.includes(path));
  if(!ordered.length)throw new Error('NV04_IDLE_SOURCE_ALLOWLIST_EMPTY');
  const shift=parseInt(sha.slice(0,4),16)%ordered.length;
  const rotated=ordered.slice(shift).concat(ordered.slice(0,shift)).slice(0,2);
  const files=[];
  for(const path of rotated){
    const blob=await json(fetchImpl,base+'/contents/'+path+'?ref='+sha,token);
    if(blob?.encoding!=='base64'||typeof blob?.content!=='string')throw new Error('NV04_IDLE_SOURCE_CONTENT_UNVERIFIED');
    const decoded=Buffer.from(blob.content.replace(/\s/g,''),'base64').toString('utf8');
    if(!decoded||decoded.length>120000)throw new Error('NV04_IDLE_SOURCE_CONTENT_BOUNDS');
    const selected=decoded.split('\n').slice(0,230).map((line,i)=>String(i+1).padStart(3,' ')+' | '+line).join('\n').slice(0,10000);
    files.push({path,sha:blob.sha||null,source:decoded.slice(0,120000),excerpt:selected});
  }
  if(files.length!==2)throw new Error('NV04_IDLE_SOURCE_INCOMPLETE');
  return {sha,files,sourceUrl:'https://github.com/'+owner+'/'+repo+'/tree/'+sha};
}

export function buildNv04IdleAuditPrompt(packet){
  if(!exactSha(packet?.sha)||!Array.isArray(packet.files)||packet.files.length!==2)throw new Error('NV04_IDLE_PACKET_INVALID');
  const sections=packet.files.map(file=>'FILE='+file.path+'\n'+file.excerpt).join('\n\n');
  return [
    'LÀM — NO YAPPING. NV04: kiểm toán mã nguồn TigerIQ chỉ đọc, do Core giao khi rảnh.',
    'NV04_ROLE=READ_ONLY_CODE_AUDITOR',
    'SOURCE_SHA='+packet.sha,
    'SOURCE_URL='+packet.sourceUrl,
    'QUYEN=READ_ONLY; KHONG_SUA_CODE; KHONG_TU_CLAIM; KHONG_DUNG_P0; KHONG_SUA_APP_CHROME.',
    'PHAM_VI=Chỉ hai file được cấp bên dưới, KHÔNG được báo đã rà toàn repository.',
    'NHIEM_VU=Tìm lỗi logic, retry, idempotency, đồng bộ, trạng thái và ranh giới quyền có căn cứ mã.',
    'BAT_BUOC=Trích đúng path, số dòng và đoạn mã; suy đoán phải phân biệt với lỗi đã tái hiện.',
    'OUTPUT=NV04_IDLE_AUDIT_RESULT_V1',
    'SOURCE_SHA='+packet.sha,
    'FINDINGS_JSON=[{"path":"path","line":1,"quote":"exact one-line excerpt","description":"potential defect","repro":"specific test or evidence to verify","severity":"P1|P2|P3"}]',
    'Nếu không có phát hiện có căn cứ, xuất FINDINGS_JSON=[]; không bịa lỗi hoặc kết quả kiểm thử.',
    sections,
  ].join('\n');
}

export function parseNv04IdleAuditResult(raw,packet){
  const value=String(raw||'');
  if(!value.includes('NV04_IDLE_AUDIT_RESULT_V1'))return {accepted:false,reason:'AUDIT_RESULT_MARKER_MISSING'};
  const sha=String(value.match(/^SOURCE_SHA=([a-f0-9]{40})\s*$/mi)?.[1]||'').toLowerCase();
  if(sha!==String(packet?.sha||'').toLowerCase())return {accepted:false,reason:'AUDIT_SOURCE_SHA_MISMATCH'};
  const payload=value.match(/^FINDINGS_JSON=(\[[^\r\n]*\])\s*$/m)?.[1]||'';
  if(!payload)return {accepted:false,reason:'AUDIT_FINDINGS_MISSING'};
  let findings;
  try{findings=JSON.parse(payload);}catch{return {accepted:false,reason:'AUDIT_FINDINGS_JSON_INVALID'};}
  if(!Array.isArray(findings)||findings.length>5)return {accepted:false,reason:'AUDIT_FINDINGS_LIMIT'};
  const checked=[];
  for(const f of findings){
    const file=packet?.files?.find(x=>x.path===f.path);
    const line=Number(f.line);
    if(!file||!Number.isInteger(line)||line<1||line>230||!['P1','P2','P3'].includes(f.severity)||
      String(f.description||'').trim().length<18||String(f.repro||'').trim().length<12){
      return {accepted:false,reason:'AUDIT_FINDING_CONTRACT_INVALID'};
    }
    const sourceLine=file.source.split('\n')[line-1]||'';
    const quote=String(f.quote||'').trim();
    if(quote.length<10||quote.length>240||!sourceLine.includes(quote))return {accepted:false,reason:'AUDIT_FINDING_SOURCE_UNVERIFIED'};
    const signature=createHash('sha256').update(packet.sha+'|'+f.path+'|'+line+'|'+quote).digest('hex').slice(0,20);
    checked.push({path:f.path,line,quote,description:String(f.description).slice(0,800),repro:String(f.repro).slice(0,800),severity:f.severity,signature,verification:'SOURCE_LINE_CONFIRMED_LOGIC_UNVERIFIED'});
  }
  return {accepted:true,reason:'SOURCE_GROUNDED_FINDINGS_NOT_YET_PROVEN',findings:checked,sourceSha:packet.sha};
}
