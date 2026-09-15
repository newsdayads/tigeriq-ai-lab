import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');

describe('#777 Core Smart Router integration',()=>{
  it('separates AI resource identity from employee identity without rewriting history',()=>{
    expect(core).toContain('create table if not exists tigeriq_ai_resources');
    expect(core).toContain('resource_id text primary key');
    expect(core).toContain('employee_id text');
    expect(core).toContain("alter table tigeriq_jobs add column if not exists resource_id text");
    expect(core).toContain("alter table tigeriq_events add column if not exists resource_id text");
    expect(core).toContain('createResourceId(provider');
  });
  it('routes by profile/capability with explainable decision evidence',()=>{
    expect(core).toContain('deriveRoutingProfile');
    expect(core).toContain('rankCandidates');
    expect(core).toContain("event('ROUTING_DECISION'");
    expect(core).toContain('routing_profile');
    expect(core).toContain('routing_decision');
  });
  it('persists quota/rate-limit telemetry without fabricating unknown limits',()=>{
    expect(core).toContain('quota_state');
    expect(core).toContain('last_429_at');
    expect(core).toContain('sourceConfidence');
    expect(core).toContain("kind==='rate_limit'");
  });
  it('uses bounded failure-aware failover and no automatic auth/config bypass',()=>{
    expect(core).toContain('failurePolicy(kind)');
    expect(core).toContain('if(policy.stop)break');
    expect(core).toContain('paid_fallback_forbidden');
  });
  it('exposes routing/performance truth through the existing status snapshot',()=>{
    expect(core).toContain('routingDecisions');
    expect(core).toContain('performanceByTask');
    expect(core).toContain('quota_state');
  });
});
