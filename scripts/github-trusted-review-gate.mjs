import {readFileSync} from 'node:fs';

const EXPECTED_REPO='newsdayads/tigeriq-ai-lab';
export const REQUIRED_CHECKS=['CI Verify','Queue Hygiene Verify','Vercel Online Verify'];
const AUTH_MARKER='TIGERIQ_INDEPENDENT_REVIEW_PASS';

const field=(body,key)=>{
  const line=String(body||'').split(/\r?\n/).find(s=>s.startsWith(key+':'));
  return line?line.slice(key.length+1).trim():'';
};
const login=s=>String(s||'').trim().toLowerCase();
export function evaluateTrustedReview({pull, reviews, checks, nv03Login, nv04Login}){
  const head=String(pull?.head?.sha||'');
  const author=login(pull?.user?.login);
  if(!/^[0-9a-f]{40}$/.test(head))return {ok:false,reason:'PR_HEAD_MISSING'};
  if(pull?.base?.ref!=='main'||pull?.state!=='open'||pull?.draft)return {ok:false,reason:'PR_NOT_ELIGIBLE'};
  if(!author)return {ok:false,reason:'PR_AUTHOR_MISSING'};
  for(const name of REQUIRED_CHECKS){
    const exact=(checks||[]).filter(c=>c.name===name&&c.status==='completed'&&c.conclusion==='success'&&Number(c.app?.id)===15368);
    if(!exact.length)return {ok:false,reason:'REQUIRED_CHECK_NOT_PASS:'+name};
  }
  const roles=[['NV03',login(nv03Login)],['NV04',login(nv04Login)]];
  if(roles.some(([role,id])=>!!id&&id===author))return {ok:false,reason:'REVIEWER_IS_AUTHOR'};
  if(!roles.some(([role,id])=>id))return {ok:false,reason:'REVIEWER_GITHUB_IDENTITY_NOT_CONFIGURED'};
  const valid=(reviews||[]).filter(x=>x&&x.user&&typeof x.user.login==='string'&&x.commit_id===head);
  const latest=new Map();
  for(const x of valid.sort((a,b)=>(Date.parse(a.submitted_at)||0)-(Date.parse(b.submitted_at)||0)||Number(a.id||0)-Number(b.id||0))){
    latest.set(login(x.user.login),x);
  }
  for(const [role,id] of roles){
    if(id&&latest.get(id)?.state==='CHANGES_REQUESTED')return {ok:false,reason:'INDEPENDENT_REVIEW_CHANGES_REQUESTED:'+role};
  }
  for(const [role,id] of roles){
    if(!id||id===author)continue;
    const review=latest.get(id);
    if(!review||review.state!=='APPROVED')continue;
    const body=String(review.body||'');
    if(!body.split(/\r?\n/).some(s=>s.trim()===AUTH_MARKER))continue;
    if(field(body,'REVIEW_ROLE')!==role)continue;
    if(field(body,'TARGET_HEAD')!==head)continue;
    const evidence=field(body,'EVIDENCE_REF');
    if(!/^([a-z][a-z0-9+.-]*:[^\s]+)$/i.test(evidence))continue;
    return {ok:true,reason:'TRUSTED_INDEPENDENT_REVIEW_PASS',reviewer:role,reviewId:review.id,evidence};
  }
  return {ok:false,reason:'NO_AUTHENTICATED_EXACT_HEAD_APPROVAL_NV03_NV04'};
}
async function api(path,token,method='GET',payload){
  const response=await fetch('https://api.github.com/repos/'+EXPECTED_REPO+path,{
    method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'TigerIQ-trusted-review-publisher',
      ...(payload?{'content-type':'application/json'}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{})});
  if(!response.ok)throw new Error('GITHUB_API_'+response.status+':'+path);
  const body=await response.text();
  return body?JSON.parse(body):{};
}
async function pages(path,token,key){
  const rows=[];
  for(let i=1;i<=10;i++){
    const value=await api(path+(path.includes('?')?'&':'?')+'per_page=100&page='+i,token);
    const part=key?value[key]:value;
    if(!Array.isArray(part))throw new Error('INVALID_GITHUB_PAGE');
    rows.push(...part);
    if(part.length<100)return rows;
  }
  throw new Error('GITHUB_PAGINATION_LIMIT');
}
async function main(){
  if(process.env.GITHUB_REPOSITORY!==EXPECTED_REPO)throw new Error('WRONG_REPOSITORY');
  const token=process.env.GITHUB_TOKEN;
  if(!token)throw new Error('GITHUB_TOKEN_MISSING');
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const prNumber=Number(event.pull_request?.number||event.issue?.number||event.inputs?.pr_number);
  if(!Number.isInteger(prNumber)||prNumber<1)throw new Error('INVALID_PR_NUMBER');
  const pr=await api('/pulls/'+prNumber,token);
  if(pr.number!==prNumber)throw new Error('PR_LOOKUP_MISMATCH');
  const head=String(pr.head?.sha||'');
  if(!/^[0-9a-f]{40}$/.test(head))throw new Error('INVALID_LIVE_HEAD');
  let verdict;
  try{
    const [reviews,checks]=await Promise.all([
      pages('/pulls/'+prNumber+'/reviews',token),
      pages('/commits/'+head+'/check-runs',token,'check_runs')
    ]);
    verdict=evaluateTrustedReview({pull:pr,reviews,checks,
      nv03Login:process.env.NV03_GITHUB_LOGIN,nv04Login:process.env.NV04_GITHUB_LOGIN});
  }catch(error){
    verdict={ok:false,reason:'REVIEW_EVIDENCE_FETCH_FAILED:'+String(error.message).slice(0,80)};
  }
  const check=await api('/check-runs',token,'POST',{
    name:'TigerIQ Trusted Independent Review',
    head_sha:head,status:'completed',conclusion:verdict.ok?'success':'failure',
    output:{title:verdict.ok?'Authenticated review PASS':'Review not authorized',
      summary:'PR #'+prNumber+' HEAD '+head+'\n'+verdict.reason+
        (verdict.ok?'\nReviewer '+verdict.reviewer+' native review #'+verdict.reviewId:'')+
        '\nNo replacement of required branch checks or manual approval.'}
  });
  console.log('TRUSTED_REVIEW_CHECK_ID='+check.id+' PR='+prNumber+' HEAD='+head+' VERDICT='+verdict.reason);
  if(!verdict.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(e=>{console.error('TRUSTED_REVIEW_PUBLISHER_ERROR='+e.message);process.exitCode=1;});
}
