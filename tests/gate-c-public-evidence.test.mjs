import {describe,it,expect} from 'vitest';
import {
  SUPPORTED_PUBLIC_EVIDENCE_KEYS,
  extractPublicEvidence,
  formatPublicEvidenceBlock,
  parsePublicEvidenceKeys,
} from '../apps/tigeriq-core/public-evidence.mjs';

describe('Gate C bounded public evidence',()=>{
  it('keeps only requested safe Gate C scalar evidence',()=>{
    const requested=parsePublicEvidenceKeys(
      'PUBLIC_EVIDENCE_KEYS=status,version,employeeId,online,lastSeenAt,expected,taskCount,completed,failed,pending,invalid,pass,sendCount,duplicateSendCount,recoveryCount,created,existing,count,raw,password'
    );
    expect(requested).toEqual([
      'status','version','employeeId','online','lastSeenAt','expected','taskCount','completed','failed','pending','invalid','pass',
      'sendCount','duplicateSendCount','recoveryCount','created','existing','count'
    ]);
    expect(SUPPORTED_PUBLIC_EVIDENCE_KEYS).not.toContain('raw');
    expect(SUPPORTED_PUBLIC_EVIDENCE_KEYS).not.toContain('password');

    const jobResult={
      evidence:{
        bridgeCalls:[{
          result:{
            data:{
              status:'GATE_C_V021_STATUS',
              version:'0.21.0-packageinstaller-stream-fix',
              employeeId:'NV101',
              online:true,
              lastSeenAt:'2026-10-04T04:45:00.000Z',
              expected:10,
              taskCount:10,
              completed:10,
              failed:0,
              pending:0,
              invalid:0,
              pass:true,
              sendCount:10,
              duplicateSendCount:0,
              recoveryCount:1,
              created:0,
              existing:10,
              count:10,
              raw:'must-not-leak',
              password:'must-not-leak'
            }
          }
        }]
      }
    };

    const evidence=extractPublicEvidence(jobResult,requested);
    expect(evidence).toMatchObject({
      status:'GATE_C_V021_STATUS',
      version:'0.21.0-packageinstaller-stream-fix',
      employeeId:'NV101',
      online:true,
      expected:10,
      taskCount:10,
      completed:10,
      failed:0,
      pending:0,
      invalid:0,
      pass:true,
      sendCount:10,
      duplicateSendCount:0,
      recoveryCount:1,
      created:0,
      existing:10,
      count:10,
    });
    expect(evidence).not.toHaveProperty('raw');
    expect(evidence).not.toHaveProperty('password');

    const block=formatPublicEvidenceBlock(evidence);
    expect(block).toContain('"sendCount":10');
    expect(block).toContain('"duplicateSendCount":0');
    expect(block).toContain('"recoveryCount":1');
    expect(block).not.toContain('must-not-leak');
  });

  it('prefers the trusted v0.21 Gate C bridge receipt over agent assertions',()=>{
    const requested=parsePublicEvidenceKeys(
      'PUBLIC_EVIDENCE_KEYS=status,version,taskCount,completed,invalid,pass,sendCount,duplicateSendCount,recoveryCount'
    );
    const trustedData={
      status:'GATE_C_V021_STATUS',
      version:'0.21.0-packageinstaller-stream-fix',
      taskCount:10,
      completed:9,
      invalid:1,
      pass:false,
      sendCount:9,
      duplicateSendCount:0,
      recoveryCount:0,
    };
    const jobResult={
      evidence:{
        agentResult:{
          evidence:{
            status:'GATE_C_V021_STATUS',
            version:'0.21.0-packageinstaller-stream-fix',
            taskCount:10,
            completed:10,
            invalid:0,
            pass:true,
            sendCount:10,
            duplicateSendCount:0,
            recoveryCount:99,
          }
        },
        bridgeCalls:[
          {result:{ok:true,action:'android_worker_gate_c_v021_status',target:'pc01-local',data:{...trustedData,pass:true},evidence:{transport:'agent-assertion',shell:false,inheritedSecretEnvironment:false,androidGateCV021:true}}},
          {result:{ok:true,action:'android_worker_gate_c_v021_status',target:'pc01-local',data:trustedData,evidence:{transport:'local-process',shell:false,inheritedSecretEnvironment:false,androidGateCV021:true}}},
        ]
      }
    };
    expect(extractPublicEvidence(jobResult,requested)).toEqual(trustedData);
  });

  it('does not backfill missing trusted Gate C scalars from agent evidence',()=>{
    const requested=parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS=pass,recoveryCount');
    const jobResult={
      evidence:{
        agentResult:{evidence:{pass:true,recoveryCount:7}},
        bridgeCalls:[{
          result:{
            ok:true,
            action:'android_worker_gate_c_v021_status',
            target:'pc01-local',
            data:{pass:false},
            evidence:{transport:'local-process',shell:false,inheritedSecretEnvironment:false,androidGateCV021:true}
          }
        }]
      }
    };
    const evidence=extractPublicEvidence(jobResult,requested);
    expect(evidence).toEqual({pass:false});
    expect(evidence).not.toHaveProperty('recoveryCount');
  });
});
