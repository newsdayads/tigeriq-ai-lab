import {runDispatchWorkerRecord} from './dispatch.mjs';

const recordPath=process.argv[2];
if(!recordPath){
  process.stderr.write('OPENCLAW_DISPATCH_RECORD_PATH_REQUIRED\n');
  process.exit(2);
}
try{
  const result=await runDispatchWorkerRecord(recordPath);
  process.exit(result?.state==='completed'?0:1);
}catch(error){
  process.stderr.write(String(error?.stack||error)+'\n');
  process.exit(1);
}
