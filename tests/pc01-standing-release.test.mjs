import {it,expect} from 'vitest';
import {
  STANDING_POLICY_PATH,validateStandingActivation,classifyStandingReleaseFiles,
  validateStandingReleaseEvidence,acceptPc01StandingWorkflowRelease,
} from '../apps/tigeriq-core/pc01-standing-release.mjs';
import {readFileSync} from 'node:fs';

const old='1'.repeat(40),next='2'.repeat(40),blob='a'.repeat(40);
const now=Date.parse('2026-10-14T11:00:00.000Z');
const base={
  schema:'TIGERIQ_PC01_STANDING_POLICY_V1',enabled:true,repo:'newsdayads/tigeriq-ai-lab',
  policy:'SAFE_CORE_CODING_V1',activatedBy:'GH-38552916380-6166808319',
  installedAtActivation:old,issuedAtUtc:new Date(now-60000).toISOString(),
  expiresAtUtc:new Date(now-60000+30*86400000).toISOString(),
  maxReleases:12,releasesUsed:0,allowedComponents:['coding','core'],updaterBlobs:{},
};
const file=(filename)=>({filename,sha:blob,status:'modified'});
const files=[file('apps/tigeriq-core/manager-cycle-policy.mjs'),
  file('apps/tigeriq-coding-lane/ai-json-transport.mjs'),
  file('tests/manager-cycle-policy.test.mjs')];
const runId=38552916380;
const payload={action:'completed',repository:{full_name:'newsdayads/tigeriq-ai-lab'},
  workflow_run:{id:runId,name:'CI',head_sha:next}};
const verifiedRun={id:runId,name:'CI',status:'completed',conclusion:'success',
  event:'push',head_branch:'main',head_sha:next};
const identity={runId:'38552920000',claims:{event_name:'workflow_run',ref:'refs/heads/main',run_attempt:'1'}};
const checks=['CI Verify','Queue Hygiene Verify','Vercel Online Verify'].map(name=>({
  name,head_sha:next,status:'completed',conclusion:'success',app:{slug:'github-actions'}}));
const compare={status:'ahead',behind_by:0,ahead_by:2,total_commits:2,files};
const args=()=>({identity,eventName:'workflow_run',payload,verifiedRun,checks,policy:base,
  installedSha:old,mainSha:next,compare,nowMs:now});
const passes=()=>validateStandingReleaseEvidence(args());

it('one signed Owner comment creates only a fixed 30-day 12-release delegation',()=>{
  const body=['TIGERIQ_PC01_STANDING_ENABLE_V1','BASELINE_SHA='+old,'POLICY=SAFE_CORE_CODING_V1'].join('\n');
  const created=new Date(now-10000).toISOString();
  const comment={id:4725123,user:{login:'newsdayads'},body,created_at:created,updated_at:created,
    issue_url:'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/4725'};
  const input={identity:{actor:'newsdayads',runId:'38552916380',claims:{
    actor:'newsdayads',event_name:'issue_comment',ref:'refs/heads/main',run_attempt:'1'}},
  eventName:'issue_comment',payload:{action:'created',repository:{full_name:'newsdayads/tigeriq-ai-lab'},
    issue:{number:4725},sender:{login:'newsdayads'},comment},comment,
    installedSha:old,mainSha:old,nowMs:now};
  const grant=validateStandingActivation(input);
  expect(grant.allowedComponents).toEqual(['coding','core']);
  expect(grant.updaterBlobs).toEqual({});
  expect(grant.maxReleases).toBe(12);
  expect(grant.expiresAtUtc).toBe(new Date(now+30*86400000).toISOString());
  expect(()=>validateStandingActivation({...input,identity:{...input.identity,actor:'ci-bot'}})).toThrow('OWNER_OIDC_REQUIRED');
  expect(()=>validateStandingActivation({...input,mainSha:next})).toThrow('BASELINE_NOT_INSTALLED');
  expect(()=>validateStandingActivation({...input,comment:{...comment,updated_at:new Date(now).toISOString()}})).toThrow('COMMENT_READBACK_INVALID');
});

