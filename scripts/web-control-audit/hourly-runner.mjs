import {pathToFileURL} from 'node:url';
import {processRepairHandoff} from './repair-handoff.mjs';

export async function runHourlyAuditCycle(targetUrls=['http://100.97.23.87:8796'],options={}){
  const results=[];
  const baseCycle=Number(options.cycleIndex||0);
  for(let i=0;i<targetUrls.length;i++){
    const url=targetUrls[i];
    try{
      const handoff=await processRepairHandoff(url,baseCycle+i,options);
      results.push({url,status:handoff?.audit?.sweepVerified===true?'success':'failed',handoff});
    }catch(err){
      results.push({url,status:'failed',error:String(err?.message||err)});
    }
  }
  return {
    schema:'TIGERIQ_WEB_CONTROL_HOURLY_AUDIT_V1',
    at:new Date().toISOString(),
    pass:results.every((x)=>x.status==='success'),
    results
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const target=process.argv[2]||'http://100.97.23.87:8796';
  const cycleIndex=Number(process.argv[3]||0);
  const result=await runHourlyAuditCycle([target],{cycleIndex});
  console.log(JSON.stringify(result,null,2));
  if(!result.pass)process.exitCode=2;
}
