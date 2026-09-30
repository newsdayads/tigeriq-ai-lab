import { describe, expect, it } from 'vitest';
import {
  appendPublicEvidenceToSummary,
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
});
