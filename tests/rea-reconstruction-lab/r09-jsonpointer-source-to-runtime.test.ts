import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
// @ts-ignore Deliberate plain ESM CLI implementation without TypeScript declarations.
import { outcome, get, set } from '../../projects/rea-reconstruction-lab/d04-pointer-cli/src/pointer.mjs';

// R09: independently execute the pinned MIT source as the behavioral oracle.
// Static REA evidence alone cannot establish observed results or full API parity.
const sourcePath=new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/jsonpointer.js',import.meta.url);
const cliPath=fileURLToPath(new URL('../../projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs',import.meta.url));
const source=readFileSync(sourcePath);
const blob=createHash('sha1').update(Buffer.from('blob '+source.length+'\0')).update(source).digest('hex');
if(blob!=='dad907d763f7369ac0e284e7d1fae2bd5508f477')
  throw new Error('R09 pinned original source blob mismatch');
const upstream:Record<string,any>={};
runInNewContext(source.toString('utf8'),{exports:upstream},{filename:'pinned-mit-jsonpointer.js',timeout:1200});
const clean=(x:any)=>JSON.parse(JSON.stringify(x));

function oracle(test:any){
  const doc=structuredClone(test.document);
  try{
    const result=test.op==='get'?upstream.get(doc,test.pointer):
      test.op==='set'?upstream.set(doc,test.pointer,test.value):
        (()=>{throw new Error('Operation not in R09 original get/set fixture');})();
    return {id:test.id,outcome:'ok',returned:result===undefined?{$type:'undefined'}:result,documentAfter:doc};
  }catch(error:any){
    return {id:test.id,outcome:'error',name:error.name,message:error.message,documentAfter:doc};
  }
}

// Fresh R09 run-cases; deliberately not replaying D04's J01-J10 or K11-K31.
const pairs:any[]=[
 {id:'R09-T01-UTF8-ESCAPES',op:'get',document:{'đường/dẫn':{'café~':42}},pointer:'/đường~1dẫn/café~0'},
 {id:'R09-T02-ARRAY-POINTER-NUMBER',op:'get',document:{rows:[{id:'A'},{id:'B'}]},pointer:['','rows',1,'id']},
 {id:'R09-T03-UNKNOWN-TILDE-ESCAPE',op:'get',document:{'x~2y':7},pointer:'/x~2y'},
 {id:'R09-T04-EMPTY-NESTED-KEY',op:'get',document:{a:{'':{z:true}}},pointer:'/a//z'},
 {id:'R09-T05-ZERO-ARRAY-INDEX',op:'get',document:{arr:[0,1]},pointer:'/arr/0'},
 {id:'R09-T06-ARRAY-UPDATE',op:'set',document:{arr:[2,3]},pointer:'/arr/1',value:8},
 {id:'R09-T07-DEEP-ARRAY-BUILD',op:'set',document:{},pointer:'/items/0/value',value:'one'},
 {id:'R09-T08-ARRAY-POINTER-ESCAPED-SET',op:'set',document:{'a/b':9},pointer:['','a~1b'],value:12},
 {id:'R09-T09-MISSING-VALUE-DELETES',op:'set',document:{a:1,b:2},pointer:'/a'},
 {id:'R09-T10-OBJECT-REPLACEMENT',op:'set',document:{a:{b:1},marker:7},pointer:'/a',value:{new:[1,2]}},
 {id:'R09-T11-EMPTY-SEGMENT-CREATION',op:'set',document:{a:{}},pointer:'/a//x',value:5},
 {id:'R09-T12-ARRAY-POINTER-DOUBLE-ESCAPE',op:'get',document:{'tilde~key':{'slash/':true}},pointer:['','tilde~0key','slash~1']},
 {id:'R09-T13-ARRAY-APPEND',op:'set',document:{a:[3]},pointer:'/a/-',value:4},
 {id:'R09-T14-SCALAR-PARENT-MISSING',op:'get',document:{a:10},pointer:'/a/b'}
];

