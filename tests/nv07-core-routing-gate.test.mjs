import { describe, it, expect } from 'vitest';
import { nv07CoreRoutingDecision } from '../apps/shared/nv07-core-routing-gate.mjs';

const NOW=Date.parse('2026-10-15T12:00:00Z');
const iso=n=>new Date(n).toISOString();
const base=()=>({
  registry:{employee_id:'NV07', name:'Google Antigravity', admin_state:'ACTIVE / ACCEPTED_CANARY'},
  commands:{'7':'NV07'},
  resource:{employee_id:'NV07', host:'PC01', interface:'ANTIGRAVITY_CLI', status:'READY', acceptanceVerified:true, authVerified:true, last_seen_at:iso(NOW-1000)},
  job:{employeeId:'NV07', executionHost:'PC01', repository:'newsdayads/tigeriq-ai-lab', priority:'P2', action:'PROPOSE_CHANGE', jobId:'GH-4788:S5', sourceSha:'a'.repeat(40), paths:['docs/implementation/nv07-proposal.md'], resourceScope:'TIGERIQ_NV07_TEST'},
  lease:{job_id:'GH-4788:S5',employee_id:'NV07',resource_scope:'TIGERIQ_NV07_TEST',state:'ACTIVE',expires_at:iso(NOW+60000)},
  nowMs:NOW,
});

describe('NV07 Core routing decision fail-closed until live acceptance',()=>{
  it('admits only a canary-accepted proposal task with current lease',()=>{
    expect(nv07CoreRoutingDecision(base())).toMatchObject({eligible:true,disposition:'ELIGIBLE_NOT_DISPATCHED',employeeId:'NV07',jobId:'GH-4788:S5'});
  });
  it('rejects current Registry #335 provisioning state',()=>{
    const x=base();x.registry.admin_state='ADMIN_ENABLED / PROVISIONING / RUNTIME_NOT_VERIFIED / NOT_YET_ROUTABLE';
    expect(nv07CoreRoutingDecision(x)).toMatchObject({eligible:false,code:'NV07_ADMIN_NOT_ACTIVE'});
  });
  it.each([
    ['wrong identity',x=>x.registry.name='ChatGPT Go','NV07_REGISTRY_IDENTITY_MISSING'],
    ['inactive substring',x=>x.registry.admin_state='INACTIVE','NV07_ADMIN_NOT_ACTIVE'],
    ['missing command',x=>x.commands={'7':'NV03'},'NV07_COMMAND_MAPPING_NOT_VERIFIED'],
    ['no resource',x=>x.resource=null,'NV07_RUNTIME_BINDING_MISSING'],
    ['wrong host',x=>x.resource.host='GitHub','NV07_RUNTIME_BINDING_MISSING'],
    ['fake ready',x=>x.resource.acceptanceVerified=false,'NV07_RUNTIME_NOT_ACCEPTED'],
    ['login missing',x=>x.resource.authVerified=false,'NV07_RUNTIME_NOT_ACCEPTED'],
    ['stale heartbeat',x=>x.resource.last_seen_at=iso(NOW-91000),'NV07_HEARTBEAT_STALE'],
    ['future heartbeat',x=>x.resource.last_seen_at=iso(NOW+1000),'NV07_HEARTBEAT_STALE'],
    ['invalid scope',x=>x.job.resourceScope='','NV07_JOB_SCOPE_INVALID'],
    ['P0',x=>x.job.priority='P0','NV07_P0_OR_PRIORITY_DENIED'],
    ['write source',x=>x.job.action='WRITE_SOURCE','NV07_PC01_WRITE_OR_UNKNOWN_ACTION_DENIED'],
    ['protected path',x=>x.job.paths=['apps/tigeriq-core/core.mjs'],'NV07_PROTECTED_CONTROL_DENIED'],
    ['App Chrome',x=>x.job.paths=['apps/chrome-controller/src/server.ts'],'NV07_APP_CHROME_DENIED'],
    ['no lease',x=>x.lease=null,'NV07_ACTIVE_LEASE_MISSING'],
    ['lease other job',x=>x.lease.job_id='GH-4700','NV07_ACTIVE_LEASE_MISSING'],
    ['lease other worker',x=>x.lease.employee_id='NV08','NV07_ACTIVE_LEASE_MISSING'],
    ['lease expired',x=>x.lease.expires_at=iso(NOW-1),'NV07_ACTIVE_LEASE_MISSING'],
    ['lease scope mismatch',x=>x.lease.resource_scope='ANOTHER_SCOPE','NV07_ACTIVE_LEASE_MISSING'],
  ])('rejects %s',(_label,change,expected)=>{const x=base();change(x);expect(nv07CoreRoutingDecision(x)).toMatchObject({eligible:false,code:expected});});
});
