import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {inspectAgy,inspectCodex} from './owner-cli-quota-probe.mjs';
const observedAt='2026-11-22T00:00:00.000Z';
describe('PC01 bounded quota preflight',()=>{
  it('uses only documented Antigravity read-only CLI verbs',async()=>{
    const invoked=[];
    const exec=async(_exe,args)=>{
      invoked.push(args);
      if(args.includes('/usage'))return JSON.stringify({status:'SUCCESS',command:{name:'usage',data:{groups:[
        {name:'Gemini Models',buckets:[{remaining_fraction:0.9,window:'5h'}]}
      ]}}});
      return 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n';
    };
    const result=await inspectAgy({exe:'agy.exe',observedAt,exec});
    expect(result).toMatchObject({authenticated:true,models:['gemini-3.8-flash-low']});
    expect(result.snapshots[0].remainingFraction).toBe(0.9);
    expect(invoked).toHaveLength(2);
    expect(invoked.flat()).not.toContain('--dangerously-skip-permissions');
  });
  it('reads only account limits and visible models from Codex app-server',async()=>{
    const sent=[];
    const spawnFn=()=>{
      const child=new EventEmitter();
      child.stdout=new EventEmitter();child.kill=()=>{};
      child.stdin={write(line){
        const msg=JSON.parse(line);sent.push(msg.method);
        if(msg.id===6)setImmediate(()=>child.stdout.emit('data',JSON.stringify({id:6,result:{rateLimits:{
          primary:{usedPercent:87,resetsAt:1795293985},secondary:{usedPercent:32,resetsAt:1795837621}
        }}})+'\n'));
        if(msg.id===7)setImmediate(()=>child.stdout.emit('data',JSON.stringify({id:7,result:{data:[{id:'gpt-test-model'}]}})+'\n'));
      }};
      return child;
    };
    const r=await inspectCodex({exe:'codex.exe',observedAt,spawnFn,timeoutMs:2000});
    expect(r.models).toEqual(['gpt-test-model']);
    expect(r.snapshots[0].remainingFraction).toBeCloseTo(.13);
    expect(sent).toEqual(['initialize','initialized','account/rateLimits/read','model/list']);
    expect(sent).not.toContain('account/rateLimitResetCredit/consume');
  });
});
