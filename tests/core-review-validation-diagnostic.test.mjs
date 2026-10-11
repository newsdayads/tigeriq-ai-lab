import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Use the actual production parser without booting the Core HTTP server or DB.
const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const match=source.match(/export function parseGithubCoreReviewEvidence\(text,prompt=''\)\{([\s\S]*?)\n\}\n\nasync function reconcileGithubCoreReviewObjective/);
if(!match)throw new Error('CORE_REVIEW_PRODUCTION_PARSER_NOT_FOUND');
const parse=runInNewContext("(function(text,prompt){"+match[1]+"\n})");
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
  it('stores only bounded schema diagnostics on rejected review jobs and audit events',()=>{
    expect(source).toContain("j.kind==='github_review'&&message==='CORE_REVIEW_EVIDENCE_INVALID'");
    expect(source).toContain("if(reviewValidation)await event('GITHUB_CORE_REVIEW_EVIDENCE_DIAGNOSTIC'");
    expect(source).toContain('JSON.stringify({message,failures,...(reviewValidation?{reviewValidation}:{})})');
    expect(source).toContain("summaryPresent:error?.detail?.summaryPresent===true");
    expect(source).not.toContain('reviewValidation:raw');
    expect(source).not.toContain('reviewValidation:routed.text');
  });
});
