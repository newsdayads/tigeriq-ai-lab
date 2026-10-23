// Read-only, fail-closed Owner dashboard projection.
// GitHub activity is NOT a Core job. This is presentation, not authorization.
const STATUS_LABELS={
 WORKING:"ĐANG LÀM",WAITING:"CHỜ",BLOCKED:"BỊ CHẶN",UNKNOWN:"CHƯA XÁC MINH",
 QUEUED:"SẴN SÀNG",OPEN:"CHƯA LÀM",REVIEW:"RÀ SOÁT",VERIFY:"XÁC MINH",
 OWNER_GATE:"CHỜ ANH SƠN",DONE:"HOÀN TẤT",PAUSED:"TẠM DỪNG"
};
const STATUS_ALIASES={
 "ĐANG XỬ LÝ":"WORKING","ĐANG LÀM":"WORKING","CHỜ":"WAITING",
 "ĐANG CHỜ":"WAITING","BỊ CHẶN":"BLOCKED","SẴN SÀNG":"QUEUED",
 "HOÀN TẤT":"DONE","CHƯA LÀM":"OPEN","MỞ":"OPEN",
 "RÀ SOÁT":"REVIEW","XÁC MINH":"VERIFY","CHỜ ANH SƠN DUYỆT":"OWNER_GATE"
};
const clean=(x,n=260)=>String(x??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,n);
const timestamp=x=>Number.isFinite(Date.parse(x||""))?Date.parse(x):null;
const blockerPresent=x=>Boolean(x&&!/^(?:NONE|NULL|N\/A|KHÔNG CÓ|NO_BLOCKER)$/i.test(x));
export function projectOwnerLiveTruth(row,ctx={}){
 const base=clean(row?.status,60).toUpperCase();
 const original=STATUS_ALIASES[base]||base||"UNKNOWN";
 const fresh=ctx.sourceFresh===true&&Boolean(timestamp(ctx.sourceCheckedAt));
 const now=Number.isFinite(ctx.now)?ctx.now:Date.now();
 const heartbeat=timestamp(row?.updatedAt);
 const worker=clean(row?.activeWorker,32);
 const verifiedRuntime=ctx.runtimeConnected===true&&fresh&&
   row?.activeLease===true&&row?.heartbeatFresh===true&&
   /^NV\d{2}$/.test(worker)&&heartbeat!==null&&
   heartbeat<=now+60000&&now-heartbeat<=60000;
 const blocker=clean(row?.blocker||row?.waitReason,320);
 const next=clean(row?.nextStep||row?.nextAction||row?.currentStep,260);
 let state=original;
 if(!fresh)state="UNKNOWN";
 else if(original==="WORKING"&&!verifiedRuntime)state="UNKNOWN";
 else if(original==="DONE"&&row?.completionVerified!==true)state="VERIFY";
 else if(["OPEN","QUEUED"].includes(original)&&blockerPresent(blocker))state="WAITING";
 const total=Number(row?.progressTotal),done=Number(row?.progressDone);
 const progressValid=fresh&&row?.progressChecklistVerified===true&&
   Number.isSafeInteger(total)&&total>0&&Number.isSafeInteger(done)&&done>=0&&done<=total;
 return {
  status:state,
  label:STATUS_LABELS[state]||"CHƯA XÁC MINH",
  runtimeVerified:verifiedRuntime,
  sourceFresh:fresh,
  sourceLabel:!fresh?"NGUỒN HẾT HẠN / CHƯA XÁC MINH":verifiedRuntime?"CORE + GITHUB":"GITHUB · CHƯA CÓ JOB CORE SỐNG",
  checkedAt:fresh?new Date(timestamp(ctx.sourceCheckedAt)).toISOString():null,
  lastActivityAt:timestamp(row?.lastActivityAt)?new Date(timestamp(row.lastActivityAt)).toISOString():null,
  lastActivitySource:clean(row?.lastActivitySource,70)||null,
  lastActivityIsExecutionReceipt:false,
  worker:verifiedRuntime?worker:null,
  // UI actionability must agree with the effective wait/blocker status.
  // Source READY alone is not proof that a dependency has cleared.
  canExecuteNow:fresh&&row?.executionEligibility==="READY"&&
    ["OPEN","QUEUED"].includes(state)&&!blockerPresent(blocker)&&row?.ownerGate!==true,
  blocker:blockerPresent(blocker)?blocker:null,
  next:next||null,
  progress:progressValid?{done,total,percent:done===total&&row?.completionVerified!==true?null:Math.round(100*done/total)}:null
 };
}
