import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');

describe('#969 stale provider identity retirement',()=>{
  it('retires a previous provider row when an NV employee is reassigned',()=>{
    expect(core).toContain("select resource_id,current_job_id from tigeriq_ai_resources where employee_id=$1 and resource_id<>$2 and enabled=true");
    expect(core).toContain("STALE_RESOURCE_IDENTITY_BUSY:");
    expect(core).toContain("set enabled=false,credential_state='BLOCKED',health_state='OFFLINE',work_state='OFFLINE'");
    expect(core).toContain("event('RESOURCE_IDENTITY_SUPERSEDED'");
  });

  it('keeps stale history rows out of current API Health truth',()=>{
    expect(core).toContain("select * from tigeriq_ai_resources where enabled=true order by employee_id nulls last,resource_id");
  });

  it('preserves history instead of deleting stale AI resource rows',()=>{
    const start=core.indexOf('const staleSameEmployee=');
    const end=core.indexOf('const legacyResourceId=',start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block=core.slice(start,end);
    expect(block).not.toContain('delete from tigeriq_ai_resources');
  });
});
