import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const capacity=core.slice(core.indexOf('async function busyCapableResourceCount('),core.indexOf('async function claimOpenClawLease('));
const run=core.slice(core.indexOf("const busyCount=message==='NO_AI_RESOURCE_AVAILABLE'"),core.indexOf("const blockedOutcome=/(?:NO_AI_RESOURCE_AVAILABLE"));

describe('Core #4457 LOCAL route temporary resource starvation',()=>{
  it('keeps the AUTO busy-only rule and independently counts configured Ollama capacity',()=>{
    expect(capacity).toContain("const localOnly=profile==='LOCAL'");
    expect(capacity).toContain("($2::boolean and provider='ollama')");
    expect(capacity).toContain("not $2::boolean and health_state in ('READY','ONLINE') and current_job_id is not null");
    expect(capacity).toContain("capabilities @> ARRAY[$1]::text[]");
  });
  it('routes LOCAL resource shortages into bounded resource waiting before terminal failure',()=>{
    expect(run).toContain("busyCapableResourceCount(j.capability,j.routing_profile||'AUTO')");
    expect(run).toContain("LOCAL_RESOURCE_TEMPORARILY_UNAVAILABLE");
    expect(run).toContain("status='waiting_resource'");
    expect(run).toContain('RESOURCE_WAIT_QUEUED');
    expect(run).toContain('const plan=resourceWaitPlan(');
    expect(run.indexOf("status='waiting_resource'")).toBeLessThan(run.indexOf("status='failed'"));
  });
  it('never treats cloud capacity as a substitute for a LOCAL-only objective',()=>{
    expect(capacity).toContain("provider='ollama'");
    expect(capacity).toContain('where enabled=true');
    expect(core).toContain("profile:j.kind==='github_api_autowork'?'LOCAL':(j.routing_profile||'AUTO')");
  });
});
