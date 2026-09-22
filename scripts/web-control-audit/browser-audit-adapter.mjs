import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const toolText=(r)=>r?.content?.map((x)=>x?.text||'').join('\n')||'';

function parseToolJson(result){
  const raw=toolText(result);
  const fenced=raw.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/i);
  const candidate=(fenced?.[1]||raw).trim();
  try{return JSON.parse(candidate)}catch{}
  const first=candidate.indexOf('{');
  const last=candidate.lastIndexOf('}');
  if(first>=0&&last>first){
    try{return JSON.parse(candidate.slice(first,last+1))}catch{}
  }
  return null;
}

function badConsoleLines(raw){
  return String(raw||'').split(/\r?\n/).filter((x)=>/\[(error|warn)\]/i.test(x));
}

function badNetworkLines(raw){
  return String(raw||'').split(/\r?\n/).filter((x)=>/\[(4|5)\d\d\]/.test(x)&&!/favicon\.ico/i.test(x));
}

async function defaultClientFactory(){
  const transport=new StdioClientTransport({
    command:'node',
    args:['node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js','--headless','--isolated','--no-performance-crux'],
    env:{...process.env,CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:'1'}
  });
  const client=new Client({name:'tigeriq-web-control-audit-658',version:'1.0.0'});
  await client.connect(transport);
  return client;
}

async function evalJson(client,pageId,fn){
  return parseToolJson(await client.callTool({
    name:'evaluate_script',
    arguments:{pageId,function:fn,waitForStableDom:false}
  }));
}

export async function runBrowserAudit(targetUrl,viewports,options={}){
  const viewportList=(Array.isArray(viewports)?viewports:[viewports]).filter(Boolean);
  if(!targetUrl||viewportList.length===0)throw new Error('Invalid audit parameters');
  const client=options.client||await (options.clientFactory||defaultClientFactory)();
  const ownsClient=!options.client;
  const startedAt=new Date().toISOString();

  try{
    const page=await client.callTool({name:'new_page',arguments:{url:targetUrl,isolatedContext:'tigeriq-web-audit-658',timeout:15000}});
    if(page?.isError)throw new Error('Web Control page failed to open');
    const pages=await client.callTool({name:'list_pages',arguments:{}});
    const selected=toolText(pages).match(/(\d+): .*\[selected\]/);
    const pageId=selected?Number(selected[1]):2;
    const results=[];
    let safeInteraction=null;

    for(let i=0;i<viewportList.length;i++){
      const vp=viewportList[i];
      await client.callTool({name:'resize_page',arguments:{pageId,width:vp.width,height:vp.height}});
      const dom=await evalJson(client,pageId,'() => ({title:document.title,width:window.innerWidth,height:window.innerHeight,bodyLength:document.body?.innerText?.length||0,overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth})');
      const snapshot=toolText(await client.callTool({name:'take_snapshot',arguments:{pageId,verbose:false}}));
      const consoleRaw=toolText(await client.callTool({name:'list_console_messages',arguments:{pageId,types:['error','warn'],includeStackTraces:true}}));
      const networkRaw=toolText(await client.callTool({name:'list_network_requests',arguments:{pageId,pageSize:200}}));
      const live=await evalJson(client,pageId,'async () => {const sample=async()=>{const r=await fetch(\'/api/status\',{cache:\'no-store\'});return await r.json()};const a=await sample();await new Promise(r=>setTimeout(r,1200));const b=await sample();const aStamp=a?.core?.time??a?.updated_at??a?.time??JSON.stringify(a).length;const bStamp=b?.core?.time??b?.updated_at??b?.time??JSON.stringify(b).length;return {changed:aStamp!==bStamp,before:aStamp,after:bStamp}}');

      if(i===0){
        safeInteraction=await evalJson(client,pageId,'() => {const nodes=[...document.querySelectorAll(\'button,a,[role="button"],[role="tab"]\')];const el=nodes.find((n)=>/Nhân sự AI/i.test(n.textContent||\'\'));if(!el)return {found:false,clicked:false};el.click();return {found:true,clicked:true,text:(el.textContent||\'\').trim()}}');
      }

      const badConsole=badConsoleLines(consoleRaw);
      const badNetwork=badNetworkLines(networkRaw);
      const resized=dom?.width===vp.width&&dom?.height===vp.height;
      const pass=Boolean(dom?.title&&dom?.bodyLength>0&&resized&&dom?.overflowX===false&&snapshot.length>0&&badConsole.length===0&&badNetwork.length===0&&live?.changed===true);
      results.push({viewport:vp,pass,resized,dom,live,badConsole,badNetwork,snapshotLength:snapshot.length});
    }

    const interactionPass=Boolean(safeInteraction?.found&&safeInteraction?.clicked);
    const sweepVerified=results.every((x)=>x.pass)&&interactionPass;
    return {
      status:sweepVerified?'audit_complete':'audit_failed',
      sweepVerified,
      startedAt,
      completedAt:new Date().toISOString(),
      targetUrl,
      pageId,
      safeInteraction,
      results,
      failures:[
        ...results.filter((x)=>!x.pass).map((x)=>'viewport:'+(x.viewport?.label||x.viewport?.width)),
        ...(interactionPass?[]:['safe_interaction_failed'])
      ]
    };
  }catch(err){
    return {
      status:'audit_failed',
      sweepVerified:false,
      startedAt,
      completedAt:new Date().toISOString(),
      targetUrl,
      error:String(err?.message||err),
      failures:[String(err?.message||err)],
      results:[]
    };
  }finally{
    if(ownsClient)await client.close().catch(()=>{});
  }
}
