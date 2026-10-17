// GH-4780 R09: distinct jq 1.7 module/API source-to-behavior trace.
// Data is native observed from isolated Linux /usr/bin/jq; this is NOT REA
// execution, PC01 receipt, CLI provenance to upstream source, or product DONE.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const R09_MODULE_API_UPSTREAM_COMMIT='11c528d04d76c9b9553781aa76b073e4f40da008';
export const R09_MODULE_API_BINARY_SHA256='5e1dcc8c21b9362013a1f30acb24c69a128cbd5238364b88803f4c60cd9376dd';
export const R09_MODULE_API_FIXTURE_SHA256='ed74855b4d4b0fd509cec36efa7cb7a3ee654438218d0c56da59d746110a7fb4';
const CASES=[
  [
    "M01_MAP_DEFAULT",
    [
      "-c",
      "map((.score // 0) + 1)"
    ],
    "[{\"score\":2},{\"score\":null},{}]\n",
    "[3,1,1]\n",
    "",
    0
  ],
  [
    "M02_SORT_BY_COMPOUND",
    [
      "-c",
      "sort_by(.priority,.id) | map(.id)"
    ],
    "[{\"priority\":2,\"id\":\"c\"},{\"priority\":1,\"id\":\"b\"},{\"priority\":1,\"id\":\"a\"}]\n",
    "[\"a\",\"b\",\"c\"]\n",
    "",
    0
  ],
  [
    "M03_GETPATH",
    [
      "-c",
      "getpath([\"items\",1,\"v\"])"
    ],
    "{\"items\":[{\"v\":\"x\"},{\"v\":7}]}\n",
    "7\n",
    "",
    0
  ],
  [
    "M04_SETPATH",
    [
      "-c",
      "setpath([\"items\",0,\"v\"];99)"
    ],
    "{\"items\":[{\"v\":1},{\"v\":2}]}\n",
    "{\"items\":[{\"v\":99},{\"v\":2}]}\n",
    "",
    0
  ],
  [
    "M05_DELPATHS",
    [
      "-c",
      "delpaths([[\"meta\",\"secret\"],[\"items\",0]])"
    ],
    "{\"meta\":{\"secret\":\"x\",\"public\":1},\"items\":[\"a\",\"b\"]}\n",
    "{\"meta\":{\"public\":1},\"items\":[\"b\"]}\n",
    "",
    0
  ],
  [
    "M06_WALK_RECURSIVE",
    [
      "-c",
      "walk(if type == \"number\" then . * 2 else . end)"
    ],
    "{\"a\":[1,{\"b\":3}],\"c\":\"ok\"}\n",
    "{\"a\":[2,{\"b\":6}],\"c\":\"ok\"}\n",
    "",
    0
  ],
  [
    "M07_REDUCE_ACCUMULATE",
    [
      "-c",
      "reduce .[] as $row ({}; .[$row.k] += $row.v)"
    ],
    "[{\"k\":\"a\",\"v\":2},{\"k\":\"b\",\"v\":4},{\"k\":\"a\",\"v\":3}]\n",
    "{\"a\":5,\"b\":4}\n",
    "",
    0
  ],
  [
    "M08_TRY_CATCH",
    [
      "-c",
      "try (.value | tonumber) catch \"BAD\""
    ],
    "{\"value\":\"not-an-int\"}\n",
    "\"BAD\"\n",
    "",
    0
  ],
  [
    "M09_ENTRIES_ROUNDTRIP",
    [
      "-c",
      "to_entries | map(select(.value>0)) | from_entries"
    ],
    "{\"a\":1,\"b\":-1,\"c\":2}\n",
    "{\"a\":1,\"c\":2}\n",
    "",
    0
  ],
  [
    "M10_UPDATE_PATH_ERROR",
    [
      "-c",
      "setpath([\"items\",\"a\"];3)"
    ],
    "{\"items\":[1,2]}\n",
    "",
    "jq: error (at <stdin>:1): Cannot index array with string \"a\"\n",
    5
  ]
];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const rejected=reason=>({decision:'REJECTED',reason,oracleIntegrityOnly:false,sourceBuildAuthenticated:false,
  reaExecuted:false,r09Accepted:false,coreLeaseOwned:false,deviceAuthorized:false,
  installAuthorized:false,pc01Used:false,mutated:false});
