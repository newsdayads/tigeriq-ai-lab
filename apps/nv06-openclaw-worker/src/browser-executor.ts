import { spawn } from 'node:child_process';

export interface ChatGptBrowserResult {content:string;marker:string;tabId:string;tabUrl:string;prompt:string;}
export class HumanAuthRequired extends Error { readonly code='BLOCKED_HUMAN_AUTH'; }

type CliResult={code:number;stdout:string;stderr:string};
type JsonRecord=Record<string,unknown>;
const challengePattern=/(captcha|verify you are human|xác minh bạn là người|suspicious activity|unusual activity|security challenge|log in to continue|đăng nhập để tiếp tục|session expired)/i;

export class OpenClawChatGptExecutor {
  readonly nodeBin:string; readonly cliMjs:string; readonly env:NodeJS.ProcessEnv;
  constructor(){
    this.nodeBin=process.env.TIGERIQ_NODE_BIN?.trim()||process.execPath;
    this.cliMjs=process.env.TIGERIQ_OPENCLAW_MJS?.trim()||'D:\\OpenClaw\\npm-global\\node_modules\\openclaw\\openclaw.mjs';
    this.env={...process.env,OPENCLAW_HOME:process.env.OPENCLAW_HOME||'D:\\OpenClaw',OPENCLAW_STATE_DIR:process.env.OPENCLAW_STATE_DIR||'D:\\TigerIQ-OpenClaw\\state',OPENCLAW_CONFIG_PATH:process.env.OPENCLAW_CONFIG_PATH||'D:\\TigerIQ-OpenClaw\\state\\openclaw.json'};
  }
  async execute(jobId:string,task:string):Promise<ChatGptBrowserResult>{
    const marker=`TIGERIQ_JOB_DONE_${jobId.replace(/[^A-Za-z0-9_-]/g,'_')}_${Date.now()}`;
    const tabs=await this.json(['browser','--browser-profile','chrome','--json','tabs'],30_000);
    const rows=Array.isArray(tabs.tabs)?tabs.tabs.filter(x=>x&&typeof x==='object') as JsonRecord[]:[];
    const tab=rows.find(x=>String(x.url??'').includes('chatgpt.com/?temporary-chat=true'))??rows.find(x=>String(x.url??'').startsWith('https://chatgpt.com/'));
    if(!tab)throw new HumanAuthRequired('Authenticated ChatGPT tab is unavailable');
    const tabId=String(tab.tabId??tab.suggestedTargetId??tab.targetId??''); if(!tabId)throw new Error('CHATGPT_TAB_ID_MISSING');
    const before=await this.snapshot(tabId,true,320); this.assertNoChallenge(String(before.snapshot??''));
    const refs=this.record(before.refs); const textbox=Object.entries(refs).find(([,v])=>this.record(v).role==='textbox')?.[0];
    if(!textbox)throw new Error('CHATGPT_COMPOSER_NOT_FOUND');
    const prompt=`TIGERIQ WORK ORDER ${jobId}\nComplete the task below. Treat it as analysis/output work only; do not claim external actions you did not perform.\n\nTASK:\n${task}\n\nWhen fully complete, append this exact marker on the final line: ${marker}`;
    await this.run(['browser','--browser-profile','chrome','type',textbox,prompt,'--submit','--target-id',tabId],30_000);
    try{await this.run(['browser','--browser-profile','chrome','wait','--text',marker,'--timeout-ms','180000','--target-id',tabId],190_000);}catch{
      const timeoutSnap=await this.snapshot(tabId,false,700); const text=String(timeoutSnap.snapshot??''); this.assertNoChallenge(text);
      if(!text.includes(marker))throw new Error('CHATGPT_RESULT_TIMEOUT');
    }
    const after=await this.snapshot(tabId,false,700); const snapshot=String(after.snapshot??''); this.assertNoChallenge(snapshot);
    const content=extractAssistantResult(snapshot,marker); if(!content.includes(marker))throw new Error('CHATGPT_RESULT_MARKER_MISSING');
    return {content,marker,tabId,tabUrl:String(tab.url??''),prompt};
  }
  private async snapshot(tabId:string,interactive:boolean,limit:number):Promise<JsonRecord>{
    const args=['browser','--browser-profile','chrome','--json','snapshot','--target-id',tabId,'--limit',String(limit)];
    if(interactive)args.push('--interactive','--compact'); return this.json(args,60_000);
  }
  private assertNoChallenge(text:string):void{if(challengePattern.test(text))throw new HumanAuthRequired('ChatGPT requires human authentication/security verification');}
  private record(value:unknown):JsonRecord{return value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{};}
  private async json(args:string[],timeoutMs:number):Promise<JsonRecord>{const result=await this.run(args,timeoutMs);const text=result.stdout.trim();const start=text.indexOf('{');if(start<0)throw new Error('OPENCLAW_JSON_MISSING');return JSON.parse(text.slice(start)) as JsonRecord;}
  private run(args:string[],timeoutMs:number):Promise<CliResult>{return new Promise((resolve,reject)=>{
    const child=spawn(this.nodeBin,[this.cliMjs,...args],{env:this.env,windowsHide:true,shell:false});let stdout='',stderr='',settled=false;
    const timer=setTimeout(()=>{if(!settled){settled=true;child.kill('SIGKILL');reject(new Error(`OPENCLAW_TIMEOUT:${args.join(' ')}`));}},timeoutMs);
    child.stdout.on('data',x=>stdout+=x.toString());child.stderr.on('data',x=>stderr+=x.toString());
    child.once('error',e=>{if(settled)return;settled=true;clearTimeout(timer);reject(e);});child.once('close',code=>{if(settled)return;settled=true;clearTimeout(timer);const result={code:code??1,stdout,stderr};if(result.code!==0)reject(new Error(`OPENCLAW_${result.code}:${stderr||stdout}`));else resolve(result);});
  });}
}

export function extractAssistantResult(snapshot:string,marker:string):string{
  const lines=snapshot.split(/\r?\n/),hits=lines.map((line,index)=>line.includes(marker)?index:-1).filter(index=>index>=0);if(!hits.length)return '';
  const end=hits[hits.length-1];let start=end;while(start>0&&!/heading \"ChatGPT .*nói:|heading \"ChatGPT said:|heading \"Assistant/i.test(lines[start]))start--;
  const parts=lines.slice(start+1,end+1).map(line=>line.match(/- (?:paragraph|generic|listitem|code)[^:]*:\s*(.*)$/)?.[1]).filter((x):x is string=>Boolean(x));
  return parts.join('\n').replace(/^"|"$/g,'').trim();
}
