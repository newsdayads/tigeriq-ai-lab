import {describe,it,expect} from 'vitest';
import {apiDoctorRepairDeploymentGate} from '../apps/tigeriq-core/api-doctor.mjs';

describe('NV10 signed release cutover evidence remains valid after a newer main candidate appears',()=>{
  const installed='a'.repeat(40);
  const newer='b'.repeat(40);
  const closedAt='2026-10-02T07:00:00Z';
  const deployedAt='2026-10-02T07:01:00Z';
  const base={
    issueNumber:9901,state:'closed',stateReason:'completed',
    issueClosedAt:closedAt,runtimeCurrentSha:installed,runtimeInstalledSha:installed,
    runtimeUpdatedAt:deployedAt,updaterResult:'WAIT_RELEASE_APPROVAL',updaterCandidateSha:newer,
  };

  it('does not erase a verified older installation merely because a newer target is waiting',()=>{
    expect(apiDoctorRepairDeploymentGate(base)).toEqual({
      action:'validate_repair',reason:'canonical_repair_installed_while_next_release_waits',
    });
    // The caller must still verify that installed SHA contains the repair PR;
    // this gate alone never emits API_DOCTOR_RECOVERED or counts probe as work.
  });

  it('does not trust a mismatch between installed and runtime current SHA',()=>{
    expect(apiDoctorRepairDeploymentGate({...base,runtimeCurrentSha:newer}))
      .toEqual({action:'wait_repair',reason:'canonical_repair_runtime_source_not_aligned'});
  });

  it('does not trust cutover time before the repair issue closed',()=>{
    expect(apiDoctorRepairDeploymentGate({...base,runtimeUpdatedAt:'2026-10-02T06:59:00Z'}))
      .toEqual({action:'wait_repair',reason:'canonical_repair_runtime_not_applied_after_completion'});
  });

  it('does not treat unknown or missing next-release candidate as an installed proof',()=>{
    for(const updaterCandidateSha of ['', 'invalid', installed]){
      expect(apiDoctorRepairDeploymentGate({...base,updaterCandidateSha}))
        .toEqual({action:'wait_repair',reason:'canonical_repair_runtime_updater_not_terminal'});
    }
  });

  it('continues to reject failed or arbitrary updater results and nonterminal issues',()=>{
    for(const updaterResult of ['FAILED','ERROR','READY','']){
      expect(apiDoctorRepairDeploymentGate({...base,updaterResult}))
        .toEqual({action:'wait_repair',reason:'canonical_repair_runtime_updater_not_terminal'});
    }
    expect(apiDoctorRepairDeploymentGate({...base,stateReason:'not_planned'}))
      .toEqual({action:'wait_repair',reason:'canonical_repair_work_order_not_completed'});
    expect(apiDoctorRepairDeploymentGate({...base,state:'open'}))
      .toEqual({action:'wait_repair',reason:'canonical_repair_work_order_open'});
  });

  it('keeps legacy V1 terminal-result and exact-candidate protections',()=>{
    expect(apiDoctorRepairDeploymentGate({...base,updaterResult:'UPDATED',updaterCandidateSha:installed}))
      .toEqual({action:'validate_repair',reason:'canonical_repair_runtime_applied'});
    expect(apiDoctorRepairDeploymentGate({...base,updaterResult:'NO_CHANGE',updaterCandidateSha:newer}))
      .toEqual({action:'wait_repair',reason:'canonical_repair_runtime_candidate_not_installed'});
  });
});
