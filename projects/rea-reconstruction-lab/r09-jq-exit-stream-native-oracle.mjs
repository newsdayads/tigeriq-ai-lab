// GH-4780: 13 NEW synthetic-input native jq 1.7 observations (not the earlier 16).
// Independent Linux oracle only; NO REA, Core/PC01, npm install or lease authority.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const FIXTURE_DIGEST='27248c84a2a05d3bc3b558eac4c31b78482eb8d9d0cfa8dbbb6a6844884cf98b';
const JQ_BINARY_SHA256='5e1dcc8c21b9362013a1f30acb24c69a128cbd5238364b88803f4c60cd9376dd';
const FIXTURE=[
["X01_NULL_FALSY",["-e","-c",".missing"],"{}\n","null\n","",1],
["X02_FALSE_FALSY",["-e","-c",".ok"],"{\"ok\":false}\n","false\n","",1],
["X03_TRUE_SUCCESS",["-e","-c",".ok"],"{\"ok\":true}\n","true\n","",0],
["X04_EMPTY_NO_OUTPUT",["-e","-c","empty"],"null\n","","",4],
["X05_LAST_OUTPUT_FALSE",["-e","-c",".[]"],"[true,false]\n","true\nfalse\n","",1],
["X06_LAST_OUTPUT_TRUE",["-e","-c",".[]"],"[false,true]\n","false\ntrue\n","",0],
["X07_PARSING_FAILURE",["-e","-c","."],"{broken\n","","jq: parse error: Invalid numeric literal at line 2, column 0\n",5],
["X08_STREAM_NESTED",["--stream","-c","."],"{\"a\":[1,{\"b\":true}]}\n","[[\"a\",0],1]\n[[\"a\",1,\"b\"],true]\n[[\"a\",1,\"b\"]]\n[[\"a\",1]]\n[[\"a\"]]\n","",0],
["X09_STREAM_ERROR",["--stream-errors","-c","."],"[1,\n","[[0],1]\n[\"Unfinished JSON term at EOF at line 2, column 0\",[1]]\n","",0],
["X10_STREAM_ERROR_MIXED",["--stream-errors","-c","."],"{\"a\":1}\n[1,\n","[[\"a\"],1]\n[[\"a\"]]\n[[0],1]\n[\"Unfinished JSON term at EOF at line 3, column 0\",[1]]\n","",0],
["X11_DUPLICATE_KEY",["-c","."],"{\"x\":1,\"x\":2}\n","{\"x\":2}\n","",0],
["X12_LARGE_INTEGER",["-c","."],"9007199254740993\n","9007199254740993\n","",0],
["X13_RAW_SLURP",["-R","-s","-c","."],"hello\nworld\n","\"hello\\nworld\\n\"\n","",0]
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const denied=reason=>({decision:'REJECTED',reason,oracleIntegrityOnly:false,
  sourceBuildAuthenticated:false,reaExecuted:false,r09Accepted:false,
  coreLeaseOwned:false,deviceAuthorized:false,installAuthorized:false,pc01Used:false,mutated:false});
export const pinnedR09ExitStreamCases=()=>structuredClone(FIXTURE);
export function inspectR09ExitStreamCases(cases){
  try{
    if(!Array.isArray(cases)||cases.length!==13)return denied('INVALID_CASE_COUNT');
    const ids=new Set();
    for(const c of cases){
      if(!Array.isArray(c)||c.length!==6||typeof c[0]!=='string'||
        !/^X(0[1-9]|1[0-3])_[A-Z0-9_]+$/.test(c[0])||ids.has(c[0])||
        !Array.isArray(c[1])||c[1].length>4||
        c[1].some(s=>typeof s!=='string'||s.length>128)||
        [c[2],c[3],c[4]].some(s=>typeof s!=='string'||s.length>4096)||
        !Number.isInteger(c[5])||c[5]<0||c[5]>255)return denied('INVALID_CASE_SHAPE');
      ids.add(c[0]);
    }
    if(hash(Buffer.from(JSON.stringify(cases),'utf8'))!==FIXTURE_DIGEST)
      return denied('PINNED_CASE_DIGEST_MISMATCH');
    const byId=id=>cases.find(c=>c[0].startsWith(id+'_'));
    if([['X01',1],['X02',1],['X03',0],['X04',4],['X05',1],['X06',0],['X07',5]]
      .some(([id,exit])=>byId(id)?.[5]!==exit))return denied('EXIT_STATUS_CONTRACT_MISMATCH');
    if(['X09','X10'].some(id=>byId(id)?.[5]!==0||byId(id)?.[4]!==''||
      !byId(id)?.[3].includes('Unfinished JSON term')))
      return denied('STREAM_ERROR_CONTRACT_MISMATCH');
    return {decision:'R09_NATIVE_JQ_ORACLE_BYTES_VERIFIED_NOT_REA_ACCEPTANCE',
      oracleIntegrityOnly:true,caseCount:cases.length,
      zeroExitErrorDataCases:2,nonzeroExitCases:5,
      sourceBuildAuthenticated:false,reaExecuted:false,r09Accepted:false,
      coreLeaseOwned:false,deviceAuthorized:false,installAuthorized:false,pc01Used:false,mutated:false};
  }catch{return denied('INVALID_UNTRUSTED_CASES');}
}
export function replayR09ExitStreamIsolated(cases,{binary='/usr/bin/jq'}={}){
  if(!inspectR09ExitStreamCases(cases).oracleIntegrityOnly)return {ok:false,reason:'UNVERIFIED_CASES'};
  if(binary!=='/usr/bin/jq')return {ok:false,reason:'NONPINNED_BINARY_PATH'};
  try{
    if(hash(readFileSync(binary))!==JQ_BINARY_SHA256)return {ok:false,reason:'JQ_BINARY_SHA_MISMATCH'};
    const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
    const ver=spawnSync(binary,['--version'],{encoding:'utf8',timeout:3000,env});
    if(ver.error||ver.status!==0||ver.stdout.trim()!=='jq-1.7')return {ok:false,reason:'JQ_VERSION_MISMATCH'};
    for(const [id,args,stdin,stdout,stderr,exit] of cases){
      const obs=spawnSync(binary,args,{input:Buffer.from(stdin,'utf8'),timeout:3000,maxBuffer:32768,env});
      if(obs.error||obs.status!==exit||!obs.stdout.equals(Buffer.from(stdout,'utf8'))||
          !obs.stderr.equals(Buffer.from(stderr,'utf8')))
        return {ok:false,reason:'NATIVE_OUTPUT_DIFFERENCE',caseId:id};
    }
    return {ok:true,decision:'ISOLATED_JQ_1_7_NATIVE_BYTE_REPLAY_PASS',count:cases.length,
      sourceBuildAuthenticated:false,reaExecuted:false,r09Accepted:false,pc01Used:false,mutated:false};
  }catch{return {ok:false,reason:'JQ_LOCAL_REPLAY_FAILED'};}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const result=process.argv.length===3&&process.argv[2]==='--replay-isolated'
    ?replayR09ExitStreamIsolated(pinnedR09ExitStreamCases())
    :{ok:false,reason:'EXPLICIT_REPLAY_ISOLATED_FLAG_REQUIRED'};
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode=result.ok?0:2;
}
