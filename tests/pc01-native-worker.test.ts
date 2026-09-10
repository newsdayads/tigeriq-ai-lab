import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CapabilityRouter, OllamaProvider, Semaphore, ToolExecutor, ToolPolicyError, type WorkerJob } from '../apps/pc01-native-worker/src/core.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

function job(overrides:Partial<WorkerJob>={}):WorkerJob{return {jobId:'JOB-TEST',title:'test',objective:'test objective',payload:{},requiredCapabilities:[],requiredPermissions:[],expectedEvidence:['json'],independentReview:false,judgeRequired:false,...overrides};}

describe('PC01 capability router',()=>{
  test('routes deterministic, structured tool, local AI, and explicit cloud without provider fabrication',()=>{
    const router=new CapabilityRouter();
    expect(router.select(job({payload:{action:'resource_snapshot'}}))).toBe('deterministic');
    expect(router.select(job({payload:{toolRequest:{operation:'read_file',path:'fixture.txt'}}}))).toBe('tool');
    expect(router.select(job({requiredCapabilities:['local_ai']}))).toBe('local_ai');
    expect(router.select(job({payload:{route:'cloud'}}))).toBe('cloud');
  });
});

describe('PC01 safe tool executor',()=>{
  test('reads and writes only inside workspace and denies traversal/secret paths',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-pc01-'));roots.push(root);const executor=new ToolExecutor(root,5_000);
    const write=await executor.execute({operation:'write_file',path:'artifacts/out.txt',content:'TIGERIQ_TOOL_PASS'});expect(write.exitCode).toBe(0);
    const read=await executor.execute({operation:'read_file',path:'artifacts/out.txt'});expect(read.stdout).toContain('TIGERIQ_TOOL_PASS');expect(await readFile(path.join(root,'artifacts','out.txt'),'utf8')).toBe('TIGERIQ_TOOL_PASS');
    await expect(executor.execute({operation:'read_file',path:'../outside.txt'})).rejects.toMatchObject({code:'PATH_DENIED'} satisfies Partial<ToolPolicyError>);
    await writeFile(path.join(root,'.env'),'SECRET=1','utf8');await expect(executor.execute({operation:'read_file',path:'.env'})).rejects.toMatchObject({code:'SECRET_PATH_DENIED'} satisfies Partial<ToolPolicyError>);
  });
  test('does not permit arbitrary shell operations',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-pc01-'));roots.push(root);const executor=new ToolExecutor(root);
    await expect(executor.execute({operation:'shell',command:'rm -rf /'})).rejects.toMatchObject({code:'TOOL_OPERATION_DENIED'} satisfies Partial<ToolPolicyError>);
    await expect(executor.execute({operation:'git',action:'checkout',branch:'main'})).rejects.toMatchObject({code:'GIT_BRANCH_DENIED'} satisfies Partial<ToolPolicyError>);
  });
});

describe('PC01 local AI scheduler and Ollama adapter',()=>{
  test('semaphore never exceeds configured concurrency',async()=>{
    const gate=new Semaphore(2);let active=0,peak=0;
    await Promise.all(Array.from({length:6},()=>gate.use(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;})));
    expect(peak).toBe(2);expect(gate.activeCount).toBe(0);
  });
  test('uses qwen3 routine defaults and records Ollama metrics',async()=>{
    let generateBody:Record<string,unknown>|undefined;
    const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      if(req.url==='/api/generate'){generateBody=JSON.parse(Buffer.concat(chunks).toString('utf8'));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({response:'{"summary":"ok"}',total_duration:2_000_000_000,load_duration:100_000_000,prompt_eval_count:10,eval_count:20,eval_duration:1_000_000_000}));return;}
      if(req.url==='/api/ps'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({models:[{name:'qwen3:8b',size:5_600_000_000,size_vram:5_600_000_000}]}));return;}
      if(req.url==='/api/tags'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({models:[{name:'qwen3:8b'}]}));return;}res.writeHead(404);res.end();});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));const address=server.address();if(!address||typeof address==='string')throw new Error('test server address unavailable');
    try{const provider=new OllamaProvider(`http://127.0.0.1:${address.port}`,'qwen3:8b',4096,2,5_000);const result=await provider.generate('return json',{json:true,temperature:0.1});
      expect(result.parsed).toEqual({summary:'ok'});expect(result.metrics.tokensPerSec).toBe(20);expect(result.metrics.processor).toBe('100% GPU');expect(generateBody).toMatchObject({model:'qwen3:8b',stream:false,think:false,options:{num_ctx:4096,temperature:0.1}});
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
