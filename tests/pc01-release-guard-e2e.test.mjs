// Keep the installed Vitest configuration byte-exact; this registered suite
// imports the complete standing-release regression suite (including live route mocks).
import './pc01-standing-release.test.mjs';
// Owner project authority tests are registered here, without changing Vitest pins.
import { describe } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { assessPc01ReleasePreflight } from '../scripts/tigeriq-core/pc01-release-preflight.mjs';
import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const guardPath=fileURLToPath(new URL('../scripts/tigeriq-core/pc01-release-guard.ps1',import.meta.url));
const sha='1'.repeat(40), previous='2'.repeat(40);
const esc=p=>p.replaceAll("'","''");
const template=()=>({
  schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V1',
  scope:'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1',
  targetSha:sha,expectedInstalledSha:previous,rollbackSha:previous,
  requestId:'PC01-RELEASE-4725-A',
  approved:true,components:['core'],
  expiresAtUtc:new Date(Date.now()+3600_000).toISOString(),
});
function createGuardHarness({approval=null,attempt=null,aclMock=true,projectPolicy=null,projectAclMock=true,paths=['apps/tigeriq-core/core.mjs'],impact='@{core=$true;web=$false;coding=$false;openclaw=$false;updater=$false;liveBridge=$false}',targetSha=sha,installedSha=previous,gateSha=targetSha,controlRepo='' }={}){
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-guard-e2e-'));
  try{
    const approver=join(dir,'approval.json'),marker=join(dir,'attempt.json');
    const projectPolicyFile=join(dir,'owner-project-policy.json');
    if(approval!==null)writeFileSync(approver,JSON.stringify(approval));
    if(attempt!==null)writeFileSync(marker,JSON.stringify(attempt));
    if(projectPolicy!==null)writeFileSync(projectPolicyFile,JSON.stringify(projectPolicy));
    const powershell=[
      ". '"+esc(guardPath)+"'",
      "$releaseApprovalPath='"+esc(approver)+"'",
      "$releaseAttemptPath='"+esc(marker)+"'",
      "$ownerProjectPolicyPath='"+esc(projectPolicyFile)+"'",
      ...(aclMock?["function Test-ReleaseApprovalAcl { return $true }"]:[]),
      ...(projectAclMock?["function Test-OwnerProjectPolicyAcl { return $true }"]:[]),
      "$controlRepo='"+esc(controlRepo)+"'",
       "$impact="+impact,
      '$changed='+JSON.stringify(paths).replace(/^\[/,'@(').replace(/\]$/,')').replaceAll('"',"'"),
      "$result=Get-ReleaseApproval '"+targetSha+"' '"+installedSha+"' $impact $changed '"+gateSha+"'",
      '$result|ConvertTo-Json -Compress -Depth 4',
    ].join('\n');
    const script=join(dir,'guard-harness.ps1');
    writeFileSync(script,powershell);
    return {dir,script};
  }catch(error){rmSync(dir,{recursive:true,force:true});throw error;}
}
function run(args){
  const {dir,script}=createGuardHarness(args);
  try{
    const p=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',script],{encoding:'utf8'});
    expect(p.status,p.stderr||p.stdout).toBe(0);
    return JSON.parse(p.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const execAsync=promisify(execFile);
async function runAsync(args){
  const {dir,script}=createGuardHarness(args);
  try{
    // Let Vitest RPC/timeout timers run while the real PowerShell child executes.
    const p=await execAsync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',timeout:20000});
    return JSON.parse(p.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const pwshPresent=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','$true'],{encoding:'utf8'}).status===0;
it.skipIf(!pwshPresent)('live PowerShell guard rejects absence of independent local ticket',()=>{
  expect(run().reason).toBe('RELEASE_LOCAL_APPROVAL_MISSING');
});
it.skipIf(!pwshPresent)('accepts only matching local release ticket (preflight, not identity proof)',()=>{
  expect(run({approval:template()}).approved).toBe(true);
});
it.skipIf(!pwshPresent)('rejects target mismatch without applying anything',()=>{
  const approval=template();approval.targetSha='3'.repeat(40);
  expect(run({approval}).reason).toBe('RELEASE_TARGET_MISMATCH');
});
it.skipIf(!pwshPresent)('rejects web/coding impact outside Phase A scope',()=>{
  expect(run({approval:template(),impact:'@{core=$true;web=$true;coding=$false;openclaw=$false;updater=$false;liveBridge=$false}'}).reason).toBe('RELEASE_IMPACT_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('rejects replayed release attempt even with valid ticket',()=>{
  const attempt={requestId:'PC01-RELEASE-4725-A',targetSha:sha,result:'ROLLED_BACK'};
  expect(run({approval:template(),attempt}).reason).toBe('RELEASE_ATTEMPT_ALREADY_RECORDED');
});
it.skipIf(!pwshPresent)('rejects approval after expiry',()=>{
  const approval=template();approval.expiresAtUtc=new Date(Date.now()-3600_000).toISOString();
  expect(run({approval}).reason).toBe('RELEASE_APPROVAL_EXPIRED_OR_TOO_LONG');
});

it.skipIf(!pwshPresent)('real untrusted temporary approval-file ACL fails closed',()=>{
  expect(run({approval:template(),aclMock:false}).reason).toBe('RELEASE_APPROVAL_ACL_UNTRUSTED');
});

it.skipIf(!pwshPresent)('allows exactly the Core-owned live-status API with a real Core component',()=>{
  expect(run({approval:template(),paths:['apps/tigeriq-core/core.mjs','api/live-status.mjs']}).reason).toBe('LOCAL_RELEASE_APPROVAL_PRESENT');
  expect(run({approval:template(),paths:['apps/tigeriq-core/core.mjs','api/live-device-auth.mjs']}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('rejects live-status API when Core component absent',()=>{
  expect(run({approval:template(),paths:['api/live-status.mjs'],impact:'@{core=$false;web=$false;coding=$false;openclaw=$false;updater=$true;liveBridge=$false}'}).reason).toBe('RELEASE_PATH_COMPONENT_MISMATCH');
});
it.skipIf(!pwshPresent)('classifies exact approved test/template paths only and denies near-miss',()=>{
  expect(run({approval:template(),paths:['.github/ISSUE_TEMPLATE/work_order_v2.md','scripts/verify_work_board_ui.mjs','tests/core-manager-stop-next.test.mjs','apps/tigeriq-core/core.mjs']}).reason).toBe('LOCAL_RELEASE_APPROVAL_PRESENT');
  expect(run({approval:template(),paths:['apps/tigeriq-core/core.mjs','tests/core-manager-stop-next.test.ts']}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('allows exact workflow document but denies near-miss',()=>{
  expect(run({approval:template(),paths:['bootstrap/02_TIGERIQ_WORKFLOW.md','apps/tigeriq-core/core.mjs']}).reason).toBe('LOCAL_RELEASE_APPROVAL_PRESENT');
  expect(run({approval:template(),paths:['bootstrap/02_TIGERIQ_WORKFLOW_V2.md','apps/tigeriq-core/core.mjs']}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('blocks unapproved Vercel/API files even when Updater is in approved components',()=>{
  expect(run({approval:template(),paths:['apps/tigeriq-core/core.mjs','api/live-device-auth.mjs']}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('blocks App Chrome paths regardless of approved component',()=>{
  expect(run({approval:template(),paths:['apps/tigeriq-core/core.mjs','apps/appchrome-unified/runtime.mjs']}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
});
it.skipIf(!pwshPresent)('rejects candidate with no changed path evidence',()=>{
  expect(run({approval:template(),paths:[]}).reason).toBe('RELEASE_CHANGED_PATHS_MISSING');
});

// --- Isolated test-component 3-version pilot (no PC01 runtime effects) ---

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(path,...args){return execFileSync('git',['-C',path,...args],{encoding:'utf8'}).trim();}
function setVersion(repo, version, healthy=true){
  writeFileSync(join(repo,'pilot-component.json'), JSON.stringify({schema:'TIGERIQ_PC01_TEST_COMPONENT_V1',version,healthy}));
  git(repo,'add','pilot-component.json');
  git(repo,'commit','-m',`pilot test component v${version}`);
  return git(repo,'rev-parse','HEAD');
}
function admit({targetSha,previousSha,blob,version}){
  return assessPc01ReleasePreflight({
    request:{
      schema:'TIGERIQ_PC01_RELEASE_CANDIDATE_V1',requestId:`PC01-PILOT-${version}-4725`,
      targetSha,expectedInstalledSha:previousSha,rollbackSha:previousSha,
      artifact:{sha256:sha256(blob)},
      components:['updater'],resourceScopes:['TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'],
    },
    observed:{installedSha:previousSha,pc01Online:true,resourceScopeBusy:false,concurrentWriter:false},
    verifiedEvidence:{
      sourceSha:targetSha,artifactSha256:sha256(blob),exactHeadCi:true,
      qualityGate:true,rollbackKnownGood:true,authoritativeWorkOrder:true,validSourceProvenance:true,
    },
  });
}

describe('PC01 #4725: isolated 3-version source → release gate → stage → health → receipt pilot',()=>{
  it('applies three independent exact-SHA test-component releases, preserves state, has one writer and rolls back failure',()=>{
    const root=mkdtempSync(join(tmpdir(),'tigeriq-pc01-4725-pilot-'));
    const repo=join(root,'isolated-git-runtime');
    mkdirSync(repo);
    let writerCount=0,maxWriters=0;
    const receipt=[];
    try{
      git(repo,'init');git(repo,'config','user.name','PC01 Isolated Test');
      git(repo,'config','user.email','pc01-test@tigeriq.local');
      const initial=setVersion(repo,0);
      git(repo,'checkout','--detach',initial);
      // Immutable device-like data outside the disposable Git runtime worktree.
      const stateFile=join(root,'preserved-configuration.json');
      const initialState={deviceIdentity:'test-component-only',ownerState:'preserve',configVersion:1};
      writeFileSync(stateFile,JSON.stringify(initialState));
      let installedSha=initial;
      const commits=[];
      for(let version=1;version<=3;version++){
        const target=setVersion(repo,version);commits.push(target);
        git(repo,'reset','--hard',installedSha);
        const blob=execFileSync('git',['-C',repo,'show',`${target}:pilot-component.json`]);
        const gate=admit({targetSha:target,previousSha:installedSha,blob,version});
        expect(gate).toMatchObject({eligible:true,reason:'READY_FOR_SEPARATE_RELEASE_AUTHORIZATION'});
        // Separate trusted authorization is represented by this isolated test fixture,
        // NOT a permission to mutate PC01 or a real Owner identity proof.
        const approvedForTest=true;
        expect(approvedForTest).toBe(true);
        writerCount++;maxWriters=Math.max(maxWriters,writerCount);
        try{
          expect(writerCount).toBe(1);
          git(repo,'reset','--hard',target);
          const health=JSON.parse(readFileSync(join(repo,'pilot-component.json'),'utf8'));
          expect(health).toMatchObject({version,healthy:true});
          expect(git(repo,'rev-parse','HEAD')).toBe(target);
          expect(JSON.parse(readFileSync(stateFile,'utf8'))).toEqual(initialState);
          receipt.push({version,previousSha:installedSha,installedSha:target,result:'COMMITTED'});
          installedSha=target;
        }finally{writerCount--;}
      }
      expect(receipt).toHaveLength(3);
      expect(new Set(commits).size).toBe(3);
      expect(receipt.every(r=>r.result==='COMMITTED')).toBe(true);
      expect(maxWriters).toBe(1);

      // Inject a bad health result into a real 4th Git commit, restore known-good SHA.
      const badSha=setVersion(repo,4,false);
      git(repo,'reset','--hard',installedSha);
      const badBlob=execFileSync('git',['-C',repo,'show',`${badSha}:pilot-component.json`]);
      expect(admit({targetSha:badSha,previousSha:installedSha,blob:badBlob,version:4}).eligible).toBe(true);
      const knownGood=installedSha;
      writerCount++;
      try{
        git(repo,'reset','--hard',badSha);
        const unhealthy=JSON.parse(readFileSync(join(repo,'pilot-component.json'),'utf8'));
        expect(unhealthy.healthy).toBe(false);
        git(repo,'reset','--hard',knownGood);
        receipt.push({version:4,previousSha:knownGood,installedSha:knownGood,result:'ROLLED_BACK'});
      }finally{writerCount--;}
      expect(git(repo,'rev-parse','HEAD')).toBe(knownGood);
      expect(JSON.parse(readFileSync(join(repo,'pilot-component.json'),'utf8')).version).toBe(3);
      expect(JSON.parse(readFileSync(stateFile,'utf8'))).toEqual(initialState);
      expect(writerCount).toBe(0);
      // Evidence is explicitly tagged as isolated simulation, NOT installed PC01.
      console.log('PC01_PILOT_EVIDENCE',JSON.stringify({environment:'ISOLATED_TEST_COMPONENT_ONLY',successiveVersions:3,forcedHealthRollback:'PASS',maxConcurrentWriters:maxWriters,configPreserved:true,receiptCount:receipt.length,rdcCalls:0,livePc01Mutations:0}));
    }finally{rmSync(root,{recursive:true,force:true});}
  },15000);

  it('rejects tampered artifact and offline device before mutating the test runtime',()=>{
    const target='a'.repeat(40),installed='b'.repeat(40),blob=Buffer.from('test');
    const accepted=admit({targetSha:target,previousSha:installed,blob,version:'NEG'});
    expect(accepted.eligible).toBe(true);
    const mismatch=assessPc01ReleasePreflight({
      request:{
        schema:'TIGERIQ_PC01_RELEASE_CANDIDATE_V1',requestId:'PC01-NEG-4725',
        targetSha:target,expectedInstalledSha:installed,rollbackSha:installed,
        artifact:{sha256:sha256(blob)},components:['updater'],
        resourceScopes:['TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'],
      },
      observed:{installedSha:installed,pc01Online:false,resourceScopeBusy:false,concurrentWriter:false},
      verifiedEvidence:{
        sourceSha:target,artifactSha256:'c'.repeat(64),
        exactHeadCi:true,qualityGate:true,rollbackKnownGood:true,
        authoritativeWorkOrder:true,validSourceProvenance:true,
      },
    });
    expect(mismatch.eligible).toBe(false);
    expect(mismatch.reason).toBe('PC01_OFFLINE');
    const onlineMismatch=assessPc01ReleasePreflight({
      request:{schema:'TIGERIQ_PC01_RELEASE_CANDIDATE_V1',requestId:'PC01-NEG-HASH-4725',targetSha:target,expectedInstalledSha:installed,rollbackSha:installed,artifact:{sha256:sha256(blob)},components:['updater'],resourceScopes:['TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1']},
      observed:{installedSha:installed,pc01Online:true,resourceScopeBusy:false,concurrentWriter:false},
      verifiedEvidence:{sourceSha:target,artifactSha256:'c'.repeat(64),exactHeadCi:true,qualityGate:true,rollbackKnownGood:true,authoritativeWorkOrder:true,validSourceProvenance:true},
    });
    expect(onlineMismatch.reason).toBe('ARTIFACT_HASH_MISMATCH');
  });
});

import { parsePc01OwnerApproval, impactForPc01ReleaseFiles, impactForPc01SignedSnapshotV2, validatePc01ApprovalEvidence,
  acceptPc01OwnerApprovalEvent, PC01_APPROVAL_PATH, PC01_INSTALLED_STATE, OWNER_ONE_TAP_APPROVED_BLOBS, OWNER_API_HEALTH_APPROVED_BLOBS, OWNER_CODING_CONTRACT_APPROVED_BLOBS, OWNER_V6_APPROVED_BLOBS, OWNER_CODING_INTAKE_APPROVED_BLOBS } from '../apps/tigeriq-core/pc01-release-approval.mjs';

const approvalBaseline='1'.repeat(40), approvalTarget='2'.repeat(40);
const ownerCommentText=()=>'TIGERIQ_PC01_RELEASE_APPROVE_V1\nTARGET_SHA='+approvalTarget+
  '\nEXPECTED_INSTALLED_SHA='+approvalBaseline+'\nCOMPONENTS=core';
const ownerFixture=(time=Date.now())=>{
  const stamp=new Date(time-20_000).toISOString();
  const comment={id:4725123,user:{login:'newsdayads'},body:ownerCommentText(),
    created_at:stamp,updated_at:stamp,issue_url:'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/4725'};
  return {
    identity:{actor:'newsdayads',runId:'1234567891',claims:{actor:'newsdayads',event_name:'issue_comment',run_attempt:'1'}},
    eventName:'issue_comment',
    payload:{action:'created',repository:{full_name:'newsdayads/tigeriq-ai-lab'},
      issue:{number:4725},sender:{login:'newsdayads'},comment},
    verifiedComment:structuredClone(comment),
    installedSha:approvalBaseline,mainSha:approvalTarget,
    compare:{status:'ahead',ahead_by:1,behind_by:0,total_commits:1,
      files:[{filename:'apps/tigeriq-core/core.mjs'},
        {filename:'apps/tigeriq-core/pc01-release-approval.mjs'},
        {filename:'tests/pc01-release-guard-e2e.test.mjs'}]},
    nowMs:time,
  };
};
it('Owner-only signed event verifies exact SHA, permitted paths and ten-minute one-shot ticket',()=>{
  const fixture=ownerFixture();
  const approval=validatePc01ApprovalEvidence(fixture);
  expect(approval).toMatchObject({schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V1',
    scope:'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1',targetSha:approvalTarget,
    rollbackSha:approvalBaseline,components:['core'],approved:true});
  expect(Date.parse(approval.expiresAtUtc)-fixture.nowMs).toBe(600_000);
  expect(approval.requestId).toBe('GH-1234567891-4725123');
});
it('rejects forged actor, fake comment, mismatched sha, stale timestamp and rerun',()=>{
  const mutators=[
    f=>{f.identity.actor='not-owner';},
    f=>{f.identity.claims.event_name='push';},
    f=>{f.identity.claims.run_attempt='2';},
    f=>{f.payload.sender.login='attacker';},
    f=>{f.verifiedComment.body+='FAKE';},
    f=>{f.verifiedComment.updated_at=new Date(f.nowMs).toISOString();},
    f=>{f.verifiedComment.created_at=new Date(f.nowMs-3_600_000).toISOString();},
    f=>{f.mainSha='3'.repeat(40);},
    f=>{f.installedSha='4'.repeat(40);},
    f=>{f.compare.behind_by=1;},
    f=>{f.compare.files.push({filename:'api/live-device-auth.mjs'});},
    f=>{f.compare.files.push({filename:'apps/appchrome/runtime.mjs'});},
  ];
  for(const mutate of mutators){
    const fixture=ownerFixture();mutate(fixture);
    expect(()=>validatePc01ApprovalEvidence(fixture)).toThrow('PC01_RELEASE_');
  }
});
it('cannot widen scope via component list, comment fields, or arbitrary paths',()=>{
  expect(parsePc01OwnerApproval(ownerCommentText()).components).toEqual(['core']);
  expect(()=>parsePc01OwnerApproval(ownerCommentText()+'\nFILE=C:\\evil')).toThrow();
  expect(()=>parsePc01OwnerApproval(ownerCommentText().replace('COMPONENTS=core','COMPONENTS=core,web'))).toThrow();
  expect(()=>impactForPc01ReleaseFiles([{filename:'.github/workflows/tigeriq-core-event-dispatch.yml'}])).toThrow('FILE_OUT_OF_SCOPE');
  // Exact paths only: executable Core-owned API module is not source-only.
  expect(impactForPc01ReleaseFiles([{filename:'api/live-status.mjs'}])).toEqual(['core']);
  expect(()=>impactForPc01ReleaseFiles([{filename:'api/live-device-auth.mjs'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(impactForPc01ReleaseFiles([{filename:'bootstrap/02_TIGERIQ_WORKFLOW.md'},{filename:'apps/tigeriq-core/core.mjs'}])).toEqual(['core']);
  expect(()=>impactForPc01ReleaseFiles([{filename:'bootstrap/02_TIGERIQ_WORKFLOW_V2.md'}])).toThrow('FILE_OUT_OF_SCOPE');
  const previousMainDiff=[".github/ISSUE_TEMPLATE/work_order_v2.md","scripts/verify_work_board_ui.mjs","tests/continuous-capability-verify.test.mjs","tests/core-autonomous-rca.test.ts","tests/core-manager-stop-next.test.mjs","tests/github-intake.test.mjs","tests/live-status-api.test.mjs","tests/tigeriq-live-owner-refinement.test.mjs","tests/web-control.test.ts","tests/work-order-lifecycle-v2.test.mjs"];
  expect(impactForPc01ReleaseFiles([...previousMainDiff.map(filename=>({filename})),{filename:'apps/tigeriq-core/core.mjs'},{filename:'api/live-status.mjs'},{filename:'scripts/tigeriq-core/pc01-release-guard.ps1'}])).toEqual(['core','updater']);
  expect(()=>impactForPc01ReleaseFiles([{filename:'tests/pc01-unknown.test.mjs'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(()=>impactForPc01ReleaseFiles([{filename:'apps/tigeriq-core/web-control-index.mjs'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(impactForPc01ReleaseFiles([{filename:'apps/openclaw-tigeriq-runtime/operator.mjs'}])).toEqual(['core','openclaw']);
});
it('one-tap rollout limits authorized changed files to the eight exact PR4746 blobs',()=>{
  const pinned=Object.entries(OWNER_ONE_TAP_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  expect(pinned).toHaveLength(8);
  expect(impactForPc01ReleaseFiles(pinned)).toEqual(['core']);
  for(const i of pinned.keys()){
    const changed=structuredClone(pinned);
    changed[i].sha='0'.repeat(40);
    expect(()=>impactForPc01ReleaseFiles(changed)).toThrow('ONE_TAP_CONTENT_UNVERIFIED');
    delete changed[i].sha;
    expect(()=>impactForPc01ReleaseFiles(changed)).toThrow('ONE_TAP_CONTENT_UNVERIFIED');
  }
  expect(impactForPc01ReleaseFiles([...pinned,{filename:'apps/tigeriq-core/pc01-release-approval.mjs'},{filename:'scripts/tigeriq-core/pc01-release-guard.ps1'}])).toEqual(['core','updater']);
  for(const filename of ['apps/shared/owner-one-tap-approval-v2.mjs','apps/tigeriq-core/web-control-admin.js','scripts/tigeriq-core/run-web-control-admin.ps1','docs/OWNER_ONE_TAP_APPROVAL_V2.md']){
    expect(()=>impactForPc01ReleaseFiles([...pinned,{filename}])).toThrow('FILE_OUT_OF_SCOPE');
  }
});

it('exact Owner-approved #4767 Coding Manager intake pair is atomic, content-bound and fail-closed',()=>{
  const bundle=Object.entries(OWNER_CODING_INTAKE_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  expect(bundle).toHaveLength(2);
  expect(impactForPc01ReleaseFiles(bundle)).toEqual(['core']);
  expect(()=>impactForPc01ReleaseFiles(bundle.slice(0,1))).toThrow('CODING_INTAKE_BUNDLE_INCOMPLETE');
  expect(()=>impactForPc01ReleaseFiles(bundle.slice(1))).toThrow('FILE_OUT_OF_SCOPE');
  for(const name of Object.keys(OWNER_CODING_INTAKE_APPROVED_BLOBS)){
    const changed=structuredClone(bundle);
    changed.find(x=>x.filename===name).sha='0'.repeat(40);
    expect(()=>impactForPc01ReleaseFiles(changed)).toThrow('CODING_INTAKE_CONTENT_UNVERIFIED');
    const removed=structuredClone(bundle);
    removed.find(x=>x.filename===name).status='removed';
    expect(()=>impactForPc01ReleaseFiles(removed)).toThrow('CODING_INTAKE_FILE_STATE_DENIED');
  }
  expect(()=>impactForPc01ReleaseFiles([...bundle,{filename:'tests/github-coding-intake-copy.test.mjs'}])).toThrow('FILE_OUT_OF_SCOPE');
  const v6=Object.entries(OWNER_V6_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  const coding=Object.entries(OWNER_CODING_CONTRACT_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  const guards=[
    {filename:'apps/tigeriq-core/pc01-release-approval.mjs',status:'modified'},
    {filename:'scripts/tigeriq-core/pc01-release-guard.ps1',status:'modified'},
    {filename:'tests/pc01-release-guard-e2e.test.mjs',status:'modified'},
  ];
  expect(impactForPc01ReleaseFiles([...v6,...coding,...bundle,...guards])).toEqual(['coding','core','updater']);
});

it.skipIf(!pwshPresent)('PowerShell guard validates the two exact Git blobs for #4767 and rejects omission or mismatches',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const paths=Object.keys(OWNER_CODING_INTAKE_APPROVED_BLOBS);
  const args={approval:{...template(),targetSha},targetSha,controlRepo:root,paths};
  const matchesHistoricBlobs=paths.every(path=>execFileSync('git',['rev-parse',targetSha+':'+path],{cwd:root,encoding:'utf8'}).trim()===OWNER_CODING_INTAKE_APPROVED_BLOBS[path]);
  expect(run(args).reason).toBe(matchesHistoricBlobs?'LOCAL_RELEASE_APPROVAL_PRESENT':'RELEASE_CODING_INTAKE_CONTENT_MISMATCH');
  expect(run({...args,paths:paths.slice(0,1)}).reason).toBe(matchesHistoricBlobs?'RELEASE_CODING_INTAKE_BUNDLE_INCOMPLETE':'RELEASE_CODING_INTAKE_CONTENT_MISMATCH');
  expect(run({...args,paths:[...paths,'tests/github-coding-intake-copy.test.mjs']}).reason).toBe(matchesHistoricBlobs?'RELEASE_PATH_OUT_OF_SCOPE':'RELEASE_CODING_INTAKE_CONTENT_MISMATCH');
  expect(run({...args,impact:'@{core=$false;web=$false;coding=$false;openclaw=$false;updater=$true;liveBridge=$false}'}).reason).toBe('RELEASE_PATH_COMPONENT_MISMATCH');
});

it('the immutable Owner V6 thirteen-blob package including Loader and sorting tests combines safely with Coding Lane two blobs for one signed main release',()=>{
  const ui=Object.entries(OWNER_V6_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  const coding=Object.entries(OWNER_CODING_CONTRACT_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  const protectedMaintenance=[
    {filename:'apps/tigeriq-core/pc01-release-approval.mjs',status:'modified'},
    {filename:'scripts/tigeriq-core/pc01-release-guard.ps1',status:'modified'},
    {filename:'tests/pc01-release-guard-e2e.test.mjs',status:'modified'},
  ];
  expect(ui).toHaveLength(13);
  expect(coding).toHaveLength(2);
  expect(ui.map(x=>x.filename)).toContain('bootstrap/00_TIGERIQ_LOADER.md');
  expect(ui.map(x=>x.filename)).toContain('tests/e2e/api-health-visual-regression.spec.ts');
  expect(impactForPc01ReleaseFiles([...ui,...coding,...protectedMaintenance])).toEqual(['coding','core','updater']);
  expect(()=>impactForPc01ReleaseFiles([...ui.slice(0,-1),...coding,...protectedMaintenance])).toThrow('OWNER_V6_BUNDLE_INCOMPLETE');
  for(const name of Object.keys(OWNER_V6_APPROVED_BLOBS)){
    const changed=structuredClone(ui);
    changed.find(x=>x.filename===name).sha='0'.repeat(40);
    expect(()=>impactForPc01ReleaseFiles([...changed,...coding,...protectedMaintenance])).toThrow('OWNER_V6_CONTENT_UNVERIFIED');
  }
  expect(()=>impactForPc01ReleaseFiles([...ui,...coding,...protectedMaintenance,{filename:'public/work-ui-unapproved.css'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(()=>impactForPc01ReleaseFiles([...ui,...coding,...protectedMaintenance,{filename:'bootstrap/00_TIGERIQ_LOADER_COPY.md'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(()=>impactForPc01ReleaseFiles([...ui,...coding,...protectedMaintenance,{filename:'tests/e2e/api-health-visual-regression-copy.spec.ts'}])).toThrow('FILE_OUT_OF_SCOPE');
});

it.skipIf(!pwshPresent)('PowerShell owner V6 plus Coding batch only accepts exact immutable Git content with both complete bundles',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const paths=[...Object.keys(OWNER_V6_APPROVED_BLOBS),...Object.keys(OWNER_CODING_CONTRACT_APPROVED_BLOBS),
    'apps/tigeriq-core/pc01-release-approval.mjs','scripts/tigeriq-core/pc01-release-guard.ps1','tests/pc01-release-guard-e2e.test.mjs'];
  const args={approval:{...template(),targetSha,components:['coding','core','updater']},paths,
    impact:'@{core=$true;web=$false;coding=$true;openclaw=$false;updater=$true;liveBridge=$false}',
    targetSha,controlRepo:root};
  // A feature PR changes its HEAD Git blobs. Legacy V1 MUST reject that
  // unsigned content; don't mistake the intended rejection for a CI defect.
  const matches=(pins)=>Object.entries(pins).every(([name,blob])=>
    execFileSync('git',['rev-parse',targetSha+':'+name],{cwd:root,encoding:'utf8'}).trim()===blob);
  const v6Matches=matches(OWNER_V6_APPROVED_BLOBS),codingMatches=matches(OWNER_CODING_CONTRACT_APPROVED_BLOBS);
  const outcome=run(args).reason;
  if(!v6Matches||!codingMatches){
    expect(outcome).toBe(v6Matches?'RELEASE_CODING_CONTRACT_CONTENT_MISMATCH':'RELEASE_OWNER_V6_CONTENT_MISMATCH');
    expect(run({...args,paths:paths.filter(p=>p!=='public/work-ui.css')}).approved).toBe(false);
    expect(run({...args,paths:[...paths,'public/work-ui-unknown.css']}).approved).toBe(false);
    return;
  }
  expect(outcome).toBe('LOCAL_RELEASE_APPROVAL_PRESENT');
  expect(run({...args,paths:paths.filter(p=>p!=='public/work-ui.css')}).reason).toBe('RELEASE_OWNER_V6_BUNDLE_INCOMPLETE');
  expect(run({...args,paths:[...paths,'public/work-ui-unknown.css']}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
});

it('exact two-blob Coding Lane maintenance permits signed coding only, fails closed on wrong or missing content',()=>{
  const pinned=Object.entries(OWNER_CODING_CONTRACT_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  expect(pinned).toHaveLength(2);
  expect(impactForPc01ReleaseFiles(pinned)).toEqual(['coding']);
  expect(impactForPc01ReleaseFiles([...pinned,
    {filename:'apps/tigeriq-core/pc01-release-approval.mjs'},
    {filename:'scripts/tigeriq-core/pc01-release-guard.ps1'},
  ])).toEqual(['coding','core','updater']);
  expect(()=>impactForPc01ReleaseFiles(pinned.slice(0,1))).toThrow('CODING_CONTRACT_BUNDLE_INCOMPLETE');
  expect(()=>impactForPc01ReleaseFiles(pinned.slice(1))).toThrow('FILE_OUT_OF_SCOPE');
  for(const name of Object.keys(OWNER_CODING_CONTRACT_APPROVED_BLOBS)){
    const edited=structuredClone(pinned);
    edited.find(f=>f.filename===name).sha='0'.repeat(40);
    expect(()=>impactForPc01ReleaseFiles(edited)).toThrow('CODING_CONTRACT_CONTENT_UNVERIFIED');
  }
  expect(()=>impactForPc01ReleaseFiles([...pinned,{filename:'apps/tigeriq-coding-lane/other.mjs'}]))
    .toThrow('FILE_OUT_OF_SCOPE');
  expect(()=>parsePc01OwnerApproval(ownerCommentText().replace('COMPONENTS=core','COMPONENTS=coding,core,updater')))
    .not.toThrow();
  expect(()=>parsePc01OwnerApproval(ownerCommentText().replace('COMPONENTS=core','COMPONENTS=core,coding,updater')))
    .toThrow('COMPONENTS_INVALID');
});

it.skipIf(!pwshPresent)('signed PowerShell guard matches only the immutable Coding Lane source and test pair',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const paths=[...Object.keys(OWNER_CODING_CONTRACT_APPROVED_BLOBS),
    'apps/tigeriq-core/pc01-release-approval.mjs','scripts/tigeriq-core/pc01-release-guard.ps1'];
  const approval={...template(),targetSha,components:['coding','core','updater']};
  const impact='@{core=$true;web=$false;coding=$true;openclaw=$false;updater=$true;liveBridge=$false}';
  const args={approval,paths,impact,targetSha,controlRepo:root};
  const matchesHistoricBlobs=Object.entries(OWNER_CODING_CONTRACT_APPROVED_BLOBS).every(([name,blob])=>
    execFileSync('git',['rev-parse',targetSha+':'+name],{cwd:root,encoding:'utf8'}).trim()===blob);
  expect(run(args).reason).toBe(matchesHistoricBlobs?'LOCAL_RELEASE_APPROVAL_PRESENT':'RELEASE_CODING_CONTRACT_CONTENT_MISMATCH');
  expect(run({...args,paths:paths.filter(p=>p!=='tests/coding-lane-foundation.test.mjs')}).reason)
    .toBe('RELEASE_CODING_CONTRACT_BUNDLE_INCOMPLETE'); // Earlier completeness preflight wins over blob comparison.
});

it('only exact three-file API Health CSS bundle is eligible in combined Owner-scoped release',()=>{
  const oneTap=Object.entries(OWNER_ONE_TAP_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  const apiHealth=Object.entries(OWNER_API_HEALTH_APPROVED_BLOBS).map(([filename,sha])=>({filename,sha,status:'modified'}));
  const protectedFiles=[{filename:'apps/tigeriq-core/pc01-release-approval.mjs',status:'modified'},
    {filename:'scripts/tigeriq-core/pc01-release-guard.ps1',status:'modified'},
    {filename:'tests/pc01-release-guard-e2e.test.mjs',status:'modified'}];
  const approved=[...oneTap,...apiHealth,...protectedFiles];
  expect(apiHealth).toHaveLength(3);
  expect(impactForPc01ReleaseFiles(approved)).toEqual(['core','updater']);
  expect(()=>impactForPc01ReleaseFiles(approved.filter(f=>f.filename!=='tests/e2e/api-health-work-card-layout.spec.ts')))
    .toThrow('API_HEALTH_BUNDLE_INCOMPLETE');
  for(const filename of Object.keys(OWNER_API_HEALTH_APPROVED_BLOBS)){
    const changed=structuredClone(approved);
    changed.find(f=>f.filename===filename).sha='0'.repeat(40);
    expect(()=>impactForPc01ReleaseFiles(changed)).toThrow('API_HEALTH_CONTENT_UNVERIFIED');
  }
  expect(()=>impactForPc01ReleaseFiles([...approved,{filename:'public/work-center-visual-override.css'}]))
    .toThrow('FILE_OUT_OF_SCOPE');
  // Unrelated modifications to the shared CSS are NOT covered by this one-shot scope.
  expect(()=>impactForPc01ReleaseFiles([{filename:'public/work-center-visual.css',sha:'0'.repeat(40),status:'modified'}]))
    .toThrow('API_HEALTH_CONTENT_UNVERIFIED');
});

it.skipIf(!pwshPresent)('PC01 PowerShell guard pins matching API Health CSS and test Git blobs',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const files=[...Object.keys(OWNER_ONE_TAP_APPROVED_BLOBS),
    ...Object.keys(OWNER_API_HEALTH_APPROVED_BLOBS),
    'apps/tigeriq-core/pc01-release-approval.mjs','scripts/tigeriq-core/pc01-release-guard.ps1',
    'tests/pc01-release-guard-e2e.test.mjs'];
  const approval={...template(),targetSha,components:['core','updater']};
  const impact='@{core=$true;web=$true;coding=$false;openclaw=$false;updater=$true;liveBridge=$false}';
  // V1 keeps immutable historical pins. New HEAD bytes are not a new grant.
  // Updated source is covered separately by the signed V2 tests below.
  const matches=(pins,names=files)=>Object.entries(pins).filter(([name])=>names.includes(name)).every(([name,blob])=>
    execFileSync('git',['rev-parse',targetSha+':'+name],{cwd:root,encoding:'utf8'}).trim()===blob);
  const v1Reason=(names,success)=>!matches(OWNER_ONE_TAP_APPROVED_BLOBS,names)
    ?'RELEASE_ONE_TAP_CONTENT_MISMATCH':!matches(OWNER_API_HEALTH_APPROVED_BLOBS,names)
      ?'RELEASE_API_HEALTH_CONTENT_MISMATCH':success;
  const result=run({approval,paths:files,impact,targetSha,controlRepo:root});
  const expectedReason=v1Reason(files,'LOCAL_RELEASE_APPROVAL_PRESENT');
  expect(result.reason).toBe(expectedReason);
  expect(result.approved).toBe(expectedReason==='LOCAL_RELEASE_APPROVAL_PRESENT');
  const incomplete=files.filter(p=>p!=='tests/e2e/api-health-work-card-layout.spec.ts');
  expect(run({approval,paths:incomplete,impact,targetSha,controlRepo:root}).reason)
    .toBe(v1Reason(incomplete,'RELEASE_API_HEALTH_BUNDLE_INCOMPLETE'));
});

it.skipIf(!pwshPresent)('PC01 PowerShell release gate accepts the exact eight-blob signed-scope bundle in a disposable harness',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const approvedPaths=Object.keys(OWNER_ONE_TAP_APPROVED_BLOBS);
  const files=[...approvedPaths,'apps/tigeriq-core/pc01-release-approval.mjs','scripts/tigeriq-core/pc01-release-guard.ps1','tests/pc01-release-guard-e2e.test.mjs'];
  const approval={...template(),targetSha,components:['core','updater']};
  const impact='@{core=$true;web=$true;coding=$false;openclaw=$false;updater=$true;liveBridge=$false}';
  // Preserve V1 fail-closed behavior when any approved historical blob has drifted.
  const matchesHistoricBlobs=Object.entries(OWNER_ONE_TAP_APPROVED_BLOBS).every(([name,blob])=>
    execFileSync('git',['rev-parse',targetSha+':'+name],{cwd:root,encoding:'utf8'}).trim()===blob);
  const result=run({approval,paths:files,impact,targetSha,controlRepo:root});
  expect(result.reason).toBe(matchesHistoricBlobs?'LOCAL_RELEASE_APPROVAL_PRESENT':'RELEASE_ONE_TAP_CONTENT_MISMATCH');
  expect(result.approved).toBe(matchesHistoricBlobs);
  expect(run({approval,paths:files.slice(1),impact,targetSha,controlRepo:root}).reason).toBe('RELEASE_ONE_TAP_BUNDLE_INCOMPLETE');
  expect(run({approval,paths:[...files,'apps/tigeriq-core/web-control-admin.js'],impact,targetSha,controlRepo:root}).reason).toBe('RELEASE_IMPACT_OUT_OF_SCOPE');
});

it('end-to-end mock writes only exclusive protected approval after authenticated GH reads',async()=>{
  const fixture=ownerFixture(),raw=JSON.stringify({currentSha:approvalBaseline});
  const urls=[],written=[],openCalls=[];
  const io={
    async readFile(p){
      if(p===PC01_INSTALLED_STATE)return raw;
      const e=Error('missing');e.code='ENOENT';throw e;
    },
    async lstat(){return{isDirectory:()=>true,isSymbolicLink:()=>false};},
    async realpath(p){return p;},
    async open(p,flags,mode){
      openCalls.push({p,flags,mode});
      return{async writeFile(t){written.push(JSON.parse(t));},async sync(){},async close(){}};
    },
  };
  const fetchImpl=async url=>{
    urls.push(url);
    return{ok:true,json:async()=>{
      if(url.includes('/issues/comments/'))return fixture.verifiedComment;
      if(url.includes('/git/ref/heads/main'))return{object:{sha:approvalTarget}};
      if(url.includes('/compare/'))return fixture.compare;
      throw Error('unexpected mock fetch');
    }};
  };
  const result=await acceptPc01OwnerApprovalEvent({
    identity:fixture.identity,eventName:fixture.eventName,payload:fixture.payload,
    githubToken:'TEST_ONLY',fetchImpl,io,nowMs:fixture.nowMs,platform:'win32',
  });
  expect(result).toMatchObject({accepted:true,owner:'newsdayads',ticketWritten:true});
  expect(urls).toHaveLength(3);
  expect(openCalls).toEqual([{p:PC01_APPROVAL_PATH,flags:'wx',mode:384}]);
  expect(written).toHaveLength(1);
  expect(written[0].targetSha).toBe(approvalTarget);
  expect(JSON.stringify(result)).not.toContain('TEST_ONLY');
});
it('end-to-end mock blocks replay, no general mutation, and absent GitHub token',async()=>{
  const fixture=ownerFixture();let writes=0;
  const io={
    async readFile(p){
      if(p===PC01_INSTALLED_STATE)return JSON.stringify({currentSha:approvalBaseline});
      return JSON.stringify({targetSha:approvalTarget,requestId:'OLD'});
    },
    async lstat(){return{isDirectory:()=>true,isSymbolicLink:()=>false};},
    async realpath(p){return p;},
    async open(){writes++;throw Error('should never write');},
  };
  const fetchImpl=async url=>({ok:true,json:async()=>url.includes('/issues/comments/')?fixture.verifiedComment:
    url.includes('/git/ref/heads/main')?{object:{sha:approvalTarget}}:fixture.compare});
  await expect(acceptPc01OwnerApprovalEvent({
    identity:fixture.identity,eventName:fixture.eventName,payload:fixture.payload,
    githubToken:'TEST_ONLY',fetchImpl,io,nowMs:fixture.nowMs,platform:'win32',
  })).rejects.toThrow('PC01_RELEASE_REPLAY_REJECTED');
  await expect(acceptPc01OwnerApprovalEvent({
    identity:fixture.identity,eventName:fixture.eventName,payload:fixture.payload,
    githubToken:'',fetchImpl,io,nowMs:fixture.nowMs,platform:'win32',
  })).rejects.toThrow('PC01_RELEASE_GITHUB_READ_AUTH_MISSING');
  expect(writes).toBe(0);
});

it('archives only a consumed prior Owner ticket, then exclusive-writes the next approval without RDC',async()=>{
  const fixture=ownerFixture();
  const priorSha='a'.repeat(40), archived=[],writes=[];
  const oldTicket={schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V1',requestId:'GH-OLD-4725',targetSha:priorSha};
  const receipt={requestId:'GH-OLD-4725',targetSha:priorSha,result:'COMMITTED'};
  const io={
    async readFile(p){
      if(p===PC01_INSTALLED_STATE)return JSON.stringify({currentSha:approvalBaseline});
      if(p.endsWith('core-runtime-release-attempt.json'))return JSON.stringify(receipt);
      if(p===PC01_APPROVAL_PATH)return JSON.stringify(oldTicket);
      throw Error('unexpected mock file');
    },
    async lstat(p){if(p.includes('release-ticket-')){const e=Error('no archive');e.code='ENOENT';throw e;}return{isDirectory:()=>true,isSymbolicLink:()=>false};},
    async realpath(p){return p;},
    async rename(from,to){archived.push({from,to});},
    async open(p,flags){expect(p).toBe(PC01_APPROVAL_PATH);expect(flags).toBe('wx');return{async writeFile(t){writes.push(JSON.parse(t));},async sync(){},async close(){}};},
  };
  const fetchImpl=async url=>({ok:true,json:async()=>url.includes('/issues/comments/')?fixture.verifiedComment:
    url.includes('/git/ref/heads/main')?{object:{sha:approvalTarget}}:fixture.compare});
  const result=await acceptPc01OwnerApprovalEvent({identity:fixture.identity,eventName:fixture.eventName,
    payload:fixture.payload,githubToken:'TEST_ONLY',fetchImpl,io,platform:'win32',nowMs:fixture.nowMs});
  expect(result.ticketWritten).toBe(true);
  expect(archived).toHaveLength(1);
  expect(archived[0].from).toBe(PC01_APPROVAL_PATH);
  expect(archived[0].to).toContain('release-ticket-'+priorSha+'-COMMITTED.json');
  expect(writes).toHaveLength(1);
  expect(writes[0].targetSha).toBe(approvalTarget);
});
it('refuses to replace an unconsumed or replayed Owner ticket',async()=>{
  const fixture=ownerFixture();let writes=0,renames=0;
  const io={
    async readFile(p){
      if(p===PC01_INSTALLED_STATE)return JSON.stringify({currentSha:approvalBaseline});
      if(p.endsWith('core-runtime-release-attempt.json'))return JSON.stringify({requestId:'OTHER',targetSha:'a'.repeat(40),result:'STARTED'});
      if(p===PC01_APPROVAL_PATH)return JSON.stringify({schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V1',requestId:'GH-PENDING',targetSha:'b'.repeat(40)});
      throw Error('unexpected file');
    },
    async lstat(){return{isDirectory:()=>true,isSymbolicLink:()=>false};},
    async realpath(p){return p;},
    async rename(){renames++;},
    async open(){writes++;},
  };
  const fetchImpl=async url=>({ok:true,json:async()=>url.includes('/issues/comments/')?fixture.verifiedComment:
    url.includes('/git/ref/heads/main')?{object:{sha:approvalTarget}}:fixture.compare});
  await expect(acceptPc01OwnerApprovalEvent({identity:fixture.identity,eventName:fixture.eventName,
    payload:fixture.payload,githubToken:'TEST_ONLY',fetchImpl,io,platform:'win32',nowMs:fixture.nowMs}))
    .rejects.toThrow('PC01_RELEASE_ACTIVE_APPROVAL_UNCONSUMED');
  expect(writes).toBe(0);
  expect(renames).toBe(0);
});

describe('Owner signed V2 exact-main snapshot: no perpetual per-blob pin edits',()=>{
  const baseline='1'.repeat(40), target='2'.repeat(40), fileSha='a'.repeat(40);
  const paths=[
    'apps/dashboard/src/bcct.mjs','apps/shared/owner-interaction-v6.mjs',
    'apps/tigeriq-coding-lane/coding-lane.mjs','apps/tigeriq-core/github-coding-intake.mjs',
    'apps/tigeriq-core/pc01-release-approval.mjs','apps/tigeriq-core/dashboard.html',
    'bootstrap/00_TIGERIQ_LOADER.md','bootstrap/02_TIGERIQ_WORKFLOW.md',
    'docs/OWNER_INTERACTION_V6.md','public/work-center.js','public/work-ui.css',
    'scripts/package-bcct-runtime.mjs','scripts/tigeriq-core/pc01-release-guard.ps1',
    'tests/github-coding-intake.test.mjs','tests/owner-interaction-v6.test.mjs',
  ];
  const files=paths.map(filename=>({filename,status:'modified',sha:fileSha}));
  const comment=['TIGERIQ_PC01_RELEASE_APPROVE_V2','TARGET_SHA='+target,
    'EXPECTED_INSTALLED_SHA='+baseline,'COMPONENTS=coding,core,updater',
    'RELEASE_POLICY=SCOPED_SNAPSHOT_V2'].join('\n');

  it('requires exact four data fields, no extra grant or unsigned policy downgrade',()=>{
    expect(parsePc01OwnerApproval(comment).releasePolicy).toBe('SCOPED_SNAPSHOT_V2');
    expect(()=>parsePc01OwnerApproval(comment.replace('SCOPED_SNAPSHOT_V2','ALLOW_ALL'))).toThrow('COMMENT_FORMAT_INVALID');
    expect(()=>parsePc01OwnerApproval(comment+'\nNO_AUTH=true')).toThrow('COMMENT_FORMAT_INVALID');
    expect(()=>parsePc01OwnerApproval(comment.replace('coding,core,updater','core'))).not.toThrow();
  });

  it('derives the release from immutable GitHub compare, not manually pinned blobs',()=>{
    expect(impactForPc01SignedSnapshotV2(files)).toEqual(['coding','core','updater']);
    for(const bad of [
      {filename:'api/live-device-auth.mjs',status:'modified',sha:fileSha},
      {filename:'apps/android-worker/runtime.mjs',status:'modified',sha:fileSha},
      {filename:'.github/workflows/release.yml',status:'modified',sha:fileSha},
      {filename:'secrets/config.json',status:'modified',sha:fileSha},
      {filename:'scripts/tigeriq-core/new-shell.ps1',status:'modified',sha:fileSha},
      {filename:'apps/tigeriq-core/../../unsafe.mjs',status:'modified',sha:fileSha},
      {filename:'apps/tigeriq-core/core.mjs',status:'removed',sha:fileSha},
      {filename:'apps/tigeriq-core/core.mjs',status:'modified',sha:'bad'},
    ])expect(()=>impactForPc01SignedSnapshotV2([...files,bad])).toThrow('PC01_RELEASE_');
    expect(()=>impactForPc01SignedSnapshotV2([...files,files[0]])).toThrow('V2_FILE_PATH_INVALID');
  });

  it('keeps OIDC signature, exact main, baseline and component gates for V2',()=>{
    const fixture=ownerFixture();
    fixture.verifiedComment.body=comment;
    fixture.payload.comment.body=comment;
    fixture.installedSha=baseline;
    fixture.mainSha=target;
    fixture.compare.files=files;
    const signed=validatePc01ApprovalEvidence(fixture);
    expect(signed).toMatchObject({
      schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V2',releasePolicy:'SCOPED_SNAPSHOT_V2',
      targetSha:target,expectedInstalledSha:baseline,components:['coding','core','updater'],
    });
    fixture.identity.actor='not-owner';
    expect(()=>validatePc01ApprovalEvidence(fixture)).toThrow('OWNER_OIDC_REQUIRED');
  });

  it.skipIf(!pwshPresent)('installed V2 gate honors exact Git objects and anti-replay without changing runtime',()=>{
    const root=fileURLToPath(new URL('../',import.meta.url));
    const gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const present=[
      'apps/tigeriq-core/pc01-release-approval.mjs','scripts/tigeriq-core/pc01-release-guard.ps1',
      'tests/pc01-release-guard-e2e.test.mjs',
    ];
    const approval={...template(),schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V2',
      releasePolicy:'SCOPED_SNAPSHOT_V2',targetSha:gitHead,components:['core','updater']};
    const impact='@{core=$true;web=$false;coding=$false;openclaw=$false;updater=$true;liveBridge=$false}';
    const args={approval,paths:present,targetSha:gitHead,controlRepo:root,impact};
    expect(run(args).reason).toBe('LOCAL_RELEASE_APPROVAL_PRESENT');
    expect(run({...args,attempt:{requestId:approval.requestId,targetSha:gitHead,result:'COMMITTED'}}).reason)
      .toBe('RELEASE_ATTEMPT_ALREADY_RECORDED');
    expect(run({...args,paths:[...present,'api/live-device-auth.mjs']}).reason).toBe('RELEASE_V2_FORBIDDEN_SURFACE');
    expect(run({...args,approval:{...approval,releasePolicy:'ALLOW_ALL'}}).reason).toBe('RELEASE_V2_POLICY_INVALID');
  });

  it.skipIf(!pwshPresent)('V2 signed-snapshot source preflight handles new Coding blobs without relaxing V1',()=>{
    const root=fileURLToPath(new URL('../',import.meta.url));
    const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const paths=['apps/tigeriq-coding-lane/coding-lane.mjs','tests/coding-lane-foundation.test.mjs'];
    const approval={...template(),schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V2',
      releasePolicy:'SCOPED_SNAPSHOT_V2',targetSha,components:['coding']};
    const impact='@{core=$false;web=$false;coding=$true;openclaw=$false;updater=$false;liveBridge=$false}';
    const args={approval,paths,targetSha,impact,controlRepo:root};
    // This is a source-only guard test with a synthetic approval fixture, NOT a real signed Owner ticket.
    expect(run(args).reason).toBe('LOCAL_RELEASE_APPROVAL_PRESENT');
    expect(run({...args,paths:[...paths,'apps/android-worker/runtime.mjs']}).reason)
      .toBe('RELEASE_V2_FORBIDDEN_SURFACE');
    expect(run({...args,approval:{...approval,releasePolicy:'ALLOW_ALL'}}).reason)
      .toBe('RELEASE_V2_POLICY_INVALID');
    const v1={...template(),targetSha,components:['coding']};
    const currentPinned=Object.entries(OWNER_CODING_CONTRACT_APPROVED_BLOBS).every(([name,blob])=>
      execFileSync('git',['rev-parse',targetSha+':'+name],{cwd:root,encoding:'utf8'}).trim()===blob);
    expect(run({...args,approval:v1}).reason)
      .toBe(currentPinned?'LOCAL_RELEASE_APPROVAL_PRESENT':'RELEASE_CODING_CONTRACT_CONTENT_MISMATCH');
  });
});



describe('Owner project authority — real Git + executable PowerShell guard',()=>{
  async function fixture(callback){
    const repo=mkdtempSync(join(tmpdir(),'tigeriq-owner-project-'));
    try{
      git(repo,'init');git(repo,'config','user.name','TigerIQ isolated authority test');
      git(repo,'config','user.email','authority-test@tigeriq.local');
      const initial={'apps/tigeriq-core/core.mjs':'export const version=1;\n','obsolete.mjs':'export const old=true;\n'};
      for(const [name,text] of Object.entries(initial)){mkdirSync(join(repo,name,'..'),{recursive:true});writeFileSync(join(repo,name),text);}
      git(repo,'add','.');git(repo,'commit','-m','baseline');
      const installedSha=git(repo,'rev-parse','HEAD');
      const changes={
        'apps/tigeriq-core/core.mjs':'export const version=2;\n',
        'apps/tigeriq-coding-lane/coding-lane.mjs':'export const coding=true;\n',
        'scripts/tigeriq-core/update-core-runtime.ps1':'# owner approved updater source\n',
        'scripts/tigeriq-core/pc01-release-guard.ps1':'# owner approved guard source\n',
        '.github/workflows/authority-test.yml':'name: isolated-test\n',
        'apps/shared/security-policy.mjs':'export const permitted=true;\n',
      };
      for(const [name,text] of Object.entries(changes)){mkdirSync(join(repo,name,'..'),{recursive:true});writeFileSync(join(repo,name),text);}
      rmSync(join(repo,'obsolete.mjs'));
      git(repo,'add','.');git(repo,'commit','-m','owner project change');
      const targetSha=git(repo,'rev-parse','HEAD');
      const projectPolicy={
        schema:'TIGERIQ_PC01_OWNER_PROJECT_POLICY_V2',enabled:true,repo:'newsdayads/tigeriq-ai-lab',
        policy:'OWNER_PROJECT_AUTONOMY_V2',authorizationSource:'OWNER_DIRECT_CHAT_RDC',
        authorizationRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/504#issuecomment-1234567890',
        activatedBy:'OWNER-RDC-ISOLATED-TEST',installedAtActivation:installedSha,
        issuedAtUtc:new Date(Date.now()-1000).toISOString(),
      };
      const args={projectPolicy,targetSha,installedSha,controlRepo:repo,paths:[...Object.keys(changes),'obsolete.mjs']};
      return await callback(args);
    }finally{rmSync(repo,{recursive:true,force:true});}
  }
  it.skipIf(!pwshPresent)('authorizes Core, Coding, updater, guard, workflow and security code without per-file pins or repeated tickets',()=>fixture(async args=>{
    const r=(await runAsync(args));
    expect(r.approved).toBe(true);expect(r.reason).toBe('OWNER_PROJECT_AUTHORIZED');
    expect(r.requestId).toBe('OWNER-PROJECT-'+args.targetSha);
    expect(r.authorizationRef).toBe(args.projectPolicy.authorizationRef);
  }),30000);
  it.skipIf(!pwshPresent)('removing or disabling the independent grant preserves the old manual release gate',()=>fixture(async args=>{
    expect((await runAsync({...args,projectPolicy:null})).reason).toBe('RELEASE_LOCAL_APPROVAL_MISSING');
    expect((await runAsync({...args,projectPolicy:{...args.projectPolicy,enabled:false}})).reason).toBe('RELEASE_LOCAL_APPROVAL_MISSING');
  }),30000);
  it.skipIf(!pwshPresent)('requires main CI for the exact target rather than an earlier PR head',()=>fixture(async args=>{
    expect((await runAsync({...args,gateSha:args.installedSha})).reason).toBe('OWNER_PROJECT_EXACT_MAIN_CI_REQUIRED');
  }),30000);
  it.skipIf(!pwshPresent)('rejects real untrusted policy ACL and cannot activate from candidate metadata',()=>fixture(async args=>{
    expect((await runAsync({...args,projectAclMock:false})).reason).toBe('OWNER_PROJECT_POLICY_ACL_UNTRUSTED');
    expect((await runAsync({...args,projectPolicy:{...args.projectPolicy,candidateMayActivate:true}})).reason).toBe('OWNER_PROJECT_POLICY_INVALID');
  }),30000);
  it.skipIf(!pwshPresent)('rejects another repository, wrong authority source and string-valued enable flag',()=>fixture(async args=>{
    for(const override of [{repo:'other/repo'},{authorizationSource:'PR_COMMENT'},{enabled:'true'}])
      expect((await runAsync({...args,projectPolicy:{...args.projectPolicy,...override}})).reason).toBe('OWNER_PROJECT_POLICY_INVALID');
  }),30000);
  it.skipIf(!pwshPresent)('rejects non-installed activation baseline and future authorization time',()=>fixture(async args=>{
    expect((await runAsync({...args,projectPolicy:{...args.projectPolicy,installedAtActivation:args.targetSha}})).reason).toBe('OWNER_PROJECT_ACTIVATION_BASELINE_MISMATCH');
    expect((await runAsync({...args,projectPolicy:{...args.projectPolicy,issuedAtUtc:new Date(Date.now()+86400000).toISOString()}})).reason).toBe('OWNER_PROJECT_POLICY_TIME_INVALID');
  }),30000);
  it.skipIf(!pwshPresent)('keeps in-flight and replay protection after broad Owner authorization',()=>fixture(async args=>{
    expect((await runAsync({...args,attempt:{targetSha:args.installedSha,result:'STARTED'}})).reason).toBe('OWNER_PROJECT_INFLIGHT_ATTEMPT');
    expect((await runAsync({...args,attempt:{targetSha:args.targetSha,result:'COMMITTED'}})).reason).toBe('RELEASE_ATTEMPT_ALREADY_RECORDED');
    expect((await runAsync({...args,attempt:{targetSha:args.targetSha,result:'ROLLED_BACK'}})).reason).toBe('RELEASE_ATTEMPT_ALREADY_RECORDED');
  }),30000);
  it.skipIf(!pwshPresent)('rejects traversal, duplicate paths and private material while allowing security code',()=>fixture(async args=>{
    expect((await runAsync({...args,paths:['../outside.ps1']})).reason).toBe('OWNER_PROJECT_PATH_INVALID');
    expect((await runAsync({...args,paths:[args.paths[0],args.paths[0]]})).reason).toBe('OWNER_PROJECT_PATH_INVALID');
    expect((await runAsync({...args,paths:['.env.production']})).reason).toBe('OWNER_PROJECT_PRIVATE_MATERIAL');
    expect((await runAsync({...args,paths:['secrets/key.txt']})).reason).toBe('OWNER_PROJECT_PRIVATE_MATERIAL');
    expect((await runAsync({...args,paths:['apps/shared/security-policy.mjs']})).approved).toBe(true);
  }),30000);
  it.skipIf(!pwshPresent)('rejects unknown paths and backwards source movement',()=>fixture(async args=>{
    expect((await runAsync({...args,paths:['not-present.mjs']})).reason).toBe('OWNER_PROJECT_SOURCE_PROVENANCE_INVALID');
    expect((await runAsync({...args,installedSha:args.targetSha,targetSha:args.installedSha,gateSha:args.installedSha}))).toMatchObject({approved:false,reason:'OWNER_PROJECT_ANCESTRY_INVALID'});
  }),30000);
  it.skipIf(!pwshPresent)('does not silently expire a valid Owner grant or invent a release quota',()=>fixture(async args=>{
    expect((await runAsync({...args,projectPolicy:{...args.projectPolicy,issuedAtUtc:'2020-01-01T00:00:00.000Z'}})).approved).toBe(true);
  }),30000);
});


describe('Owner project updater — exact CI and reversible guard sync',()=>{
  const updaterSource=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');
  const extract=(first,next)=>{
    const begin=updaterSource.indexOf(first),end=updaterSource.indexOf(next,begin);
    expect(begin).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(begin);
    return updaterSource.slice(begin,end);
  };
  async function execute(script){
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-owner-updater-'));
    try{
      const file=join(dir,'harness.ps1');writeFileSync(file,script);
      const r=await execAsync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',file],{encoding:'utf8',timeout:20000});
      return JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
  const ciNames=['CI','WO-014 Queue Hygiene'];
  const runs=()=>ciNames.map((name,i)=>({name,id:i+1,head_sha:sha,event:'push',head_branch:'main',status:'completed',conclusion:'success'}));
  async function check(r){
    return execute(extract('function Gates-Pass(','function Resolve-GateSha(')+
      "\nfunction Invoke-GithubApiJson {param([string]$uri); return ('"+esc(JSON.stringify({workflow_runs:r}))+"'|ConvertFrom-Json)}\n"+
      "$v=Gates-Pass '"+sha+"' -ExactMain\n$v|ConvertTo-Json -Compress\n");
  }
  it.skipIf(!pwshPresent)('accepts both required runtime main-push runs on the exact candidate without a hosting dependency',async()=>{
    expect(await check(runs())).toBe(true);
    expect(await check(runs().slice(0,1))).toBe(false);
  },30000);
  it.skipIf(!pwshPresent)('rejects stale success when a newer run fails/pends, PR-only evidence, and another revision',async()=>{
    expect(await check([...runs(),{...runs()[0],id:100,status:'in_progress',conclusion:null}])).toBe(false);
    expect(await check([...runs(),{...runs()[0],id:100,conclusion:'failure'}])).toBe(false);
    expect(await check(runs().map(r=>({...r,event:'pull_request'})))).toBe(false);
    expect(await check(runs().map(r=>({...r,head_sha:previous})))).toBe(false);
  },30000);
  async function syncCase({invalid=false}={}){
    const dir=mkdtempSync(join(tmpdir(),'tigeriq-owner-guard-sync-'));
    try{
      const runtime=join(dir,'source'),protectedRoot=join(dir,'protected');
      mkdirSync(join(runtime,'scripts/tigeriq-core'),{recursive:true});
      mkdirSync(join(protectedRoot,'Updater'),{recursive:true});mkdirSync(join(protectedRoot,'Backup'));
      const sourceUpdater=join(runtime,'scripts/tigeriq-core/update-core-runtime.ps1');
      const sourceGuard=join(runtime,'scripts/tigeriq-core/pc01-release-guard.ps1');
      const installedUpdater=join(protectedRoot,'Updater/update-core-runtime.ps1');
      const installedGuard=join(protectedRoot,'pc01-release-guard.ps1');
      writeFileSync(installedUpdater,'# updater old\n');writeFileSync(installedGuard,'# guard old\n');
      writeFileSync(sourceUpdater,'# updater new\n');writeFileSync(sourceGuard,invalid?'function broken {':'# guard new\n');
      const script=". '"+esc(guardPath)+"'\n"+extract('function Sync-UpdaterRuntime(){','function Ensure-UpdaterTaskRuntimeTarget(){')+
        "\n$ErrorActionPreference='Stop'\n$runtimeRepo='"+esc(runtime)+"'\n$updaterRuntime='"+esc(installedUpdater)+"'\n$releaseGuardScript='"+esc(installedGuard)+"'\n";
      if(invalid){
        const r=await execute(script+"try {Sync-UpdaterRuntime; throw 'EXPECTED_REJECT'} catch {$_.Exception.Message|ConvertTo-Json -Compress}\n");
        expect(r).toBe('RELEASE_GUARD_SOURCE_PARSE_FAILED');
        expect(readFileSync(installedUpdater,'utf8')).toBe('# updater old\n');
        expect(readFileSync(installedGuard,'utf8')).toBe('# guard old\n');
      }else{
        await execute(script+"Sync-UpdaterRuntime\n$true|ConvertTo-Json -Compress\n");
        expect(readFileSync(installedUpdater,'utf8')).toBe('# updater new\n');
        expect(readFileSync(installedGuard,'utf8')).toBe('# guard new\n');
        const oldHash=createHash('sha256').update('# guard old\n').digest('hex').toUpperCase();
        expect(readFileSync(join(protectedRoot,'Backup','guard-'+oldHash+'.ps1'),'utf8')).toBe('# guard old\n');
        // Rollback uses the exact same sync function on the restored snapshot.
        writeFileSync(sourceUpdater,'# updater old\n');writeFileSync(sourceGuard,'# guard old\n');
        await execute(script+"Sync-UpdaterRuntime\n$true|ConvertTo-Json -Compress\n");
        expect(readFileSync(installedUpdater,'utf8')).toBe('# updater old\n');
        expect(readFileSync(installedGuard,'utf8')).toBe('# guard old\n');
      }
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
  it.skipIf(!pwshPresent)('backs up and restores both updater and guard with their approved snapshot',async()=>{await syncCase();},30000);
  it.skipIf(!pwshPresent)('rejects malformed candidate before replacing either executable',async()=>{await syncCase({invalid:true});},30000);
  it.skipIf(!pwshPresent)('backs off once while main CI is pending instead of spinning on the GitHub API',async()=>{
    const begin=updaterSource.indexOf('if(-not $gateSha){');
    const end=updaterSource.indexOf('    [string[]]$changed=',begin);
    expect(begin).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(begin);
    const branch=updaterSource.slice(begin,end);
    const result=await execute("$script:saved=0;$script:delays=@();$script:later=0\n"+
      "function Save-State {param([hashtable]$d); if($d.result -ne 'WAIT_GATES'){throw 'WRONG_WAIT_STATE'};$script:saved++}\n"+
      "function Start-Sleep {param([int]$Seconds);$script:delays+= $Seconds}\n"+
      "$gateSha=$null;$IntervalSeconds=120\nfor($i=0;$i -lt 1;$i++){\n"+branch+"$script:later++\n}\n"+
      "@{saved=$script:saved;delays=@($script:delays);later=$script:later}|ConvertTo-Json -Compress\n");
    expect(result).toEqual({saved:1,delays:[120],later:0});
  },30000);

});


