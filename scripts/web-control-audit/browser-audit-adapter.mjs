import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const MODULE_DIR=path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT=path.resolve(MODULE_DIR,'../..');
const MCP_BIN=path.join(REPO_ROOT,'node_modules','chrome-devtools-mcp','build','src','bin','chrome-devtools-mcp.js');

function toolText(result){
  return result?.content?.map(item=>item?.text||'').join('\n')||'';
}

export function parseToolJson(result){
  const raw=typeof result==='string'?result:toolText(result);
  const fenced=raw.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/i);
  if(fenced) return JSON.parse(fenced[1]);
  const first=raw.indexOf('{'),last=raw.lastIndexOf('}');
  if(first>=0&&last>first) return JSON.parse(raw.slice(first,last+1));
  throw new Error('MCP_JSON_RESULT_MISSING');
}

function selectedPageId(...results){
  for(const result of results){
    const match=toolText(result).match(/(\d+): .*\[selected\]/);
    if(match) return Number(match[1]);
  }
  throw new Error('MCP_SELECTED_PAGE_ID_MISSING');
}

function evidenceDir(options={}){
  if(options.evidenceDir) return options.evidenceDir;
  if(process.platform!=='win32') return null;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  return path.join(process.env.TIGERIQ_WEB_AUDIT_EVIDENCE_ROOT||'D:/TigerIQ/Evidence/web-control-658',stamp);
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

export async function createChromeDevtoolsClient(){
  const transport=new StdioClientTransport({
    command:'node',
    args:[MCP_BIN,'--headless','--isolated','--no-performance-crux'],
    env:{...process.env,CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:'1'}
  });
  const client=new Client({name:'tigeriq-web-audit-658',version:'1.0.0'});
  await client.connect(transport);
  return client;
}

export async function runBrowserAudit(targetUrl,viewports,options={}){
  if(!targetUrl) throw new Error('TARGET_URL_REQUIRED');
  const requested=Array.isArray(viewports)?viewports:[viewports].filter(Boolean);
  if(requested.length===0) throw new Error('VIEWPORTS_REQUIRED');

  const out=evidenceDir(options);
  if(out) fs.mkdirSync(out,{recursive:true});
  const client=await (options.clientFactory||createChromeDevtoolsClient)();
  const failures=[];
  const viewportResults=[];

  try{
    const tools=await client.listTools();
    const opened=await client.callTool({name:'new_page',arguments:{url:targetUrl,isolatedContext:`tigeriq-658-${Date.now()}`,timeout:15000}});
    const pages=await client.callTool({name:'list_pages',arguments:{}});
    const pageId=selectedPageId(opened,pages);

    for(let index=0;index<requested.length;index++){
      const viewport=requested[index];
      const label=viewport.label||`${viewport.width}x${viewport.height}`;
      await client.callTool({name:'resize_page',arguments:{pageId,width:viewport.width,height:viewport.height}});

      await client.callTool({
        name:'take_snapshot',
        arguments:{pageId,verbose:false,...(out?{filePath:path.join(out,`snapshot-${index}-${label}.txt`)}:{})}
      });

      const dom=parseToolJson(await client.callTool({
        name:'evaluate_script',
        arguments:{
          pageId,
          waitForStableDom:false,
          function:`() => ({
            title: document.title,
            readyState: document.readyState,
            bodyChars: (document.body?.innerText || '').trim().length,
            width: window.innerWidth,
            height: window.innerHeight,
            overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
            scrollWidth: document.documentElement.scrollWidth
          })`
        }
      }));

      const liveRefresh=parseToolJson(await client.callTool({
        name:'evaluate_script',
        arguments:{
          pageId,
          waitForStableDom:false,
          function:`async () => {
            const first=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());
            await new Promise(resolve=>setTimeout(resolve,1200));
            const second=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());
            return {
              changed: JSON.stringify(first)!==JSON.stringify(second),
              firstTime:first?.core?.time||first?.updated_at||null,
              secondTime:second?.core?.time||second?.updated_at||null
            };
          }`
        }
      }));

      const interaction=parseToolJson(await client.callTool({
        name:'evaluate_script',
        arguments:{
          pageId,
          function:`() => {
            const candidates=[...document.querySelectorAll('button,a,[role="button"],[role="tab"]')];
            const el=candidates.find(node=>(node.textContent||'').trim().includes('Nhân sự AI'));
            if(!el) return {ok:false,reason:'SAFE_CONTROL_NOT_FOUND'};
            const before=location.href;
            const label=(el.textContent||'').trim();
            el.click();
            return {ok:true,label,before,after:location.href};
          }`
        }
      }));

      const consoleText=toolText(await client.callTool({
        name:'list_console_messages',
        arguments:{pageId,types:['error','warn'],includeStackTraces:true}
      }));
      const networkText=toolText(await client.callTool({
        name:'list_network_requests',
        arguments:{pageId,pageSize:300}
      }));
      const badConsole=materialConsoleLines(consoleText);
      const badNetwork=materialNetworkLines(networkText);

      const localFailures=[];
      if(!dom.title||!['interactive','complete'].includes(dom.readyState)||Number(dom.bodyChars)<20) localFailures.push('DOM_RENDER_INVALID');
      if(dom.overflowX) localFailures.push('HORIZONTAL_OVERFLOW');
      if(Math.abs(Number(dom.width)-Number(viewport.width))>2) localFailures.push('VIEWPORT_WIDTH_NOT_APPLIED');
      if(!liveRefresh.changed) localFailures.push('LIVE_STATUS_NOT_CHANGING');
      if(!interaction.ok) localFailures.push('SAFE_INTERACTION_FAILED');
      if(badConsole.length) localFailures.push('MATERIAL_CONSOLE_ERROR');
      if(badNetwork.length) localFailures.push('MATERIAL_NETWORK_ERROR');

      for(const code of localFailures) failures.push({code,viewport:label});
      const row={label,viewport,dom,liveRefresh,interaction,badConsole,badNetwork,failures:localFailures};
      viewportResults.push(row);
      if(out) fs.writeFileSync(path.join(out,`viewport-${index}-${label}.json`),JSON.stringify(row,null,2));
    }

    const result={
      status:failures.length?'audit_failed':'audit_complete',
      pass:failures.length===0,
      sweepVerified:failures.length===0,
      targetUrl,
      toolCount:tools?.tools?.length||0,
      viewports:viewportResults,
      failures,
      evidenceDir:out,
      checkedAt:new Date().toISOString()
    };
    if(out) fs.writeFileSync(path.join(out,'cycle.json'),JSON.stringify(result,null,2));
    return result;
  }finally{
    await client.close().catch(()=>{});
  }
}
