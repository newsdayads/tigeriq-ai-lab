import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const target=process.argv[2]||'http://127.0.0.1:18787'; const out=process.argv[3]||'D:/TigerIQ/Evidence/chrome-devtools-mcp-582';
fs.mkdirSync(out,{recursive:true}); const clean=t=>(t||'').replace(/\r/g,''); const text=r=>r?.content?.map(x=>x.text||'').join('\n')||''; const results=[];
for(let i=1;i<=3;i++){
 const transport=new StdioClientTransport({command:'node',args:['node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js','--headless','--isolated','--no-performance-crux'],env:{...process.env,CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:'1'}});
 const client=new Client({name:`tigeriq-chrome-mcp-${i}`,version:'1.0.0'}); await client.connect(transport);
 const tools=await client.listTools(); const page=await client.callTool({name:'new_page',arguments:{url:target,isolatedContext:`tigeriq-${i}`,timeout:15000}});
 const pages=await client.callTool({name:'list_pages',arguments:{}}); const m=text(pages).match(/(\d+): .*\[selected\]/); const pageId=m?Number(m[1]):2;
 await client.callTool({name:'take_snapshot',arguments:{pageId,verbose:false,filePath:`${out}/snapshot-${i}.txt`}});
 const con=clean(text(await client.callTool({name:'list_console_messages',arguments:{pageId,types:['error','warn'],includeStackTraces:true}})));
 const net=clean(text(await client.callTool({name:'list_network_requests',arguments:{pageId,pageSize:200}})));
 const errorNetwork=net.split('\n').filter(x=>/\[(4|5)\d\d\]/.test(x)); const badNetwork=errorNetwork.filter(x=>!/favicon\.ico/i.test(x));
 const faviconOnly404=errorNetwork.length>0&&errorNetwork.every(x=>/favicon\.ico.*\[404\]/i.test(x));
 const materialConsole=con.split('\n').filter(x=>/\[(error|warn)\]/i.test(x)&&!(faviconOnly404&&/Failed to load resource:.*404/i.test(x)));
 const pass=tools.tools.length>=20&&!page.isError&&materialConsole.length===0&&badNetwork.length===0;
 const row={run:i,pass,toolCount:tools.tools.length,pageId,materialConsole,badNetwork,console:con,network:net}; fs.writeFileSync(`${out}/run-${i}.json`,JSON.stringify(row,null,2)); results.push(row); await client.close();
}
const summary={at:new Date().toISOString(),target,pass:results.every(x=>x.pass),results}; fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2)); console.log(JSON.stringify(summary,null,2)); if(!summary.pass) process.exit(2);
