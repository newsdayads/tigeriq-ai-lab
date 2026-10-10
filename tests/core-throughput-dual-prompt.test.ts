import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Runtime transform is a JavaScript module without a declaration file.
import {transformCoreSource} from '../apps/tigeriq-core/core-throughput-transform.mjs';
const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
describe('Core throughput loader compatibility with two manager prompts',()=>{
  it('transforms live Core source without startup exceptions',()=>{
    const compiled=transformCoreSource(core);
    expect(compiled).toContain('MAX_MANAGER_JOBS');
    expect(compiled.split('Maximum ${MANAGER_MAX_JOBS} jobs.').length-1).toBe(2);
    expect(compiled).not.toContain('Maximum 3 jobs.');
  });
  it('fails closed when any prompt location disappears',()=>{
    const once=core.replace('Maximum 3 jobs.','Maximum X jobs.');
    expect(()=>transformCoreSource(once)).toThrow(/CORE_THROUGHPUT_PATCH_COUNT:manager_prompt:1/);
  });
});