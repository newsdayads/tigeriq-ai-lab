import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {
  API_DOCTOR_CAPABILITY,
  apiDoctorAction,
  apiDoctorRepairSignature,
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

  it('wires the autonomous scan, low-token think=false NV10 job, durable handoff and telemetry',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain("nv10Resource.capabilities = ['general','reasoning','review',API_DOCTOR_CAPABILITY]");
    expect(core).toContain('async function runApiDoctorScan()');
    expect(core).toContain("think:false");
    expect(core).toContain('num_predict:160');
    expect(core).toContain("API_DOCTOR_REPAIR_HANDOFF");
    expect(core).toContain("API_DOCTOR_EXTERNAL_BLOCKED");
    expect(core).toContain("API_DOCTOR_RECOVERED");
    expect(core).toContain('apiDoctor:await apiDoctorTelemetry()');
    expect(core).not.toContain("retryDue=['READY','ERROR','RATE_LIMITED','OFFLINE']");
  });
});
