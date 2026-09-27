import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  TERMINAL_BLOCKED_LABEL,
  addTerminalBlockedLabel,
  clearTerminalBlockedLabel,
  hasTerminalBlockedLabel,
} from '../apps/tigeriq-core/github-lifecycle-label.mjs';

function response(data,status=200){
  return new Response(data==null?'':JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
}

describe('GitHub terminal lifecycle label',()=>{
  it('recognizes string and object label shapes',()=>{
    expect(TERMINAL_BLOCKED_LABEL).toBe('tigeriq:terminal-blocked');
    expect(hasTerminalBlockedLabel({labels:['x','tigeriq:terminal-blocked']})).toBe(true);
    expect(hasTerminalBlockedLabel({labels:[{name:'TIGERIQ:TERMINAL-BLOCKED'}]})).toBe(true);
    expect(hasTerminalBlockedLabel({labels:[]})).toBe(false);
  });

  it('adds existing label without repository mutation',async()=>{
    const calls=[];
    const fetchImpl=async(url,init)=>{calls.push([url,init.method]);return response([])};
    await addTerminalBlockedLabel({fetchImpl,owner:'o',repo:'r',issueNumber:7,token:'x'});
    expect(calls).toEqual([['https://api.github.com/repos/o/r/issues/7/labels','POST']]);
  });

  it('creates a missing repository label once then retries issue add',async()=>{
    const calls=[]; let issueAdd=0;
    const fetchImpl=async(url,init)=>{
      calls.push([url,init.method]);
      if(url.endsWith('/issues/7/labels')&&++issueAdd===1)return response({message:'Validation Failed',errors:[{code:'missing',field:'labels'}]},422);
      if(url.endsWith('/labels')&&init.method==='POST')return response({name:'tigeriq:terminal-blocked'},201);
      return response([]);
    };
    await addTerminalBlockedLabel({fetchImpl,owner:'o',repo:'r',issueNumber:7,token:'x'});
    expect(calls.map(x=>x[0])).toEqual([
      'https://api.github.com/repos/o/r/issues/7/labels',
      'https://api.github.com/repos/o/r/labels',
      'https://api.github.com/repos/o/r/issues/7/labels'
    ]);
  });

  it('treats clearing an absent label as idempotent success',async()=>{
    const fetchImpl=async()=>response({message:'Not Found'},404);
    await expect(clearTerminalBlockedLabel({fetchImpl,owner:'o',repo:'r',issueNumber:7,token:'x'})).resolves.toBe(true);
  });

  it('wires Core, Coding and Live projection to the shared lifecycle label',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
    const coding=readFileSync(new URL('../apps/tigeriq-core/github-coding-intake.mjs',import.meta.url),'utf8');
    const live=readFileSync(new URL('../api/live-status.mjs',import.meta.url),'utf8');
    expect(core).toContain('addTerminalBlockedLabel');
    expect(core).toContain('clearTerminalBlockedLabel');
    expect(coding).toContain('addTerminalBlockedLabel');
    expect(coding).toContain('clearTerminalBlockedLabel');
    expect(live).toContain('hasTerminalBlockedLabel');
  });

  it('orders Coding lifecycle as objective exists, label clears, then durable transition markers',()=>{
    const coding=readFileSync(new URL('../apps/tigeriq-core/github-coding-intake.mjs',import.meta.url),'utf8');
    expect(coding).toMatch(/CODING_OBJECTIVE_ID_MISSING[\s\S]*?clearTerminalBlockedLabel\(\{fetchImpl,owner,repo,issueNumber:spec\.number,token\}\);[\s\S]*?GITHUB_CODING_COMPLETED_REARMED[\s\S]*?GITHUB_CODING_DISPATCHED/);
    expect(coding).toMatch(/CODING_STALE_REARM_OBJECTIVE_ID_MISSING[\s\S]*?clearTerminalBlockedLabel\(\{fetchImpl,owner,repo,issueNumber:n,token\}\);[\s\S]*?GITHUB_CODING_STALE_RESULT_REARMED[\s\S]*?GITHUB_CODING_DISPATCHED/);
    expect(coding).toMatch(/CODING_RECOVERY_OBJECTIVE_ID_MISSING[\s\S]*?clearTerminalBlockedLabel\(\{fetchImpl,owner,repo,issueNumber:n,token\}\);[\s\S]*?GITHUB_CODING_RECOVERY_REARMED[\s\S]*?GITHUB_CODING_DISPATCHED/);
    expect(coding).toMatch(/CODING_RETRY_OBJECTIVE_ID_MISSING[\s\S]*?alreadyDispatched[\s\S]*?clearTerminalBlockedLabel\(\{fetchImpl,owner,repo,issueNumber:n,token\}\);[\s\S]*?GITHUB_CODING_RETRY_DISPATCHED[\s\S]*?GITHUB_CODING_DISPATCHED/);
  });


});
