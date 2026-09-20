import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {assertSafeFileChange,evaluateFileChangeSafety,SafetyGuardViolationError} from '../apps/tigeriq-coding-lane/safety-guard.mjs';

const existingSource = Array.from({length: 80}, (_, index) => `export function f${index}(){ return ${index}; }`).join('\n');

describe('Coding Lane destructive rewrite safety guard',()=>{
  it('allows new-file creation when content is non-empty',()=>{
    const result=assertSafeFileChange({path:'apps/tigeriq-coding-lane/new-helper.mjs',before:'',after:'export const ok=true;\n',isNew:true});
    expect(result.reason).toBe('NEW_FILE_ALLOWED');
    expect(result.after.bytes).toBeGreaterThan(0);
  });

  it('allows small local edits to existing files and reports metrics',()=>{
    const after=existingSource.replace('return 12;', 'return 1200;');
    const result=evaluateFileChangeSafety({path:'apps/tigeriq-coding-lane/coding-lane.mjs',before:existingSource,after});
    expect(result.reason).toBe('EXISTING_FILE_CHANGE_ALLOWED');
    expect(result.delta.lines).toBe(0);
    expect(result.before.lines).toBe(result.after.lines);
  });

  it('rejects truncating an existing source file to empty',()=>{
    expect(()=>assertSafeFileChange({path:'apps/tigeriq-coding-lane/coding-lane.mjs',before:existingSource,after:''})).toThrow(SafetyGuardViolationError);
    try{assertSafeFileChange({path:'apps/tigeriq-coding-lane/coding-lane.mjs',before:existingSource,after:''});}
    catch(error){expect(error.reason).toBe('EXISTING_FILE_TRUNCATED_TO_EMPTY');expect(error.detail.before.lines).toBe(80);}
  });

  it('rejects suspicious line and byte loss on existing source files',()=>{
    const after=existingSource.split('\n').slice(0,10).join('\n');
    expect(()=>assertSafeFileChange({path:'apps/tigeriq-coding-lane/coding-lane.mjs',before:existingSource,after})).toThrow(/EXISTING_FILE_SUSPICIOUS_LINE_TRUNCATION|EXISTING_FILE_SUSPICIOUS_BYTE_TRUNCATION/);
  });

  it('rejects structural loss even when some content remains',()=>{
    const before=Array.from({length: 30}, (_, index) => `export async function job${index}(){ const value=${index}; return value; }`).join('\n');
    const after='export const stillHere = true;\n// implementation accidentally removed\n';
    expect(()=>assertSafeFileChange({path:'apps/tigeriq-coding-lane/coding-lane.mjs',before,after})).toThrow(SafetyGuardViolationError);
  });

  it('is wired into the Coding Lane write path, not only as a standalone helper',()=>{
    const src=readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs','utf8');
    expect(src).toContain("from './safety-guard.mjs'");
    expect(src).toContain('assertSafeFileChange({');
    expect(src).toContain('before:old.sha?old.content:null');
    expect(src).toContain('after:change.content');
  });
});
