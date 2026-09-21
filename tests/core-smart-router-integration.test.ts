import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
const router=readFileSync('apps/tigeriq-core/smart-router.mjs','utf8');

describe('#777 Core Smart Router integration',()=>{
  it('separates AI resource identity from employee identity without rewriting historical jobs/events',()=>{expect(core).toContain('create table if not exists tigeriq_ai_resources');expect(core).toContain('resource_id text primary key');expect(core).toContain('employee_id text');expect(core).toContain("alter table tigeriq_jobs add column if not exists resource_id text");expect(core).toContain("alter table tigeriq_events add column if not exists resource_id text");expect(core).toContain("createResourceId(provider,model,'default','core')");expect(core).toContain('RESOURCE_IDENTITY_SUPERSEDED');});
  it('keeps Ollama current identity on NV10 and migrates stale current NV02 rows safely',()=>{expect(core).toContain("const OLLAMA_EMPLOYEE_ID = 'NV10';");expect(core).toContain("R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'");expect(core).not.toContain("R('NV02','Ollama','ollama'");expect(core).not.toContain("employeeId:'NV02',provider:'ollama'");expect(core).toContain("where provider='ollama' and employee_id<>$1");expect(core).toContain('STALE_OLLAMA_IDENTITY_BUSY');expect(core).toContain("event('RESOURCE_IDENTITY_MIGRATED'");});
  it('routes by profile/capability with explainable decision evidence',()=>{expect(core).toContain('deriveRoutingProfile');expect(core).toContain('rankCandidates');expect(core).toContain("event('ROUTING_DECISION'");expect(core).toContain('routing_profile');expect(core).toContain('routing_decision');});
  it('integrates AUTO task profiles and reviewer independence into real job routing',()=>{expect(core).toContain('reviewerResourceIdsForJob');expect(core).toContain("capability<>'review'");expect(core).toContain('reviewerResourceIds:options.reviewerResourceIds||[]');expect(core).toContain('reviewerResourceIds});');expect(router).toContain("normalizedRequested!=='AUTO'");expect(router).toContain('reviewerExclusions');});
  it('persists quota/rate-limit telemetry only from real provider signals or bounded cooldown evidence',()=>{expect(core).toContain('quota_state');expect(core).toContain('last_429_at');expect(core).toContain('syncQuotaFromHeaders');expect(core).toContain('x-ratelimit-limit-requests');expect(core).toContain('x-ratelimit-remaining-tokens');expect(core).toContain("kind==='rate_limit'");expect(core).toContain('rateLimitFailureState(currentQuota,policy.cooldownMs)');expect(core).toContain("select quota_state from tigeriq_ai_resources where resource_id=$1");});
  it('parses compound provider reset durations such as current Groq headers',()=>{const start=core.indexOf('function quotaResetDurationMs');const end=core.indexOf('\nfunction quotaResetAt',start);expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);const fn=new Function(`${core.slice(start,end)}; return quotaResetDurationMs;`)();expect(fn('2m59.56s')).toBeCloseTo(179560,5);expect(fn('7.66s')).toBeCloseTo(7660,5);expect(fn('n/a')).toBeNull();});
  it('uses task-kind performance and bounded failure-aware failover without paid fallback',()=>{expect(core).toContain('avg_latency_ms');expect(core).toContain('failurePolicy(kind)');expect(core).toContain('if(policy.stop)break');expect(router).toContain('paid_fallback_forbidden');expect(router).toContain("'security','credential','paid','production','irreversible'");});
  it('exposes routing/performance truth through the existing status snapshot',()=>{expect(core).toContain('routingDecisions');expect(core).toContain('performanceByTask');expect(core).toContain('quota_state');});
  it('ensures Core remains sole AUTO_UI selector and coordinates NV02/NV03/NV04 routing cleanly without duplicate schedulers',()=>{expect(core).not.toContain('setInterval');});
  it('normalizes Watsonx shapes and retries only valid empty responses',()=>{
    const start=core.indexOf('export function watsonxTextFromBody');
    const end=core.indexOf('\nasync function invokeProvider',start);
    expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    const src=core.slice(start,end).replaceAll('export ','');
    const fn=new Function(`${src}; return {watsonxTextFromBody,hasWatsonxTextShape,watsonxRetryDecision};`)();
    expect(fn.watsonxRetryDecision({choices:[{message:{content:'chat-ok'}}]},0)).toEqual({action:'success',text:'chat-ok'});
    expect(fn.watsonxRetryDecision({choices:[{message:{content:[{type:'text',text:'array-ok'}]}}]},0)).toEqual({action:'success',text:'array-ok'});
    expect(fn.watsonxRetryDecision({results:[{generated_text:'ok'}]},0)).toEqual({action:'success',text:'ok'});
    expect(fn.watsonxRetryDecision({results:[{text:'alt'}]},0)).toEqual({action:'success',text:'alt'});
    expect(fn.watsonxRetryDecision({results:[{generated_text:''}]},0)).toEqual({action:'retry',code:'WATSONX_TRANSIENT_EMPTY'});
    expect(fn.watsonxRetryDecision({results:[{generated_text:''}]},2)).toEqual({action:'fail',code:'EMPTY_RESPONSE'});
    expect(fn.watsonxRetryDecision({unexpected:true},0)).toEqual({action:'fail',code:'WATSONX_SHAPE_MISMATCH'});
    expect(core).toContain("apikey:process.env.WATSONX_API_KEY");
    expect(core).toContain("/ml/v1/text/chat?version=2025-10-25");
    expect(core).toContain("messages:[{role:'user',content:prompt}]");
    expect(core).toContain("max_completion_tokens:1200");
    expect(core).not.toContain("/ml/v1/text/generation?version=2024-05-01");
  });
});
