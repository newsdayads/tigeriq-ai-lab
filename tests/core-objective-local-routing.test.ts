import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Objective routing policy is intentionally a runtime ESM module.
import {normalizeObjectiveRoutingProfile,objectiveJobRoutingProfile,mayWaitAfterLocalFailure} from '../apps/tigeriq-core/objective-local-routing.mjs';
const src=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const router=readFileSync(new URL('../apps/tigeriq-core/smart-router.mjs',import.meta.url),'utf8');

describe('Core P2 objective LOCAL provider boundary',()=>{
  it('accepts only an explicit safe local restriction or the existing AUTO default',()=>{
    expect(normalizeObjectiveRoutingProfile(undefined)).toBe('AUTO');
    expect(normalizeObjectiveRoutingProfile('local')).toBe('LOCAL');
    expect(normalizeObjectiveRoutingProfile(' AUTO ')).toBe('AUTO');
    expect(()=>normalizeObjectiveRoutingProfile('REVIEW')).toThrow('OBJECTIVE_ROUTING_PROFILE_INVALID');
    expect(()=>normalizeObjectiveRoutingProfile('PAID')).toThrow('OBJECTIVE_ROUTING_PROFILE_INVALID');
  });
  it('requires verified objective metadata before local routing is enforced',()=>{
    expect(objectiveJobRoutingProfile({routingProfile:'LOCAL'})).toBe('LOCAL');
    expect(objectiveJobRoutingProfile({routingProfile:'AUTO'})).toBe('AUTO');
    expect(objectiveJobRoutingProfile({})).toBe('AUTO');
    expect(objectiveJobRoutingProfile({routingProfile:'local'})).toBe('AUTO');
  });
  it('retains non-null routing profiles on legacy AUTO and LOCAL campaign jobs',()=>{
    expect(objectiveJobRoutingProfile(undefined)).toBe('AUTO');
    expect(objectiveJobRoutingProfile({routingProfile:'LOCAL'})).toBe('LOCAL');
    expect(objectiveJobRoutingProfile({routingProfile:'AUTO'})).toBe('AUTO');
  });
  it('carries LOCAL from API to both AI and campaign-evidence job records',()=>{
    expect(src).toContain('profile=normalizeObjectiveRoutingProfile(b.routingProfile)');
    expect(src).toContain("profile==='LOCAL'?{routingProfile:'LOCAL'}");
    expect(src).toMatch(/compiled_campaign.*?\$6,\$7/);
    expect(src).toMatch(/compiled_ai.*?\$6,\$7/);
    expect(src).toContain('objectiveJobRoutingProfile(o.metadata)');
    expect(src).toContain('MANAGER_LOCAL_OBJECTIVE_PC_OPERATOR_DENIED');
  });
  it('retries only transient LOCAL inference failures with a configured Ollama resource',()=>{
    const request={profile:'LOCAL',message:'NO_AI_RESOURCE_AVAILABLE',configuredLocalCount:1};
    expect(mayWaitAfterLocalFailure({...request,failures:[{kind:'timeout'}]})).toBe(true);
    expect(mayWaitAfterLocalFailure({...request,failures:[{kind:'outage'},{kind:'timeout'}]})).toBe(true);
    expect(mayWaitAfterLocalFailure({...request,failures:[{kind:'auth'}]})).toBe(false);
    expect(mayWaitAfterLocalFailure({...request,failures:[{kind:'invalid_response'}]})).toBe(false);
    expect(mayWaitAfterLocalFailure({...request,failures:[{kind:'security'}]})).toBe(false);
    expect(mayWaitAfterLocalFailure({...request,failures:[]})).toBe(false);
    expect(mayWaitAfterLocalFailure({...request,configuredLocalCount:0,failures:[{kind:'timeout'}]})).toBe(false);
    expect(mayWaitAfterLocalFailure({...request,profile:'AUTO',failures:[{kind:'timeout'}]})).toBe(false);
  });
  it('enforces provider locality in the existing router, not in the prompt alone',()=>{
    expect(router).toContain("normalizedProfile==='LOCAL'&&!isLocal(resource)");
  });
});
