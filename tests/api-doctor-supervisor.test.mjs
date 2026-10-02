import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {
  API_DOCTOR_CAPABILITY,
  apiDoctorAction,
  apiDoctorCurrentFailure,
  apiDoctorExistingHandoffAction,
  apiDoctorHandoffMatchesFailureClass,
  apiDoctorHealthEvidenceEvents,
  apiDoctorLocalRefreshHealth,
  apiDoctorRepairSignature,
  apiDoctorResourceEligibleForCapability,
  buildApiDoctorPrompt,
  classifyApiDoctorFailure,
  parseApiDoctorDecision,
} from '../apps/tigeriq-core/api-doctor.mjs';
import {deriveRoutingProfile,rankCandidates} from '../apps/tigeriq-core/smart-router.mjs';

describe('#1255 NV10 API Doctor policy',()=>{
  it('classifies quota/payment/contract failures without calling them credential failures',()=>{
    expect(classifyApiDoctorFailure({kind:'rate_limit',message:'HTTP_429'})).toBe('rate_limit');
    expect(classifyApiDoctorFailure({kind:'configuration',message:'HTTP_402'})).toBe('external_blocked');
    expect(classifyApiDoctorFailure({kind:'invalid_response',message:'EMPTY_RESPONSE'})).toBe('source_contract');
    expect(classifyApiDoctorFailure({kind:'auth',message:'HTTP_401'})).toBe('auth');
    expect(classifyApiDoctorFailure({kind:'security',message:'credential change required'})).toBe('hard_blocked');
    expect(classifyApiDoctorFailure({kind:'outage',message:'Production browser-auth action required'})).toBe('hard_blocked');
  });

  it('waits through a live cooldown and probes exactly when it is due',()=>{
    const now=Date.parse('2026-09-21T05:00:00Z');
    expect(apiDoctorAction({
      healthState:'RATE_LIMITED',credentialState:'READY',
      cooldownUntil:'2026-09-21T05:10:00Z',
      latestFailure:{kind:'rate_limit',message:'HTTP_429'},nowMs:now,
    })).toMatchObject({action:'wait',failureClass:'rate_limit'});
    expect(apiDoctorAction({
      healthState:'RATE_LIMITED',credentialState:'READY',
      cooldownUntil:'2026-09-21T04:59:59Z',
      latestFailure:{kind:'rate_limit',message:'HTTP_429'},nowMs:now,
    })).toMatchObject({action:'probe',failureClass:'rate_limit'});
  });

  it('fails closed on HTTP 402 and escalates repeated work-contract failures only after a live probe',()=>{
    expect(apiDoctorAction({
      healthState:'ERROR',credentialState:'READY',
      latestFailure:{kind:'configuration',message:'HTTP_402'},
    })).toMatchObject({action:'external_blocked',failureClass:'external_blocked'});
    expect(apiDoctorAction({
      healthState:'ERROR',credentialState:'READY',
      latestFailure:{kind:'security',message:'Production browser-auth action required'},
    })).toMatchObject({action:'external_blocked',failureClass:'hard_blocked'});

    expect(apiDoctorAction({
      healthState:'ERROR',credentialState:'READY',
      latestFailure:{kind:'invalid_response',message:'EMPTY_RESPONSE'},
      repeatedWorkFailures:2,
    })).toMatchObject({action:'probe_then_handoff',failureClass:'source_contract'});
  });

  it('bounds post-repair validation and respects cooldown before probing again',()=>{
    const now=Date.parse('2026-09-21T07:00:00Z');
    expect(apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:false,cooldownUntil:'2026-09-21T07:10:00Z',validationAttempts:0,nowMs:now,
    })).toEqual({action:'wait_repair',reason:'repair_handoff_cooldown_active'});
    expect(apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:false,cooldownUntil:'2026-09-21T06:59:00Z',validationAttempts:0,nowMs:now,
    })).toEqual({action:'validate_repair',reason:'post_repair_validation_due'});
    expect(apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:false,cooldownUntil:null,validationAttempts:2,nowMs:now,
    })).toEqual({action:'wait_repair',reason:'post_repair_validation_budget_exhausted'});
    expect(apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:true,healthState:'ONLINE',nowMs:now,
    })).toEqual({
      action:'recovered',reason:'live_work_success_after_handoff',
    });
    expect(apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:true,healthState:'ERROR',validationAttempts:0,nowMs:now,
    })).toEqual({action:'validate_repair',reason:'post_repair_validation_due'});
    expect(apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:true,healthState:'RATE_LIMITED',
      cooldownUntil:'2026-09-21T07:10:00Z',validationAttempts:0,nowMs:now,
    })).toEqual({action:'wait_repair',reason:'repair_handoff_cooldown_active'});
    expect(apiDoctorExistingHandoffAction({existingHandoff:false,successAfterHandoff:false,nowMs:now})).toEqual({action:'proceed'});
  });

  it('clears an older failure when newer success/probe evidence exists',()=>{
    const oldFailure={type:'RESOURCE_FAILURE',data:{kind:'rate_limit',message:'HTTP_429'}};
    expect(apiDoctorCurrentFailure([
      {type:'RESOURCE_PROBE_OK',data:{}},
      oldFailure,
    ])).toBeNull();
    expect(apiDoctorCurrentFailure([
      {type:'RESOURCE_SUCCESS',data:{}},
      oldFailure,
    ])).toBeNull();
    expect(apiDoctorCurrentFailure([
      {type:'RESOURCE_PROBE_FAIL',data:{kind:'rate_limit'}},
      {type:'RESOURCE_PROBE_OK',data:{}},
      oldFailure,
    ])).toMatchObject({type:'RESOURCE_PROBE_FAIL'});
  });

  it('ignores manager output-contract failures as resource-health evidence',()=>{
    const managerFailure={type:'RESOURCE_FAILURE',task_kind:'manager',data:{kind:'invalid_response',message:'MANAGER_SCHEMA_INVALID'}};
    const providerFailure={type:'RESOURCE_FAILURE',task_kind:'ai',data:{kind:'invalid_response',message:'EMPTY_RESPONSE'}};
    const rateLimit={type:'RESOURCE_FAILURE',task_kind:'manager',data:{kind:'rate_limit',message:'HTTP_429'}};
    expect(apiDoctorHealthEvidenceEvents([managerFailure,providerFailure])).toEqual([providerFailure]);
    expect(apiDoctorHealthEvidenceEvents([rateLimit])).toEqual([rateLimit]);
    expect(apiDoctorCurrentFailure(apiDoctorHealthEvidenceEvents([managerFailure]))).toBeNull();
  });

  it('does not let an old source-contract handoff suppress a newer expired rate-limit reprobe',()=>{
    const oldHandoff={data:{failureClass:'source_contract',signature:'NV11|groq|source_contract|invalid_response'}};
    expect(apiDoctorHandoffMatchesFailureClass(oldHandoff,'rate_limit')).toBe(false);
    expect(apiDoctorHandoffMatchesFailureClass(oldHandoff,'source_contract')).toBe(true);
    expect(apiDoctorHandoffMatchesFailureClass({data:{}},'rate_limit')).toBe(false);
  });

  it('uses a stable dedupe signature for the same provider/failure class',()=>{
    const a=apiDoctorRepairSignature({employeeId:'NV18',provider:'watsonx',failureClass:'source_contract',message:'EMPTY_RESPONSE attempt 12'});
    const b=apiDoctorRepairSignature({employeeId:'NV18',provider:'watsonx',failureClass:'source_contract',message:'EMPTY_RESPONSE attempt 77'});
    expect(a).toBe(b);
  });

  it('builds a compact strict NV10 prompt and parses the bounded response',()=>{
    const prompt=buildApiDoctorPrompt([{employeeId:'NV18',provider:'watsonx',health:'ERROR',failureClass:'source_contract',action:'probe_then_handoff'}]);
    expect(prompt).toContain('NV10');
    expect(prompt).toContain('Return ONLY one compact JSON object');
    expect(prompt).toContain('Do not suggest paid upgrades');
    expect(parseApiDoctorDecision('{"summary":"x","attention":["NV18"],"sourceRepair":["NV18"]}')).toEqual({
      summary:'x',attention:['NV18'],sourceRepair:['NV18'],
    });
  });

  it('keeps NV10 liveness separate from functional readiness',()=>{
    const now=Date.parse('2026-10-02T02:00:00Z');
    expect(apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:'ONLINE',latestFunctionalEvent:null,nowMs:now,
    })).toBe('READY');
    expect(apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:'ERROR',cooldownUntil:'2026-10-02T02:05:00Z',
      latestFunctionalEvent:'RESOURCE_FAILURE',nowMs:now,
    })).toBe('ERROR');
    expect(apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:'ERROR',cooldownUntil:'2026-10-02T01:59:00Z',
      latestFunctionalEvent:'RESOURCE_FAILURE',nowMs:now,
    })).toBe('READY');
    expect(apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:'READY',latestFunctionalEvent:'RESOURCE_SUCCESS',nowMs:now,
    })).toBe('ONLINE');
    expect(apiDoctorLocalRefreshHealth({
      modelAvailable:false,currentHealth:'ONLINE',latestFunctionalEvent:'RESOURCE_SUCCESS',nowMs:now,
    })).toBe('OFFLINE');
  });

  it('classifies malformed API Doctor output as invalid_response rather than provider outage',()=>{
    try {
      parseApiDoctorDecision('not-json');
      throw new Error('expected parse failure');
    } catch (error) {
      expect(error.message).toBe('API_DOCTOR_JSON_MISSING');
      expect(error.kind).toBe('invalid_response');
    }
  });

  it('keeps READY NV10 api_doctor-only until a functional success restores ONLINE',()=>{
    const ready=apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:'ERROR',cooldownUntil:'2026-10-02T01:59:00Z',
      latestFunctionalEvent:'RESOURCE_FAILURE',nowMs:Date.parse('2026-10-02T02:00:00Z'),
    });
    expect(ready).toBe('READY');
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:ready,capability:'api_doctor'})).toBe(true);
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:ready,capability:'general'})).toBe(false);
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:ready,capability:'review'})).toBe(false);

    const online=apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:ready,latestFunctionalEvent:'RESOURCE_SUCCESS',
    });
    expect(online).toBe('ONLINE');
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:online,capability:'general'})).toBe(true);
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV12',healthState:'READY',capability:'general'})).toBe(true);
  });

  it('bounds API Doctor repair scheduling without blocking a healthy peer worker',()=>{
    const now=Date.parse('2026-10-02T02:00:00Z');
    const doctorPlan=apiDoctorExistingHandoffAction({
      existingHandoff:true,successAfterHandoff:false,healthState:'ERROR',
      cooldownUntil:null,validationAttempts:2,maxValidationAttempts:2,nowMs:now,
    });
    expect(doctorPlan).toEqual({action:'wait_repair',reason:'post_repair_validation_budget_exhausted'});

    const resources=[
      {employeeId:'NV11',resourceId:'res:groq:x',provider:'groq',model:'x',enabled:true,healthState:'ERROR',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning'],rank:1},
      {employeeId:'NV12',resourceId:'res:gemini:x',provider:'gemini',model:'x',enabled:true,healthState:'ONLINE',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning'],rank:2},
    ].filter(r=>['READY','ONLINE'].includes(String(r.healthState||'').toUpperCase()));
    const decision=rankCandidates(resources,{capability:'general',taskKind:'ai'});
    expect(decision.chosen?.employeeId).toBe('NV12');
  });
});

