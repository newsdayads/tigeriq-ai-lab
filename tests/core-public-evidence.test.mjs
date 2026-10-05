import { describe, expect, it } from 'vitest';
import {
  appendPublicEvidenceToSummary,
  buildPublicJobEvidenceRecord,
  extractPublicEvidence,
  parsePublicEvidenceKeys,
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

  it('exposes bounded mobile update request telemetry when explicitly requested',()=>{
    const data={
      status:'MOBILE_UPDATE_REQUEST_STATUS',
      employeeId:'NV101',
      version:'0.21.0-packageinstaller-stream-fix',
      online:true,
      lastSeenAt:'2026-10-04T15:00:00.000Z',
      updateManifestSeenAt:'2026-10-04T15:00:10.000Z',
      updateManifestVersion:22,
      updateApkRequestedAt:'2026-10-04T15:00:20.000Z',
      updateApkVersion:22,
      token:'must-not-publish',
    };
    const requested=[
      'status','employeeId','version','online','lastSeenAt',
      'updateManifestSeenAt','updateManifestVersion','updateApkRequestedAt','updateApkVersion',
    ];
    const jobResult={evidence:{
      agentResult:{evidence:{
        status:'FORGED_STATUS',employeeId:'NV999',version:'forged',online:false,
        lastSeenAt:'2099-01-01T00:00:00.000Z',
        updateManifestSeenAt:'2099-01-01T00:00:01.000Z',updateManifestVersion:999,
        updateApkRequestedAt:'2099-01-01T00:00:02.000Z',updateApkVersion:999,
      }},
      bridgeCalls:[{tool:'tigeriq_pc',result:{
        ok:true,action:'android_worker_update_request_status',target:'pc01-local',data,
        evidence:{
          transport:'local-process',androidUpdateStatus:true,shell:false,inheritedSecretEnvironment:false,
        },
      }}],
    }};
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS='+requested.join(','))).toEqual(requested);
    expect(extractPublicEvidence(jobResult,requested)).toEqual(Object.fromEntries(
      requested.map((key)=>[key,data[key]]),
    ));
    expect(JSON.stringify(extractPublicEvidence(jobResult,requested))).not.toContain('must-not-publish');
  });

  it('preserves update telemetry from trusted v0.21 status receipts',()=>{
    const data={
      status:'GATE_C_V021_STATUS',employeeId:'NV101',version:'0.21.0-packageinstaller-stream-fix',
      online:true,lastSeenAt:'2026-10-04T15:10:00.000Z',
      updateManifestSeenAt:'2026-10-04T15:10:10.000Z',updateManifestVersion:22,
      updateApkRequestedAt:'2026-10-04T15:10:20.000Z',updateApkVersion:22,
    };
    const requested=['status','employeeId','version','online','lastSeenAt','updateManifestSeenAt','updateManifestVersion','updateApkRequestedAt','updateApkVersion'];
    const jobResult={evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
      ok:true,action:'android_worker_gate_c_v021_status',target:'pc01-local',data,
      evidence:{transport:'local-process',androidGateCV021:true,shell:false,inheritedSecretEnvironment:false},
    }}]}};
    expect(extractPublicEvidence(jobResult,requested)).toEqual(Object.fromEntries(requested.map(key=>[key,data[key]])));
  });

  it('preserves update telemetry from trusted v0.22 live status receipts',()=>{
    const data={
      status:'MOBILE_LIVE_V022_STATUS',employeeId:'NV101',version:'0.22.0-live-worker',
      online:true,lastSeenAt:'2026-10-04T15:20:00.000Z',
      updateManifestSeenAt:'2026-10-04T15:20:10.000Z',updateManifestVersion:22,
      updateApkRequestedAt:'2026-10-04T15:20:20.000Z',updateApkVersion:22,
    };
    const requested=['status','employeeId','version','online','lastSeenAt','updateManifestSeenAt','updateManifestVersion','updateApkRequestedAt','updateApkVersion'];
    const jobResult={evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
      ok:true,action:'android_worker_live_v022_status',target:'pc01-local',data,
      evidence:{transport:'local-process',androidLiveV022Status:true,shell:false,inheritedSecretEnvironment:false},
    }}]}};
    expect(extractPublicEvidence(jobResult,requested)).toEqual(Object.fromEntries(requested.map(key=>[key,data[key]])));
  });

  it('rejects forged update request telemetry without a trusted pc01 receipt',()=>{
    const requested=[
      'status','employeeId','version','online','lastSeenAt',
      'updateManifestSeenAt','updateManifestVersion','updateApkRequestedAt','updateApkVersion',
    ];
    const forged={
      status:'MOBILE_UPDATE_REQUEST_STATUS',employeeId:'NV999',version:'forged',online:true,
      lastSeenAt:'2099-01-01T00:00:00.000Z',
      updateManifestSeenAt:'2099-01-01T00:00:01.000Z',
      updateManifestVersion:999,
      updateApkRequestedAt:'2099-01-01T00:00:02.000Z',
      updateApkVersion:999,
    };
    const jobResult={
      evidence:{
        agentResult:{evidence:forged},
        bridgeCalls:[{tool:'tigeriq_pc',result:{
          ok:true,action:'file_read',target:'pc01-local',data:{content:JSON.stringify(forged)},
        }}],
      },
    };
    expect(extractPublicEvidence(jobResult,requested)).toEqual({});
  });

  it('exports a bounded v0.20 APK base64 chunk without raising generic evidence limits',()=>{
    const chunkBase64='A'.repeat(16000);
    const data={
      status:'ANDROID_V020_EXPORT_CHUNK_READY',
      apkSha256:'F2A8F279033EC832764370A50A34B51B8D29586AF6D9AE7B8957EA81E563A04D',
      totalBytes:62002,
      chunkIndex:0,
      chunkCount:6,
      chunkBytes:12000,
      chunkSha256:'ABC123',
      chunkBase64,
      token:'must-not-publish',
    };
    const jobResult={evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
      ok:true,action:'android_worker_export_v020_signed_apk_chunk',target:'pc01-local',data,
    }}]}};
    const requested=['status','apkSha256','totalBytes','chunkIndex','chunkCount','chunkBytes','chunkSha256','chunkBase64'];
    const evidence=extractPublicEvidence(jobResult,requested);
    expect(evidence.chunkBase64).toBe(chunkBase64);
    expect(evidence.totalBytes).toBe(62002);
    const summary=appendPublicEvidenceToSummary('done',jobResult,requested);
    expect(summary).toContain(chunkBase64);
    expect(summary).not.toContain('must-not-publish');
  });

  it('exposes only explicitly allowlisted v0.20 signed-release receipt fields',()=>{
    const receipt={
      status:'ANDROID_WORKER_STABLE_RELEASE_READY',
      version:'0.20.0-update-lease-guard',
      apkSha256:'SIGNED_SHA',
      unsignedApkSha256:'UNSIGNED_SHA',
      certificateSha256:'CERT_SHA',
      sourceSha:'SOURCE_SHA',
      sourceWorkflowRunId:37119358164,
      sourceArtifactId:11273046069,
      signingIdentity:'canonical-release',
      passwordTransport:'stdin-only',
      apksignerMode:'v2-v3',
      prealignedInput:true,
      secretsPrinted:false,
      executionIdentity:'pc01\\\\wdragons12x',
      taskName:'TigerIQ Android Worker v0.20 User Signer',
      taskPrincipal:'pc01\\\\wdragons12x',
      taskLogonType:'InteractiveToken',
      taskRunLevel:'Highest',
      taskDeleted:true,
      token:'must-not-publish',
    };
    const requested=[
      'status','version','apkSha256','unsignedApkSha256','certificateSha256','sourceSha',
      'sourceWorkflowRunId','sourceArtifactId','signingIdentity','passwordTransport','apksignerMode',
      'prealignedInput','secretsPrinted','executionIdentity','taskName','taskPrincipal','taskLogonType',
      'taskRunLevel','taskDeleted',
    ];
    const jobResult={evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
      ok:true,action:'file_read',target:'pc01-local',data:{content:JSON.stringify(receipt)},
    }}]}};

    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS='+requested.join(','))).toEqual(requested);
    expect(extractPublicEvidence(jobResult,requested)).toEqual(Object.fromEntries(
      requested.map((key)=>[key,receipt[key]]),
    ));
    expect(JSON.stringify(extractPublicEvidence(jobResult,requested))).not.toContain('must-not-publish');
  });

  it('exports only explicitly requested sanitized API Doctor telemetry fields',()=>{
    const data={
      status:'CORE_STATUS_READ',
      apiDoctor:{
        lastScanAt:'2026-10-05T07:44:00.000Z',
        postRepairValidations24h:3,
        actions:[{employeeId:'NV18',action:'wait_repair_lifecycle',token:'hidden'}],
        degradedProviders:[{employeeId:'NV19',reason:'cooldown',password:'hidden'}],
      },
    };
    const jobResult={evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{
      ok:true,action:'core_status_read',target:'pc01-local',data,
    }}]}};
    const requested=['status','lastScanAt','postRepairValidations24h','actions','degradedProviders'];
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS='+requested.join(','))).toEqual(requested);
    expect(extractPublicEvidence(jobResult,requested)).toEqual({
      status:'CORE_STATUS_READ',
      lastScanAt:'2026-10-05T07:44:00.000Z',
      postRepairValidations24h:3,
      actions:[{employeeId:'NV18',action:'wait_repair_lifecycle'}],
      degradedProviders:[{employeeId:'NV19',reason:'cooldown'}],
    });
    expect(JSON.stringify(extractPublicEvidence(jobResult,requested))).not.toContain('hidden');
  });

  it('exports bounded Coding Lane diagnostic scalar evidence',()=>{
    const data={status:'CODING_ISSUE_STATUS_READ',issueNumber:4190,objectiveId:'CODEOBJ-1',objectiveStatus:'active',objectiveSummary:'MICRO_CONTEXT charsBefore=100 charsAfter=40',jobId:'CODE-1',jobStatus:'done',implementer:'NV17',reviewer:'NV11',branch:'tigeriq/nv17/code-x',prNumber:123,headSha:'a'.repeat(40),resultSummary:'MICRO_CONTEXT charsBefore=100 charsAfter=40',failureMessage:''};
    const jobResult={evidence:{bridgeCalls:[{tool:'tigeriq_pc',result:{ok:true,action:'coding_issue_status_read',target:'pc01-local',data}}]}};
    const keys=['status','issueNumber','objectiveId','objectiveStatus','objectiveSummary','jobId','jobStatus','implementer','reviewer','branch','prNumber','headSha','resultSummary','failureMessage'];
    expect(extractPublicEvidence(jobResult,keys)).toEqual(data);
  });

});
