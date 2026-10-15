import {describe,it,expect} from 'vitest';
import {MOBILE_HEARTBEAT_FRESH_MS,projectMobileWorkerPresence} from '../apps/tigeriq-core/mobile-workforce-presence.mjs';

const now=Date.parse('2026-10-15T06:52:30.000Z');
const row={employee_id:'NV102',provider:'ChatGPT',agent_version:'0.27.0-nv02-core-guard',last_seen_at:'2026-10-15T06:52:21.181Z',revoked:false,credential_id:'NEVER_EXPOSE',token_hash:'NEVER_EXPOSE',node_id:'PRIVATE_NODE_ID'};

describe('NV102 core mobile heartbeat projection',()=>{
  it('reflects a fresh Core Mobile pairing as connected without claiming routing acceptance',()=>{
    const [w]=projectMobileWorkerPresence([row],{nowMs:now});
    expect(w).toEqual({employeeId:'NV102',provider:'ChatGPT',agentVersion:'0.27.0-nv02-core-guard',heartbeatAt:'2026-10-15T06:52:21.181Z',online:true,connectionStatus:'ONLINE',source:'core_mobile_devices',acceptanceStatus:'NOT_VERIFIED_20_TASKS'});
    for(const secret of ['credential_id','token_hash','node_id','task_prompt','public_key'])expect(JSON.stringify(w)).not.toContain(secret);
  });
  it('never treats stale, absent, future or revoked devices as online',()=>{
    expect(MOBILE_HEARTBEAT_FRESH_MS).toBe(120000);
    const stale={...row,last_seen_at:new Date(now-120001).toISOString()};
    const future={...row,last_seen_at:new Date(now+5001).toISOString()};
    expect(projectMobileWorkerPresence([stale],{nowMs:now})[0].online).toBe(false);
    expect(projectMobileWorkerPresence([future],{nowMs:now})[0].online).toBe(false);
    expect(projectMobileWorkerPresence([{...row,last_seen_at:null}],{nowMs:now})[0].online).toBe(false);
    expect(projectMobileWorkerPresence([{...row,revoked:true}],{nowMs:now})).toEqual([]);
  });
  it('keeps only the most recent employee record; never creates AI resources or leases',()=>{
    const items=projectMobileWorkerPresence([row,{...row,last_seen_at:'2026-10-10T06:52:00Z'},{...row,employee_id:'NOT_NV'}],{nowMs:now});
    expect(items).toHaveLength(1);
    expect(items[0].online).toBe(true);
  });
});
