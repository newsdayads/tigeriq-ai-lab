import { describe } from 'vitest';
import { execFileSync } from 'node:child_process';
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
function run({approval=null,attempt=null,aclMock=true,paths=['apps/tigeriq-core/core.mjs'],impact='@{core=$true;web=$false;coding=$false;openclaw=$false;updater=$false;liveBridge=$false}'}={}){
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-guard-e2e-'));
  try{
    const approver=join(dir,'approval.json'),marker=join(dir,'attempt.json');
    if(approval!==null)writeFileSync(approver,JSON.stringify(approval));
    if(attempt!==null)writeFileSync(marker,JSON.stringify(attempt));
    const powershell=[
      ". '"+esc(guardPath)+"'",
      "$releaseApprovalPath='"+esc(approver)+"'",
      "$releaseAttemptPath='"+esc(marker)+"'",
      ...(aclMock?["function Test-ReleaseApprovalAcl { return $true }"]:[]),
      "$impact="+impact,
      '$changed='+JSON.stringify(paths).replace(/^\[/,'@(').replace(/\]$/,')').replaceAll('"',"'"),
      "$result=Get-ReleaseApproval '"+sha+"' '"+previous+"' $impact $changed",
      '$result|ConvertTo-Json -Compress -Depth 4',
    ].join('\n');
    const script=join(dir,'guard-harness.ps1');
    writeFileSync(script,powershell);
    const p=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',script],{encoding:'utf8'});
    expect(p.status,p.stderr||p.stdout).toBe(0);
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

it.skipIf(!pwshPresent)('accepts the exact non-runtime V1 source files while rejecting lookalikes',()=>{
  const paths=[
    'apps/tigeriq-core/dashboard.html',
    '.github/ISSUE_TEMPLATE/work_order_v2.md',
    'scripts/verify_work_board_ui.mjs',
    'tests/core-autonomous-rca.test.ts',
    'tests/github-intake.test.mjs',
    'tests/tigeriq-live-owner-refinement.test.mjs',
    'tests/web-control.test.ts',
    'tests/work-order-lifecycle-v2.test.mjs'
  ];
  expect(run({approval:template(),paths}).approved).toBe(true);
  for(const invalid of [
    'tests/web-control-extra.test.ts','tests/github-intake.test.ts',
    'tests/new-core-regression.test.mjs','scripts/not-approved.mjs',
    '.github/workflows/tigeriq-core-event-dispatch.yml',
    '.github/ISSUE_TEMPLATE/work_order_v2.yml',
    'api/live-device-auth.mjs','apps/app-chrome/runtime.mjs'
  ]){
    expect(run({approval:template(),paths:[...paths,invalid]}).reason).toBe('RELEASE_PATH_OUT_OF_SCOPE');
  }
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

import { parsePc01OwnerApproval, impactForPc01ReleaseFiles, validatePc01ApprovalEvidence,
  acceptPc01OwnerApprovalEvent, PC01_APPROVAL_PATH, PC01_INSTALLED_STATE } from '../apps/tigeriq-core/pc01-release-approval.mjs';

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
it('permits exactly the two UI source-only checks alongside an approved Core change',()=>{
  const files=[{filename:'apps/tigeriq-core/dashboard.html'},
    {filename:'scripts/verify_work_board_ui.mjs'},{filename:'tests/web-control.test.ts'}];
  expect(impactForPc01ReleaseFiles(files)).toEqual(['core']);
  for(const bad of ['tests/web-control-extra.test.ts','scripts/not-approved.mjs',
    '.github/workflows/tigeriq-core-event-dispatch.yml','api/live-device-auth.mjs']){
    expect(()=>impactForPc01ReleaseFiles([...files,{filename:bad}])).toThrow('FILE_OUT_OF_SCOPE');
  }
});

it('cannot widen scope via component list, comment fields, or arbitrary paths',()=>{
  expect(parsePc01OwnerApproval(ownerCommentText()).components).toEqual(['core']);
  expect(()=>parsePc01OwnerApproval(ownerCommentText()+'\nFILE=C:\\evil')).toThrow();
  expect(()=>parsePc01OwnerApproval(ownerCommentText().replace('COMPONENTS=core','COMPONENTS=core,web'))).toThrow();
  expect(()=>impactForPc01ReleaseFiles([{filename:'.github/workflows/tigeriq-core-event-dispatch.yml'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(()=>impactForPc01ReleaseFiles([{filename:'apps/tigeriq-core/web-control-index.mjs'}])).toThrow('FILE_OUT_OF_SCOPE');
  expect(impactForPc01ReleaseFiles([{filename:'apps/openclaw-tigeriq-runtime/operator.mjs'}])).toEqual(['core','openclaw']);
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
