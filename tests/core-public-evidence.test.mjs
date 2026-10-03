import { describe, expect, it } from 'vitest';
import {
  appendPublicEvidenceToSummary,
  buildPublicJobEvidenceRecord,
  extractPublicEvidence,
} from '../apps/tigeriq-core/public-evidence.mjs';

describe('Core public evidence for direct PC receipts', () => {
  it('maps a trusted pc01-local receipt data payload to requested result evidence', () => {
    const jobResult={
      ok:true,
      provider:'local-direct',
      evidence:{
        bridgeCalls:[{
          tool:'tigeriq_pc',
          result:{
            ok:true,
            action:'paperclip_lab_health',
            target:'pc01-local',
            data:{
              healthFailureClass:'HTTP_UNREACHABLE',
              httpAppOk:false,
              portReachable:true,
              container:{status:'running',identityOk:true,logClass:'DATABASE'},
            },
          },
        }],
      },
    };

    expect(extractPublicEvidence(jobResult,['result'])).toEqual({
      result:{
        healthFailureClass:'HTTP_UNREACHABLE',
        httpAppOk:false,
        portReachable:true,
        container:{status:'running',identityOk:true,logClass:'DATABASE'},
      },
    });
    expect(appendPublicEvidenceToSummary('done',jobResult,['result']))
      .toContain('PUBLIC_EVIDENCE_JSON={"result":');
  });

  it('sanitizes sensitive keys inside the mapped direct receipt', () => {
    const jobResult={
      evidence:{
        bridgeCalls:[{
          tool:'tigeriq_pc',
          result:{
            ok:true,
            action:'paperclip_lab_health',
            target:'pc01-local',
            data:{healthFailureClass:'OK',token:'must-not-publish',password:'must-not-publish'},
          },
        }],
      },
    };

    const evidence=extractPublicEvidence(jobResult,['result']);
    expect(evidence.result).toEqual({healthFailureClass:'OK'});
    expect(JSON.stringify(evidence)).not.toContain('must-not-publish');
  });
  it('builds stored-job evidence only from metadata allowlisted keys', () => {
    const row={
      id:'JOB-GH-2476-PC-c5e0cd999080',
      objective_id:'OBJ-GH-2476-Rae019c13e5f4-20260930043617',
      status:'done',
      objective_metadata:{publicEvidenceKeys:['result'],publicEvidenceDiagnostic:true},
      result:{evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
        ok:true,
        action:'paperclip_lab_health',
        target:'pc01-local',
        data:{healthFailureClass:'HTTP_UNREACHABLE',token:'hidden'},
      }}]}},
    };
    expect(buildPublicJobEvidenceRecord(row)).toEqual({
      ok:true,
      jobId:row.id,
      objectiveId:row.objective_id,
      status:'done',
      requestedKeys:['result'],
      evidence:{result:{healthFailureClass:'HTTP_UNREACHABLE'}},
    });
  });

  it('exposes only sanitized TigerIQ taskNames when explicitly requested',()=>{
    const jobResult={
      evidence:{
        bridgeCalls:[{
          tool:'tigeriq_pc',
          result:{
            ok:true,
            action:'task_list',
            target:'pc01-local',
            data:{
              readOnly:true,
              scope:'TigerIQ',
              taskNames:['TigerIQ Core 24x7','TigerIQ Android Worker Release'],
              tasks:[{taskName:'TigerIQ Core 24x7'},{taskName:'TigerIQ Android Worker Release'}],
            },
          },
        }],
      },
    };
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS=taskNames')).toEqual(['taskNames']);
    expect(extractPublicEvidence(jobResult,['taskNames'])).toEqual({
      taskNames:['TigerIQ Core 24x7','TigerIQ Android Worker Release'],
    });
  });

  it('exposes only filtered release-related task names when explicitly requested',()=>{
    const jobResult={
      evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
        ok:true,action:'task_list',target:'pc01-local',
        data:{
          releaseTaskNames:['TigerIQ Android Worker Release','TigerIQ Stable Signer'],
          taskNames:['TigerIQ Core 24x7','TigerIQ Android Worker Release','TigerIQ Stable Signer'],
        },
      }}]},
    };
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS=releaseTaskNames')).toEqual(['releaseTaskNames']);
    expect(extractPublicEvidence(jobResult,['releaseTaskNames'])).toEqual({
      releaseTaskNames:['TigerIQ Android Worker Release','TigerIQ Stable Signer'],
    });
  });

});
