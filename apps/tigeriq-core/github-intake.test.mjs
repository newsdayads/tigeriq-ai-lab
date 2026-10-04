import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { contextIssueRefs,extractExplicitContextIssues,extractIssueRefs,extractPcOperatorInstruction,extractRepoPaths,finalLiveReviewJobId,formatResultComment,githubDependencySpec,githubDispatchLane,githubIssueSourceRevision,githubPcOperatorJobId,githubRateLimitCooldownMs,githubSpecBlockedByActive,githubTerminalDependencyGate,hydrateContext,implementationReviewContext,indexOpenGithubIssues,isBoundedAppChromeRequestOnly,objectiveCompletionGate,parseExecutableIssue,parseLiveAcceptanceEvidence,parsePcOperatorDirectAction,resolveGithubSourceIssue,syncExternalRoleClaimLabels,syncGithubOutcomes,trustedFinalLiveReviewEvidence } from './github-intake.mjs';
import { appendPublicEvidenceToSummary,buildPublicEvidenceDiagnostic,extractPublicEvidence,formatPublicEvidenceBlock,formatPublicEvidenceDiagnosticBlock,parsePublicEvidenceKeys,sanitizePublicEvidenceValue } from './public-evidence.mjs';
import { openClawTerminalDecision } from '../openclaw-tigeriq-runtime/dispatch.mjs';

