import { pathToFileURL } from 'node:url';
import { startWebControlServer } from './server.js';

export async function startStandaloneWebControl(){
  const host=(process.env.TIGERIQ_WEB_CONTROL_HOST??'127.0.0.1').trim();
  const port=Math.max(1,Math.min(65535,Number(process.env.TIGERIQ_WEB_CONTROL_PORT??8788)));
  const server=await startWebControlServer({host,port});
  console.log(JSON.stringify({event:'TIGERIQ_WEB_CONTROL_START',url:server.url,host,port}));
  return server;
}

const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startStandaloneWebControl().catch(error=>{console.error(JSON.stringify({event:'TIGERIQ_WEB_CONTROL_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
