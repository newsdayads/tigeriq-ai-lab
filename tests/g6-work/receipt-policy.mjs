import {createHash} from 'node:crypto';
export const sha256=x=>createHash('sha256').update(x).digest('hex');
// Host-origin receipts only; never infer success from an AI's text.
export function verifySandboxReceipt(r){
  const deny=code=>({pass:false,code});
  if(!/^[a-f0-9]{40}$/.test(r?.source_sha||''))return deny('G6_SOURCE_UNVERIFIED');
  if(r.permission?.surface!=='GITHUB_BRANCH_ISOLATED_ONLY'||r.permission?.new_cost!==0||r.permission?.no_pc01_shell!==true)return deny('G6_PERMISSION_UNVERIFIED');
  if(r.skill?.status!=='ACTIVE'||!r.skill.id||!r.skill.version||!(r.skill.bytes>0)||!/^[a-f0-9]{64}$/.test(r.skill.content_sha256||''))return deny('G6_ACTIVE_SKILL_UNVERIFIED');
  if(!Array.isArray(r.models)||r.models.length!==4)return deny('G6_MODEL_ROLES_MISSING');
  const workers=new Set();
  for(const role of ['manager','implementer','reviewer','acceptor']){
    const rows=r.models.filter(x=>x.role===role);
    if(rows.length!==1)return deny('G6_MODEL_ROLES_MISSING');
    const m=rows[0];workers.add(m.worker_id);
    if(!m.worker_id||!Number.isInteger(m.pid)||!m.model_id||!m.lease?.lease_token||m.lease.role!==role||!m.prompt||!m.response||
       sha256(m.prompt)!==m.prompt_sha256||sha256(m.response)!==m.response_sha256||
       !m.prompt.includes(r.source_sha)||!m.prompt.includes(r.skill.content_sha256))return deny('G6_MODEL_RECEIPT_UNVERIFIED');
  }
  if(workers.size!==4)return deny('G6_INDEPENDENCE_UNVERIFIED');
  if(!r.tool?.id||r.tool.network!=='none'||r.tool.read_only!==true||r.tool.exit_code!==0||
     !r.tool.stdout||sha256(r.tool.stdout)!==r.tool.stdout_sha256||
     !r.tool.candidate_sha256||r.tool.candidate_sha256!==r.candidate_sha256)return deny('G6_TOOL_UNVERIFIED');
  if(r.functional?.pass!==true||r.functional?.tested!==12||r.functional?.candidate_sha256!==r.candidate_sha256)return deny('G6_FUNCTIONAL_UNVERIFIED');
  if(r.models.find(x=>x.role==='reviewer').parsed?.decision!=='approve'||
     r.models.find(x=>x.role==='acceptor').parsed?.decision!=='accept')return deny('G6_REVIEW_OR_ACCEPTANCE_REJECTED');
  return {pass:true,code:'G6_IMPORTED_COMPONENT_SANDBOX_VERIFIED',production_runtime_accepted:false};
}
