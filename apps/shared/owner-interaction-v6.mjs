// TigerIQ Owner Interaction V6 — read-only, evidence-gated presentation.
// Not an authorization service, Core dispatcher, chat host integration or live feed.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/;
const ISSUE=/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/[1-9]\d*$/;
const EVIDENCE=/^https:\/\/(github\.com\/newsdayads\/tigeriq-ai-lab\/|tigeriq-ai-lab\.vercel\.app\/)/;
const LABELS=Object.freeze({
  completed:{label:'HOÀN TẤT',color:'success',icon:'check-circle'},
  working:{label:'ĐANG XỬ LÝ',color:'info',icon:'activity'},
  review:{label:'ĐANG RÀ SOÁT',color:'info',icon:'clipboard-check'},
  waiting:{label:'CHỜ',color:'warning',icon:'clock'},
  blocked:{label:'BỊ CHẶN',color:'danger',icon:'shield-alert'},
  unknown:{label:'CHƯA XÁC MINH',color:'secondary',icon:'circle-help'},
});
export const OWNER_V6_STATUS=LABELS;
export const OWNER_V6_ACTIONS=Object.freeze({OPEN:'HỒ SƠ',REFRESH:'KIỂM TRA',CONTINUE:'LÀM NGAY'});
const parsedTime=(value)=>typeof value==='string'&&value.trim()?Date.parse(value):NaN;
const gitIssue=(value)=>typeof value==='string'&&ISSUE.test(value);
const evidence=(value)=>typeof value==='string'&&EVIDENCE.test(value);
const positiveInt=(n)=>Number.isSafeInteger(n)&&n>=0;

function evidenceProgress(row, accepted) {
  const p=row?.progress;
  if(!p || p.verified!==true || !positiveInt(p.completed) ||
    !Number.isSafeInteger(p.total) || p.total<1 || p.completed>p.total ||
    !evidence(p.evidenceUrl))return {percent:null,label:'CHƯA ĐỦ DỮ LIỆU TÍNH %',verified:false};
  const label=p.completed+'/'+p.total+' mốc đã xác minh';
  // All milestones checked but final acceptance still pending: never show 100%.
  if(p.completed===p.total && !accepted)
    return {percent:null,label:label+' · CHỜ NGHIỆM THU CUỐI',verified:true};
  return {percent:Math.round(p.completed/p.total*100),label,verified:true};
}
function readState(row,source,progress) {
  const fresh=source?.fresh===true && source?.verified===true &&
    Number.isFinite(parsedTime(source.checkedAt));
  if(!fresh)return 'unknown';
  const status=String(row.status||'').trim().toUpperCase();
  if(['DONE','COMPLETED','HOÀN TẤT'].includes(status))
    return row.acceptanceVerified===true && progress.verified &&
      progress.percent===100 ? 'completed':'waiting';
  if(['BLOCKED','BỊ CHẶN','ERROR','FAILED'].includes(status))return 'blocked';
  if(['WAITING','WAIT','PENDING','OWNER_GATE','PAUSED','CHỜ'].includes(status))return 'waiting';
  if(['WORKING','RUNNING','ĐANG LÀM','ĐANG XỬ LÝ'].includes(status)) {
    const r=row.runtime||{};
    const now=parsedTime(source.checkedAt),then=parsedTime(r.heartbeatAt);
    return r.leaseVerified===true && r.receiptVerified===true &&
      evidence(r.receiptUrl) && Number.isFinite(then) &&
      then<=now && now-then<=120000 ? 'working':'unknown';
  }
  if(['REVIEW','VERIFY'].includes(status))return 'review';
  return 'waiting';
}
function realContinue(row,source,execution) {
  if(!execution || execution.authorized!==true ||
     execution.boundToExistingCore!==true ||
     execution.readbackRequired!==true ||
     !ID.test(String(execution.idempotencyKey||'')) ||
     !ID.test(String(execution.scope||'')) ||
     typeof execution.onExecute!=='function')return false;
  const priority=String(row.priority||'').toUpperCase();
  return source?.fresh===true && source?.verified===true &&
    Number.isFinite(parsedTime(source.checkedAt)) &&
    /^P[1-5]$/.test(priority) &&
    row.ownerHold!==true && row.ownerGate!==true &&
    row.mutationOwnerActive!==true && row.dependencyBlocked!==true &&
    row.executable===true && row.queueIncluded===true &&
    ['READY','QUEUED'].includes(String(row.status||'').toUpperCase());
}
export function projectOwnerWorkCardV6(row,source={},actions={}) {
  if(!row || typeof row!=='object' || !ID.test(String(row.id||'')) ||
      typeof row.title!=='string' || !row.title.trim() ||
      !gitIssue(row.issueUrl))return {ok:false,errors:['CANONICAL_ISSUE_REQUIRED']};
  const acceptance=row.acceptanceVerified===true;
  const progress=evidenceProgress(row,acceptance);
  const state=readState(row,source,progress);
  const buttons=[{kind:'OPEN',label:OWNER_V6_ACTIONS.OPEN,href:row.issueUrl}];
  if(typeof actions.onRefresh==='function')
    buttons.push({kind:'REFRESH',label:OWNER_V6_ACTIONS.REFRESH,onClick:actions.onRefresh});
  if(realContinue(row,source,actions.execution))
    buttons.push({kind:'CONTINUE',label:OWNER_V6_ACTIONS.CONTINUE,
      // UI click only; this does not grant a lease or claim success.
      onClick:()=>actions.execution.onExecute({
        workId:row.id,scope:actions.execution.scope,
        idempotencyKey:actions.execution.idempotencyKey})});
  return {ok:true,errors:[],card:{
    id:row.id,title:row.title,priority:row.priority||null,
    state:LABELS[state],progress,buttons,
    checkedAt:source.checkedAt||null,
    sourceFresh:source.fresh===true&&source.verified===true,
    evidenceUrl:progress.verified?row.progress.evidenceUrl:null,
    currentStep:typeof row.currentStep==='string'?row.currentStep:null,
    blocker:typeof row.blocker==='string'?row.blocker:null,
    nextAction:typeof row.nextAction==='string'?row.nextAction:null,
  }};
}
export function publishOwnerWorkCardV6(row,{source={},actions={},emit}={}) {
  const result=projectOwnerWorkCardV6(row,source,actions);
  if(!result.ok)return {published:false,errors:result.errors};
  if(typeof emit!=='function')return {published:false,errors:['RENDERER_REQUIRED']};
  emit(result.card); // Never execute buttons on render.
  return {published:true,errors:[]};
}
