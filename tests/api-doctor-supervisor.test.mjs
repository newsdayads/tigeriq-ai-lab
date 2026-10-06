import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {
  API_DOCTOR_CAPABILITY,
  apiDoctorAction,
  apiDoctorCurrentFailure,
  apiDoctorExistingHandoffAction,
  apiDoctorFreshRecurrence,
  apiDoctorHandoffMatchesFailureClass,
  apiDoctorHealthEvidenceEvents,
  apiDoctorLocalRefreshHealth,
  apiDoctorRepairDeploymentGate,
  apiDoctorRepairLifecycleRelevant,
  apiDoctorRepairSignature,
  apiDoctorRepairWorkOrderGate,
  apiDoctorResourceEligibleForCapability,
  buildApiDoctorPrompt,
  buildApiDoctorRepairWorkOrder,
  classifyApiDoctorFailure,
  parseApiDoctorDecision,
} from '../apps/tigeriq-core/api-doctor.mjs';
import {deriveRoutingProfile,rankCandidates} from '../apps/tigeriq-core/smart-router.mjs';
import {parseCodingIssue} from '../apps/tigeriq-core/github-coding-intake.mjs';
import {nv02EligibleWorkOrder} from '../apps/tigeriq-core/nv02-local-self-pull.mjs';

describe('#1255 NV10 API Doctor policy',()=>{
  it('keeps the NV09 canary marker contract even when a caller supplies diagnostic text',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const start=core.indexOf('function buildNv09CanaryPrompt');
    expect(start).toBeGreaterThanOrEqual(0);
    const open=core.indexOf('{',start);
    let depth=0,end=-1;
    for(let i=open;i<core.length;i++){
      if(core[i]==='{')depth++;
      else if(core[i]==='}'&&--depth===0){end=i+1;break;}
    }
    expect(end).toBeGreaterThan(open);
    const factory=new Function(`${core.slice(start,end)}\nreturn buildNv09CanaryPrompt;`);
    const buildNv09CanaryPrompt=factory();
    const marker='NV09_CORE_CANARY_OK';
    const prompt=buildNv09CanaryPrompt('Explain why 2 + 3 equals 5.',marker);
    expect(prompt).toContain('Diagnostic context only');
    expect(prompt).toContain('Explain why 2 + 3 equals 5.');
    expect(prompt.trim().endsWith(`CANARY OUTPUT CONTRACT: return exactly ${marker} and nothing else.`)).toBe(true);
  });

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


  it('creates one stable fresh-recurrence generation after a terminal repair cutover',()=>{
    const base='NV15|cloudflare|source_contract|empty_response';
    const a=apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',
      currentFailureAt:'2026-10-05T01:10:00Z',
      terminalAt:'2026-10-05T01:00:00Z',
      currentSignature:base,
      priorSignature:base,
    });
    const b=apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',
      currentFailureAt:'2026-10-05T01:20:00Z',
      terminalAt:'2026-10-05T01:00:00Z',
      currentSignature:base,
      priorSignature:base,
    });
    expect(a.fresh).toBe(true);
    expect(a.sameSignature).toBe(true);
    expect(a.signature).toBe(b.signature);
    expect(a.signature).toBe(`${base}|recurrence_after:2026-10-05T01:00:00.000Z`);
  });

  it('does not call pre-cutover/equal-cutover or rate-limit evidence a fresh recurrence',()=>{
    const base='NV15|cloudflare|source_contract|empty_response';
    expect(apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',currentFailureAt:'2026-10-05T01:00:00Z',
      terminalAt:'2026-10-05T01:00:00Z',currentSignature:base,priorSignature:base,
    }).fresh).toBe(false);
    expect(apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',currentFailureAt:'2026-10-05T00:59:59Z',
      terminalAt:'2026-10-05T01:00:00Z',currentSignature:base,priorSignature:base,
    }).fresh).toBe(false);
    expect(apiDoctorFreshRecurrence({
      currentFailureClass:'rate_limit',currentFailureAt:'2026-10-05T01:10:00Z',
      terminalAt:'2026-10-05T01:00:00Z',currentSignature:'rate-limit',priorSignature:base,
    }).fresh).toBe(false);
    expect(apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',currentFailureAt:'2026-10-05T01:10:00Z',
      terminalAt:null,currentSignature:base,priorSignature:base,
    }).fresh).toBe(false);
  });

  it('changes recurrence generation only after a newer terminal repair cutover',()=>{
    const base='NV15|cloudflare|source_contract|empty_response';
    const first=apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',currentFailureAt:'2026-10-05T01:10:00Z',
      terminalAt:'2026-10-05T01:00:00Z',currentSignature:base,priorSignature:base,
    });
    const second=apiDoctorFreshRecurrence({
      currentFailureClass:'source_contract',currentFailureAt:'2026-10-05T02:10:00Z',
      terminalAt:'2026-10-05T02:00:00Z',currentSignature:base,priorSignature:first.signature,
    });
    expect(second.fresh).toBe(true);
    expect(second.signature).not.toBe(first.signature);
  });

  it('gates canonical repair lifecycle on completed repair Work Order',()=>{
    expect(apiDoctorRepairWorkOrderGate({issueNumber:9901,state:'open',stateReason:null})).toEqual({
      action:'wait_repair',reason:'canonical_repair_work_order_open',
    });
    expect(apiDoctorRepairWorkOrderGate({issueNumber:9901,state:'closed',stateReason:'completed'})).toEqual({
      action:'validate_repair',reason:'canonical_repair_work_order_completed',
    });
    expect(apiDoctorRepairWorkOrderGate({issueNumber:9901,state:'closed',stateReason:'not_planned'})).toEqual({
      action:'wait_repair',reason:'canonical_repair_work_order_not_completed',
    });
  });

  it('keeps canonical and legacy source repair lifecycle active after a healthy reprobe',()=>{
    expect(apiDoctorRepairLifecycleRelevant({
      hasHandoff:true,repairIssueNumber:9901,handoffFailureClass:'source_contract',
      currentFailureClass:'unknown',currentAction:'idle',
    })).toBe(true);
    expect(apiDoctorRepairLifecycleRelevant({
      hasHandoff:true,repairIssueNumber:0,handoffFailureClass:'source_contract',
      currentFailureClass:'unknown',currentAction:'idle',
    })).toBe(true);
    expect(apiDoctorRepairLifecycleRelevant({
      hasHandoff:true,repairIssueNumber:9901,handoffFailureClass:'source_contract',
      currentFailureClass:'rate_limit',currentAction:'wait',
    })).toBe(false);
    expect(apiDoctorRepairLifecycleRelevant({
      hasHandoff:true,repairIssueNumber:9901,handoffFailureClass:'source_contract',
      currentFailureClass:'source_contract',currentAction:'probe_then_handoff',freshRecurrence:true,
    })).toBe(false);
  });

  it('fails closed until updater terminal evidence proves the repair runtime is installed',()=>{
    const closedAt='2026-10-02T07:00:00Z';
    const sha='a'.repeat(40);
    expect(apiDoctorRepairDeploymentGate({
      issueNumber:9901,state:'closed',stateReason:'completed',issueClosedAt:closedAt,
      runtimeCurrentSha:sha,runtimeInstalledSha:'b'.repeat(40),runtimeUpdatedAt:'2026-10-02T07:01:00Z',
      updaterResult:'UPDATED',
    })).toEqual({action:'wait_repair',reason:'canonical_repair_runtime_source_not_aligned'});
    expect(apiDoctorRepairDeploymentGate({
      issueNumber:9901,state:'closed',stateReason:'completed',issueClosedAt:closedAt,
      runtimeCurrentSha:sha,runtimeInstalledSha:sha,runtimeUpdatedAt:'2026-10-02T07:01:00Z',
      updaterResult:'FAILED',
    })).toEqual({action:'wait_repair',reason:'canonical_repair_runtime_updater_not_terminal'});
    expect(apiDoctorRepairDeploymentGate({
      issueNumber:9901,state:'closed',stateReason:'completed',issueClosedAt:closedAt,
      runtimeCurrentSha:sha,runtimeInstalledSha:sha,runtimeUpdatedAt:'2026-10-02T06:59:59Z',
      updaterResult:'UPDATED',
    })).toEqual({action:'wait_repair',reason:'canonical_repair_runtime_not_applied_after_completion'});
    expect(apiDoctorRepairDeploymentGate({
      issueNumber:9901,state:'closed',stateReason:'completed',issueClosedAt:closedAt,
      runtimeCurrentSha:sha,runtimeInstalledSha:sha,runtimeUpdatedAt:'2026-10-02T07:01:00Z',
      updaterResult:'NO_CHANGE',updaterCandidateSha:'b'.repeat(40),
    })).toEqual({action:'wait_repair',reason:'canonical_repair_runtime_candidate_not_installed'});
    expect(apiDoctorRepairDeploymentGate({
      issueNumber:9901,state:'closed',stateReason:'completed',issueClosedAt:closedAt,
      runtimeCurrentSha:sha,runtimeInstalledSha:sha,runtimeUpdatedAt:'2026-10-02T07:01:00Z',
      updaterResult:'UPDATED',updaterCandidateSha:sha,
    })).toEqual({action:'validate_repair',reason:'canonical_repair_runtime_applied'});
  });

  it('builds a canonical P1 delegated repair Work Order accepted by protected-path coding intake',()=>{
    const signature=apiDoctorRepairSignature({
      employeeId:'NV15',provider:'cloudflare',failureClass:'source_contract',message:'EMPTY_RESPONSE attempt 12',
    });
    const spec=buildApiDoctorRepairWorkOrder({
      employeeId:'NV15',
      provider:'cloudflare',
      resourceId:'res:cloudflare:test',
      failureClass:'source_contract',
      message:'EMPTY_RESPONSE attempt 12',
      signature,
    });
    expect(spec.priority).toBe('P1');
    expect(spec.body).toContain('PRIORITY=P1');
    expect(spec.body).not.toContain('PRIORITY=P0');
    expect(spec.body).toContain('OWNER_PROXY=NV02');
    expect(spec.body).toContain('AUTO_CONTROL_REPAIR=true');
    expect(spec.body).toContain('INDEPENDENT_REPAIR_REQUIRED=true');
    expect(spec.body).toContain('ACTIVE_EXECUTION=true');
    expect(spec.body).toContain('CANONICAL_SPEC=#1255');
    expect(spec.body).toContain('MUTATION_OWNER=CORE_DYNAMIC_LEASE');
    expect(spec.body).toContain('ALLOW_PATH_PREFIX=apps/tigeriq-core/core.mjs,tests/api-doctor-supervisor.test.mjs');
    expect(spec.body).toContain('RECOVERED requires a later normal Core work success');
    const parsed=parseCodingIssue({
      number:9901,
      title:spec.title,
      body:spec.body,
      state:'open',
      html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/9901',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.priority).toBe('P1');
    expect(parsed?.controlRepair?.delegated).toBe(true);
    expect(parsed?.scopeLease?.paths).toContain('apps/tigeriq-core/core.mjs');
    expect(nv02EligibleWorkOrder({
      number:9901,title:spec.title,body:spec.body,state:'open',
    })).toMatchObject({eligible:false,reason:'INDEPENDENT_CODING_LANE_RESERVED'});
  });

  it('refuses to build source repair work for non-source external or rate-limit classes',()=>{
    for(const failureClass of ['rate_limit','auth','external_blocked','configuration','hard_blocked']){
      expect(()=>buildApiDoctorRepairWorkOrder({
        employeeId:'NV16',provider:'huggingface',failureClass,message:'external gate',
      })).toThrow('API_DOCTOR_REPAIR_WORK_ORDER_INVALID');
    }
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

  it('allows READY NV10 into bounded functional reprobe for general Core work',()=>{
    const ready=apiDoctorLocalRefreshHealth({
      modelAvailable:true,currentHealth:'ERROR',cooldownUntil:'2026-10-02T01:59:00Z',
      latestFunctionalEvent:'RESOURCE_FAILURE',nowMs:Date.parse('2026-10-02T02:00:00Z'),
    });
    expect(ready).toBe('READY');
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:ready,capability:'api_doctor'})).toBe(true);
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:ready,capability:'general'})).toBe(true);
    expect(apiDoctorResourceEligibleForCapability({employeeId:'NV10',healthState:ready,capability:'review'})).toBe(true);

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

  it('does not let an empty Watsonx chat field mask later valid response text',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const extractFunction=(name)=>{
      const start=core.indexOf(`function ${name}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const open=core.indexOf('{',start);
      let depth=0,end=-1;
      for(let i=open;i<core.length;i++){
        if(core[i]==='{')depth++;
        else if(core[i]==='}'&&--depth===0){end=i+1;break;}
      }
      expect(end).toBeGreaterThan(open);
      return core.slice(start,end);
    };
    const factory=new Function(
      `${extractFunction('watsonxTextFromBody')}\n${extractFunction('hasWatsonxTextShape')}\n${extractFunction('watsonxRetryDecision')}\nreturn {watsonxTextFromBody,watsonxRetryDecision};`,
    );
    const {watsonxTextFromBody,watsonxRetryDecision}=factory();

    const fallbackBody={choices:[{message:{content:''},text:'usable fallback'}]};
    expect(watsonxTextFromBody(fallbackBody)).toBe('usable fallback');
    expect(watsonxRetryDecision(fallbackBody,0,2)).toEqual({action:'success',text:'usable fallback'});

    const emptyBody={choices:[{message:{content:''},text:''}]};
    expect(watsonxRetryDecision(emptyBody,0,2)).toEqual({action:'retry',code:'WATSONX_TRANSIENT_EMPTY'});
    expect(watsonxRetryDecision(emptyBody,2,2)).toEqual({action:'fail',code:'EMPTY_RESPONSE'});
    expect(watsonxRetryDecision({unexpected:true},0,2)).toEqual({action:'fail',code:'WATSONX_SHAPE_MISMATCH'});
  });

  it('executes the Cloudflare manager JSON helper behavior and verifies provider wiring',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const extractFunction=(name)=>{
      const start=core.indexOf(`function ${name}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const open=core.indexOf('{',start);
      let depth=0,end=-1;
      for(let i=open;i<core.length;i++){
        if(core[i]==='{')depth++;
        else if(core[i]==='}'&&--depth===0){end=i+1;break;}
      }
      expect(end).toBeGreaterThan(open);
      return core.slice(start,end);
    };
    const schema={type:'object',required:['status','summary','jobs']};
    const factory=new Function(
      'isManagerPrompt','GEMINI_MANAGER_RESPONSE_SCHEMA',
      `${extractFunction('cloudflareRequestBody')}\n${extractFunction('cloudflareResponseText')}\nreturn {cloudflareRequestBody,cloudflareResponseText};`,
    );
    const {cloudflareRequestBody,cloudflareResponseText}=factory(
      prompt=>String(prompt||'').trimStart().startsWith('You are TigerIQ AI Manager.'),
      schema,
    );

    const managerPrompt='You are TigerIQ AI Manager. Return one decision.';
    expect(cloudflareRequestBody(managerPrompt)).toEqual({
      prompt:managerPrompt,
      temperature:0,
      response_format:{type:'json_schema',json_schema:schema},
    });
    const ordinaryPrompt='Summarize this bounded task.';
    expect(cloudflareRequestBody(ordinaryPrompt)).toEqual({prompt:ordinaryPrompt,temperature:0});
    expect(cloudflareRequestBody(ordinaryPrompt)).not.toHaveProperty('response_format');
    const structured={status:'continue',summary:'ok',jobs:[]};
    expect(cloudflareResponseText(structured)).toBe(JSON.stringify(structured));
    expect(cloudflareResponseText('raw provider text')).toBe('raw provider text');

    expect(core).toContain("body:JSON.stringify(cloudflareRequestBody(prompt))");
    expect(core).toContain("const text = cloudflareResponseText(b?.result?.response)");
  });

  it('constrains Gemini manager output to the strict Core manager schema',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain('const GEMINI_MANAGER_RESPONSE_SCHEMA={');
    expect(core).toContain("required:['status','summary','jobs']");
    expect(core).toContain("required:['title','prompt']");
    expect(core).toContain("responseJsonSchema:GEMINI_MANAGER_RESPONSE_SCHEMA");
    expect(core).toContain("temperature:0");
    expect(core).toContain("managerGenerationConfig?{generationConfig:managerGenerationConfig}:{}");
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
    expect(core).toContain("!apiDoctorResourceEligibleForCapability({employeeId:row.employee_id,healthState:row.health_state,capability})||!functionalRoutingReadiness(freshResource,{requireEvidence:true}).ready");
    expect(core).toContain('async function runApiDoctorScan()');
    expect(core).toContain("const CODING_LANE_HOST = process.env.TIGERIQ_CODING_HOST?.trim() || HOST;");
    expect(core).toContain("think:false");
    expect(core).toContain('num_predict:160');
    expect(core).toContain("API_DOCTOR_REPAIR_HANDOFF");
    expect(core).toContain("apiDoctorOpenRepairIssueBySignature");
    expect(core).toContain("githubCreateApiDoctorRepairIssue");
    expect(core).toContain("repairIssueNumber");
    expect(core).toContain("priority:'P1'");
    expect(core).toContain("lifecycle:'github_work_order'");
    expect(core).not.toContain("body:JSON.stringify({objective,priority:'P0'})");
    expect(core).toContain("API_DOCTOR_EXTERNAL_BLOCKED");
    expect(core).toContain("API_DOCTOR_RECOVERED");
    expect(core).toContain("const analysisCandidates=degraded.filter(x=>!['wait','wait_repair','busy_skip','external_blocked'].includes(x.action))");
    expect(core).toContain("degraded.length?'no_actionable_degraded':'no_degraded'");
    expect(core).toContain("actionableDegradedCount:analysisCandidates.length");
    expect(core).toContain("row.action='wait_repair'");
    expect(core).toContain("apiDoctorLatestResourceHandoff(resourceId)");
    expect(core).toContain("apiDoctorLatestUnresolvedResourceHandoff(resource.resource_id)");
    expect(core).toContain("apiDoctorCurrentFailure(events)");
    expect(core).toContain("apiDoctorHandoffMatchesFailureClass(handoffCandidate,plan.failureClass)");
    expect(core).toContain("row.handoff=canonicalRepairIssueNumber>0?'deferred_for_current_failure_class':'ignored_stale_failure_class'");
    expect(core.indexOf("if(handoffPlan.action==='recovered')")).toBeLessThan(core.indexOf("const existingHandoff=freshRecurrence?.fresh?null:("));
    expect(core).not.toContain("evidence:'stale_failure_class_reprobe_success'");
    expect(core).toContain("row.staleHandoffProbe='ok_wait_repair_lifecycle'");
    expect(core).toContain("healthState:resource.health_state");
    expect(core).toContain("data->>'evidence'='live_work_success_after_repair_deploy'");
    expect(core).toContain("const deployedAt=String(runtimeSourceState?.updatedAt||'').trim()");
    expect(core).not.toContain("const deployedAt=String(updaterState?.updatedAt||'').trim()");
    expect(core).toContain("return recovered?null:handoff");
    expect(core).toContain("apiDoctorLatestUnresolvedSignatureHandoff(resource.resource_id,signature)");
    expect(core).toContain("type='API_DOCTOR_REPAIR_HANDOFF' and resource_id=$1 and data->>'signature'=$2");
    expect(core).toContain("type='API_DOCTOR_RECOVERED' and resource_id=$1 and ts>$2 and data->>'signature'=$3 and data->>'evidence'='live_work_success_after_repair_deploy'");
    expect(core).not.toContain("apiDoctorEventBySignature('API_DOCTOR_REPAIR_HANDOFF',signature)");

    expect(core.indexOf("apiDoctorLatestUnresolvedResourceHandoff(resource.resource_id)")).toBeLessThan(core.indexOf("if(plan.action==='wait'||plan.action==='idle')"));
    expect(core).toContain("coalesce(task_kind,'') not in ('probe','api_doctor','api_doctor_validation')");
    expect(core).toContain("apiDoctorRepairLifecycleEvidence(handoffCandidate)");
    expect(core).toContain("apiDoctorRepairLifecycleRelevant({");
    expect(core).toContain("apiDoctorFreshRecurrence({");
    expect(core).toContain("freshRecurrence?.fresh?{signatureOverride:freshRecurrence.signature}:{}");
    expect(core).toContain("legacy_handoff_migrated_to_canonical_p1");
    expect(core).toContain("signatureOverride:existingHandoff.data?.signature||''");
    expect(core).toContain("prior&&Number(prior.data?.repairIssueNumber||0)>0");
    expect(core).toContain("GITHUB_CODING_RESULT_REPORTED");
    expect(core).toContain("from tigeriq_coding_jobs where objective_id=$1 and status='completed'");
    expect(core).toContain("apiDoctorOwnerProxyRepairPrEvidence");
    expect(core).toContain("ALLOW_PATH_PREFIX=");
    expect(core).toContain("/timeline?per_page=100");
    expect(core).toContain("/files?per_page=100");
    expect(core).toContain("[TIGERIQ_INDEPENDENT_REVIEW_V1]");
    expect(core).toContain("REVIEW=(?:PASS|ĐẠT)");
    expect(core).toContain("TIGERIQ_CORE_UI_TERMINAL_V1");
    expect(core).toContain("REVIEW_INDEPENDENT=true");
    expect(core).toContain("TARGET_PR=#${prNumber}");
    expect(core).toContain("worker&&worker!==ownerProxy");
    expect(core).toContain("owner_proxy_cross_reference");
    expect(core).toContain("files.length>=100");
    expect(core).toContain("repairEvidenceSource=fallback.evidenceSource");
    expect(core).toContain("/compare/${repairRevision}...${deployedRevision}");
    expect(core).toContain("const deployedRevision=apiDoctorSha(updaterState?.installedSha)");
    expect(core).toContain("apiDoctorRepairDeploymentGate({");
    expect(core).toContain("updaterResult:updaterState?.result||''");
    expect(core).toContain("updaterCandidateSha:updaterState?.candidateSha||''");
    expect(core).toContain("successAfterAt:new Date(cutoverMs).toISOString()");
    expect(core).toContain("evidence:'live_work_success_after_repair_deploy'");
    expect(core).toContain("normalWorkSuccessAt:successAfter?.ts||null");
    expect(core).toContain("page=${page}");
    expect(core).toContain("if(issues.length<100)return null");
    expect(core).toContain("taskKind:'api_doctor_validation'");
    expect(core).toContain("API_DOCTOR_POST_REPAIR_VALIDATION");
    expect(core).toContain("maxValidationAttempts:2");
    expect(core).toContain("validation_pass_wait_normal_work");
    expect(core).not.toContain("evidence:'post_repair_live_validation_job'");
    expect(core).toContain("API_DOCTOR_VALIDATION_POLICY_VERSION = 'nonempty-v2'");
    expect(core).toContain("data->>'policyVersion'=$3");
    expect(core).toContain("min(ts) as first_at,max(ts) as last_at");
    expect(core).toContain("issue_durable_terminal_evidence");
    expect(core).toContain("SOURCE_FIX_REUSED");
    expect(core).toContain("DURABLE_TERMINAL_NORMAL_WORK");
    expect(core).toContain("repair_issue_terminal_normal_work_recovery");
    expect(core).toContain("const repairTerminalAt=validationEvidence.firstAt||lifecycle.successAfterAt||null");
    expect(core).toContain("terminalAt:repairTerminalAt");
    expect(core).toContain("const recoveryAfterAt=repairTerminalAt");
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
    expect(core).toContain('function shrinkGroq413Prompt(prompt)');
    expect(core).toContain('let groq413RetryUsed=false');
    expect(core).toContain("host==='api.groq.com'&&!groq413RetryUsed&&Number(error?.status)===413");
    expect(core).toContain('if(shrunk!==requestPrompt){requestPrompt=shrunk;groq413RetryUsed=true;continue;}');
    expect((core.match(/Number\(error\?\.status\)===413/g)||[]).length).toBe(1);
    expect(core).not.toContain("Number(error?.status)>=400");
    expect(core).toContain("host==='openrouter.ai'?{reasoning:{enabled:false}}:{}");
    expect(core.split('reasoning:{enabled:false}').length-1).toBe(1);
    expect(core).toContain("if(host==='api.groq.com'&&isManagerPrompt(prompt))requestBody.reasoning_format='hidden';");
    expect(core.split("requestBody.reasoning_format='hidden'").length-1).toBe(1);
    expect(core).toContain('const rankedClaimCandidates=[decision.chosen,...(Array.isArray(decision.candidates)?decision.candidates:[])]');
    expect(core).toContain('.filter(item=>item?.resourceId&&item?.eligible!==false)');
    expect(core).toContain('.filter((item,index,all)=>all.findIndex(x=>x.resourceId===item.resourceId)===index)');
    expect(core).toContain('.slice(0,20)');
    expect(core).toContain('for(const candidate of rankedClaimCandidates)');
    expect(core).toContain('if(!row)continue;');
    expect(core).toContain('selectedCandidate=candidate;break;');
    expect(core).toContain("chosen:selectedCandidate||decision.chosen");
    expect(core).toContain("ROUTING_CLAIM_FALLBACK");
    expect(core).not.toContain('[decision.chosen.resourceId]);');
  });
});


describe('#2980 watsonx token quota classification',()=>{
  it('treats token_quota_reached as an external quota blocker while preserving ordinary 403 auth',()=>{
    expect(classifyApiDoctorFailure({kind:'external_blocked',message:'HTTP_403'})).toBe('external_blocked');
    expect(classifyApiDoctorFailure({kind:'auth',message:'HTTP_403 token_quota_reached'})).toBe('external_blocked');
    expect(classifyApiDoctorFailure({kind:'auth',message:'HTTP_403'})).toBe('auth');

    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain("if (code === 'token_quota_reached') return 'external_blocked';");
    expect(core).toContain('classifyHttp(res.status,body)');
  });
});
