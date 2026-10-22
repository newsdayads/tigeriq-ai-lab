import { describe, it, expect, vi } from 'vitest';
import { inspectRdcPool, executeRdcWithPool } from '../apps/shared/rdc-account-preflight.mjs';

const links = [
  { rdcId: 'RDC01', link_id: 'link_main' },
  { rdcId: 'RDC02', link_id: 'link_backup1' },
  { rdcId: 'RDC03', link_id: 'link_backup2' },
];
const quota = { link_main: 0, link_backup1: 53, link_backup2: 53 };
const whoAmI = vi.fn(async ({link_id}) => ({
  text: JSON.stringify({role:'authenticated', remote_calls_left_pct:quota[link_id]})
}));
const listDevices = vi.fn(async ({link_id}) => ({
  text: 'Desktop Commander devices\n\n1. PC01\n   Status: Online\n   ID: ' +
    ({link_main:'aaaa1111-1111-1111-1111-111111111111',
      link_backup1:'bbbb2222-2222-2222-2222-222222222222',
      link_backup2:'cccc3333-3333-3333-3333-333333333333'}[link_id]) +
    '\n   Last seen: 3m ago'
}));
const args = () => ({links,whoAmI,listDevices,authorized:true,operation:'read'});

describe('RDC account preflight — actual linked-account routing contract', () => {
  it('excludes exhausted main and selects the highest-quota online account with stable tie-break', async () => {
    const audit = await inspectRdcPool(args());
    expect(audit.audit.find(a=>a.rdcId==='RDC01').reason).toBe('QUOTA_EXHAUSTED');
    expect(audit.eligible.map(a=>a.rdcId)).toEqual(['RDC02','RDC03']);
    const invoke=vi.fn(async x=>x);
    const out=await executeRdcWithPool({...args(),invoke});
    expect(out.selected.rdcId).toBe('RDC02');
    expect(invoke).toHaveBeenCalledWith({
      link_id:'link_backup1',deviceId:'bbbb2222-2222-2222-2222-222222222222'
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('fails closed without authorized operation; never calls device', async () => {
    const invoke=vi.fn();
    await expect(executeRdcWithPool({...args(),authorized:false,invoke})).rejects.toThrow(
      'RDC_OPERATION_NOT_AUTHORIZED');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns RDC_POOL_UNAVAILABLE when every link is quota-exhausted', async () => {
    const whoAmI=async()=>({role:'authenticated',remote_calls_left_pct:0});
    const invoke=vi.fn();
    await expect(executeRdcWithPool({...args(),whoAmI,invoke})).rejects.toMatchObject({
      code:'RDC_POOL_UNAVAILABLE'
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses offline and unknown quota links instead of assuming capacity', async () => {
    const whoAmI=async({link_id})=>({
      role:'authenticated',remote_calls_left_pct:link_id==='link_backup2'?50:undefined
    });
    const listDevices=async()=>({text:'1. PC01\n   Status: Offline\n   ID: cccc3333-3333-3333-3333-333333333333'});
    const audit=await inspectRdcPool({...args(),whoAmI,listDevices});
    expect(audit.eligible).toHaveLength(0);
    expect(audit.audit.find(a=>a.link_id==='link_backup2').reason).toBe('PC01_OFFLINE');
    expect(audit.audit.find(a=>a.link_id==='link_main').reason).toBe('QUOTA_UNVERIFIED');
  });

  it('rechecks and falls back only after confirmed pre-execution quota denial', async () => {
    let calls=0;
    const invoke=vi.fn(async x=>{
      calls++;
      if (calls===1) throw Object.assign(new Error('quota'),{code:'QUOTA_EXHAUSTED'});
      return x;
    });
    const out=await executeRdcWithPool({...args(),invoke});
    expect(out.selected.rdcId).toBe('RDC03');
    expect(out.attempts).toEqual([{rdcId:'RDC02',code:'QUOTA_EXHAUSTED'}]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(whoAmI).toHaveBeenCalled();
  });

  it('does not rotate on permission/security denial', async () => {
    const invoke=vi.fn(async()=>{
      throw Object.assign(new Error('permission denied'),{code:'PERMISSION_DENIED'});
    });
    await expect(executeRdcWithPool({...args(),invoke})).rejects.toMatchObject({
      code:'PERMISSION_DENIED'
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not replay an uncertain write on any other account', async () => {
    const invoke=vi.fn(async()=>{throw new Error('ambiguous write outcome');});
    await expect(executeRdcWithPool({...args(),operation:'write',invoke}))
      .rejects.toThrow('ambiguous write outcome');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('pairs the chosen account with its own PC01 device ID', async () => {
    const invoke=vi.fn(async x=>x);
    const out=await executeRdcWithPool({...args(),invoke});
    expect(out.result.link_id).toBe('link_backup1');
    expect(out.result.deviceId).toBe('bbbb2222-2222-2222-2222-222222222222');
  });

  it('GH-5167 rejects two distinct connector links claiming one RDC slot before metadata reads', async () => {
    const duplicateSlot = [
      {rdcId:'RDC02',link_id:'link_backup1'},
      {rdcId:'RDC02',link_id:'link_backup2'},
    ];
    const who = vi.fn();
    const devices = vi.fn();
    await expect(inspectRdcPool({
      links:duplicateSlot,whoAmI:who,listDevices:devices,
    })).rejects.toThrow('RDC_LINK_CONFIGURATION_INVALID');
    expect(who).not.toHaveBeenCalled();
    expect(devices).not.toHaveBeenCalled();

    const invoke = vi.fn();
    await expect(executeRdcWithPool({
      links:duplicateSlot,whoAmI:who,listDevices:devices,
      invoke,authorized:true,operation:'write',
    })).rejects.toThrow('RDC_LINK_CONFIGURATION_INVALID');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('GH-5167 preserves valid 1:1 account-slot bindings despite arbitrary link input order', async () => {
    const reordered=[links[2],links[0],links[1]];
    const found=await inspectRdcPool({...args(),links:reordered});
    expect(found.audit).toHaveLength(3);
    expect(found.eligible.map(x=>x.rdcId)).toEqual(['RDC02','RDC03']);
  });

  it('rejects duplicate links, malformed identities and unlabeled Rdc accounts', async () => {
    await expect(inspectRdcPool({...args(),links:[links[0],links[0]]}))
      .rejects.toThrow('RDC_LINK_CONFIGURATION_INVALID');
    await expect(inspectRdcPool({...args(),links:[{rdcId:'RDC06',link_id:'link_unknown'}]}))
      .rejects.toThrow('RDC_LINK_CONFIGURATION_INVALID');
  });
});
