import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
// @ts-ignore Standalone CLI source is .mjs and deliberately has no declaration emit.
import {outcome, get, set} from '../../projects/rea-reconstruction-lab/d04-pointer-cli/src/pointer.mjs';

const originalPath=new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/jsonpointer.js',import.meta.url);
const originalLicensePath=new URL('../../projects/rea-reconstruction-lab/d02-node-jsonpointer/LICENSE.md',import.meta.url);
const cliPath=new URL('../../projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs',import.meta.url);
const blob=(bytes:Buffer)=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const original=readFileSync(originalPath);
const originalLicense=readFileSync(originalLicensePath);
const originalExports:Record<string,any>={};
if(blob(original)!=='dad907d763f7369ac0e284e7d1fae2bd5508f477'||
   blob(originalLicense)!=='ac32f5dfdd49682b416374dcbed58a7f17fa4e24')
  throw new Error('D04 original-source MIT provenance mismatch');
runInNewContext(original.toString('utf8'),{exports:originalExports},{filename:'pinned-jsonpointer.js',timeout:1200});

const cases:any[]=[
 {id:'J01_NESTED_GET',op:'get',document:{a:{b:7}},pointer:'/a/b'},
 {id:'J02_ESCAPED_SLASH_GET',op:'get',document:{'a/b':12},pointer:'/a~1b'},
 {id:'J03_ESCAPED_TILDE_GET',op:'get',document:{'m~n':'tilde'},pointer:'/m~0n'},
 {id:'J04_MISSING_GET',op:'get',document:{a:1},pointer:'/missing'},
 {id:'J05_SET_REPLACE',op:'set',document:{a:1},pointer:'/a',value:9},
 {id:'J06_SET_NESTED_ARRAY',op:'set',document:{},pointer:'/items/0/name',value:'Lin'},
 {id:'J07_SET_ARRAY_APPEND',op:'set',document:{items:[1]},pointer:'/items/-',value:2},
 {id:'J08_SET_ESCAPED_SLASH',op:'set',document:{'a/b':2},pointer:'/a~1b',value:5},
 {id:'J09_BAD_RELATIVE_POINTER',op:'get',document:{a:1},pointer:'a'},
 {id:'J10_BAD_INPUT_OBJECT',op:'get',document:42,pointer:'/a'},
 {id:'K11_ROOT_GET',op:'get',document:{a:1},pointer:''},
 {id:'K12_ARRAY_INDEX_GET',op:'get',document:{a:[9,8]},pointer:'/a/1'},
 {id:'K13_EMPTY_SEGMENT_GET',op:'get',document:{'':13},pointer:'/'},
 {id:'K14_COMBINED_ESCAPE_GET',op:'get',document:{'a~/b':4},pointer:'/a~0~1b'},
 {id:'K15_GET_NULL_VALUE',op:'get',document:{a:null},pointer:'/a'},
 {id:'K16_GET_MISSING_PARENT',op:'get',document:{a:null},pointer:'/a/b'},
 {id:'K17_SET_NEW_SCALAR',op:'set',document:{},pointer:'/new',value:22},
 {id:'K18_SET_DEEP_OBJECT',op:'set',document:{},pointer:'/nested/child/k',value:3},
 {id:'K19_SET_EXISTING_ARRAY_INDEX',op:'set',document:{arr:[5,6]},pointer:'/arr/0',value:12},
 {id:'K20_SET_NESTED_ARRAY_APPEND',op:'set',document:{},pointer:'/arr/-',value:15},
 {id:'K21_SET_NULL_VALUE',op:'set',document:{a:1},pointer:'/a',value:null},
 {id:'K22_GET_INVALID_TYPE',op:'get',document:{},pointer:true},
 {id:'K23_GET_INVALID_ARRAY_SEGMENT',op:'get',document:{a:1},pointer:['x',{}]},
 {id:'K24_SET_RELATIVE_POINTER_REJECT',op:'set',document:{},pointer:'x',value:1},
 {id:'K25_SET_ESCAPED_TILDE',op:'set',document:{'a~b':1},pointer:'/a~0b',value:2},
 {id:'K26_GET_TRUE_VALUE',op:'get',document:{b:true},pointer:'/b'},
 {id:'K27_GET_DOUBLE_ESCAPED_SLASH',op:'get',document:{'a/b':{'c/d':4}},pointer:'/a~1b/c~1d'},
 {id:'K28_SET_REPLACE_NESTED',op:'set',document:{a:{b:'old'}},pointer:'/a/b',value:'new'},
];
const clean=(x:any)=>JSON.parse(JSON.stringify(x));
function originalOutcome(test:any){
  const doc=structuredClone(test.document);
  try{
    const result=test.op==='get'?originalExports.get(doc,test.pointer):originalExports.set(doc,test.pointer,test.value);
    return {id:test.id,outcome:'ok',returned:result===undefined?{$type:'undefined'}:result,documentAfter:doc};
  }catch(e:any){
    return {id:test.id,outcome:'error',name:e.name,message:e.message,documentAfter:doc};
  }
}
function cli(input:string|Buffer){
  return spawnSync(process.execPath,[cliPath.pathname,'--jsonl'],{input,encoding:'utf8',timeout:9000,maxBuffer:4*1024*1024});
}
describe('REA #4780 D04: integrated independent JSONPointer CLI (not REA)',()=>{
  it('pins the original MIT blobs and matches 10 golden + 18 distinct cases',()=>{
    expect(cases).toHaveLength(28);
    expect(new Set(cases.map(c=>c.id)).size).toBe(28);
    for(const c of cases) expect(clean(outcome(c)),c.id).toEqual(clean(originalOutcome(c)));
  });
  it('matches original MIT distinction: [] is undefined, while string root and one-element array are root',()=>{
    const fixtures:any[]=[
      {id:'K29_EMPTY_ARRAY_POINTER',op:'get',document:{keep:'root'},pointer:[]},
      {id:'K30_EMPTY_STRING_ROOT',op:'get',document:{keep:'root'},pointer:''},
      {id:'K31_ARRAY_ROOT_POINTER',op:'get',document:{keep:'root'},pointer:['']},
    ];
    const expected=fixtures.map(c=>clean(originalOutcome(c)));
    expect(expected[0]).toMatchObject({id:'K29_EMPTY_ARRAY_POINTER',outcome:'ok',returned:{$type:'undefined'}});
    expect(expected[1].returned).toEqual({keep:'root'});
    expect(expected[2].returned).toEqual({keep:'root'});
    expect(get(fixtures[0].document,[])).toBeUndefined();
    expect(fixtures.map(c=>clean(outcome(c)))).toEqual(expected);
    const native=cli(fixtures.map(c=>JSON.stringify(c)).join('\n')+'\n');
    expect(native.status,native.stderr).toBe(0);
    expect(native.stdout.trim().split('\n').map(line=>JSON.parse(line))).toEqual(expected);
  });
  it('executes all 28 cases via native CLI JSONL process',()=>{
    const p=cli(cases.map(c=>JSON.stringify(c)).join('\n')+'\n');
    expect(p.status,p.stderr).toBe(0);
    const rows=p.stdout.trim().split('\n').map(row=>JSON.parse(row));
    expect(rows).toHaveLength(28);
    expect(rows).toEqual(cases.map(c=>clean(originalOutcome(c))));
  });
  it('rejects accessors without executing getters on public outcome',()=>{
    for(const location of ['record','root','nested','value']){
      let hits=0;
      const makeGetter=(object:any,key:string)=>Object.defineProperty(object,key,{enumerable:true,get(){hits++;return 1;}});
      const test:any={id:'getter',op:'get',document:{nested:{}},pointer:'/nested/value'};
      if(location==='record') makeGetter(test,'op');
      if(location==='root') makeGetter(test.document,'unsafe');
      if(location==='nested') makeGetter(test.document.nested,'unsafe');
      if(location==='value'){test.op='set';test.value={};makeGetter(test.value,'unsafe');}
      expect(outcome(test).outcome).toBe('error');
      expect(hits).toBe(0);
    }
  });
  it('handles cyclic, very deep, exotic and unsafe pointer records without mutation',()=>{
    const cyclic:any={};cyclic.self=cyclic;
    for(const doc of [cyclic,new Date()]){
      expect(outcome({op:'get',document:doc,pointer:''}).outcome).toBe('error');
    }
    const deep:any={};let node=deep;for(let i=0;i<160;i++){node.child={};node=node.child;}
    expect(outcome({op:'get',document:deep,pointer:''}).outcome).toBe('error');
    const base:any={};
    expect(()=>set(base,'/safe/__proto__/polluted',1)).toThrow(/Unsafe/);
    expect(base).toEqual({});
    expect(({} as any).polluted).toBeUndefined();
    expect(()=>get(Object.defineProperty({},'secret',{get(){throw Error('bad');}}),'/secret')).toThrow(/Accessor/);
  });
  it('rejects non-enumerable properties without silently erasing original JS data',()=>{
    const obj:any={visible:'kept'};
    Object.defineProperty(obj,'hidden',{value:'do-not-erase-silently',enumerable:false});
    const beforeKeys=Reflect.ownKeys(obj);
    const result=outcome({op:'get',document:obj,pointer:''});
    expect(result.outcome).toBe('error');
    expect(result.message).toContain('Non-enumerable JSON property forbidden.');
    expect(Reflect.ownKeys(obj)).toEqual(beforeKeys);
    expect(Object.getOwnPropertyDescriptor(obj,'hidden')?.value).toBe('do-not-erase-silently');
  });
  it('rejects sparse JS arrays without silently serializing holes into nulls',()=>{
    const sparse:any[]=new Array(2);
    sparse[1]='value';
    const result=outcome({op:'get',document:{arr:sparse},pointer:'/arr'});
    expect(result.outcome).toBe('error');
    expect(result.message).toContain('Sparse JSON array forbidden.');
    expect(0 in sparse).toBe(false);
  });
  it('rejects non-index named properties on JS arrays instead of losing them',()=>{
    const arr:any=[2,3];
    arr.auditMarker='preserve';
    const result=outcome({op:'get',document:{arr},pointer:'/arr'});
    expect(result.outcome).toBe('error');
    expect(result.message).toContain('Named JSON array property forbidden.');
    expect(arr.auditMarker).toBe('preserve');
    const dangerous:any=[1];
    dangerous['4294967295']='not-a-real-array-index';
    const high=outcome({op:'get',document:{arr:dangerous},pointer:'/arr'});
    expect(high.outcome).toBe('error');
    expect(high.message).toContain('Named JSON array property forbidden.');
  });
  it('continues accepting dense arrays and ordinary JSONL input',()=>{
    expect(outcome({id:'dense',op:'get',document:{arr:[null,7]},pointer:'/arr/1'}))
      .toMatchObject({id:'dense',outcome:'ok',returned:7});
    const p=cli(JSON.stringify({id:'dense',op:'get',document:{arr:[null,7]},pointer:'/arr/1'})+'\n');
    expect(p.status,p.stderr).toBe(0);
    expect(JSON.parse(p.stdout.trim())).toMatchObject({id:'dense',outcome:'ok',returned:7});
  });
  it('rejects invalid UTF-8, excessive input and excessive row count from native CLI',()=>{
    const badUtf8=cli(Buffer.from([0x7b,0x22,0x69,0x64,0x22,0x3a,0x22,0xff,0x22,0x7d,0x0a]));
    expect(badUtf8.status).toBe(1);
    expect(badUtf8.stdout).toContain('Invalid UTF-8 input.');
    const huge=cli(JSON.stringify({op:'get',document:{x:'x'.repeat(34000)},pointer:'/x'})+'\n');
    expect(huge.status).toBe(1);
    expect(huge.stdout).toContain('Input line exceeds 32768 bytes.');
    const rows=cli((JSON.stringify({op:'get',document:{a:1},pointer:'/a'})+'\n').repeat(1001));
    expect(rows.status).toBe(1);
    expect(rows.stdout).toContain('Input exceeds 1000 rows.');
  });
});

