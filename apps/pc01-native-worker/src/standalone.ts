import { pathToFileURL } from 'node:url';
import { NativeWorker, configFromEnv } from './core.js';

export async function startNativeWorker():Promise<void>{
  const worker=new NativeWorker(configFromEnv());
  const stop=(signal:string)=>{console.log(JSON.stringify({event:'PC01_NATIVE_WORKER_STOP',signal}));worker.stop();};
  process.once('SIGINT',()=>stop('SIGINT'));
  process.once('SIGTERM',()=>stop('SIGTERM'));
  console.log(JSON.stringify({event:'PC01_NATIVE_WORKER_START',model:'qwen3:8b',context:4096,localAiMax:2,openClawDependency:false}));
  await worker.start();
}

const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startNativeWorker().catch(error=>{console.error(JSON.stringify({event:'PC01_NATIVE_WORKER_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
