import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrowserMutationLeaseStore } from '../apps/chrome-controller/src/browser-mutation-lease.js';

function store(){
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-browser-lease-'));
  return new BrowserMutationLeaseStore(join(dir,'leases.json'));
}

describe('browser mutation lease',()=>{
  it('allows exactly one active owner per worker',()=>{
    const leases=store();
    const first=leases.acquire('NV04','HARNESS',30_000,1_000);
    expect(first.kind).toBe('ACQUIRED');
    const second=leases.acquire('NV04','DIRECT_CDP',30_000,2_000);
    expect(second).toMatchObject({kind:'BUSY',lease:{ownerId:'HARNESS',workerId:'NV04'}});
  });

  it('isolates leases by worker',()=>{
    const leases=store();
    expect(leases.acquire('NV04','HARNESS',30_000,1_000).kind).toBe('ACQUIRED');
    expect(leases.acquire('NV03','DIRECT_CDP',30_000,1_000).kind).toBe('ACQUIRED');
  });

  it('allows bounded takeover after expiry',()=>{
    const leases=store();
    const first=leases.acquire('NV04','HARNESS',5_000,1_000);
    expect(first.kind).toBe('ACQUIRED');
    const next=leases.acquire('NV04','DIRECT_CDP',5_000,6_001);
    expect(next).toMatchObject({kind:'ACQUIRED',lease:{ownerId:'DIRECT_CDP'}});
  });

  it('requires the exact owner and token to release',()=>{
    const leases=store();
    const first=leases.acquire('NV04','HARNESS',30_000,1_000);
    if(first.kind!=='ACQUIRED')throw new Error('setup');
    expect(()=>leases.release('NV04','OTHER',first.lease.leaseId)).toThrow('BROWSER_MUTATION_LEASE_TOKEN_MISMATCH');
    expect(leases.release('NV04','HARNESS',first.lease.leaseId)).toBe(true);
    expect(leases.active('NV04',2_000)).toBeUndefined();
  });

  it('blocks controller mutations while a Harness lease is active',()=>{
    const leases=store();
    leases.acquire('NV04','HARNESS',30_000,1_000);
    expect(()=>leases.assertControllerAllowed('NV04',2_000)).toThrow('BROWSER_MUTATION_LEASE_BUSY:NV04:HARNESS');
    expect(()=>leases.assertControllerAllowed('NV03',2_000)).not.toThrow();
  });
});

describe('controller and direct-CDP lease wiring',()=>{
  it('gates page mutations and command delivery in Controller',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain("pageMutationActions=new Set(['NAVIGATE','DISPATCH','ARCHIVE_CHAT','CLOSE_WINDOW'])");
    expect(server).toContain('browserMutationLeases.assertControllerAllowed(workerId)');
    expect(server).toContain('/mutation-lease(?:\\/(acquire|release))?');
    expect(server).toContain('WORKER_COMMAND_INFLIGHT');
    expect(server).toContain('if(mutationLease){json(res,200,{command:null');
  });

  it('keeps NV02 isolated duplicate observation independent of Controller lease',()=>{
    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain('DUPLICATE_TABS_OBSERVED_NO_MUTATION');
    expect(bridge).toContain('NV02_LOCAL_MUTATION_ACQUIRED');
    const prune=bridge.slice(
      bridge.indexOf('async function pruneDuplicates'),
      bridge.indexOf('async function windowIdFor'),
    );
    expect(prune).not.toContain('acquireBridgeMutationLease');
    expect(prune).not.toContain('releaseBridgeMutationLease');
  });
});
