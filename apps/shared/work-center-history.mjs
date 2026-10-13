/* Shared read-only work-order audit: declarations are not execution receipts. */
import {validateWorkOrderLifecycleV2} from '../tigeriq-core/work-order-lifecycle-v2.mjs';
const MAX_EVENTS=60;
export function recentCommentPages(total){
 const n=Number(total);
 if(!Number.isSafeInteger(n)||n<0)return [1];
 const last=Math.max(1,Math.ceil(n/100));
 return last>1?[last-1,last]:[1];
}
export function latestComments(pages){
 return (Array.isArray(pages)?pages:[]).flatMap(p=>Array.isArray(p)?p:[]).slice(-100);
}
function val(body,key){const m=String(body||'').match(new RegExp('^'+key+'=([^\\r\\n]+)$','m'));return m?m[1].trim():''}
function safeText(v,max=220){return String(v||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function url(v){const t=String(v||'');return /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:issues|pull|commit)\/[a-zA-Z0-9_.#/-]+(?:\?.*)?$/.test(t)?t:null}
export function completionProof(issue){
 const checked=validateWorkOrderLifecycleV2(issue);
 const body=String(issue?.body||'');
 const isClosed=issue?.state==='closed'&&issue?.state_reason==='completed';
 const verified=isClosed&&checked.required===true&&checked.valid===true
   &&val(body,'DONE').toLowerCase()==='true'
   &&checked.timestamps?.finishVerified===true
   &&checked.steps.length>=2&&checked.steps.every(s=>s.checked&&Boolean(s.evidence));
 return {verified,timing:checked.timestamps,contract:{required:checked.required,valid:checked.valid,missing:checked.missing},checkedSteps:checked.steps.length,verifiedSteps:checked.steps.filter(s=>s.checked&&s.evidence).length};
}
function commentEvent(comment){
 const body=String(comment?.body||'');
 const step=val(body,'CURRENT_STEP')||val(body,'LAST_COMPLETED_STEP')||val(body,'ACTION');
 const result=val(body,'RESULT')||val(body,'VERIFICATION');
 const state=val(body,'CURRENT_STATE')||val(body,'STATE');
 const evidence=url(val(body,'EVIDENCE_URL')||val(body,'EVIDENCE'))||url(comment?.html_url);
 // GitHub progress/retry/results comments are legitimate recorded activity
 // even when they lack CURRENT_STATE=... fields. Do not treat author text
 // as proof that an AI executed or completed the corresponding task.
 const prefix=body.match(/^\s*\[([^\]\r\n]{2,55})\]/);
 const observedAction=prefix?safeText(prefix[1],70):'Bình luận GitHub';
 const observedDetail=safeText(body.replace(/^\s*\[[^\]\r\n]+\]\s*/,''),300);
 const actor=safeText(comment?.user?.login||'Chưa xác minh',70);
 const executor=val(body,'EXECUTOR_ID');
 const executorReceipt=url(val(body,'EXECUTOR_RECEIPT_URL')||val(body,'START_RECEIPT_URL'));
 return {
  at:comment?.created_at||null,
  action:safeText(state||observedAction,72),
  detail:safeText(step||result||observedDetail||'Không có mô tả',300),
  author:actor+' (người ghi nhật ký)',
  executor:/^NV\d{2}$/.test(executor)&&executorReceipt?executor:null,
  url:evidence
 };
}
export function buildWorkHistory(issue,comments=[]){
 const number=Number(issue?.number);
 if(!Number.isSafeInteger(number)||number<1)throw Error('INVALID_WORK_ORDER');
 const proof=completionProof(issue);
 const creation={at:issue.created_at||null,action:'Tạo hồ sơ',detail:safeText(issue.title,220),author:safeText(issue.user?.login||'GitHub',70)+' (người tạo)',url:url(issue.html_url)};
 const list=(Array.isArray(comments)?comments:[]).map(commentEvent).filter(Boolean);
 if(issue.state==='closed')list.push({at:issue.closed_at||null,action:proof.verified?'Nghiệm thu hoàn tất':'Đóng thẻ GitHub — chưa xác minh hoàn tất',detail:proof.verified?'Đã đủ biên nhận V2':'Không dùng trạng thái đóng thẻ làm bằng chứng kết thúc công việc',author:'GitHub (trạng thái thẻ)',url:url(issue.html_url)});
 return {
  ok:true,issueNumber:number,source:'github_read_only',completionVerified:proof.verified,timing:proof.timing,
  checkedSteps:proof.checkedSteps,verifiedSteps:proof.verifiedSteps,historyScope:'latest_100_comments_only',
  events:[creation,...list].sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0)).slice(0,MAX_EVENTS)
 };
}