it('R09 executes 14 NEW pinned-MIT source outcomes against pure D04 get/set and actual JSONL process',()=>{
  expect(new Set(pairs.map(p=>p.id)).size).toBe(14);
  const expected=pairs.map(p=>clean(oracle(p)));
  expect(expected.every(p=>p.outcome==='ok')).toBe(true);
  expect(expected.find(p=>p.id==='R09-T01-UTF8-ESCAPES')?.returned).toBe(42);
  expect(expected.find(p=>p.id==='R09-T02-ARRAY-POINTER-NUMBER')?.returned).toBe('B');
  expect(expected.find(p=>p.id==='R09-T09-MISSING-VALUE-DELETES')?.documentAfter).toEqual({b:2});
  expect(expected.find(p=>p.id==='R09-T14-SCALAR-PARENT-MISSING')?.returned).toEqual({$type:'undefined'});
  expect(pairs.map(p=>clean(outcome(p)))).toEqual(expected);
  const proc=spawnSync(process.execPath,[cliPath,'--jsonl'],{
    input:pairs.map(p=>JSON.stringify(p)).join('\n')+'\n',
    encoding:'utf8',timeout:9000,maxBuffer:1024*1024
  });
  expect(proc.status,proc.stderr).toBe(0);
  const actual=proc.stdout.trim().split('\n').map(line=>JSON.parse(line));
  expect(actual).toEqual(expected);
  const digest=createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  console.log('GH4780_R09_REAL_SOURCE_CLI_PARITY=14_OF_14|ORACLE_SHA256='+digest+'|CLI_EXIT=0');
});

it('R09 records three intentional safety-exclusion behaviors; never counts them as parity',()=>{
  const dangerous:any={id:'R09-E01-DANGEROUS',op:'set',document:{safe:1},pointer:'/constructor/x',value:1};
  const originalDanger=clean(oracle(dangerous));
  const guardedDanger=clean(outcome(dangerous));
  expect(originalDanger.outcome).toBe('ok');
  expect(guardedDanger.outcome).toBe('error');
  expect(guardedDanger.message).toContain('Unsafe JSON pointer segment');

  const sparse:any={id:'R09-E02-SPARSE',op:'set',document:{arr:[5]},pointer:'/arr/4',value:9};
  const originalSparse=clean(oracle(sparse));
  const guardedSparse=clean(outcome(sparse));
  expect(originalSparse.outcome).toBe('ok');
  expect(originalSparse.documentAfter.arr).toHaveLength(5);
  expect(guardedSparse.outcome).toBe('error');
  expect(guardedSparse.documentAfter).toEqual({arr:[5]});

  const rootSet:any={id:'R09-E03-EMPTY-ROOT-SET',op:'set',document:{a:1},pointer:'',value:9};
  const originalRoot=clean(oracle(rootSet));
  const guardedRoot=clean(outcome(rootSet));
  expect(originalRoot.outcome).toBe('ok');
  expect(originalRoot.documentAfter).toHaveProperty('undefined',9);
  expect(guardedRoot.outcome).toBe('error');
  expect(guardedRoot.message).toContain('Invalid JSON pointer for set');
  console.log('GH4780_R09_DELIBERATE_SAFETY_DIVERGENCES=3|NOT_PARITY=3');
});

it('R09 verifies MIT compile closures but explicitly flags D04 CLI compile operation as missing',()=>{
  expect(typeof upstream.compile).toBe('function');
  const originalDoc={payload:[7]};
  const compiled=upstream.compile('/payload/0');
  expect(compiled.get(originalDoc)).toBe(7);
  expect(compiled.set(originalDoc,11)).toBe(7);
  expect(originalDoc).toEqual({payload:[11]});
  const standalone={payload:[7]};
  expect(get(standalone,'/payload/0')).toBe(7);
  expect(set(standalone,'/payload/0',11)).toBe(7);
  expect(standalone).toEqual({payload:[11]});
  const unimplemented=outcome({id:'R09-C01-COMPILE-GAP',op:'compile',document:{payload:[7]},pointer:'/payload/0'});
  expect(unimplemented).toMatchObject({outcome:'error',message:'Unsupported operation.'});
  console.log('GH4780_R09_COMPILE_MIT_ORACLE=EXECUTED|D04_JSONL_RAW_FUNCTION_SERIALIZATION=NOT_SUPPORTED');
});
