import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Use the actual production parser without booting the Core HTTP server or DB.
const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const match=source.match(/export function parseGithubCoreReviewEvidence\(text,prompt=''\)\{([\s\S]*?)\n\}\n\nasync function reconcileGithubCoreReviewObjective/);
if(!match)throw new Error('CORE_REVIEW_PRODUCTION_PARSER_NOT_FOUND');
const parse=runInNewContext("(function(text,prompt){"+match[1]+"\n})");
const retrySource=source.match(/export function githubReviewFormatRetryEligible\([\s\S]*?\n\}\nexport function githubReviewFormatRetryPrompt\([\s\S]*?\n\}\n/);
if(!retrySource)throw new Error('GITHUB_REVIEW_RETRY_HELPERS_NOT_FOUND');
const retryFns=runInNewContext(retrySource[0].replaceAll('export function ','function ')+
  '\n({eligible:githubReviewFormatRetryEligible,prompt:githubReviewFormatRetryPrompt})');

const head='e7f4f7dcd3c59de2c8e81ebc93982de59c62e5bc';
const prompt='Source review\nTARGET_HEAD='+head;
const valid=['[TIGERIQ_INDEPENDENT_REVIEW_V1]','REVIEW=CHANGES_REQUIRED','TARGET_HEAD='+head,'SUMMARY=Root-cause evidence is incomplete','FINDINGS=No post-deploy recurrence was verified'].join('\n');

describe('Core independent-review failure diagnostics for #2788',()=>{
  it('accepts only well-formed exact-head independent review evidence',()=>{
    const evidence=parse(valid,prompt);
    expect(evidence.schema).toBe('TIGERIQ_INDEPENDENT_REVIEW_V1');
    expect(evidence.decision).toBe('CHANGES_REQUIRED');
    expect(evidence.targetHead).toBe(head);
    expect(evidence.findings).toContain('post-deploy');
  });
  it('keeps the invalid-review gate closed and classifies missing fields without raw model text',()=>{
    const invalid='Other model output: secret=must-not-persist\nTARGET_HEAD='+head+'\nSUMMARY=Partial';
    let caught=null;
    try{parse(invalid,prompt);}catch(e){caught=e;}
    expect(caught?.message).toBe('CORE_REVIEW_EVIDENCE_INVALID');
    expect(caught?.detail).toEqual({
      expectedHead:head,targetHead:head,decision:null,
      markerPresent:false,summaryPresent:true,findingsPresent:false,
    });
    expect(JSON.stringify(caught.detail)).not.toContain('must-not-persist');
  });
  it('rejects a stale head even with a PASS token',()=>{
    let caught=null;
    const stale=valid.replace('REVIEW=CHANGES_REQUIRED','REVIEW=PASS').replace('TARGET_HEAD='+head,'TARGET_HEAD='+'a'.repeat(40));
    try{parse(stale,prompt);}catch(e){caught=e;}
    expect(caught?.message).toBe('CORE_REVIEW_EVIDENCE_INVALID');
    expect(caught?.detail?.decision).toBe('PASS');
    expect(caught?.detail?.targetHead).toBe('a'.repeat(40));
    expect(caught?.detail?.expectedHead).toBe(head);
  });
  it('permits at most one format correction by the same zero-cost reviewer within existing attempt budget',()=>{
    const valid={kind:'github_review',message:'CORE_REVIEW_EVIDENCE_INVALID',
      resource:{costTier:'FREE',zeroOutOfPocket:true},attempts:1,maxAttempts:2,expectedHead:head};
    expect(retryFns.eligible(valid)).toBe(true);
    expect(retryFns.eligible({...valid,attempts:2})).toBe(false);
    expect(retryFns.eligible({...valid,maxAttempts:1})).toBe(false);
    expect(retryFns.eligible({...valid,kind:'coding'})).toBe(false);
    expect(retryFns.eligible({...valid,message:'RESOURCE_ERROR'})).toBe(false);
    expect(retryFns.eligible({...valid,expectedHead:'not-a-sha'})).toBe(false);
    expect(retryFns.eligible({...valid,resource:{costTier:'PAID',zeroOutOfPocket:false}})).toBe(false);
    expect(retryFns.eligible({...valid,resource:{costTier:'FREE',zeroOutOfPocket:false}})).toBe(false);
    expect(retryFns.eligible({...valid,resource:{costTier:'LOCAL',zeroOutOfPocket:true}})).toBe(true);
  });
  it('provides original exact-head evidence and strict fail-closed format without invented decisions',()=>{
    const base='Review the exact PR patch; do not invent any source facts.';
    const text=retryFns.prompt(base,head);
    expect(text).toContain(base);
    expect(text).toContain('TARGET_HEAD='+head);
    expect(text).toContain('CHANGES_REQUIRED');
    expect(text).toContain('The previous response was rejected');
    expect(text).toContain('\nLine 1 is literally');
    expect(text).not.toContain('REVIEW=PASS\n');
    expect(()=>retryFns.prompt(base,'bad-sha')).toThrow('CORE_REVIEW_RETRY_HEAD_INVALID');
  });
  it('wires review format correction only after validation and keeps resource identity fixed',()=>{
    expect(source).toContain("if(j.kind==='github_review'){");
    expect(source).toContain("reviewEvidence=parseGithubCoreReviewEvidence(routed.text,j.prompt);");
    expect(source).toContain('githubReviewFormatRetryEligible({');
    expect(source).toContain("select attempts,max_attempts from tigeriq_jobs where id=$1");
    expect(source).toContain('employeeAllowlist:[originalResource.id]');
    expect(source).toContain('if(retry.resource.resourceId!==originalResource.resourceId)');
    expect(source).toContain("throw Object.assign(new Error('CORE_REVIEW_RETRY_IDENTITY_CHANGED')");
    expect(source).toContain("GITHUB_CORE_REVIEW_FORMAT_RETRY");
    expect(source).toContain("GITHUB_CORE_REVIEW_FORMAT_RECOVERED");
  });
  it('stores only bounded schema diagnostics on rejected review jobs and audit events',()=>{
    expect(source).toContain("j.kind==='github_review'&&message==='CORE_REVIEW_EVIDENCE_INVALID'");
    expect(source).toContain("if(reviewValidation)await event('GITHUB_CORE_REVIEW_EVIDENCE_DIAGNOSTIC'");
    expect(source).toContain('JSON.stringify({message,failures,...(reviewValidation?{reviewValidation}:{})})');
    expect(source).toContain("summaryPresent:error?.detail?.summaryPresent===true");
    expect(source).not.toContain('reviewValidation:raw');
    expect(source).not.toContain('reviewValidation:routed.text');
  });
});
