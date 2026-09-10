import { readFileSync } from 'node:fs';

const base='http://100.97.23.87:8790';
const token=readFileSync('D:/TigerIQ/Secrets/pc01-primary-node.ingress-token','utf8').trim();
const stamp=Date.now();
const jobId=`JOB-530-E2E-${stamp}`;
const body={
  jobId,idempotencyKey:`issue530-e2e-${stamp}`,title:'Issue 530 zero-touch E2E',
  objective:'Return a deterministic PC01 resource snapshot without shell execution',
  payload:{action:'resource_snapshot'},targetEmployeeId:'EMP-PC01-NATIVE',
  requiredPermissions:[],requiredCapabilities:[],allowedWorkerKinds:['pc01'],expectedEvidence:['json'],
  scopeKeys:['issue-530/e2e'],dependencies:[],maxAttempts:2,independentReview:false,judgeRequired:false,priority:'P0',
};
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
let response=await fetch(`${base}/api/v1/work-orders`,{method:'POST',headers,body:JSON.stringify(body)});
let payload=await response.json();
if(!response.ok)throw new Error(`submit ${response.status} ${JSON.stringify(payload)}`);
const observedStages=[];
let state;
for(let attempt=0;attempt<40;attempt+=1){
  await new Promise(resolve=>setTimeout(resolve,500));
  response=await fetch(`${base}/api/v1/work-orders/${encodeURIComponent(jobId)}`,{headers:{authorization:`Bearer ${token}`}});
  payload=await response.json();
  if(!response.ok)throw new Error(`poll ${response.status} ${JSON.stringify(payload)}`);
  state=payload.state;
  const stage=state?.job?.stage;
  if(stage&&!observedStages.includes(stage))observedStages.push(stage);
  if(stage==='done'||stage==='failed')break;
}
if(!state)throw new Error('missing state');
console.log(JSON.stringify({jobId,observedStages,terminal:state.job?.stage,attempts:state.job?.attempts,resultStatus:state.result?.status,employeeId:state.result?.employeeId,deviceId:state.result?.deviceId,evidenceCount:state.evidence?.length,route:state.result?.output?.route,hasResourceSnapshot:Boolean(state.result?.output?.resources)}));
if(state.job?.stage!=='done')process.exitCode=2;