describe('GitHub Core intake guardrails',()=>{

  it('materializer has no global active-GitHub-objective stop gate',()=>{
    const source=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    expect(source).not.toContain("status='active' limit 1\")).rowCount>0");
    expect(source).toContain("select metadata from tigeriq_objectives where metadata->>'source'='github' and status='active'");
    expect(source).toContain('githubSpecBlockedByActive(spec,activeMetadata)');
    expect(source).toContain('dispatchLane:spec.dispatchLane');
  });


  const base={number:588,title:'safe test',state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/588',body:'TIGERIQ_EXECUTABLE=true\nPRIORITY=P2\nCAPABILITY=reasoning\nOWNER_POLICY=AUTO\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRead #280 and #335 plus `docs/CURRENT_STATE.md`.'};
  it('accepts an explicitly safe autonomous issue',()=>{expect(parseExecutableIssue(base)).toMatchObject({number:588,priority:'P2',capability:'reasoning'});});
  it('parses multi-phase keep-open lifecycle marker',()=>{
    const parsed=parseExecutableIssue({...base,body:base.body+'\nKEEP_OPEN_ON_STEP_COMPLETE=true'});
    expect(parsed).toMatchObject({keepOpenOnStepComplete:true});
    expect(parseExecutableIssue(base).keepOpenOnStepComplete).toBe(false);
  });

  it('requires current-revision live evidence plus trusted DB-backed final review',()=>{
    const parsed=parseExecutableIssue({...base,body:base.body+'\nLIVE_ACCEPTANCE_REQUIRED=true\nFINAL_REVIEW_REQUIRED=true'});
    expect(parsed).toMatchObject({liveAcceptanceRequired:true,finalReviewRequired:true});
    const stale=[{id:1,body:'LIVE_ACCEPTANCE_PASS=true\nSOURCE_REVISION=old-revision'}];
    expect(parseLiveAcceptanceEvidence(stale,{sourceRevision:'current-revision'}).accepted).toBe(false);
    const claimed=[{id:3,body:'LIVE_ACCEPTANCE_PASS=true\nSOURCE_REVISION=current-revision\nFINAL_LIVE_REVIEW=PASS\nFINAL_LIVE_REVIEWER=NV04\nFINAL_REVIEWER_DIFFERENT_FROM_IMPLEMENTER=true'}];
    expect(parseLiveAcceptanceEvidence(claimed,{sourceRevision:'current-revision',finalReviewRequired:true})).toMatchObject({accepted:false,reason:'trusted_final_review_required',commentId:3});
    expect(parseLiveAcceptanceEvidence(claimed,{sourceRevision:'current-revision',finalReviewRequired:false})).toMatchObject({accepted:true,revision:'current-revision',reviewer:null,commentId:3});
    const livePassPendingFinal=[{id:33,body:'LIVE_ACCEPTANCE_PASS=true\nSOURCE_REVISION=current-revision\nDONE=false'}];
    expect(parseLiveAcceptanceEvidence(livePassPendingFinal,{sourceRevision:'current-revision',finalReviewRequired:false})).toMatchObject({accepted:true,revision:'current-revision',commentId:33});
    const doneFalseOnly=[{id:34,body:'DONE=false\nSOURCE_REVISION=current-revision'}];
    expect(parseLiveAcceptanceEvidence(doneFalseOnly,{sourceRevision:'current-revision',finalReviewRequired:false})).toMatchObject({accepted:false,reason:'live_acceptance_explicitly_not_passed',commentId:34});
    const revoked=[...claimed,{id:4,body:'DONE=false\nLIVE_ACCEPTANCE_PASS=false'}];
    expect(parseLiveAcceptanceEvidence(revoked,{sourceRevision:'current-revision'})).toMatchObject({accepted:false,reason:'live_acceptance_explicitly_not_passed',commentId:4});
    expect(objectiveCompletionGate({liveAcceptanceRequired:true,sourceRevision:'current-revision',liveAcceptancePass:true,liveAcceptanceRevision:'current-revision',finalReviewRequired:true,finalReviewPass:false})).toMatchObject({allow:false,reason:'final_review_pending'});
    expect(objectiveCompletionGate({liveAcceptanceRequired:true,sourceRevision:'current-revision',liveAcceptancePass:true,liveAcceptanceRevision:'current-revision',finalReviewRequired:true,finalReviewPass:true,finalReviewRevision:'current-revision',finalReviewerEmployeeId:'NV12',finalReviewerResourceId:'res-review',finalReviewImplementationFingerprint:'impl-fp'})).toMatchObject({allow:true});
    expect(objectiveCompletionGate({finalReviewRequired:true,sourceRevision:'current-revision',finalReviewPass:false})).toMatchObject({allow:false,reason:'final_review_pending'});
  });


  it('parses only explicit terminal dependency policies and references',()=>{
    expect(githubDependencySpec('DEPENDENCY_POLICY=REQUIRE_PARENT_GATE_PASS\nDEPENDS_ON=#2706 - parent',2707))
      .toEqual({required:true,policy:'REQUIRE_PARENT_GATE_PASS',dependencies:[2706]});
    expect(githubDependencySpec('DEPENDENCY_POLICY=REQUIRE_ALL_PARENT_GATES_PASS\nDEPENDS_ON=#2708\nADDITIONAL_DEPENDENCY=#2657 - acceptance',2709))
      .toEqual({required:true,policy:'REQUIRE_ALL_PARENT_GATES_PASS',dependencies:[2708,2657]});
    expect(githubDependencySpec('DEPENDS_ON=#2706',2707).required).toBe(false);
    expect(objectiveCompletionGate({dependencyGateRequired:true,dependencyGatePass:false})).toMatchObject({allow:false,reason:'dependency_pending'});
  });

  it('fails closed until every canonical dependency is closed completed',async()=>{
    const source={number:2710,body:'DEPENDENCY_POLICY=REQUIRE_PARENT_GATE_PASS\nDEPENDS_ON=#2709 - parent'};
    const openParent={number:2709,state:'open',state_reason:null};
    const openGate=await githubTerminalDependencyGate(async()=>{throw new Error('unexpected fetch')},'newsdayads','tigeriq-ai-lab','fake',source,indexOpenGithubIssues([openParent]));
    expect(openGate).toMatchObject({allow:false,reason:'dependency_not_terminal_accepted',dependency:2709,state:'open'});
    const closedGate=await githubTerminalDependencyGate(async()=>new Response(JSON.stringify({number:2709,state:'closed',state_reason:'completed'}),{status:200,headers:{'content-type':'application/json'}}),'newsdayads','tigeriq-ai-lab','fake',source,new Map());
    expect(closedGate).toMatchObject({allow:true,reason:'dependencies_terminal_accepted',dependencies:[2709]});
  });

  it('keeps a completed Core objective open when its canonical dependency is not terminal accepted',async()=>{
    const sourceIssue={number:2707,state:'open',state_reason:null,title:'child',comments:0,body:'DEPENDENCY_POLICY=REQUIRE_PARENT_GATE_PASS\nDEPENDS_ON=#2706 - parent'};
    const revision=githubIssueSourceRevision(sourceIssue);
    const row={id:'OBJ-GH-2707',status:'completed',summary:'premature complete',metadata:{source:'github',issueNumber:2707,githubClaimReported:true,githubResultReported:false,sourceRevision:revision}};
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){Object.assign(row.metadata,JSON.parse(params[1]));return {rowCount:1,rows:[]};}
      if(q.includes("update tigeriq_objectives set status='active'")){row.status='active';row.summary=params[1];return {rowCount:1,rows:[]};}
      return {rowCount:0,rows:[]};
    }};
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      calls.push([url,init.method||'GET']);
      if(url.endsWith('/issues/2706'))return new Response(JSON.stringify({number:2706,state:'open',state_reason:null}),{status:200,headers:{'content-type':'application/json'}});
      if(url.endsWith('/issues/2707/comments')&&init.method==='POST')return new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}});
      if(url.endsWith('/issues/2707')&&init.method==='PATCH')return new Response(JSON.stringify({state:'closed'}),{status:200,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[sourceIssue]});
    expect(row.status).toBe('active');
    expect(row.metadata).toMatchObject({dependencyGateRequired:true,dependencyGatePass:false,dependencyGateReason:'dependency_not_terminal_accepted'});
    expect(calls.some(([url,method])=>url.endsWith('/issues/2707')&&method==='PATCH')).toBe(false);
    expect(calls.some(([url,method])=>url.endsWith('/issues/2707/comments')&&method==='POST')).toBe(false);
  });

  it('keeps source revision stable across lifecycle state_reason changes but changes on title/body edits',()=>{
    const issue={number:1,title:'A',body:'BODY',state_reason:null};
    const revision=githubIssueSourceRevision(issue);
    expect(githubIssueSourceRevision({...issue,state_reason:'reopened'})).toBe(revision);
    expect(githubIssueSourceRevision({...issue,state_reason:'completed'})).toBe(revision);
    expect(githubIssueSourceRevision({...issue,body:'BODY2'})).not.toBe(revision);
    expect(githubIssueSourceRevision({...issue,title:'B'})).not.toBe(revision);
  });

  it('tracks implementation completion plus employee/resource identity and rejects same-employee reviewer',async()=>{
    const implPool={async query(){return {rows:[
      {id:'J1',status:'done',employee_id:'NV12',resource_id:'res-a',completed_at:'2026-10-01T00:00:00Z'},
      {id:'J2',status:'running',employee_id:'NV11',resource_id:'res-b',completed_at:null},
    ]};}};
    const context=await implementationReviewContext(implPool,{objectiveId:'OBJ',metadata:{implementerEmployeeId:'NV02'},sourceBody:'IMPLEMENTER_EMPLOYEE=NV10'});
    expect(context.implementationTerminal).toBe(false);
    expect(context.blockingJobs).toEqual(['J2']);
    expect(context.implementerEmployeeIds.sort()).toEqual(['NV02','NV10','NV11','NV12'].sort());
    expect(context.implementerResourceIds.sort()).toEqual(['res-a','res-b']);
    expect(context.fingerprint).toMatch(/^[a-f0-9]{16}$/);

    const reviewPool={async query(q,params=[]){
      expect(params[0]).toBe(finalLiveReviewJobId('OBJ','11',context.fingerprint));
      return {rows:[{id:params[0],status:'done',employee_id:'NV12',resource_id:'res-review',provider:'gemini',result:{reviewEvidence:{decision:'PASS',targetHead:'abc1234'}}}]};
    }};
    const terminal={...context,implementationTerminal:true,blockingJobs:[]};
    await expect(trustedFinalLiveReviewEvidence(reviewPool,{objectiveId:'OBJ',sourceRevision:'abc1234',evidenceKey:'11',implementationContext:terminal}))
      .resolves.toMatchObject({accepted:false,reason:'trusted_reviewer_not_independent',employeeId:'NV12',resourceId:'res-review'});
  });

  it('treats failed non-review jobs as terminal while preserving them in implementation identity/fingerprint',async()=>{
    const pool={async query(){return {rows:[
      {id:'J-DONE',status:'done',employee_id:'NV11',resource_id:'res-done',completed_at:'2026-10-01T00:00:00Z'},
      {id:'J-FAILED',status:'failed',employee_id:'NV12',resource_id:'res-failed',completed_at:'2026-10-01T00:01:00Z'},
    ]};}};
    const context=await implementationReviewContext(pool,{objectiveId:'OBJ-2652',metadata:{implementerEmployeeId:'NV02'}});
    expect(context.implementationTerminal).toBe(true);
    expect(context.blockingJobs).toEqual([]);
    expect(context.implementerEmployeeIds.sort()).toEqual(['NV02','NV11','NV12'].sort());
    expect(context.implementerResourceIds.sort()).toEqual(['res-done','res-failed']);
    expect(context.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('keeps labels outside sourceRevision while carrying them for lifecycle projection',()=>{
    const a=parseExecutableIssue({...base,labels:[]});
    const b=parseExecutableIssue({...base,labels:[{name:'tigeriq:role-claimed'},{name:'tigeriq:role-worker-nv02'}]});
    expect(b.labels).toHaveLength(2);
    expect(b.sourceRevision).toBe(a.sourceRevision);
  });

  it('syncs external role claim labels only on lifecycle transitions',async()=>{
    const already={number:588,labels:[{name:'tigeriq:role-claimed'},{name:'tigeriq:role-worker-nv02'}]};
    const calls=[];
    const fetchImpl=async(url,init={})=>{calls.push([url,init.method||'GET']);return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}})};
    await expect(syncExternalRoleClaimLabels({fetchImpl,owner:'o',repo:'r',token:'x',issue:already,workerId:'NV02',active:true})).resolves.toMatchObject({changed:false,active:true,workerId:'NV02'});
    expect(calls).toHaveLength(0);

    const released=[];
    const releaseFetch=async(url,init={})=>{released.push([url,init.method||'GET']);return new Response(null,{status:204})};
    await expect(syncExternalRoleClaimLabels({fetchImpl:releaseFetch,owner:'o',repo:'r',token:'x',issue:already,active:false})).resolves.toMatchObject({changed:true,active:false});
    expect(released.map(([url,method])=>[url,method])).toEqual([
      ['https://api.github.com/repos/o/r/issues/588/labels/tigeriq%3Arole-claimed','DELETE'],
      ['https://api.github.com/repos/o/r/issues/588/labels/tigeriq%3Arole-worker-nv02','DELETE'],
    ]);
  });
  it('admits only explicit typed local pc_operator actions and never shell/file-write/PAD mutation',()=>{
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_status","taskName":"TigerIQ Core Runtime Updater"}',false)).toMatchObject({
      present:true,valid:true,action:{action:'task_status',taskName:'TigerIQ Core Runtime Updater'},mutating:false
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_list"}',false)).toMatchObject({
      present:true,valid:true,action:{action:'task_list'},mutating:false
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_start","taskName":"TigerIQ Core Runtime Updater"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'task_start',taskName:'TigerIQ Core Runtime Updater'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_start","taskName":"TigerIQ Core Runtime Updater"}',false)).toMatchObject({present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'});
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_restart","taskName":"TigerIQ Core 24x7"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'task_restart',taskName:'TigerIQ Core 24x7'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_restart","taskName":"TigerIQ Core 24x7"}',false)).toMatchObject({present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'});
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"chrome_ui_reconcile_cancelled_job","workerId":"NV03"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'chrome_ui_reconcile_cancelled_job',workerId:'NV03'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"chrome_ui_reconcile_cancelled_job","workerId":"NV03"}',false)).toMatchObject({
      present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"chrome_ui_reconcile_cancelled_job","workerId":"NV02"}',true)).toMatchObject({
      present:true,valid:false,reason:'CORE_UI_WORKER_INVALID'
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_gate_c_v020_status"}',false)).toMatchObject({
      present:true,valid:true,action:{action:'android_worker_gate_c_v020_status'},mutating:false
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_gate_c_v020_enqueue_10"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'android_worker_gate_c_v020_enqueue_10'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_gate_c_v020_enqueue_10"}',false)).toMatchObject({
      present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'
    });

    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_publish_v020_manifest"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'android_worker_publish_v020_manifest'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_publish_v020_manifest"}',false)).toMatchObject({
      present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'
    });

    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_release_build"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'android_worker_release_build'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_release_build"}',false)).toMatchObject({
      present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_sign_v021_ci_artifact"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'android_worker_sign_v021_ci_artifact'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_sign_v021_ci_artifact"}',false)).toMatchObject({
      present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_sign_v020_user_context"}',true)).toMatchObject({
      present:true,valid:true,action:{action:'android_worker_sign_v020_user_context'},mutating:true
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_sign_v020_user_context"}',false)).toMatchObject({
      present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"paperclip_lab_preflight"}',false)).toMatchObject({
      present:true,valid:true,action:{action:'paperclip_lab_preflight'},mutating:false
    });
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"paperclip_lab_health"}',false)).toMatchObject({
      present:true,valid:true,action:{action:'paperclip_lab_health'},mutating:false
    });
    for(const action of ['paperclip_lab_install','paperclip_lab_start','paperclip_lab_stop']){
      expect(parsePcOperatorDirectAction(`PC_OPERATOR_DIRECT_ACTION_JSON={"action":"${action}"}`,true)).toMatchObject({present:true,valid:true,action:{action},mutating:true});
      expect(parsePcOperatorDirectAction(`PC_OPERATOR_DIRECT_ACTION_JSON={"action":"${action}"}`,false)).toMatchObject({present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'});
    }
    for(const action of ['shell_exec','file_write','pad_click']){
      expect(parsePcOperatorDirectAction(`PC_OPERATOR_DIRECT_ACTION_JSON={"action":"${action}"}`,true)).toMatchObject({present:true,valid:false});
    }
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={bad json}',true)).toMatchObject({present:true,valid:false,reason:'JSON_INVALID'});
  });


  it('accepts only the Owner-authorized exact-SHA TigerIQ Live production direct action',()=>{
    const sha='a'.repeat(40);
    const raw='PC_OPERATOR_DIRECT_ACTION_JSON={"action":"tigeriq_live_3150_production_deploy","expectedSha":"'+sha+'"}';
    expect(parsePcOperatorDirectAction(raw,true)).toMatchObject({
      present:true,valid:true,action:{action:'tigeriq_live_3150_production_deploy',expectedSha:sha},mutating:true
    });
    expect(parsePcOperatorDirectAction(raw,false)).toMatchObject({present:true,valid:false,reason:'OWNER_DIRECT_REQUIRED'});
    expect(parsePcOperatorDirectAction('PC_OPERATOR_DIRECT_ACTION_JSON={"action":"tigeriq_live_3150_production_deploy","expectedSha":"bad"}',true))
      .toMatchObject({present:true,valid:false,reason:'EXPECTED_SHA_INVALID'});

    const body=[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1','CAPABILITY=pc_operator',
      'ASSIGNED_EXECUTOR=NV06','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
      'RESOURCE_SCOPE=PC01_TIGERIQ_LIVE_3150_DEPLOY_TEST',
      'ASSIGNED_ACTION','tigeriq_pc tigeriq_live_3150_production_deploy expectedSha="'+sha+'"',
      'ACCEPTANCE','PASS',raw,
    ].join('\n');
    expect(parseExecutableIssue({...base,number:3192,title:'typed deploy',body})).toMatchObject({
      capability:'pc_operator',
      dispatchLane:'PC_OPERATOR',
      targetWorker:'NV06',
      pcOperatorDirectAction:{action:'tigeriq_live_3150_production_deploy',expectedSha:sha}
    });
  });

  it('fails closed on an invalid direct-action marker and preserves OpenClaw path when marker is absent',()=>{
    const basePc=[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P1','CAPABILITY=pc_operator','OWNER_DIRECT=true',
      'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=READBACK_X',
      'ASSIGNED_ACTION','tigeriq_pc task_status taskName="TigerIQ Core Runtime Updater"','ACCEPTANCE','PASS'
    ];
    const legacy=parseExecutableIssue({...base,body:basePc.join('\n')});
    expect(legacy).toMatchObject({capability:'pc_operator',pcOperatorDirectAction:null});
    expect(parseExecutableIssue({...base,body:[...basePc,'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"shell_exec"}'].join('\n')})).toBeNull();
    const direct=parseExecutableIssue({...base,body:[...basePc,'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_status","taskName":"TigerIQ Core Runtime Updater"}'].join('\n')});
    expect(direct.pcOperatorDirectAction).toEqual({action:'task_status',taskName:'TigerIQ Core Runtime Updater'});
    const restart=parseExecutableIssue({...base,body:[...basePc,'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"task_restart","taskName":"TigerIQ Core 24x7"}'].join('\n')});
    expect(restart).toMatchObject({capability:'pc_operator',pcOperatorDirectAction:{action:'task_restart',taskName:'TigerIQ Core 24x7'}});
  });

  it('accepts bounded NV06/OpenClaw pc_operator work with required safety flags',()=>{const parsed=parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true\nPRIORITY=P1\nCAPABILITY=pc_operator\nOWNER_POLICY=AUTO\nOWNER_DIRECT=true\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRESOURCE_SCOPE=OPENCLAW_FAST_TEST\nASSIGNED_ACTION\ntigeriq_pc status\nACCEPTANCE\nPASS'});expect(parsed).toMatchObject({number:588,priority:'P1',capability:'pc_operator',dispatchLane:'PC_OPERATOR',resourceScope:'OPENCLAW_FAST_TEST'});});
  it('fails closed if shell/code guardrails are missing',()=>{expect(parseExecutableIssue({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO'})).toBeNull();});
  it('does not treat CENTRAL prose/backticks as an executable marker',()=>{expect(parseExecutableIssue({...base,body:'Rule: `TIGERIQ_EXECUTABLE=true`; OWNER_POLICY=AUTO'})).toBeNull();});
  it('extracts bounded issue refs and safe repository paths',()=>{expect(extractIssueRefs(base.body,588)).toEqual([280,335]);expect(extractRepoPaths(base.body)).toEqual(['docs/CURRENT_STATE.md']);});
  it('uses explicit CONTEXT_ISSUES deterministically up to sixteen and excludes self/duplicates/invalid tokens',()=>{
    const body='CONTEXT_ISSUES=#101,#102,garbage,#588,#101,0,#103,#104,#105,#106,#107,#108,#109,#110,#111,#112,#113,#114,#115,#116,#117,#118,#119';
    expect(extractExplicitContextIssues(body,588)).toEqual([101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116]);
    expect(contextIssueRefs(body,588)).toEqual({explicit:true,refs:[101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116]});
  });

  it('preserves legacy five-ref extraction when CONTEXT_ISSUES is absent',()=>{
    const body='Refs #101 #102 #103 #104 #105 #106 #107';
    expect(contextIssueRefs(body,588)).toEqual({explicit:false,refs:[101,102,103,104,105]});
  });

  it('hydrates all explicit refs in order and records unavailable refs instead of silently omitting them',async()=>{
    const spec={...base,number:588,title:'context test',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/588',body:'CONTEXT_ISSUES=#101,#102,#103,#104,#105,#106,#107,#108'};
    const seen=[];
    const fetchImpl=async url=>{
      const n=Number(String(url).match(/\/issues\/(\d+)$/)?.[1]||0);
      seen.push(n);
      if(n===104)return new Response(JSON.stringify({message:'not found'}),{status:404});
      return new Response(JSON.stringify({number:n,title:'Issue '+n,body:'Body '+n}),{status:200,headers:{'content-type':'application/json'}});
    };
    const hydrated=await hydrateContext(fetchImpl,'newsdayads','tigeriq-ai-lab',spec,'');
    expect(seen).toEqual([101,102,103,104,105,106,107,108]);
    for(const n of [101,102,103,105,106,107,108])expect(hydrated).toContain('REFERENCED ISSUE #'+n+': Issue '+n);
    expect(hydrated).toContain('REFERENCED ISSUE #104: UNAVAILABLE');
    expect(hydrated).toContain('ERROR: GITHUB_HTTP_404');
  });

  it('excludes P0 from employee intake even when stale assignment or AUTO markers exist',()=>{
    const legacy={...base,number:1528,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nOWNER_DIRECT=true\nPRIORITY=P0\nCAPABILITY=pc_operator\nNO_CODE_CHANGE=true\nNO_PC01_SHELL=true\nRESOURCE_SCOPE=OPENCLAW_TEST\nASSIGNED_ACTION\ntigeriq_pc tcp_probe host=127.0.0.1 port=18789\nACCEPTANCE\nPASS'};
    expect(parseExecutableIssue(legacy)).toBeNull();
    const assigned={...legacy,body:legacy.body.replace('CAPABILITY=pc_operator','CAPABILITY=pc_operator\nASSIGNED_EXECUTOR=NV06')};
    expect(parseExecutableIssue(assigned)).toBeNull();
    const ownerHeld={...assigned,body:assigned.body+'\nOWNER_HOLD=true'};
    expect(parseExecutableIssue(ownerHeld)).toBeNull();
    expect(parseExecutableIssue({...legacy,title:'[P0] title-only marker',body:legacy.body.replace('PRIORITY=P0','PRIORITY=P1')})).toBeNull();
  });

  it('excludes every App Chrome request or mutation after LOCAL-only migration',()=>{
    const boundedBody=[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1','CAPABILITY=pc_operator',
      'APP_CHROME_REQUEST_ONLY=true','RESOURCE_SCOPE=APP_CHROME_DEPLOY_REQUEST_STATE',
      'NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
      'ASSIGNED_ACTION','Use tigeriq_pc file_write only:','path=D:\\TigerIQ\\State\\appchrome-install-request.json',
      'Then use tigeriq_pc file_read on the same path.','ACCEPTANCE','PASS',
    ].join('\n');
    expect(isBoundedAppChromeRequestOnly(boundedBody)).toBe(true);
    expect(parseExecutableIssue({...base,number:1881,title:'[P1][OPENCLAW] request only',body:boundedBody})).toBeNull();
    const mutation=boundedBody.replace('APP_CHROME_REQUEST_ONLY=true\n','').replace('ASSIGNED_ACTION\nUse tigeriq_pc file_write only:','ALLOW_PATH_PREFIX=apps/chrome-controller/\nASSIGNED_ACTION\nUse tigeriq_pc file_write only:');
    expect(parseExecutableIssue({...base,number:1882,title:'[APP-CHROME] mutation',body:mutation})).toBeNull();
  });

  it('active objectives block only the same RESOURCE_SCOPE, not an entire lane',()=>{
    const reasoning={capability:'reasoning',dispatchLane:githubDispatchLane('reasoning'),resourceScope:'SCOPE_A'};
    const pc={capability:'pc_operator',dispatchLane:githubDispatchLane('pc_operator'),resourceScope:'PC_STATE'};
    const active=[{capability:'reasoning',dispatchLane:'CORE_REASONING',resourceScope:'OTHER'}];
    expect(githubSpecBlockedByActive(reasoning,active)).toBe(false);
    expect(githubSpecBlockedByActive(pc,active)).toBe(false);
    expect(githubSpecBlockedByActive(reasoning,[{capability:'review',resourceScope:'SCOPE_A'}])).toBe(true);
    expect(githubSpecBlockedByActive(pc,[{capability:'pc_operator',resourceScope:'PC_STATE'}])).toBe(true);
  });

  it('leaves NV03 reviews to the UI role lane and avoids generic Core duplication',()=>{
    const reviewBody=[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P1','CAPABILITY=review',
      'PREFERRED_REVIEWER=NV03','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=REVIEW_X'
    ].join('\n');
    expect(parseExecutableIssue({...base,number:1874,title:'review',body:reviewBody})).toBeNull();
    expect(parseExecutableIssue({...base,number:1875,title:'default review',body:reviewBody.replace('PREFERRED_REVIEWER=NV03\n','')})).toBeNull();
    const fallbackReview=reviewBody.replace('PREFERRED_REVIEWER=NV03','PREFERRED_REVIEWER=NV17')
      +'\nREVIEW_FALLBACK_EMPLOYEE=NV17\nREVIEW_FALLBACK_REASON=NV03_UNAVAILABLE';
    expect(parseExecutableIssue({...base,number:1876,title:'API review fallback',body:fallbackReview})).toMatchObject({
      capability:'review',dispatchLane:'CORE_REVIEW',targetWorker:'NV17'
    });
    const staleNv10=reviewBody
      .replace('PREFERRED_REVIEWER=NV03','PREFERRED_REVIEWER=NV10')
      +'\nTARGET_EMPLOYEE=NV10\nASSIGNED_EXECUTOR=NV10';
    expect(parseExecutableIssue({...base,number:1877,title:'stale generic NV10 review',body:staleNv10})).toBeNull();
  });

  it('sync prioritizes active and unreported GitHub objectives instead of the oldest 100 rows',()=>{
    const source=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    expect(source).not.toContain("order by created_at asc limit 100");
    expect(source).toContain("status='active'");
    expect(source).toContain("githubResultReported");
    expect(source).toContain("order by case when status='active' then 0 else 1 end, updated_at desc, created_at desc");
  });


  it('syncs a blocked Core lifecycle label once before durable result reporting',async()=>{
    const row={id:'OBJ-GH-840',status:'blocked',summary:'terminal failure',metadata:{source:'github',issueNumber:840,githubClaimReported:true,githubResultReported:false}};
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){
        Object.assign(row.metadata,JSON.parse(params[1]));
        return {rowCount:1,rows:[]};
      }
      return {rowCount:0,rows:[]};
    }};
    let labelAdds=0,resultComments=0;
    const fetchImpl=async(url,init={})=>{
      if(url.endsWith('/issues/840/labels')&&init.method==='POST'){labelAdds++;return new Response(JSON.stringify([]),{status:200,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/840/comments')&&init.method==='POST'){resultComments++;return new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}});}
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake'});
    await syncGithubOutcomes({pool,fetchImpl,token:'fake'});
    expect(labelAdds).toBe(1);
    expect(resultComments).toBe(1);
    expect(row.metadata).toMatchObject({githubTerminalLabelSynced:true,githubResultReported:true});
  });

  it('keeps completed multi-phase Core issue open while reporting the step result',async()=>{
    const row={id:'OBJ-GH-842',status:'completed',summary:'phase done',metadata:{source:'github',issueNumber:842,githubClaimReported:true,githubResultReported:false,keepOpenOnStepComplete:true}};
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){
        Object.assign(row.metadata,JSON.parse(params[1]));
        return {rowCount:1,rows:[]};
      }
      return {rowCount:0,rows:[]};
    }};
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      if(url.endsWith('/issues/842/comments')&&init.method==='POST'){calls.push('result-comment');return new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/842')&&init.method==='PATCH'){calls.push('close-issue');return new Response(JSON.stringify({state:'closed'}),{status:200,headers:{'content-type':'application/json'}});}
      if(url.includes('/issues/842/labels/')&&init.method==='DELETE'){calls.push('clear-label');return new Response(null,{status:204});}
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake'});
    expect(calls).toEqual(['result-comment','clear-label']);
    expect(row.metadata).toMatchObject({githubResultReported:true,githubClosed:false});
  });

  it('keeps #2652-style source PASS open when live acceptance is still false',async()=>{
    const sourceIssue={number:2652,state:'open',state_reason:'reopened',title:'corrective',comments:1,body:'LIVE_ACCEPTANCE_REQUIRED=true\nFINAL_REVIEW_REQUIRED=true'};
    const revision=githubIssueSourceRevision(sourceIssue);
    const row={id:'OBJ-GH-2652-Rcurrent',status:'completed',summary:'source/review pass',metadata:{source:'github',issueNumber:2652,githubClaimReported:true,githubResultReported:false,sourceRevision:revision,liveAcceptanceRequired:true,finalReviewRequired:true,liveAcceptanceCommentCount:0}};
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){Object.assign(row.metadata,JSON.parse(params[1]));return {rowCount:1,rows:[]};}
      if(q.includes("update tigeriq_objectives set status='active'")){row.status='active';row.summary=params[1];return {rowCount:1,rows:[]};}
      if(q.includes('select distinct resource_id from tigeriq_jobs'))return {rowCount:0,rows:[]};
      return {rowCount:0,rows:[]};
    }};
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues/2652/comments?')&&(init.method||'GET')==='GET'){calls.push('comments-get');return new Response(JSON.stringify([{id:10,body:'SOURCE_PASS=true\nREVIEW_PASS=true\nDONE=false\nLIVE_ACCEPTANCE_PASS=false'}]),{status:200,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/2652/comments')&&init.method==='POST'){calls.push('result-comment');return new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/2652')&&init.method==='PATCH'){calls.push('close-issue');return new Response(JSON.stringify({state:'closed'}),{status:200,headers:{'content-type':'application/json'}});}
      if(url.includes('/issues/2652/labels/')&&init.method==='DELETE'){calls.push('clear-label');return new Response(null,{status:204});}
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[sourceIssue]});
    expect(calls).toEqual(['comments-get']);
    expect(row.status).toBe('active');
    expect(row.metadata).toMatchObject({sourceRevision:revision,liveAcceptancePass:false,liveAcceptanceRevision:null,finalReviewPass:false,githubResultReported:false});
  });

  it('backfills live/final policy and current source revision onto a pre-fix objective',async()=>{
    const sourceIssue={number:2652,state:'open',state_reason:'reopened',title:'corrective v2',comments:1,body:'LIVE_ACCEPTANCE_REQUIRED=true\nFINAL_REVIEW_REQUIRED=true'};
    const revision=githubIssueSourceRevision(sourceIssue);
    const row={id:'OBJ-GH-2652-Rlegacy',status:'completed',summary:'legacy objective completed',metadata:{source:'github',issueNumber:2652,githubClaimReported:true,githubResultReported:false,sourceRevision:'stale-revision',liveAcceptanceRequired:true,finalReviewRequired:false}};
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){Object.assign(row.metadata,JSON.parse(params[1]));return {rowCount:1,rows:[]};}
      if(q.includes("update tigeriq_objectives set status='active'")){row.status='active';row.summary=params[1];return {rowCount:1,rows:[]};}
      if(q.includes('select distinct resource_id from tigeriq_jobs'))return {rowCount:0,rows:[]};
      return {rowCount:0,rows:[]};
    }};
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues/2652/comments?')&&(init.method||'GET')==='GET'){calls.push('comments-get');return new Response(JSON.stringify([{id:20,body:'DONE=false\nLIVE_ACCEPTANCE_PASS=false'}]),{status:200,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/2652')&&init.method==='PATCH'){calls.push('close-issue');return new Response(JSON.stringify({state:'closed'}),{status:200,headers:{'content-type':'application/json'}});}
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[sourceIssue]});
    expect(calls).toEqual(['comments-get']);
    expect(row.status).toBe('active');
    expect(row.metadata).toMatchObject({sourceRevision:revision,liveAcceptanceRequired:true,finalReviewRequired:true,liveAcceptancePass:false,finalReviewPass:false,githubResultReported:false});
  });

  it('closes only after current-revision live PASS plus trusted independent review job',async()=>{
    const sourceIssue={number:2659,state:'open',state_reason:null,title:'live gate',comments:1,body:'LIVE_ACCEPTANCE_REQUIRED=true\nFINAL_REVIEW_REQUIRED=true'};
    const revision=githubIssueSourceRevision(sourceIssue);
    const row={id:'OBJ-GH-2659-Rcurrent',status:'completed',summary:'ready for live gate',metadata:{source:'github',issueNumber:2659,githubClaimReported:true,githubResultReported:false,sourceRevision:revision,liveAcceptanceRequired:true,finalReviewRequired:true,liveAcceptanceCommentCount:0}};
    let trustedJobId='';
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){Object.assign(row.metadata,JSON.parse(params[1]));return {rowCount:1,rows:[]};}
      if(q.includes("select id,status,employee_id,resource_id,completed_at from tigeriq_jobs"))return {rowCount:1,rows:[{id:'JOB-IMPL',status:'done',employee_id:'NV02',resource_id:'res-implementer',completed_at:'2026-10-01T00:00:00Z'}]};
      if(q.includes("capability='review' and kind='github_review'")){
        trustedJobId=String(params[0]||'');
        return {rowCount:1,rows:[{id:trustedJobId,status:'done',employee_id:'NV12',resource_id:'res-review',provider:'gemini',result:{reviewEvidence:{schema:'TIGERIQ_INDEPENDENT_REVIEW_V1',decision:'PASS',targetHead:revision,summary:'live pass',findings:'NONE'}}}]};
      }
      return {rowCount:0,rows:[]};
    }};
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues/2659/comments?')&&(init.method||'GET')==='GET'){calls.push('comments-get');return new Response(JSON.stringify([{id:11,body:`LIVE_ACCEPTANCE_PASS=true\nSOURCE_REVISION=${revision}`}]),{status:200,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/2659/comments')&&init.method==='POST'){calls.push('result-comment');return new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/2659')&&init.method==='PATCH'){calls.push('close-issue');return new Response(JSON.stringify({state:'closed'}),{status:200,headers:{'content-type':'application/json'}});}
      if(url.includes('/issues/2659/labels/')&&init.method==='DELETE'){calls.push('clear-label');return new Response(null,{status:204});}
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[sourceIssue]});
    expect(calls).toEqual(['comments-get','result-comment','close-issue','clear-label']);
    expect(row.metadata).toMatchObject({liveAcceptancePass:true,liveAcceptanceRevision:revision,liveAcceptanceEvidenceCommentId:11,finalReviewPass:true,finalReviewRevision:revision,finalReviewJobId:trustedJobId,finalReviewerEmployeeId:'NV12',finalReviewerResourceId:'res-review',githubResultReported:true,githubClosed:true});
    expect(row.metadata.finalReviewImplementationFingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('queues standalone final review without requiring LIVE_ACCEPTANCE_PASS',async()=>{
    const sourceIssue={number:2660,state:'open',state_reason:null,title:'final review only',comments:0,body:'FINAL_REVIEW_REQUIRED=true'};
    const revision=githubIssueSourceRevision(sourceIssue);
    const row={id:'OBJ-GH-2660',status:'completed',summary:'implementation complete',metadata:{source:'github',issueNumber:2660,githubClaimReported:true,githubResultReported:false,sourceRevision:revision,finalReviewRequired:true,liveAcceptanceCommentCount:-1}};
    const inserted=[];
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){Object.assign(row.metadata,JSON.parse(params[1]));return {rowCount:1,rows:[]};}
      if(q.includes("select id,status,employee_id,resource_id,completed_at from tigeriq_jobs"))return {rowCount:0,rows:[]};
      if(q.includes("capability='review' and kind='github_review'"))return {rowCount:0,rows:[]};
      if(q.includes("insert into tigeriq_jobs")){inserted.push(params[0]);return {rowCount:1,rows:[]};}
      if(q.includes("select status,attempts,max_attempts from tigeriq_jobs"))return {rowCount:1,rows:[{status:'queued',attempts:0,max_attempts:2}]};
      if(q.includes("update tigeriq_objectives set status='active'")){row.status='active';row.summary=params[1];return {rowCount:1,rows:[]};}
      return {rowCount:0,rows:[]};
    }};
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues/2660/comments?'))return new Response(JSON.stringify([]),{status:200,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[sourceIssue]});
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain('FINAL-LIVE-REVIEW-SOURCE-');
    expect(row.status).toBe('active');
    expect(row.metadata).toMatchObject({finalReviewPass:false,finalReviewRevision:null});
    expect(row.metadata.finalReviewJobId).toBe(inserted[0]);
  });

  it('does not queue final review while implementation jobs are non-terminal',async()=>{
    const sourceIssue={number:2662,state:'open',state_reason:null,title:'pending impl',comments:1,body:'LIVE_ACCEPTANCE_REQUIRED=true\nFINAL_REVIEW_REQUIRED=true'};
    const revision=githubIssueSourceRevision(sourceIssue);
    const row={id:'OBJ-GH-2662',status:'completed',summary:'premature complete',metadata:{source:'github',issueNumber:2662,githubClaimReported:true,githubResultReported:false,sourceRevision:revision,liveAcceptanceRequired:true,finalReviewRequired:true,liveAcceptanceCommentCount:0}};
    let reviewInsert=0;
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){Object.assign(row.metadata,JSON.parse(params[1]));return {rowCount:1,rows:[]};}
      if(q.includes("select id,status,employee_id,resource_id,completed_at from tigeriq_jobs"))return {rowCount:1,rows:[{id:'JOB-IMPL',status:'running',employee_id:'NV02',resource_id:'res-impl',completed_at:null}]};
      if(q.includes("insert into tigeriq_jobs")){reviewInsert++;return {rowCount:1,rows:[]};}
      if(q.includes("update tigeriq_objectives set status='active'")){row.status='active';return {rowCount:1,rows:[]};}
      return {rowCount:0,rows:[]};
    }};
    const fetchImpl=async(url)=>url.includes('/comments?')
      ? new Response(JSON.stringify([{id:30,body:`LIVE_ACCEPTANCE_PASS=true\nSOURCE_REVISION=${revision}`}]),{status:200,headers:{'content-type':'application/json'}})
      : new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[sourceIssue]});
    expect(reviewInsert).toBe(0);
    expect(row.status).toBe('active');
    expect(row.metadata).toMatchObject({liveAcceptancePass:true,finalReviewPass:false,finalReviewJobId:null});
  });

  it('fails closed on source-policy lookup errors before terminal result publication',async()=>{
    const row={id:'OBJ-GH-900',status:'completed',summary:'done',metadata:{source:'github',issueNumber:900,githubClaimReported:true,githubResultReported:false}};
    const pool={async query(q){if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};return {rowCount:0,rows:[]};}};
    const calls=[];
    const fetchImpl=async(url,init={})=>{calls.push([url,init.method||'GET']);return new Response(JSON.stringify({message:'transient'}),{status:500,headers:{'content-type':'application/json'}});};
    await syncGithubOutcomes({pool,fetchImpl,token:'fake'});
    expect(calls.length).toBe(1);
    expect(row.metadata.githubResultReported).toBe(false);
  });

  it('closes completed Core issues before clearing a stale terminal label',async()=>{
    const row={id:'OBJ-GH-841',status:'completed',summary:'done',metadata:{source:'github',issueNumber:841,githubClaimReported:true,githubResultReported:false}};
    const pool={async query(q,params=[]){
      if(q.includes('select id,status,summary,metadata from tigeriq_objectives'))return {rowCount:1,rows:[row]};
      if(q.includes('update tigeriq_objectives set metadata=metadata||$2::jsonb')){
        Object.assign(row.metadata,JSON.parse(params[1]));
        return {rowCount:1,rows:[]};
      }
      return {rowCount:0,rows:[]};
    }};
    const calls=[];
    const fetchImpl=async(url,init={})=>{
      if(url.endsWith('/issues/841/comments')&&init.method==='POST'){calls.push('result-comment');return new Response(JSON.stringify({}),{status:201,headers:{'content-type':'application/json'}});}
      if(url.endsWith('/issues/841')&&init.method==='PATCH'){calls.push('close-issue');return new Response(JSON.stringify({state:'closed'}),{status:200,headers:{'content-type':'application/json'}});}
      if(url.includes('/issues/841/labels/')&&init.method==='DELETE'){calls.push('clear-label');return new Response(null,{status:204});}
      return new Response(JSON.stringify({}),{status:200,headers:{'content-type':'application/json'}});
    };
    await syncGithubOutcomes({pool,fetchImpl,token:'fake'});
    expect(calls).toEqual(['result-comment','close-issue','clear-label']);
    expect(row.metadata).toMatchObject({githubResultReported:true,githubClosed:true});
  });

  it('reuses one open-issue snapshot for active source reconciliation instead of per-objective GitHub GETs',async()=>{
    const rows=Array.from({length:6},(_,i)=>({number:700+i,state:'open',title:'Issue '+(700+i)}));
    const index=indexOpenGithubIssues(rows);
    let fetchCalls=0;
    const fetchImpl=async()=>{fetchCalls++;return new Response(JSON.stringify({number:999,state:'closed'}),{status:200,headers:{'content-type':'application/json'}})};
    for(const row of rows){
      const resolved=await resolveGithubSourceIssue(fetchImpl,'newsdayads','tigeriq-ai-lab','',row.number,index);
      expect(resolved.number).toBe(row.number);
    }
    expect(fetchCalls).toBe(0);
    const missing=await resolveGithubSourceIssue(fetchImpl,'newsdayads','tigeriq-ai-lab','',999,index);
    expect(missing).toMatchObject({number:999,state:'closed'});
    expect(fetchCalls).toBe(1);
  });

  it('derives bounded GitHub rate-limit cooldown from Retry-After/reset and ignores unrelated 403s',()=>{
    const retryAfter=Object.assign(new Error('API rate limit exceeded'),{status:403,retryAfter:'2',rateLimitRemaining:'0'});
    expect(githubRateLimitCooldownMs(retryAfter,1000)).toBe(2000);
    const reset=Object.assign(new Error('API rate limit exceeded'),{status:403,rateLimitReset:'10',rateLimitRemaining:'0'});
    expect(githubRateLimitCooldownMs(reset,1000)).toBe(10000);
    const fallback=Object.assign(new Error('API rate limit exceeded'),{status:403,rateLimitRemaining:'0'});
    expect(githubRateLimitCooldownMs(fallback,1000)).toBe(60000);
    const unrelated=Object.assign(new Error('Forbidden'),{status:403,rateLimitRemaining:'42'});
    expect(githubRateLimitCooldownMs(unrelated,1000)).toBe(0);
  });

  it('dedupes unchanged Work Orders before loading role-claim comments on the 5s hot path',()=>{
    const core=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    const priorIndex=core.indexOf("const prior=(await pool.query");
    const claimIndex=core.indexOf("const externalClaim=await readActiveExternalRoleClaim");
    expect(priorIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(priorIndex);
  });

  it('wires shared fast-tick snapshot and rate-limit cooldown into Core and Coding intake schedulers',()=>{
    const core=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    const coding=readFileSync(new URL('./github-coding-intake.mjs',import.meta.url),'utf8');
    expect(core).toContain('const openIssues=await ghJson');
    expect(core).toContain('const stableIssues=openIssues.filter');
    expect(core).toContain('syncGithubOutcomes({pool,fetchImpl,owner,repo,token,openIssues:stableIssues})');
    expect(core).toContain('materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:stableIssues})');
    expect(core).toContain("event:'GITHUB_CHAT_OWNER_FALLBACK_HANDOFF'");
    expect(core).toContain("event:'GITHUB_RATE_LIMIT_COOLDOWN'");
    expect(core).toContain('if(githubCooldownUntil>Date.now())return');
    expect(coding).toContain("event:'GITHUB_CODING_RATE_LIMIT_COOLDOWN'");
    expect(coding).toContain('if(githubCooldownUntil>Date.now())return');
    expect(coding).toContain('if(githubRateLimitCooldownMs(error)>0)throw error');
  });

  it('uses legacy pc_operator job id for the initial objective and unique deterministic ids for rearms',()=>{
    const initial=githubPcOperatorJobId('OBJ-GH-588',588);
    const rearmA='OBJ-GH-588-Rabc123-20260926032117';
    const rearmB='OBJ-GH-588-Rdef456-20260926032350';
    expect(initial).toBe('JOB-GH-588-PC');
    expect(githubPcOperatorJobId(rearmA,588)).toBe(githubPcOperatorJobId(rearmA,588));
    expect(githubPcOperatorJobId(rearmA,588)).not.toBe(initial);
    expect(githubPcOperatorJobId(rearmA,588)).not.toBe(githubPcOperatorJobId(rearmB,588));
  });

  it('parses only supported PUBLIC_EVIDENCE_KEYS and preserves marker-absent behavior',()=>{
    expect(parsePublicEvidenceKeys('PUBLIC_EVIDENCE_KEYS=installedSha,result,token,changedPaths,installedSha,foo')).toEqual(['installedSha','result','changedPaths']);
    expect(parsePublicEvidenceKeys('NO_PUBLIC_EVIDENCE=true')).toEqual([]);
    const parsed=parseExecutableIssue({...base,body:[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P1','CAPABILITY=pc_operator',
      'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=READBACK_X',
      'PUBLIC_EVIDENCE_KEYS=installedSha,result,remoteDesktopGuard,changedPaths,updaterTaskTarget,token',
      'ASSIGNED_ACTION','tigeriq_pc file_read path="D:\\TigerIQ\\State\\core-runtime-updater.json"',
      'ACCEPTANCE','PASS'
    ].join('\n')});
    expect(parsed.publicEvidenceKeys).toEqual(['installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget']);
    const diagnostic=parseExecutableIssue({...base,body:[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P1','CAPABILITY=pc_operator',
      'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=READBACK_X',
      'PUBLIC_EVIDENCE_KEYS=installedSha,result','PUBLIC_EVIDENCE_DIAGNOSTIC=true',
      'ASSIGNED_ACTION','tigeriq_pc file_read path="D:\\TigerIQ\\State\\core-runtime-updater.json"','ACCEPTANCE','PASS'
    ].join('\n')});
    expect(diagnostic.publicEvidenceDiagnostic).toBe(true);
  });

  it('extracts requested fields only from structured agent evidence and redacts sensitive nested keys',()=>{
    const jobResult={evidence:{agentResult:{evidence:{
      wrapper:{
        installedSha:'abc123',
        result:{status:'PASS',token:'must-not-leak',nested:{password:'no',ok:'yes'}},
        remoteDesktopGuard:'PASS',
        changedPaths:['a','b'],
        updaterTaskTarget:'D:\\TigerIQ\\Core',
        secret:{installedSha:'evil'}
      },
      arbitraryText:'do not publish'
    }}}};
    const out=extractPublicEvidence(jobResult,['installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget','token']);
    expect(out).toEqual({
      installedSha:'abc123',
      result:{status:'PASS',nested:{ok:'yes'}},
      remoteDesktopGuard:'PASS',
      changedPaths:['a','b'],
      updaterTaskTarget:'D:\\TigerIQ\\Core',
    });
    const block=formatPublicEvidenceBlock(out);
    expect(block).toContain('PUBLIC_EVIDENCE_JSON=');
    expect(block).not.toContain('must-not-leak');
    expect(block).not.toContain('password');
    expect(block).not.toContain('arbitraryText');
  });

  it('falls back to structured bridgeCalls for requested allowlisted fields without leaking raw content',()=>{
    const jobResult={evidence:{
      agentResult:{evidence:{installedSha:'primary-wins'}},
      bridgeCalls:[
        {tool:'tigeriq_pc',result:{
          data:{
            installedSha:'bridge-sha',
            result:'PASS',
            remoteDesktopGuard:'DENY',
            changedPaths:['a','b'],
            updaterTaskTarget:'D:\\TigerIQ\\Core',
            token:'never-publish',
            content:'raw file body must stay private',
            nested:{password:'secret',ok:true}
          }
        }}
      ]
    }};
    const out=extractPublicEvidence(jobResult,['installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget']);
    expect(out).toEqual({
      installedSha:'primary-wins',
      result:'PASS',
      remoteDesktopGuard:'DENY',
      changedPaths:['a','b'],
      updaterTaskTarget:'D:\\TigerIQ\\Core',
    });
    const block=formatPublicEvidenceBlock(out);
    expect(block).not.toContain('raw file body');
    expect(block).not.toContain('never-publish');
    expect(block).not.toContain('password');
    expect(block).not.toContain('"content"');
    expect(block).not.toContain('"data"');
  });

  it('extracts allowlisted fields from JSON inside a trusted pc01-local file_read receipt without publishing raw content',()=>{
    const fileJson=JSON.stringify({
      installedSha:'deadbeef',
      result:'SUCCESS',
      remoteDesktopGuard:'DENY',
      changedPaths:['apps/tigeriq-core/core.mjs'],
      updaterTaskTarget:'D:\\TigerIQ\\Core',
      password:'must-not-leak',
      nested:{token:'also-secret'}
    });
    const jobResult={evidence:{bridgeCalls:[{
      tool:'tigeriq_pc',
      result:{ok:true,action:'file_read',target:'pc01-local',data:{
        path:'D:\\TigerIQ\\State\\core-runtime-updater.json',
        size:fileJson.length,
        content:fileJson
      }}
    }]}};
    const out=extractPublicEvidence(jobResult,['installedSha','result','remoteDesktopGuard','changedPaths','updaterTaskTarget']);
    expect(out).toEqual({
      installedSha:'deadbeef',
      result:'SUCCESS',
      remoteDesktopGuard:'DENY',
      changedPaths:['apps/tigeriq-core/core.mjs'],
      updaterTaskTarget:'D:\\TigerIQ\\Core',
    });
    const block=formatPublicEvidenceBlock(out);
    expect(block).toContain('PUBLIC_EVIDENCE_JSON=');
    expect(block).not.toContain('must-not-leak');
    expect(block).not.toContain('also-secret');
    expect(block).not.toContain('"content"');

    const wrongAction={evidence:{bridgeCalls:[{result:{ok:true,action:'file_write',target:'pc01-local',data:{content:fileJson}}}]}};
    expect(extractPublicEvidence(wrongAction,['installedSha'])).toEqual({});
    const invalidJson={evidence:{bridgeCalls:[{result:{ok:true,action:'file_read',target:'pc01-local',data:{content:'not-json'}}}]}};
    expect(extractPublicEvidence(invalidJson,['installedSha'])).toEqual({});
  });

  it('does not mistake the bridge call wrapper result object for the requested result field',()=>{
    const out=extractPublicEvidence({evidence:{bridgeCalls:[{
      result:{data:{result:{status:'PASS',content:'private'},installedSha:'abc'},transport:'local'}
    }] }},['result','installedSha']);
    expect(out).toEqual({result:{status:'PASS'},installedSha:'abc'});
    const block=formatPublicEvidenceBlock(out);
    expect(block).toContain('"status":"PASS"');
    expect(block).not.toContain('"content"');
    expect(block).not.toContain('"transport"');
  });

  it('caps public evidence depth, arrays, and summary publication while leaving unmarked outcomes unchanged',()=>{
    const deep={a:{b:{c:{d:{e:'too-deep'}}}}};
    expect(JSON.stringify(sanitizePublicEvidenceValue(deep))).toContain('[TRUNCATED_DEPTH]');
    const noMarker=appendPublicEvidenceToSummary('base',{evidence:{agentResult:{evidence:{result:'PASS'}}}},[]);
    expect(noMarker).toBe('base');
    const marked=appendPublicEvidenceToSummary('base',{evidence:{agentResult:{evidence:{result:'PASS'}}}},['result']);
    expect(marked).toBe('base\nPUBLIC_EVIDENCE_JSON={"result":"PASS"}');
  });

  it('emits structure-only diagnostic only when opt-in marker is active and normal extraction is empty',()=>{
    const secretValue='SUPER_SECRET_VALUE_987';
    const fileContent=JSON.stringify({other:'value',password:secretValue});
    const jobResult={
      token:secretValue,
      evidence:{
        content:secretValue,
        agentResult:{status:'SUCCESS',evidence:{wrapper:{other:'not-requested'},token:secretValue}},
        bridgeCalls:[{tool:'tigeriq_pc',result:{ok:true,action:'file_read',target:'pc01-local',data:{path:'D:\\Secret\\state.json',content:fileContent}}}],
      },
    };
    const baseSummary='base';
    expect(appendPublicEvidenceToSummary(baseSummary,jobResult,['installedSha'],{})).toBe(baseSummary);
    const summary=appendPublicEvidenceToSummary(baseSummary,jobResult,['installedSha'],{
      diagnostic:true,
      metadataPublicEvidenceKeysPresent:true,
      metadataPublicEvidenceKeyCount:1,
    });
    expect(summary).toContain('PUBLIC_EVIDENCE_DIAGNOSTIC_JSON=');
    expect(summary).not.toContain(secretValue);
    expect(summary).not.toContain('D:\\Secret\\state.json');
    expect(summary).not.toContain('"token"');
    expect(summary).not.toContain('"content"');
    const raw=summary.split('PUBLIC_EVIDENCE_DIAGNOSTIC_JSON=')[1];
    const diagnostic=JSON.parse(raw);
    expect(diagnostic.requestedKeys).toEqual(['installedSha']);
    expect(diagnostic.metadataPublicEvidenceKeysPresent).toBe(true);
    expect(diagnostic.metadataPublicEvidenceKeyCount).toBe(1);
    expect(diagnostic.jobResultType).toBe('object');
    expect(diagnostic.jobResultKeys).toEqual(['evidence']);
    expect(diagnostic.evidenceKeys).toEqual(['agentResult','bridgeCalls']);
    expect(diagnostic.agentResultKeys).toEqual(['status','evidence']);
    expect(diagnostic.agentEvidenceKeys).toEqual(['wrapper']);
    expect(diagnostic.bridgeCallsType).toBe('array');
    expect(diagnostic.bridgeCallsCount).toBe(1);
    expect(diagnostic.trustedFileReadReceiptPresent).toBe(true);
    expect(diagnostic.trustedFileReadJsonParseable).toBe(true);
    expect(diagnostic.extractedKeys).toEqual([]);
  });

  it('normal public evidence wins over diagnostic and bridge shapes stay structure-only',()=>{
    const success=appendPublicEvidenceToSummary('base',{evidence:{agentResult:{evidence:{result:'PASS'}}}},['result'],{diagnostic:true,metadataPublicEvidenceKeysPresent:true,metadataPublicEvidenceKeyCount:1});
    expect(success).toBe('base\nPUBLIC_EVIDENCE_JSON={"result":"PASS"}');
    expect(success).not.toContain('PUBLIC_EVIDENCE_DIAGNOSTIC_JSON=');

    const objectShape=buildPublicEvidenceDiagnostic({evidence:{bridgeCalls:{result:{ok:false}}}},['installedSha'],{});
    expect(objectShape.bridgeCallsType).toBe('object');
    expect(objectShape.bridgeCallsCount).toBe(1);
    expect(objectShape.trustedFileReadReceiptPresent).toBe(false);

    const nullShape=buildPublicEvidenceDiagnostic({evidence:{bridgeCalls:null}},['installedSha'],{});
    expect(nullShape.bridgeCallsType).toBe('null');
    expect(nullShape.bridgeCallsCount).toBe(0);
    expect(formatPublicEvidenceDiagnosticBlock(nullShape)).toContain('PUBLIC_EVIDENCE_DIAGNOSTIC_JSON=');
  });

  it('wires live-acceptance completion rejection into manager terminalization',()=>{
    const intake=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    const core=readFileSync(new URL('./core.mjs',import.meta.url),'utf8');
    expect(intake).toContain('liveAcceptanceRequired:spec.liveAcceptanceRequired===true');
    expect(intake).toContain('parseLiveAcceptanceEvidence(comments');
    expect(intake).toContain('comments?per_page=100&page=${lastPage}');
    expect((intake.match(/objectiveCompletionGate\(row\.metadata\)/g)||[]).length).toBeGreaterThanOrEqual(2);
    expect(intake).toContain("update tigeriq_objectives set status='active'");
    expect(core).toContain('objectiveCompletionGate(o.metadata||{})');
    expect(core).toContain('OBJECTIVE_COMPLETE_REJECTED_LIVE_ACCEPTANCE_PENDING');
  });

  it('wires fail-closed live gate hardening and preserves manager retry budget',()=>{
    const intake=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    const core=readFileSync(new URL('./core.mjs',import.meta.url),'utf8');
    expect(intake).toContain('githubIssueSourceRevision(sourceIssueForGate||{})');
    expect(intake).toContain('trustedFinalLiveReviewEvidence(pool');
    expect(intake).toContain("kind='github_review'");
    expect(intake).toContain("status='queued',employee_id=null,resource_id=null,provider=null,result=null,failure=null");
    expect(intake).toContain('const evidenceRows=[...(selected?[selected]:[]),...recent]');
    expect(intake).toContain("const terminalStatuses=new Set(['done','failed'])");
    expect(intake).toContain("!terminalStatuses.has(String(row.status||'').toLowerCase())");
    expect(intake).toContain('finalReviewImplementerEmployeeIds:implementationContext.implementerEmployeeIds');
    expect(intake).toContain('liveAcceptanceCommentCount:(spec.liveAcceptanceRequired===true||spec.finalReviewRequired===true)?-1:spec.commentCount');
    expect(core).toContain("employee_id=any($1::text[])");
    expect(core).toContain('finalReviewImplementerEmployeeIds');
    expect(core).toContain("set manager_cycles=0,summary=$2");
    expect(core).toContain('OBJECTIVE_COMPLETE_REJECTED_LIVE_ACCEPTANCE_PENDING');
  });

  it('wires public evidence metadata and both bounded pc_operator reconciliation paths',()=>{
    const intake=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
    const core=readFileSync(new URL('./core.mjs',import.meta.url),'utf8');
    expect(intake).toContain('publicEvidenceKeys:spec.publicEvidenceKeys||[]');
    expect(intake).toContain("PC_OPERATOR_DIRECT_LOCAL");
    expect(intake).toContain("job.provider==='local-direct'?'local-direct'");
    expect(intake).toContain('appendPublicEvidenceToSummary(`bounded pc_operator completed');
    expect(core).toContain('o.metadata as objective_metadata');
    expect(core).toContain('appendPublicEvidenceToSummary(`bounded pc_operator completed');
  });

  it('accepts receipt-backed structured OpenClaw success even when outer wrapper reports error',()=>{
    const result={
      exitCode:1,status:'error',
      agentResult:{status:'SUCCESS',evidence:{fileRead:{path:'D:\\TigerIQ\\State\\x.json'}}},
      successfulToolNames:['tigeriq_pc'],
      bridgeCalls:[{tool:'tigeriq_pc',result:{ok:true,action:'file_read',target:'pc01-local',data:{path:'D:\\TigerIQ\\State\\x.json',size:1,content:'x'}}}],
    };
    expect(openClawTerminalDecision(result,{timedOut:false,parsedPresent:true})).toMatchObject({success:true,trustedToolReceipt:true,bridgeFileReadReceipt:true,agentSuccess:true});
  });

  it('rejects contradictory structured success without a trusted TigerIQ tool receipt',()=>{
    const result={exitCode:1,status:'error',agentResult:{status:'SUCCESS',evidence:{marker:'model-only'}},successfulToolNames:[]};
    expect(openClawTerminalDecision(result,{timedOut:false,parsedPresent:true})).toMatchObject({success:false,invalidTerminal:true,trustedToolReceipt:false});
  });

  it('keeps clean wrapper success and rejects prose-only or timed-out terminals',()=>{
    expect(openClawTerminalDecision({exitCode:0,status:'ok',agentResult:{status:'PASS'},successfulToolNames:[]},{timedOut:false,parsedPresent:true})).toMatchObject({success:true,wrapperClean:true});
    expect(openClawTerminalDecision({exitCode:0,status:'ok',agentResult:null,successfulToolNames:['tigeriq_pc']},{timedOut:false,parsedPresent:true})).toMatchObject({success:false,invalidTerminal:true});
    expect(openClawTerminalDecision({exitCode:0,status:'ok',agentResult:{status:'PASS'},successfulToolNames:['tigeriq_pc']},{timedOut:true,parsedPresent:true})).toMatchObject({success:false});
  });

  it('formats a terminal result with Vietnamese Owner-facing evidence',()=>{const out=formatResultComment({id:'OBJ-GH-588',status:'completed',summary:'final review PASS'});expect(out).toContain('[KẾT QUẢ] TigerIQ Core đã hoàn tất OBJ-GH-588');expect(out).toContain('rà soát cuối ĐẠT');expect(out).not.toMatch(/\\b(?:PASS|COMPLETED|BLOCKED)\\b/);});
});
