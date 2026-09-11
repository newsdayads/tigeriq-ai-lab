import {describe,expect,it} from 'vitest';
import {parseJsonObject} from '../apps/tigeriq-coding-lane/policy.mjs';

describe('Coding Lane JSON parser resilience',()=>{
  it('parses normal JSON',()=>{
    expect(parseJsonObject('{"ok":true,"path":"apps/test.mjs"}')).toEqual({ok:true,path:'apps/test.mjs'});
  });

  it('repairs invalid backslash escapes emitted inside JSON strings',()=>{
    const raw='```json\n{"summary":"windows path C:\\TigerIQ\\new","ok":true}\n```';
    expect(parseJsonObject(raw)).toEqual({summary:'windows path C:\\TigerIQ\\new',ok:true});
  });

  it('still fails closed for structurally invalid JSON',()=>{
    expect(()=>parseJsonObject('{"ok":true')).toThrow(/JSON_OBJECT_MISSING|JSON_OBJECT_INVALID/);
  });
});
