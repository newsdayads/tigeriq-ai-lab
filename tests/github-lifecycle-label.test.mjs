import {describe,expect,it,vi} from 'vitest';
import {
  TERMINAL_BLOCKED_LABEL,
  clearTerminalBlockedLabel,
  ensureTerminalBlockedLabel,
  hasTerminalBlockedLabel,
  setTerminalBlockedLabel,
} from '../apps/tigeriq-core/github-lifecycle-label.mjs';

function httpError(status){const e=new Error('HTTP_'+status);e.status=status;return e}

describe('GitHub durable terminal-blocked lifecycle label',()=>{
  it('detects string and object labels case-insensitively',()=>{
    expect(hasTerminalBlockedLabel({labels:[TERMINAL_BLOCKED_LABEL]})).toBe(true);
    expect(hasTerminalBlockedLabel({labels:[{name:'TIGERIQ:TERMINAL-BLOCKED'}]})).toBe(true);
    expect(hasTerminalBlockedLabel({labels:[{name:'other'}]})).toBe(false);
  });

  it('creates missing repository label once then attaches it to the issue',async()=>{
    const calls=[];
    const request=vi.fn(async(path,init={})=>{
      calls.push({path,method:init.method||'GET',body:init.body||null});
      if(path.startsWith('/labels/')&&(init.method||'GET')==='GET')throw httpError(404);
      return {};
    });
    await setTerminalBlockedLabel({issueNumber:2055,request});
    expect(calls.map(x=>x.method+' '+x.path)).toEqual([
      'GET /labels/tigeriq%3Aterminal-blocked',
      'POST /labels',
      'POST /issues/2055/labels',
    ]);
    expect(JSON.parse(calls.at(-1).body)).toEqual({labels:[TERMINAL_BLOCKED_LABEL]});
  });

  it('treats concurrent label creation 422 and absent-label removal 404 as idempotent success',async()=>{
    const createRace=vi.fn(async(path,init={})=>{
      if(path.startsWith('/labels/')&&(init.method||'GET')==='GET')throw httpError(404);
      if(path==='/labels'&&init.method==='POST')throw httpError(422);
      return {};
    });
    await expect(ensureTerminalBlockedLabel({request:createRace})).resolves.toBe(true);

    const removeAbsent=vi.fn(async()=>{throw httpError(404)});
    await expect(clearTerminalBlockedLabel({issueNumber:2055,request:removeAbsent})).resolves.toBe(true);
  });

  it('propagates non-idempotent GitHub failures instead of hiding queue truth errors',async()=>{
    const request=vi.fn(async()=>{throw httpError(503)});
    await expect(setTerminalBlockedLabel({issueNumber:2055,request})).rejects.toMatchObject({status:503});
    await expect(clearTerminalBlockedLabel({issueNumber:2055,request})).rejects.toMatchObject({status:503});
  });
});
