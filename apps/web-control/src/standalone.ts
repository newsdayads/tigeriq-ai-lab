import { pathToFileURL } from 'node:url';
import { defaultLiveWebControlPaths,refreshLiveWebControlSnapshot } from './live-source.js';
import { startWebControlServer } from './server.js';

export async function startStandaloneWebControl(){
  const host=(process.env.TIGERIQ_WEB_CONTROL_HOST??'127.0.0.1').trim();
  const port=Math.max(1,Math.min(65535,Number(process.env.TIGERIQ_WEB_CONTROL_PORT??8788)));
  const refreshMs=Math.max(2_000,Math.min(60_000,Number(process.env.TIGERIQ_WEB_CONTROL_REFRESH_MS??5_000)));
  const freshnessMs=Math.max(5_000,Math.min(10*60_000,Number(process.env.TIGERIQ_WEB_CONTROL_FRESHNESS_MS??60_000)));
  const paths=defaultLiveWebControlPaths();
  await refreshLiveWebControlSnapshot(paths,new Date(),freshnessMs);
  const server=await startWebControlServer({host,port,snapshotPath:paths.snapshot});
  const timer=setInterval(()=>{void refreshLiveWebControlSnapshot(paths,new Date(),freshnessMs).catch(error=>console.error(JSON.stringify({event:'TIGERIQ_WEB_CONTROL_LIVE_REFRESH_ERROR',message:error instanceof Error?error.message:String(error)})));},refreshMs);
  console.log(JSON.stringify({event:'TIGERIQ_WEB_CONTROL_START',url:server.url,host,port,refreshMs,freshnessMs,source:'live-pc01-runtime'}));
  return {url:server.url,close:async()=>{clearInterval(timer);await server.close();}};
}

const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startStandaloneWebControl().catch(error=>{console.error(JSON.stringify({event:'TIGERIQ_WEB_CONTROL_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
