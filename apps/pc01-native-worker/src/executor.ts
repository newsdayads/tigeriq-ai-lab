import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { asRecord, numberValue, stringValue, truncate, type ToolExecutionResult } from './types.js';

const SECRET_PATH_PATTERN=/(^|[\\/])(\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|id_rsa|id_ed25519|\.npmrc$)/i;
export type ToolRequest =
  | {operation:'read_file';path:string;maxBytes?:number}
  | {operation:'write_file';path:string;content:string}
  | {operation:'git';action:'status'|'diff'|'branch'|'checkout';branch?:string}
  | {operation:'npm';script:'build'|'test'|'typecheck'|'lint'|'ci'}
  | {operation:'node';script:string;args?:string[]}
  | {operation:'python';script:string;args?:string[]}
  | {operation:'http';method:'GET'|'POST';url:string;body?:Record<string,unknown>};

export class ToolPolicyError extends Error {constructor(readonly code:string,message:string){super(message);}}
export class ToolExecutor {
  private readonly root:string;
  constructor(workspace:string,readonly defaultTimeoutMs=120_000){this.root=path.resolve(workspace);}
  async execute(raw:unknown):Promise<ToolExecutionResult>{
    const request=this.validate(raw),started=Date.now();
    switch(request.operation){
      case 'read_file':{const target=this.safePath(request.path,false),max=Math.min(Math.max(request.maxBytes??1_000_000,1),5_000_000),info=await stat(target);if(!info.isFile()||info.size>max)throw new ToolPolicyError('FILE_READ_LIMIT','file is not a permitted bounded file');return {operation:'read_file',exitCode:0,stdout:truncate(await readFile(target,'utf8')),stderr:'',durationMs:Date.now()-started,timedOut:false,detail:{path:path.relative(this.root,target),bytes:info.size}};}
      case 'write_file':{const target=this.safePath(request.path,true);await mkdir(path.dirname(target),{recursive:true});const temp=`${target}.tigeriq-${process.pid}.tmp`;await writeFile(temp,request.content,'utf8');await rename(temp,target);return {operation:'write_file',exitCode:0,stdout:`WROTE ${Buffer.byteLength(request.content)} bytes`,stderr:'',durationMs:Date.now()-started,timedOut:false,detail:{path:path.relative(this.root,target)}};}
      case 'git':{if(request.action==='checkout'){const branch=request.branch??'';if(!/^[A-Za-z0-9._/-]{1,160}$/.test(branch)||['main','master','production','prod'].includes(branch.toLowerCase()))throw new ToolPolicyError('GIT_BRANCH_DENIED','checkout target is not an allowed feature branch');return this.spawnSafe('git',['checkout',branch],this.defaultTimeoutMs);}const args=request.action==='status'?['status','--short','--branch']:request.action==='diff'?['diff','--']:['branch','--show-current'];return this.spawnSafe('git',args,this.defaultTimeoutMs);}
      case 'npm':{const npm=process.platform==='win32'?'npm.cmd':'npm',args=request.script==='test'?['test']:['run',request.script];return this.spawnSafe(npm,args,Math.max(this.defaultTimeoutMs,300_000));}
      case 'node':return this.spawnSafe(process.execPath,[this.safeScript(request.script,['.js','.mjs','.cjs']),...this.safeArgs(request.args)],this.defaultTimeoutMs);
      case 'python':return this.spawnSafe(process.env.TIGERIQ_PYTHON_BIN?.trim()||'python',[this.safeScript(request.script,['.py']),...this.safeArgs(request.args)],this.defaultTimeoutMs);
      case 'http':return this.localHttp(request,started);
    }
  }
  private validate(raw:unknown):ToolRequest{
    const row=asRecord(raw);if(!row)throw new ToolPolicyError('TOOL_REQUEST_INVALID','tool request must be an object');const operation=stringValue(row.operation);if(!operation||!['read_file','write_file','git','npm','node','python','http'].includes(operation))throw new ToolPolicyError('TOOL_OPERATION_DENIED','operation is not allowlisted');
    if(operation==='read_file')return {operation,path:this.requiredText(row.path,'path'),maxBytes:numberValue(row.maxBytes)};
    if(operation==='write_file'){if(typeof row.content!=='string')throw new ToolPolicyError('TOOL_REQUEST_INVALID','content must be string');return {operation,path:this.requiredText(row.path,'path'),content:row.content};}
    if(operation==='git'){const action=this.requiredText(row.action,'action');if(!['status','diff','branch','checkout'].includes(action))throw new ToolPolicyError('GIT_ACTION_DENIED','git action denied');return {operation,action:action as 'status'|'diff'|'branch'|'checkout',branch:stringValue(row.branch)};}
    if(operation==='npm'){const script=this.requiredText(row.script,'script');if(!['build','test','typecheck','lint','ci'].includes(script))throw new ToolPolicyError('NPM_SCRIPT_DENIED','npm script denied');return {operation,script:script as 'build'|'test'|'typecheck'|'lint'|'ci'};}
    if(operation==='node'||operation==='python')return {operation,script:this.requiredText(row.script,'script'),args:Array.isArray(row.args)?row.args.map(value=>this.requiredText(value,'arg')):undefined};
    const method=(stringValue(row.method)??'GET').toUpperCase();if(method!=='GET'&&method!=='POST')throw new ToolPolicyError('HTTP_METHOD_DENIED','HTTP method denied');return {operation:'http',method,url:this.requiredText(row.url,'url'),body:asRecord(row.body)};
  }
  private requiredText(value:unknown,name:string):string{const text=stringValue(value);if(!text||text.length>4096)throw new ToolPolicyError('TOOL_REQUEST_INVALID',`${name} is required`);return text;}
  private safePath(relative:string,writing:boolean):string{if(path.isAbsolute(relative))throw new ToolPolicyError('PATH_DENIED','absolute paths are denied');const target=path.resolve(this.root,relative),prefix=this.root.endsWith(path.sep)?this.root:`${this.root}${path.sep}`;if(target!==this.root&&!target.startsWith(prefix))throw new ToolPolicyError('PATH_DENIED','path escapes workspace');if(SECRET_PATH_PATTERN.test(target))throw new ToolPolicyError('SECRET_PATH_DENIED','credential-like paths are denied');if(writing&&target.includes(`${path.sep}.git${path.sep}`))throw new ToolPolicyError('GIT_INTERNAL_WRITE_DENIED','direct .git writes are denied');return target;}
  private safeScript(relative:string,extensions:string[]):string{const target=this.safePath(relative,false);if(!extensions.includes(path.extname(target).toLowerCase()))throw new ToolPolicyError('SCRIPT_TYPE_DENIED','script extension denied');return target;}
  private safeArgs(values?:string[]):string[]{if(!values)return [];if(values.length>32||values.some(value=>value.length>2048||value.includes('\u0000')))throw new ToolPolicyError('ARGUMENTS_DENIED','arguments exceed policy');return values;}
  private spawnSafe(command:string,args:string[],timeoutMs:number):Promise<ToolExecutionResult>{
    const started=Date.now();return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:this.root,shell:false,windowsHide:true,env:{...process.env}});let stdout='',stderr='',timedOut=false,settled=false;const append=(current:string,chunk:Buffer|string)=>truncate(current+chunk.toString());child.stdout?.on('data',chunk=>{stdout=append(stdout,chunk);});child.stderr?.on('data',chunk=>{stderr=append(stderr,chunk);});const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);child.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});child.once('close',code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({operation:[command,...args].join(' '),exitCode:timedOut?124:(code??1),stdout,stderr,durationMs:Date.now()-started,timedOut});});});
  }
  private async localHttp(request:Extract<ToolRequest,{operation:'http'}>,started:number):Promise<ToolExecutionResult>{
    const url=new URL(request.url);if(url.protocol!=='http:')throw new ToolPolicyError('HTTP_SCHEME_DENIED','only local HTTP is allowed');if(!['127.0.0.1','localhost','100.97.23.87'].includes(url.hostname))throw new ToolPolicyError('HTTP_HOST_DENIED','HTTP host is outside PC01 local boundary');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.defaultTimeoutMs);
    try{const response=await fetch(url,{method:request.method,headers:request.body?{'Content-Type':'application/json'}:undefined,body:request.body?JSON.stringify(request.body):undefined,signal:controller.signal});const text=truncate(await response.text());return {operation:`http ${request.method} ${url.origin}${url.pathname}`,exitCode:response.ok?0:1,stdout:text,stderr:response.ok?'':`HTTP ${response.status}`,durationMs:Date.now()-started,timedOut:false,detail:{status:response.status}};}catch(error){if((error as Error).name==='AbortError')return {operation:`http ${request.method}`,exitCode:124,stdout:'',stderr:'timeout',durationMs:Date.now()-started,timedOut:true};throw error;}finally{clearTimeout(timer);}
  }
}
