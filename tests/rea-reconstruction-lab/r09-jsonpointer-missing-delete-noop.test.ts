import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
// @ts-ignore Standalone independent JSONPointer ESM has no emitted .d.ts.
import { compile, outcome, set } from '../../projects/rea-reconstruction-lab/d04-pointer-cli/src/pointer.mjs';

// R09-E new negative case: deleting an absent object path should not create
// parents; unlike upstream's original set() implementation, this is a
// deliberate side-effect-safety divergence, not an API-parity claim.
const bytes=readFileSync(new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/jsonpointer.js',import.meta.url));
const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
if(blob!=='dad907d763f7369ac0e284e7d1fae2bd5508f477')
  throw Error('Pinned MIT original source has changed.');
const original:Record<string,any>={};
runInNewContext(bytes.toString('utf8'),{exports:original},{filename:'pinned-mit-jsonpointer.js',timeout:1200});
const cli=fileURLToPath(new URL('../../projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs',import.meta.url));

it('R09-E observes upstream create-on-missing-delete; new set and compiled set are mutation-free',()=>{
  const upstreamDoc:any={keep:1};
  expect(original.set(upstreamDoc,'/absent/leaf',undefined)).toBeUndefined();
  expect(upstreamDoc).toEqual({keep:1,absent:{}});

  const own:any={keep:1};
  expect(set(own,'/absent/leaf',undefined)).toBeUndefined();
  expect(own).toEqual({keep:1});

  const compiled:any={keep:1,present:{}};
  expect(compile('/present/absent/leaf').set(compiled,undefined)).toBeUndefined();
  expect(compiled).toEqual({keep:1,present:{}});

  const array:any={keep:1};
  expect(()=>set(array,'/missingArray/0',undefined)).toThrow('Sparse array deletion forbidden.');
  expect(array).toEqual({keep:1});
  console.log('GH4780_R09_MISSING_DELETE_UPSTREAM_PARENT_CREATED=true|D04_DIRECT_COMPILED_NOOP=2|ARRAY_GUARD_RETAINED=true');
});

it('R09-E tests four new JSONL delete/set scenarios on actual CLI process',()=>{
  const rows=[
    {id:'R09-E01-MISSING-SET',op:'set',document:{keep:1},pointer:'/missing/child'},
    {id:'R09-E02-MISSING-COMPILED',op:'compile-set',document:{keep:1},pointer:'/missing/deep/leaf'},
    {id:'R09-E03-EXISTING-DELETE',op:'compile-set',document:{keep:1,remove:2},pointer:'/remove'},
    {id:'R09-E04-EXPLICIT-NULL-KEEPS-CREATION',op:'set',document:{keep:1},pointer:'/created/deep',value:null},
  ];
  const expected=rows.map(row=>outcome(row));
  expect(expected.every(x=>x.outcome==='ok')).toBe(true);
  expect(expected[0]).toMatchObject({returned:{$type:'undefined'},documentAfter:{keep:1}});
  expect(expected[1]).toMatchObject({returned:{$type:'undefined'},documentAfter:{keep:1}});
  expect(expected[2]).toMatchObject({returned:2,documentAfter:{keep:1}});
  expect(expected[3]).toMatchObject({returned:{$type:'undefined'},documentAfter:{keep:1,created:{deep:null}}});
  const p=spawnSync(process.execPath,[cli,'--jsonl'],{
    input:rows.map(x=>JSON.stringify(x)).join('\n')+'\n',
    encoding:'utf8',timeout:9000,maxBuffer:1024*1024,
  });
  expect(p.status,p.stderr).toBe(0);
  expect(p.stdout.trim().split('\n').map(line=>JSON.parse(line))).toEqual(JSON.parse(JSON.stringify(expected)));
  console.log('GH4780_R09_MISSING_DELETE_JSONL=4_OF_4|NO_UNINTENDED_PARENT_CREATION=true');
});
