import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {compactPromptForChanges,expandCompactChanges,matchesExpectedSchema} from '../apps/tigeriq-coding-lane/ai-json-transport.mjs';
import {validateChanges} from '../apps/tigeriq-coding-lane/policy.mjs';

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
    expect(validateChanges(combined,['apps/a.mjs','tests/b.test.mjs'])).toBe(true);
  });

  it('recovers malformed compact JSON with raw quotes and backslash escapes',()=>{
    const content=String.raw`const re=/\\d+"quoted"/;`;
    const prompt=generationPrompt('apps/a.mjs',content);
    const malformed=String.raw`{"summary":"repair regex","edits":[{"path":"exact allowed path","search":"const re=/\\d+"quoted"/;","replace":"const re=/\\w+"quoted"/;"}]}`;
    expect(expandCompactChanges(prompt,malformed)).toEqual({
      summary:'repair regex',
      changes:[{path:'apps/a.mjs',content:String.raw`const re=/\\w+"quoted"/;`}],
    });
  });

  it('fails closed when loose recovery is ambiguous with embedded edit-field markers',()=>{
    const content=String.raw`const obj={"search":"x","replace":"y"};`;
    const prompt=generationPrompt('apps/a.mjs',content);
    const malformed=String.raw`{"summary":"ambiguous","edits":[{"path":"exact allowed path","search":"const obj={"search":"x","replace":"y"};","replace":"const obj={"search":"x","replace":"z"};"}]}`;
    expect(()=>expandCompactChanges(prompt,malformed)).toThrow('COMPACT_EDIT_JSON_INVALID');
  });

  it('normalizes bounded schema drift but never guesses a placeholder across multiple files',()=>{
    const prompt=generationPrompt('apps/a.mjs','const a=1;');
    expect(expandCompactChanges(prompt,JSON.stringify({
      changes:[{path:'exact allowed path',old:'const a=1;',new:'const a=2;'}],
    }))).toEqual({
      summary:'compact edits',
      changes:[{path:'apps/a.mjs',content:'const a=2;'}],
    });

    const multi=`TASK: bounded
BATCH_NOOP_ALLOWED=true
CURRENT FILES:
FILE apps/a.mjs
const a=1;

---

FILE apps/b.mjs
const b=1;
Return ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.`;
    expect(()=>expandCompactChanges(multi,JSON.stringify({
      summary:'ambiguous',
      edits:[{path:'exact allowed path',search:'const a=1;',replace:'const a=2;'}],
    }))).toThrow('COMPACT_EDIT_PATH_UNKNOWN:exact allowed path');
  });

  it('still rejects an all-noop job before branch creation',()=>{
    const a=expandCompactChanges(generationPrompt('apps/a.mjs','const a=1;'),JSON.stringify({summary:'no change',noop:true,edits:[]}));
    const b=expandCompactChanges(generationPrompt('tests/b.test.mjs','const b=1;'),JSON.stringify({summary:'no change',noop:true,edits:[]}));
    expect(()=>validateChanges([...a.changes,...b.changes],['apps/a.mjs','tests/b.test.mjs'])).toThrow('CODING_CHANGES_COUNT_INVALID');
  });

  it('wires batch no-op into both generation paths and keeps the job-level non-empty gate',()=>{
    const src=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
    expect((src.match(/BATCH_NOOP_ALLOWED=true/g)||[]).length).toBeGreaterThanOrEqual(2);
    expect((src.match(/validateChanges\(changes,j\.paths\);/g)||[]).length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("throw new Error('CODING_BATCH_NOOP_INVALID')");
  });
});
