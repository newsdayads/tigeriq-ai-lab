import { describe,expect,it } from 'vitest';
import { appendEvent,emptyJournal,parseSecretReference,projectPaths,recoveryDecision,redactSensitiveText,verifyJournal } from '../apps/runtime-foundation/src/core.js';

describe('runtime foundation',()=>{
  it('creates isolated project paths',()=>{
    const ai=projectPaths('ai-lab');
    const driver=projectPaths('driver');
    expect(ai.root).not.toBe(driver.root);
    expect(ai.queue).toContain('ai-lab');
    expect(driver.evidence).toContain('driver');
  });

  it('appends ordered idempotent events and verifies journal integrity',()=>{
    let journal=emptyJournal();
    journal=appendEvent(journal,{projectId:'ai-lab',entity:'goal',entityId:'G-1',kind:'created',at:'2026-09-04T00:00:00.000Z',idempotencyKey:'create-G-1'});
    const duplicate=appendEvent(journal,{projectId:'ai-lab',entity:'goal',entityId:'G-1',kind:'created',at:'2026-09-04T00:00:01.000Z',idempotencyKey:'create-G-1'});
    expect(duplicate).toBe(journal);
    journal=appendEvent(journal,{projectId:'ai-lab',entity:'goal',entityId:'G-1',kind:'started',at:'2026-09-04T00:00:02.000Z'});
    expect(journal.events.map(event=>event.sequence)).toEqual([1,2]);
    expect(verifyJournal(journal)).toBe(true);
    expect(verifyJournal({...journal,lastSequence:99})).toBe(false);
  });

  it('detects stuck workers and bounds retry attempts',()=>{
    const policy={stuckAfterMs:60_000,maxAttempts:3,baseRetryMs:1000,maxRetryMs:8000};
    const now=Date.parse('2026-09-04T00:02:00.000Z');
    expect(recoveryDecision({id:'W1',projectId:'ai-lab',lastSeenAt:'2026-09-04T00:00:00.000Z',status:'running',attempt:1},now,policy).action).toBe('restart');
    expect(recoveryDecision({id:'W1',projectId:'ai-lab',lastSeenAt:'2026-09-04T00:02:00.000Z',status:'failed',attempt:1},now,policy)).toMatchObject({action:'retry',retryAfterMs:2000});
    expect(recoveryDecision({id:'W1',projectId:'ai-lab',lastSeenAt:'2026-09-04T00:02:00.000Z',status:'failed',attempt:3},now,policy).action).toBe('blocked');
  });

  it('stores secret references but rejects raw secret-looking values',()=>{
    expect(parseSecretReference({version:1,providerId:'openai',keyName:'OPENAI_API_KEY',source:'env',reference:'OPENAI_API_KEY'})).toEqual({version:1,providerId:'openai',keyName:'OPENAI_API_KEY',source:'env',reference:'OPENAI_API_KEY'});
    expect(()=>parseSecretReference({version:1,providerId:'openai',keyName:'OPENAI_API_KEY',source:'file-ref',reference:'sk-abcdefghijklmnopqrstuvwxyz'})).toThrow('RAW_SECRET_FORBIDDEN');
    expect(redactSensitiveText('api_key=secret123 Authorization: Bearer abcdef sk-abcdefghijkl')).not.toContain('secret123');
  });
});
