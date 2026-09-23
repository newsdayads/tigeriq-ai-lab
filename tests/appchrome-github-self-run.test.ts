import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  activeAppChromeClaims,
  buildSelfRunPrompt,
  claimGithubIssue,
  eligibleIssuesForWorker,
  isSelfRunSafe,
  parseWorkOrderMetadata,
  terminalMarkerFromComments,
  workerEligibleForIssue,
  type GithubIssue,
} from '../apps/chrome-controller/src/github-self-run.js';

function issue(number:number,title:string,body:string):GithubIssue{
  return {number,title,body,html_url:`https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}`,state:'open',updated_at:'2026-09-23T10:00:00Z'};
}
const SAFE=[
  'TIGERIQ_EXECUTABLE=true',
  'ZERO_COST=true',
  'NO_DIRECT_MAIN=true',
  'NO_PRODUCTION_RELEASE=true',
  'NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true',
  'NO_DESTRUCTIVE=true',
].join('\n');

describe('App Chrome GitHub self-run policy',()=>{
  it('uses last metadata occurrence so Owner overrides are authoritative',()=>{
    const meta=parseWorkOrderMetadata('TIGERIQ_EXECUTABLE=false\nTIGERIQ_EXECUTABLE=true\nPRIORITY=P1\nPRIORITY=P0');
    expect(meta.TIGERIQ_EXECUTABLE).toBe('true');
    expect(meta.PRIORITY).toBe('P0');
  });

  it('keeps hard-gated or coding mutation work out of UI self-run',()=>{
    const unsafe=issue(1,'unsafe',SAFE.replace('NO_PRODUCTION_RELEASE=true','NO_PRODUCTION_RELEASE=false'));
    expect(isSelfRunSafe(unsafe)).toBe(false);
    const coding=issue(2,'coding',SAFE+'\nAUTONOMOUS_CODE=true\nRESOURCE_SCOPE=CORE_FIX');
    expect(workerEligibleForIssue('NV02',coding)).toBe(false);
    expect(workerEligibleForIssue('NV03',coding)).toBe(false);
    expect(workerEligibleForIssue('NV04',coding)).toBe(false);
  });

  it('routes execution to NV02, review to NV03/NV04, research to NV04',()=>{
    const execution=issue(10,'[P0] Read-only integration',SAFE+'\nOWNER_DIRECT=true\nPRIORITY=P0\nRESOURCE_SCOPE=READ_ONLY_INTEGRATION');
    const review=issue(11,'[REVIEW][P0] Verify change',SAFE+'\nPRIORITY=P0\nREVIEW_ONLY=true\nCAPABILITY=review\nRESOURCE_SCOPE=REVIEW_X');
    const research=issue(12,'[RESEARCH][P1] Cross-check',SAFE+'\nPRIORITY=P1\nCAPABILITY=research\nRESOURCE_SCOPE=RESEARCH_X');
    expect(workerEligibleForIssue('NV02',execution)).toBe(true);
    expect(workerEligibleForIssue('NV02',review)).toBe(false);
    expect(workerEligibleForIssue('NV03',review)).toBe(true);
    expect(workerEligibleForIssue('NV04',review)).toBe(true);
    expect(workerEligibleForIssue('NV03',research)).toBe(false);
    expect(workerEligibleForIssue('NV04',research)).toBe(true);
  });

  it('respects scope collision and Owner/P0 priority',()=>{
    const issues=[
      issue(21,'P1',SAFE+'\nPRIORITY=P1\nRESOURCE_SCOPE=A'),
      issue(22,'Owner P0',SAFE+'\nOWNER_DIRECT=true\nPRIORITY=P0\nRESOURCE_SCOPE=B'),
      issue(23,'Blocked scope',SAFE+'\nOWNER_DIRECT=true\nPRIORITY=P0\nRESOURCE_SCOPE=BUSY'),
    ];
    const out=eligibleIssuesForWorker('NV02',issues,new Set(['BUSY']));
    expect(out.map(x=>x.number)).toEqual([22,21]);
  });

  it('creates exactly one durable claim and refuses a second active claim',async()=>{
    const target=issue(30,'Review',SAFE+'\nREVIEW_ONLY=true\nCAPABILITY=review\nRESOURCE_SCOPE=REVIEW_30');
    const comments:any[]=[];
    let nextId=1;
    const fetchImpl=async(url:any,init:any={})=>{
      const u=String(url);
      if(u.endsWith('/issues/30/comments?per_page=100'))return new Response(JSON.stringify(comments),{status:200});
      if(u.endsWith('/issues/30/comments')&&init.method==='POST'){
        comments.push({id:nextId++,body:JSON.parse(String(init.body)).body,created_at:new Date().toISOString()});
        return new Response(JSON.stringify(comments.at(-1)),{status:201});
      }
      return new Response('{}',{status:404});
    };
    const first=await claimGithubIssue({workerId:'NV03',issue:target,fetchImpl:fetchImpl as typeof fetch,token:'x'});
    expect(first?.issueNumber).toBe(30);
    expect(activeAppChromeClaims(comments)).toHaveLength(1);
    const second=await claimGithubIssue({workerId:'NV04',issue:target,fetchImpl:fetchImpl as typeof fetch,token:'x'});
    expect(second).toBeNull();
    expect(activeAppChromeClaims(comments)).toHaveLength(1);
  });

  it('recognizes terminal worker evidence and builds a bounded full-issue prompt',()=>{
    expect(terminalMarkerFromComments([{id:1,body:'STATE=BLOCKED\nblocker=x'}])).toBe('BLOCKED');
    expect(terminalMarkerFromComments([{id:2,body:'REVIEW=PASS\nevidence=ok'}])).toBe('DONE');
    const target=issue(40,'Review',SAFE+'\nREVIEW_ONLY=true\nRESOURCE_SCOPE=R40');
    const prompt=buildSelfRunPrompt('NV03',target,[],{claimId:'abc',workerId:'NV03',scope:'R40',issueNumber:40,expiresAt:'2099-01-01T00:00:00Z',createdAt:'2026-09-23T00:00:00Z'});
    expect(prompt).toContain('APP_CHROME_SELF_RUN=true');
    expect(prompt).toContain('CURRENT_WORK_ORDER=#40 - Review');
    expect(prompt).toContain('--- FULL ISSUE ---');
    expect(prompt).toContain('đóng chính issue này');
  });
});

describe('App Chrome self-run wiring',()=>{
  const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
  const supervisor=readFileSync('apps/chrome-controller/runtime/Start-Unified-AppChrome.ps1','utf8');

  it('runs independently of external Core assignment while keeping Core available for collision hints',()=>{
    expect(server).toContain("const selfRunEnabled=process.env.TIGERIQ_APP_CHROME_SELF_RUN!=='0'");
    expect(server).toContain('listOpenGithubIssues');
    expect(server).toContain('claimGithubIssue');
    expect(server).toContain('eligibleIssuesForWorker');
    expect(server).toContain('bestEffortExternalActiveScopes');
    expect(server).toContain('scheduleSelfRunTick(5000)');
    expect(server).toContain("source:'APP_CHROME_SELF_RUN'");
    expect(server).not.toContain('if(!config.autopilot.enabled)return false; // self-run gate');
  });

  it('reuses the existing PC01 GitHub token file without changing credentials',()=>{
    expect(supervisor).toContain("github-command-center.token");
    expect(supervisor).toContain('$env:TIGERIQ_GITHUB_TOKEN=');
    expect(supervisor).toContain("$env:TIGERIQ_APP_CHROME_SELF_RUN='1'");
  });
});
