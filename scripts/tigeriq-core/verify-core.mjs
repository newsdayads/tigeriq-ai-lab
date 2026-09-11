const url=process.env.TIGERIQ_CORE_URL||'http://100.97.23.87:8795/api/status';
const r=await fetch(url,{signal:AbortSignal.timeout(5000)});
if(!r.ok) throw new Error(`CORE_HTTP_${r.status}`);
const d=await r.json();
if(!d.ok||!d.core?.pid) throw new Error('CORE_NOT_HEALTHY');
const byId=Object.fromEntries(d.resources.map(x=>[x.employee_id,x]));
for(const id of ['NV02','NV11','NV12']) if(!byId[id]) throw new Error(`MISSING_${id}`);
for(const x of d.resources){
  if(!['IDLE','BUSY','READY','WAIT_KEY','RATE_LIMITED','OFFLINE','ERROR','DISABLED'].includes(x.status)) throw new Error(`BAD_STATUS_${x.employee_id}`);
  if(x.status==='BUSY'&&!x.current_job_id) throw new Error(`BUSY_WITHOUT_JOB_${x.employee_id}`);
}
const completed=d.objectives.some(x=>x.id==='OBJ-E2E-578-1'&&x.status==='completed');
if(!completed) throw new Error('AUTONOMOUS_E2E_NOT_PERSISTED');
console.log(JSON.stringify({pass:true,pid:d.core.pid,resources:d.resources.length,completedObjective:'OBJ-E2E-578-1'}));