describe('REA #4780 D04: offline npm package fresh-install acceptance',()=>{
  it('packs with no network, installs in a clean prefix and reproduces all 28 MIT golden outcomes',()=>{
    const root=mkdtempSync(join(tmpdir(),'tigeriq-d04-fresh-install-'));
    const project=fileURLToPath(new URL('../../projects/rea-reconstruction-lab/d04-pointer-cli/',import.meta.url));
    const env={...process.env,npm_config_update_notifier:'false',npm_config_audit:'false',npm_config_fund:'false'};
    try{
      const pack=spawnSync('npm',['pack',project,'--offline','--ignore-scripts','--pack-destination',root,'--json'],{
        cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,
      });
      expect(pack.status,pack.stderr+' '+pack.stdout).toBe(0);
      const metadata=JSON.parse(pack.stdout);
      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe('tigeriq-rea-pointer-demo');
      const tarball=join(root,metadata[0].filename);
      const digest=createHash('sha256').update(readFileSync(tarball)).digest('hex');
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
      const target=join(root,'fresh');
      mkdirSync(target);
      const install=spawnSync('npm',[
        'install','--offline','--ignore-scripts','--no-audit','--no-fund',
        '--prefix',target,tarball,
      ],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
      expect(install.status,install.stderr+' '+install.stdout).toBe(0);
      const installedCli=join(target,'node_modules','tigeriq-rea-pointer-demo','bin','rea-pointer-demo.mjs');
      const actual=spawnSync(process.execPath,[installedCli,'--jsonl'],{
        input:cases.map(c=>JSON.stringify(c)).join('\n')+'\n',
        encoding:'utf8',timeout:9000,maxBuffer:4*1024*1024,
      });
      expect(actual.status,actual.stderr).toBe(0);
      const outputs=actual.stdout.trim().split('\n').map(row=>JSON.parse(row));
      expect(outputs).toHaveLength(28);
      expect(outputs).toEqual(cases.map(c=>clean(originalOutcome(c))));
      console.log('D04_OFFLINE_FRESH_INSTALL_PASS=28_OF_28|PACKAGE=tigeriq-rea-pointer-demo@0.6.1|PACK_SHA256='+digest+'|PC01_TOUCHED=false');
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