export const pinnedR09ModuleAPICases=()=>structuredClone(CASES);

export function inspectR09ModuleAPICases(rows){
  try{
    if(!Array.isArray(rows)||rows.length!==10)return rejected('INVALID_COUNT');
    const ids=new Set();
    for(const row of rows){
      if(!Array.isArray(row)||row.length!==6||typeof row[0]!=='string'||
         !/^M(?:0[1-9]|10)_[A-Z0-9_]+$/.test(row[0])||ids.has(row[0])||
         !Array.isArray(row[1])||row[1].length!==2||
         row[1].some(v=>typeof v!=='string'||v.length>140)||
         [row[2],row[3],row[4]].some(v=>typeof v!=='string'||v.length>4096)||
         !Number.isInteger(row[5])||row[5]<0||row[5]>255)
        return rejected('INVALID_CASE_SHAPE');
      ids.add(row[0]);
    }
    if(sha256(Buffer.from(JSON.stringify(rows),'utf8'))!==R09_MODULE_API_FIXTURE_SHA256)
      return rejected('PINNED_CASE_DIGEST_MISMATCH');
    if(rows.slice(0,9).some(row=>row[5]!==0||row[4]!==''||
      !row[3].endsWith('\n'))||rows[9][5]!==5||rows[9][3]!==''||
      !rows[9][4].includes('Cannot index array'))
      return rejected('UNEXPECTED_EXIT_OR_OUTPUT_CONTRACT');
    return {decision:'R09_JQ_MODULE_API_ORACLE_BYTES_VERIFIED_NOT_REA_ACCEPTANCE',
      oracleIntegrityOnly:true,caseCount:10,sourceBuildAuthenticated:false,
      reaExecuted:false,r09Accepted:false,coreLeaseOwned:false,deviceAuthorized:false,
      installAuthorized:false,pc01Used:false,mutated:false};
  }catch{return rejected('UNTRUSTED_ROWS_REJECTED');}
}

export function replayR09ModuleAPIIsolated(rows,{binary='/usr/bin/jq'}={}){
  if(!inspectR09ModuleAPICases(rows).oracleIntegrityOnly)
    return {ok:false,reason:'UNVERIFIED_FIXTURES'};
  if(binary!=='/usr/bin/jq')return {ok:false,reason:'NONPINNED_BINARY_PATH'};
  try{
    if(sha256(readFileSync(binary))!==R09_MODULE_API_BINARY_SHA256)
      return {ok:false,reason:'JQ_BINARY_SHA_MISMATCH'};
    const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
    const version=spawnSync(binary,['--version'],{encoding:'utf8',timeout:3000,env});
    if(version.error||version.status!==0||version.stdout.trim()!=='jq-1.7')
      return {ok:false,reason:'JQ_VERSION_MISMATCH'};
    for(const [id,args,stdin,stdout,stderr,exit] of rows){
      const p=spawnSync(binary,args,{input:Buffer.from(stdin,'utf8'),timeout:3000,maxBuffer:32768,env});
      if(p.error||p.status!==exit||!p.stdout.equals(Buffer.from(stdout,'utf8'))||
        !p.stderr.equals(Buffer.from(stderr,'utf8')))
        return {ok:false,reason:'NATIVE_OUTPUT_DIFFERENCE',caseId:id};
    }
    return {ok:true,decision:'ISOLATED_JQ_1_7_MODULE_API_NATIVE_BYTE_REPLAY_PASS',
      count:rows.length,sourceBuildAuthenticated:false,reaExecuted:false,r09Accepted:false,
      coreLeaseOwned:false,deviceAuthorized:false,installAuthorized:false,pc01Used:false,mutated:false};
  }catch{return {ok:false,reason:'ISOLATED_NATIVE_REPLAY_ERROR'};}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const result=process.argv.length===3&&process.argv[2]==='--replay-isolated'
    ?replayR09ModuleAPIIsolated(pinnedR09ModuleAPICases())
    :{ok:false,reason:'EXPLICIT_REPLAY_ISOLATED_FLAG_REQUIRED'};
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode=result.ok?0:2;
}
