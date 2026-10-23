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
    expect(core).toContain('const effectiveWaitProfile=effectiveCoreJobRoutingProfile(j);');
    expect(run).toContain('busyCapableResourceCount(j.capability,effectiveWaitProfile)');
    expect(run).toContain("LOCAL_RESOURCE_TEMPORARILY_UNAVAILABLE");
    expect(run).toContain("status='waiting_resource'");
    expect(run).toContain('RESOURCE_WAIT_QUEUED');
    expect(run).toContain('const plan=resourceWaitPlan(');
    expect(run.indexOf("status='waiting_resource'")).toBeLessThan(run.indexOf("status='failed'"));
  });
  it('retries boundedly after real local timeout instead of immediately failing the job',()=>{
    expect(core).toContain('TIGERIQ_OLLAMA_TIMEOUT_MS || 90000');
    expect(run).toContain('mayWaitAfterLocalFailure({');
    expect(run).toContain('LOCAL_TRANSIENT_INFERENCE_FAILURE');
    expect(run).toContain('transientLocalWait||targetedReviewWait');
    expect(core).toContain('RESOURCE_WAIT_MAX_RETRIES=6');
  });
  it('never treats cloud capacity as a substitute for a LOCAL-only objective',()=>{
    expect(capacity).toContain("provider='ollama'");
    expect(capacity).toContain('where enabled=true');
    expect(core).toContain("profile:effectiveCoreJobRoutingProfile(j)");
    const localProfile=readFileSync(new URL('../apps/tigeriq-core/objective-local-routing.mjs',import.meta.url),'utf8');
    expect(localProfile).toContain("String(job?.routing_profile||'AUTO').toUpperCase()==='LOCAL'");
  });
});
