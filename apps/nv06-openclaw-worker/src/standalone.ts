import { pathToFileURL } from 'node:url';
import { configFromEnv } from './types.js';
import { NV06Worker } from './worker.js';

export async function startNV06Worker():Promise<void>{
  const worker=new NV06Worker(configFromEnv());
  const stop=(signal:string)=>{console.log(JSON.stringify({event:'NV06_WORKER_STOP',signal}));worker.stop();};
  process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
  console.log(JSON.stringify({event:'NV06_WORKER_START',employee:'EMP-NV06-OPENCLAW',capability:'browser.chatgpt',concurrency:1}));
  await worker.start();
}
const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startNV06Worker().catch(error=>{console.error(JSON.stringify({event:'NV06_WORKER_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
