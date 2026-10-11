import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Objective routing policy is intentionally a runtime ESM module.
import {normalizeObjectiveRoutingProfile,objectiveJobRoutingProfile} from '../apps/tigeriq-core/objective-local-routing.mjs';
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
    expect(objectiveJobRoutingProfile({routingProfile:'AUTO'})).toBeNull();
    expect(objectiveJobRoutingProfile({})).toBeNull();
    expect(objectiveJobRoutingProfile({routingProfile:'local'})).toBeNull();
  });
  it('carries LOCAL from API to both AI and campaign-evidence job records',()=>{
    expect(src).toContain('profile=normalizeObjectiveRoutingProfile(b.routingProfile)');
    expect(src).toContain("profile==='LOCAL'?{routingProfile:'LOCAL'}");
    expect(src).toMatch(/compiled_campaign.*?\$6,\$7/);
    expect(src).toMatch(/compiled_ai.*?\$6,\$7/);
    expect(src).toContain('objectiveJobRoutingProfile(o.metadata)');
    expect(src).toContain('MANAGER_LOCAL_OBJECTIVE_PC_OPERATOR_DENIED');
  });
  it('enforces provider locality in the existing router, not in the prompt alone',()=>{
    expect(router).toContain("normalizedProfile==='LOCAL'&&!isLocal(resource)");
  });
});
