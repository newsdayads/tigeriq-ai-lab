import {pathToFileURL} from 'node:url';
import {processRepairHandoff} from './repair-handoff.mjs';

const HOUR_MS=60*60*1000;

export function cycleIndexForTime(now=Date.now()){
  return Math.floor(Number(now)/HOUR_MS);
}

export async function runHourlyAuditCycle(targetUrls,options={}){
  const results=[];
  const cycleIndex=options.cycleIndex??cycleIndexForTime(options.now??Date.now());
  for(const url of targetUrls){
    try{
      const cycle=await (options.processCycle||processRepairHandoff)(url,cycleIndex,options.processOptions||{});
      results.push({
        url,
        status:cycle.status==='PASS'?'pass':'material_failure',
        cycleIndex,
        cycle
      });
    }catch(error){
      results.push({url,status:'failed',cycleIndex,error:String(error?.message||error)});
    }
  }
  return results;
}

async function main(){
  const targets=process.argv.slice(2).filter(Boolean);
  const urls=targets.length?targets:['http://100.97.23.87:8796'];
  const results=await runHourlyAuditCycle(urls);
  const output={
    schema:'TIGERIQ_WEB_AUDIT_HOURLY_V1',
    at:new Date().toISOString(),
    pass:results.every(row=>row.status==='pass'),
    results
  };
  console.log(JSON.stringify(output,null,2));
  if(!output.pass) process.exitCode=2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await main();
}
