import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {compactPromptForChanges,expandCompactChanges,matchesExpectedSchema} from '../apps/tigeriq-coding-lane/ai-json-transport.mjs';
import {validateAggregatedGenerationChanges} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {isRetryableAiError,validateChanges} from '../apps/tigeriq-coding-lane/policy.mjs';

const generationPrompt=(path,content)=>`TASK: update only when needed
ALLOWED PATHS FOR THIS BATCH: ${path}
OTHER ALLOWED PATHS are handled in separate bounded batches; do not emit them here.
BATCH_NOOP_ALLOWED=true
If this batch needs no mutation, return an explicit bounded no-op; do not invent an edit.
CURRENT FILES:
FILE ${path}
${content}
Return ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside this batch. Never output secrets. Keep changes minimal and testable.`;

describe('Coding Lane bounded batch no-op',()=>{
  it('accepts an explicit no-op only when the batch contract opts in',()=>{
    const prompt=generationPrompt('apps/a.mjs','const a=1;');
    const compact=compactPromptForChanges(prompt,{maxContextChars:6000,maxOutputChars:3200});
    expect(compact).toContain('BATCH_NOOP_ALLOWED=true');
    expect(compact).toContain('"noop":true');
    expect(matchesExpectedSchema(compact,JSON.stringify({summary:'no changes needed in this batch',noop:true,edits:[]}))).toBe(true);
    expect(expandCompactChanges(prompt,JSON.stringify({summary:'no changes needed in this batch',noop:true,edits:[]}))).toEqual({
      summary:'no changes needed in this batch',
      noop:true,
      changes:[],
    });

    const unmarked=prompt.replace('BATCH_NOOP_ALLOWED=true\n','');
    expect(matchesExpectedSchema(compactPromptForChanges(unmarked),JSON.stringify({summary:'no changes',noop:true,edits:[]}))).toBe(false);
    expect(()=>expandCompactChanges(unmarked,JSON.stringify({summary:'no changes',noop:true,edits:[]}))).toThrow('COMPACT_EDIT_SCHEMA_INVALID');
  });

  it('allows one multi-batch no-op when another batch supplies the real mutation',()=>{
    const batchA=generationPrompt('apps/a.mjs','const a=1;');
    const batchB=generationPrompt('tests/b.test.mjs','const b=1;');
    const a=expandCompactChanges(batchA,JSON.stringify({summary:'already correct',noop:true,edits:[]}));
    const b=expandCompactChanges(batchB,JSON.stringify({
      summary:'update test',
      edits:[{path:'tests/b.test.mjs',search:'const b=1;',replace:'const b=2;'}],
    }));
    const combined=[...a.changes,...b.changes];
    expect(combined).toEqual([{path:'tests/b.test.mjs',content:'const b=2;'}]);
    expect(validateAggregatedGenerationChanges(combined,['apps/a.mjs','tests/b.test.mjs'],2)).toBe(true);
  });

  it('terminalizes all explicit-noop batches with CODING_ALL_BATCHES_NOOP',()=>{
    const a=expandCompactChanges(generationPrompt('apps/a.mjs','const a=1;'),JSON.stringify({summary:'no change',noop:true,edits:[]}));
    const b=expandCompactChanges(generationPrompt('tests/b.test.mjs','const b=1;'),JSON.stringify({summary:'no change',noop:true,edits:[]}));
    const combined=[...a.changes,...b.changes];
    expect(()=>validateChanges(combined,['apps/a.mjs','tests/b.test.mjs'])).toThrow('CODING_CHANGES_COUNT_INVALID');
    try{validateAggregatedGenerationChanges(combined,['apps/a.mjs','tests/b.test.mjs'],2)}
    catch(error){
      expect(error.code).toBe('CODING_ALL_BATCHES_NOOP');
      expect(error.message).toBe('CODING_ALL_BATCHES_NOOP');
    }
  });

  it('preserves normal non-noop behavior',()=>{
    expect(validateAggregatedGenerationChanges([
      {path:'apps/a.mjs',content:'const a=2;'},
      {path:'tests/b.test.mjs',content:'const b=2;'},
    ],['apps/a.mjs','tests/b.test.mjs'],2)).toBe(true);
  });

  it('wires terminal aggregation into both initial and repair generation paths',()=>{
    const src=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
    expect((src.match(/BATCH_NOOP_ALLOWED=true/g)||[]).length).toBeGreaterThanOrEqual(2);
    expect((src.match(/validateAggregatedGenerationChanges\(changes,j\.paths,batches\.length\);/g)||[]).length).toBe(2);
    expect(src).toContain("throw new Error('CODING_BATCH_NOOP_INVALID')");
  });

  it('does not classify the terminal all-noop outcome as retryable AI failure',()=>{
    const error=Object.assign(new Error('CODING_ALL_BATCHES_NOOP'),{code:'CODING_ALL_BATCHES_NOOP'});
    expect(isRetryableAiError(error)).toBe(false);
  });
});
