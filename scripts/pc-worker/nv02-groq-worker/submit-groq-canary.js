const base=process.env.TIGERIQ_WORKFORCE_CONTROLLER_URL;
const token=process.env.TIGERIQ_WORKFORCE_INGRESS_TOKEN;
if(!base||!token)throw new Error('CONTROLLER_ENV_MISSING');
const run=new Date().toISOString().replace(/[-:.]/g,'');
const prompt='Return exactly this JSON and nothing else: {"nv02":"groq-controller","status":"pass"}';
const body={idempotencyKey:`nv02-groq-${run}`,title:'NV02 Groq Controller canary',objective:prompt,payload:{route:'groq',requireAssurance:true,requireJudge:true,taskType:'ai',prompt},targetEmployeeId:'NV02',requiredPermissions:['cloud_ai:execute','local_ai:execute','evidence:write'],requiredCapabilities:['groq','evidence'],allowedWorkerKinds:['pc01'],expectedEvidence:['json'],scopeKeys:[`runtime/nv02-groq/${run}`],dependencies:[],maxAttempts:1,independentReview:false,judgeRequired:false,priority:'P0'};
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
const created=await fetch(new URL('/api/v1/work-orders',base),{method:'POST',headers,body:JSON.stringify(body)});
const c=await created.json();if(!created.ok)throw new Error(`CREATE_${created.status}:${JSON.stringify(c)}`);
const jobId=c.workOrder.jobId;let state,maxLeases=0,maxQueued=0;
for(let i=0;i<1200;i++){
  const live=await fetch(new URL('/api/v1/status',base));const ls=await live.json();
  maxLeases=Math.max(maxLeases,Number(ls.workforce?.activeLeases||0));maxQueued=Math.max(maxQueued,Number(ls.workforce?.queuedJobs||0));
  const r=await fetch(new URL(`/api/v1/work-orders/${encodeURIComponent(jobId)}`,base),{headers:{authorization:`Bearer ${token}`}});state=await r.json();
  if(['done','failed'].includes(state.state?.job?.stage))break;
  await new Promise(r=>setTimeout(r,100));
}
const s=state.state;console.log(JSON.stringify({jobId,stage:s?.job?.stage,employeeId:s?.result?.employeeId,deviceId:s?.result?.deviceId,bindingId:s?.result?.bindingId,route:s?.result?.output?.route,provider:s?.result?.output?.provider,model:s?.result?.output?.model,content:s?.result?.output?.content,assurance:s?.result?.output?.assurance,maxQueued,maxLeases,evidenceCount:(s?.evidence||[]).length,failure:s?.result?.failure}));