describe('#1255 routing/runtime integration',()=>{
  it('routes api_doctor exclusively to an explicitly-capable local NV10 resource',()=>{
    const resources=[
      {employeeId:'NV10',resourceId:'res:ollama:qwen3',provider:'ollama',model:'qwen3:4b',enabled:true,healthState:'ONLINE',zeroOutOfPocket:true,costTier:'LOCAL',capabilities:['general','reasoning','review',API_DOCTOR_CAPABILITY],rank:90},
      {employeeId:'NV11',resourceId:'res:groq:x',provider:'groq',model:'x',enabled:true,healthState:'ONLINE',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning','review'],rank:1},
    ];
    expect(deriveRoutingProfile({capability:'api_doctor',taskKind:'api_doctor'})).toBe('LOCAL');
    const decision=rankCandidates(resources,{capability:'api_doctor',taskKind:'api_doctor'});
    expect(decision.chosen?.employeeId).toBe('NV10');
    expect(decision.candidates.find(x=>x.employeeId==='NV11')?.eligible).toBe(false);
  });

  it('keeps routing through a healthy worker when peer API resources are degraded',()=>{
    const resources=[
      {employeeId:'NV11',resourceId:'res:groq:x',provider:'groq',model:'x',enabled:true,healthState:'ERROR',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning'],rank:1},
      {employeeId:'NV12',resourceId:'res:gemini:x',provider:'gemini',model:'x',enabled:true,healthState:'ONLINE',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning'],rank:2},
      {employeeId:'NV14',resourceId:'res:mistral:x',provider:'mistral',model:'x',enabled:true,healthState:'RATE_LIMITED',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning'],rank:3},
      {employeeId:'NV18',resourceId:'res:watsonx:x',provider:'watsonx',model:'x',enabled:true,healthState:'OFFLINE',zeroOutOfPocket:true,costTier:'FREE',capabilities:['general','reasoning'],rank:4},
    ];
    const routable=resources.filter(r=>['READY','ONLINE'].includes(String(r.healthState||'').toUpperCase()));
    const decision=rankCandidates(routable,{capability:'general',taskKind:'ai'});
    expect(decision.chosen?.employeeId).toBe('NV12');
    expect(decision.candidates.map(x=>x.employeeId)).toEqual(['NV12']);
  });

  it('wires the autonomous scan, low-token think=false NV10 job, durable handoff and telemetry',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain("nv10Resource.capabilities = ['general','reasoning','review',API_DOCTOR_CAPABILITY]");
    expect(core).toContain('apiDoctorLocalRefreshHealth({');
    expect(core).toContain("type in ('RESOURCE_SUCCESS','RESOURCE_FAILURE')");
    expect(core).toContain("coalesce(task_kind,'')<>'probe'");
    expect(core).toContain('apiDoctorResourceEligibleForCapability({employeeId:x.employee_id,healthState:x.health_state,capability})');
    expect(core).toContain("let candidates=q.rows");
    expect(core).toContain(".filter(x=>apiDoctorResourceEligibleForCapability({employeeId:x.employee_id,healthState:x.health_state,capability}))");
    expect(core).toContain("if(!r||!apiDoctorResourceEligibleForCapability({employeeId:r.employee_id,healthState:r.health_state,capability}))");
    expect(core).toContain('async function runApiDoctorScan()');
    expect(core).toContain("const CODING_LANE_HOST = process.env.TIGERIQ_CODING_HOST?.trim() || HOST;");
    expect(core).toContain("think:false");
    expect(core).toContain('num_predict:160');
    expect(core).toContain("API_DOCTOR_REPAIR_HANDOFF");
    expect(core).toContain("API_DOCTOR_EXTERNAL_BLOCKED");
    expect(core).toContain("API_DOCTOR_RECOVERED");
    expect(core).toContain("row.action='wait_repair'");
    expect(core).toContain("apiDoctorLatestResourceHandoff(resourceId)");
    expect(core).toContain("apiDoctorLatestUnresolvedResourceHandoff(resource.resource_id)");
    expect(core).toContain("apiDoctorCurrentFailure(events)");
    expect(core).toContain("apiDoctorHandoffMatchesFailureClass(handoffCandidate,plan.failureClass)");
    expect(core).toContain("row.handoff='ignored_stale_failure_class'");
    expect(core.indexOf("if(handoffPlan.action==='recovered')")).toBeLessThan(core.indexOf("const existingHandoff=apiDoctorHandoffMatchesFailureClass"));
    expect(core).toContain("evidence:'stale_failure_class_reprobe_success'");
    expect(core).toContain("row.staleHandoffRetired=true");
    expect(core).toContain("healthState:resource.health_state");
    expect(core).toContain("type='API_DOCTOR_RECOVERED' and resource_id=$1 and ts>$2");
    expect(core).toContain("return recovered?null:handoff");
    expect(core).toContain("apiDoctorLatestUnresolvedSignatureHandoff(resource.resource_id,signature)");
    expect(core).toContain("type='API_DOCTOR_REPAIR_HANDOFF' and resource_id=$1 and data->>'signature'=$2");
    expect(core).toContain("type='API_DOCTOR_RECOVERED' and resource_id=$1 and ts>$2 and data->>'signature'=$3");
    expect(core).not.toContain("apiDoctorEventBySignature('API_DOCTOR_REPAIR_HANDOFF',signature)");

    expect(core.indexOf("apiDoctorLatestUnresolvedResourceHandoff(resource.resource_id)")).toBeLessThan(core.indexOf("if(plan.action==='wait'||plan.action==='idle')"));
    expect(core).toContain("coalesce(task_kind,'')<>'api_doctor'");
    expect(core).toContain("taskKind:'api_doctor_validation'");
    expect(core).toContain("API_DOCTOR_POST_REPAIR_VALIDATION");
    expect(core).toContain("maxValidationAttempts:2");
    expect(core).toContain("post_repair_live_validation_job");
    expect(core).toContain("API_DOCTOR_VALIDATION_POLICY_VERSION = 'nonempty-v2'");
    expect(core).toContain("data->>'policyVersion'=$3");
    expect(core).toContain("Provide one short useful sentence confirming this provider can complete a normal TigerIQ Core reasoning request.");
    expect(core).toContain("API_DOCTOR_VALIDATION_EMPTY_RESPONSE");
    expect(core).not.toContain("API_DOCTOR_VALIDATION_UNEXPECTED_RESPONSE");
    expect(core).toContain('apiDoctor:await apiDoctorTelemetry()');
    expect(core).toContain("failure=jsonb_build_object('message','RESTART_RECONCILIATION_FAIL_CLOSED')");
    expect(core).toContain("legacy_nv10_unavailable_reclassified");
    expect(core).toContain("e.type='API_DOCTOR_ANALYSIS_SKIPPED' and e.data->>'reason'='nv10_unavailable'");
    expect(core).not.toContain("error_message='RESTART_RECONCILIATION_FAIL_CLOSED'");
    expect(core).toContain("API_DOCTOR_STALE_JOB_RECOVERED");
    expect(core).toContain("kind='api_doctor' and started_at < now()-interval '2 minutes'");
    expect(core).toContain("data->>'reason'='nv10_unavailable'");
    expect(core).toContain("skipped:'deduped_nv10_unavailable'");
    expect(core).toContain("status='done',result=$2,lease_until=null,completed_at=now()");
    expect(core).toContain("now()+interval '2 minutes',0,1");
    expect(core).toContain("set employee_id=$2,resource_id=$3,provider=$4,routing_profile='LOCAL',lease_until=now()+interval '2 minutes'");
    expect(core).not.toContain("retryDue=['READY','ERROR','RATE_LIMITED','OFFLINE']");
  });
});
