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
});
