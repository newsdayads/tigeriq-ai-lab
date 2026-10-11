import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// @ts-expect-error Runtime-only JS transform.
import {transformCoreSource} from '../apps/tigeriq-core/core-throughput-transform.mjs';
const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const nodeCheck=(source:string)=>spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8',timeout:20000});
describe('Core startup source integrity',()=>{
  it('parses the exact runtime Core source as an ES module',()=>{
    const result=nodeCheck(core);
    expect(result.status,result.stderr).toBe(0);
  });
  it('parses the actual throughput-loader transformed source',()=>{
    const compiled=transformCoreSource(core);
    const result=nodeCheck(compiled);
    expect(result.status,result.stderr).toBe(0);
  });
  it('keeps a complete bounded manager SQL statement and Owner ranking without P0',()=>{
    expect(core).toContain('o.created_at limit 500');
    expect(core).toContain('rank:objectiveBacklogRank(objective,ownerOrder)');
    expect(core).toContain("and o.priority in ('P1','P2','P3','P4','P5')");
    expect(core).not.toContain("when (o.metadata->>'issueNumber') ~ '^[0-9]+");
  });
});