it('auto-dispatch uses the actual three GitHub Actions checks on one exact SHA',()=>{
  const ticket=passes();
  expect(ticket.components).toEqual(['coding','core']);
  expect(ticket.expectedInstalledSha).toBe(old);
  expect(ticket.targetSha).toBe(next);
  expect(ticket.requestId).toMatch(/^AUTO-\d+-[a-f0-9]{16}$/);
  expect(ticket.expiresAtUtc).toBe(new Date(now+10*60000).toISOString());
});
it('never accepts a fabricated workflow actor, action, revision or missing checks',()=>{
  for(const bad of [
    {identity:{runId:'2',claims:{event_name:'issue_comment',ref:'refs/heads/main',run_attempt:'1'}}},
    {payload:{...payload,workflow_run:{...payload.workflow_run,id:24}}},
    {verifiedRun:{...verifiedRun,event:'pull_request'}},
    {checks:checks.slice(0,2)},
    {checks:checks.map(x=>({...x,app:{slug:'untrusted'}}))},
    {mainSha:old},
    {compare:{...compare,behind_by:1}},
    {compare:{...compare,ahead_by:31}},
  ])expect(()=>validateStandingReleaseEvidence({...args(),...bad})).toThrow();
});
it('expires and exhausts authority without silently increasing limits',()=>{
  expect(()=>validateStandingReleaseEvidence({...args(),nowMs:now+30*86400000})).toThrow('STANDING_EXPIRED');
  expect(()=>validateStandingReleaseEvidence({...args(),policy:{...base,releasesUsed:12}})).toThrow('STANDING_POLICY_INVALID');
  expect(()=>validateStandingReleaseEvidence({...args(),policy:{...base,maxReleases:999}})).toThrow('STANDING_POLICY_INVALID');
  expect(()=>validateStandingReleaseEvidence({...args(),policy:{...base,updaterBlobs:{'scripts/tigeriq-core/update-core-runtime.ps1':blob}}})).toThrow('STANDING_POLICY_INVALID');
});
it('rejects all changes to the standing release authority, bootstrap, shell and UI',()=>{
  for(const p of [
    'apps/tigeriq-core/pc01-release-approval.mjs',
    'apps/tigeriq-core/pc01-standing-release.mjs',
    'apps/tigeriq-core/core.mjs',
    'apps/tigeriq-core/github-actions-oidc.mjs',
    'apps/tigeriq-coding-lane/coding-lane.mjs',
    'scripts/tigeriq-core/update-core-runtime.ps1',
    'scripts/tigeriq-core/pc01-release-guard.ps1',
    '.github/workflows/tigeriq-core-event-dispatch.yml',
    'apps/tigeriq-core/web-control.html',
    'public/work-center.js',
    'apps/app-chrome/app.mjs',
  ])expect(()=>classifyStandingReleaseFiles([file(p)])).toThrow();
  expect(()=>classifyStandingReleaseFiles([file('tests/only.test.mjs')])).toThrow('NO_RUNTIME_CHANGE');
  expect(()=>classifyStandingReleaseFiles([files[0],files[0]])).toThrow('FILE_PROVENANCE');
});
it('unactivated machine refuses without a network call or filesystem mutation',async()=>{
  let calls=0;
  const io={readFile:async()=>{const e=new Error('no policy');e.code='ENOENT';throw e;}};
  await expect(acceptPc01StandingWorkflowRelease({identity,eventName:'workflow_run',payload,
    io,platform:'win32',fetchImpl:async()=>{calls++;throw Error('network unauthorized');}}))
    .rejects.toThrow('NOT_ACTIVATED');
  expect(calls).toBe(0);
});
it('source integration cannot treat merge or current GH owner connection as activation',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/pc01-standing-release.mjs',import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../.github/workflows/tigeriq-core-event-dispatch.yml',import.meta.url),'utf8');
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  expect(source).toContain('TIGERIQ_PC01_STANDING_ENABLE_V1');
  expect(source).toContain('if(!policy)deny(');
  expect(source).toContain('ANOTHER_WRITER_OR_STALE_LOCK');
  // Preserve the independently signed issue/comment bridge already installed on PC01.
  expect(workflow).toContain('  issue_comment:');
  expect(workflow).toContain('  issues:');
  expect(workflow).not.toContain('  workflow_run:');
  expect(core).toContain('acceptPc01StandingWorkflowRelease');
  expect(core).toContain('enablePc01StandingRelease');
});


it('existing issues bridge is only a signed signal and cannot substitute Owner grant',()=>{
  const issue={id:280999,number:280,updated_at:'2026-10-14T10:55:00Z'};
  const verifiedIssue={id:280999,number:280,
    url:'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/280'};
  const trigger={...args(),eventName:'issues',
    identity:{runId:'38552920000',claims:{event_name:'issues',ref:'refs/heads/main',run_attempt:'1'}},
    payload:{action:'edited',repository:{full_name:'newsdayads/tigeriq-ai-lab'},issue},
    verifiedRun:null,verifiedIssue};
  expect(validateStandingReleaseEvidence(trigger).components).toEqual(['coding','core']);
  expect(()=>validateStandingReleaseEvidence({...trigger,policy:null})).toThrow('STANDING_POLICY_INVALID');
  expect(()=>validateStandingReleaseEvidence({...trigger,verifiedIssue:null})).toThrow('ISSUE_TRIGGER_NOT_VERIFIED');
  expect(()=>validateStandingReleaseEvidence({...trigger,payload:{...trigger.payload,issue:{...issue,id:1}}})).toThrow('ISSUE_TRIGGER_NOT_VERIFIED');
  expect(()=>validateStandingReleaseEvidence({...trigger,identity:{...trigger.identity,claims:{...trigger.identity.claims,event_name:'issue_comment'}}})).toThrow('WORKFLOW_OIDC_REQUIRED');
  expect(()=>validateStandingReleaseEvidence({...trigger,checks:checks.slice(0,2)})).toThrow('THREE_CI_CHECKS_REQUIRED');
});

it('issue comment signal only from audited central issue and actual GitHub readback',()=>{
  const issue={id:280999,number:280};
  const verifiedIssue={id:280999,number:280,
    url:'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/280'};
  const trigger={...args(),eventName:'issue_comment',
    identity:{runId:'38552920000',claims:{event_name:'issue_comment',ref:'refs/heads/main',run_attempt:'1'}},
    payload:{action:'created',repository:{full_name:'newsdayads/tigeriq-ai-lab'},issue,
      comment:{id:6167190663}},verifiedRun:null,verifiedIssue};
  expect(validateStandingReleaseEvidence(trigger).targetSha).toBe(next);
  expect(()=>validateStandingReleaseEvidence({...trigger,payload:{...trigger.payload,action:'edited'}})).toThrow('ISSUE_TRIGGER_NOT_VERIFIED');
  expect(()=>validateStandingReleaseEvidence({...trigger,payload:{...trigger.payload,issue:{id:1,number:4725}}})).toThrow('ISSUE_TRIGGER_NOT_VERIFIED');
  expect(()=>validateStandingReleaseEvidence({...trigger,verifiedIssue:{...verifiedIssue,url:'https://evil.example/issues/280'}})).toThrow('ISSUE_TRIGGER_NOT_VERIFIED');
});
