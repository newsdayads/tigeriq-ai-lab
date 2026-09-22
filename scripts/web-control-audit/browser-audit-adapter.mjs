import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const toolText=(result)=>result?.content?.map(item=>item?.text||'').join('\n')||'';

export function parseToolJson(result){
  const raw=typeof result==='string'?result:toolText(result);
  const fenced=raw.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/i);
  const candidate=(fenced?.[1]||raw).trim();
  try{return JSON.parse(candidate)}catch{}
  const first=candidate.indexOf('{'),last=candidate.lastIndexOf('}');
  if(first>=0&&last>first){
    try{return JSON.parse(candidate.slice(first,last+1))}catch{}
  }
  throw new Error('MCP_JSON_RESULT_MISSING');
}

export function materialConsoleLines(raw){
  return String(raw||'').split(/\r?\n/).filter(line=>
    /\[(error|warn)\]/i.test(line)&&
    !/favicon\.ico/i.test(line)&&
    !/Failed to load resource:.*404/i.test(line)
  );
}

export function materialNetworkLines(raw){
  return String(raw||'').split(/\r?\n/).filter(line=>
    /\[(4|5)\d\d\]/.test(line)&&!/favicon\.ico/i.test(line)
  );
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
  if(!targetUrl||viewportList.length===0)throw new Error('INVALID_AUDIT_PARAMETERS');
  const client=options.client||await (options.clientFactory||defaultClientFactory)();
  const ownsClient=!options.client;
  const startedAt=new Date().toISOString();
  const evidenceDir=options.evidenceDir||null;
  if(evidenceDir)fs.mkdirSync(evidenceDir,{recursive:true});

  try{
    const page=await client.callTool({name:'new_page',arguments:{url:targetUrl,isolatedContext:`tigeriq-web-audit-658-${Date.now()}`,timeout:15000}});
    if(page?.isError)throw new Error('WEB_CONTROL_PAGE_OPEN_FAILED');
    const pages=await client.callTool({name:'list_pages',arguments:{}});
    const selected=toolText(pages).match(/(\d+): .*\[selected\]/);
    if(!selected)throw new Error('MCP_SELECTED_PAGE_ID_MISSING');
    const pageId=Number(selected[1]);
    const results=[];
    let safeInteraction=null;

    for(let index=0;index<viewportList.length;index++){
      const viewport=viewportList[index];
      const label=viewport.label||`${viewport.width}x${viewport.height}`;
      await client.callTool({name:'resize_page',arguments:{pageId,width:viewport.width,height:viewport.height}});

      const dom=await evalJson(client,pageId,`() => ({
        title:document.title,
        readyState:document.readyState,
        width:window.innerWidth,
        height:window.innerHeight,
        bodyLength:document.body?.innerText?.length||0,
        overflowX:document.documentElement.scrollWidth>window.innerWidth+1,
        scrollWidth:document.documentElement.scrollWidth
      })`);
      const snapshot=toolText(await client.callTool({name:'take_snapshot',arguments:{pageId,verbose:false}}));

      const live=await evalJson(client,pageId,`async () => {
        const sample=async()=>{
          const response=await fetch('/api/status',{cache:'no-store'});
          if(!response.ok)throw new Error('STATUS_HTTP_'+response.status);
          return await response.json();
        };
        const first=await sample();
        await new Promise(resolve=>setTimeout(resolve,1200));
        const second=await sample();
        return {
          changed:JSON.stringify(first)!==JSON.stringify(second),
          firstTime:first?.core?.time||first?.updated_at||first?.time||null,
          secondTime:second?.core?.time||second?.updated_at||second?.time||null
        };
      }`);

      if(index===0){
        safeInteraction=await evalJson(client,pageId,`() => {
          const nodes=[...document.querySelectorAll('button,a,[role="button"],[role="tab"]')];
          const el=nodes.find(node=>(node.textContent||'').trim().includes('Nhân sự AI'));
          if(!el)return {found:false,clicked:false,reason:'SAFE_CONTROL_NOT_FOUND'};
          const before=location.href;
          const text=(el.textContent||'').trim();
          el.click();
          return {found:true,clicked:true,text,before,after:location.href};
        }`);
      }

      const consoleRaw=toolText(await client.callTool({name:'list_console_messages',arguments:{pageId,types:['error','warn'],includeStackTraces:true}}));
      const networkRaw=toolText(await client.callTool({name:'list_network_requests',arguments:{pageId,pageSize:300}}));
      const badConsole=materialConsoleLines(consoleRaw);
      const badNetwork=materialNetworkLines(networkRaw);
      const resized=Math.abs(Number(dom?.width)-Number(viewport.width))<=2&&Math.abs(Number(dom?.height)-Number(viewport.height))<=2;

      const failures=[];
      if(!dom?.title||!['interactive','complete'].includes(dom?.readyState)||Number(dom?.bodyLength)<20)failures.push('DOM_RENDER_INVALID');
      if(!resized)failures.push('VIEWPORT_NOT_APPLIED');
      if(dom?.overflowX)failures.push('HORIZONTAL_OVERFLOW');
      if(live?.changed!==true)failures.push('LIVE_STATUS_NOT_CHANGING');
      if(badConsole.length)failures.push('MATERIAL_CONSOLE_ERROR');
      if(badNetwork.length)failures.push('MATERIAL_NETWORK_ERROR');

      const row={viewport:{...viewport,label},pass:failures.length===0,resized,dom,live,badConsole,badNetwork,snapshotLength:snapshot.length,failures};
      results.push(row);
      if(evidenceDir){
        fs.writeFileSync(path.join(evidenceDir,`snapshot-${index}-${label}.txt`),snapshot);
        fs.writeFileSync(path.join(evidenceDir,`viewport-${index}-${label}.json`),JSON.stringify(row,null,2));
      }
    }

    const interactionPass=Boolean(safeInteraction?.found&&safeInteraction?.clicked);
    const failures=[
      ...results.flatMap(row=>row.failures.map(code=>({code,viewport:row.viewport.label}))),
      ...(interactionPass?[]:[{code:'SAFE_INTERACTION_FAILED',viewport:'cycle'}])
    ];
    const sweepVerified=failures.length===0;
    const result={
      status:sweepVerified?'audit_complete':'audit_failed',
      pass:sweepVerified,
      sweepVerified,
      startedAt,
      completedAt:new Date().toISOString(),
      targetUrl,pageId,safeInteraction,results,failures,
      evidenceDir
    };
    if(evidenceDir)fs.writeFileSync(path.join(evidenceDir,'cycle.json'),JSON.stringify(result,null,2));
    return result;
  }catch(error){
    const result={
      status:'audit_failed',pass:false,sweepVerified:false,startedAt,
      completedAt:new Date().toISOString(),targetUrl,
      error:String(error?.message||error),
      failures:[{code:String(error?.message||error),viewport:'cycle'}],
      results:[],evidenceDir
    };
    if(evidenceDir)fs.writeFileSync(path.join(evidenceDir,'cycle.json'),JSON.stringify(result,null,2));
    return result;
  }finally{
    if(ownsClient)await client.close().catch(()=>{});
  }
}
