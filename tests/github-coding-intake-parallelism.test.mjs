import test from 'node:test';
import assert from 'node:assert';
import {parseCodingScope,materializeGithubCodingIssues} from '../apps/tigeriq-core/github-coding-intake.mjs';

test('parseCodingScope detects scopes and ambiguity',()=>{
  const s1=parseCodingScope('RESOURCE_SCOPE=foo\nALLOW_PATH_PREFIX=src/,tests/');
  assert.deepStrictEqual(s1.paths,['src','tests']);
  assert.strictEqual(s1.ambiguous,false);

  const s2=parseCodingScope('ALLOW_PATH_PREFIX=*');
  assert.strictEqual(s2.ambiguous,true);
});

test('codingScopesOverlap correctly identifies non-overlapping vs overlapping scopes',()=>{
  const s1=parseCodingScope('ALLOW_PATH_PREFIX=apps/tigeriq-core/');
  const s2=parseCodingScope('ALLOW_PATH_PREFIX=apps/tigeriq-web/');
  const s3=parseCodingScope('ALLOW_PATH_PREFIX=apps/tigeriq-core/github-coding-intake.mjs');
  const s4=parseCodingScope('ALLOW_PATH_PREFIX=*');

  assert.strictEqual(codingScopesOverlap(s1,s2),false);
  assert.strictEqual(codingScopesOverlap(s1,s3),true);
  assert.strictEqual(codingScopesOverlap(s1,s4),true);
});

test('materializeGithubCodingIssues respects concurrency cap and path collision safety',async()=>{
  const mockPool={
    async query(text,params){
      if(text.includes('tigeriq_events')){
        return {rowCount:0,rows:[]};
      }
      return {rowCount:0,rows:[]};
    }
  };

  let fetchedIssues=false;
  let postedObjectives=0;

  const mockFetch=async(url,init)=>{
    if(url.includes('/issues?')){
      fetchedIssues=true;
      return new Response(JSON.stringify([
        {
          number:101,
          title:'Task A',
          state:'open',
          html_url:'https://github.com/test/repo/issues/101',
          body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nAUTONOMOUS_CODE=true\nZERO_COST=true\nNO_PC01_SHELL=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nNO_DESTRUCTIVE=true\nNO_PRODUCTION_RELEASE=true\nNO_BROWSER_AUTH=true\nNO_DIRECT_MAIN=true\nPRIORITY=P1\nALLOW_PATH_PREFIX=apps/tigeriq-core/'
        },
        {
          number:102,
          title:'Task B',
          state:'open',
          html_url:'https://github.com/test/repo/issues/102',
          body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nAUTONOMOUS_CODE=true\nZERO_COST=true\nNO_PC01_SHELL=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nNO_DESTRUCTIVE=true\nNO_PRODUCTION_RELEASE=true\nNO_BROWSER_AUTH=true\nNO_DIRECT_MAIN=true\nPRIORITY=P1\nALLOW_PATH_PREFIX=apps/tigeriq-web/'
        },
        {
          number:103,
          title:'Task C (Overlapping with A)',
          state:'open',
          html_url:'https://github.com/test/repo/issues/103',
          body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nAUTONOMOUS_CODE=true\nZERO_COST=true\nNO_PC01_SHELL=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nNO_DESTRUCTIVE=true\nNO_PRODUCTION_RELEASE=true\nNO_BROWSER_AUTH=true\nNO_DIRECT_MAIN=true\nPRIORITY=P1\nALLOW_PATH_PREFIX=apps/tigeriq-core/'
        }
      ]), {status:200});
    }
    if(url.includes('/api/status')){
      return new Response(JSON.stringify({objectives:[],jobs:[]}), {status:200});
    }
    if(url.includes('/api/objectives')){
      postedObjectives++;
      return new Response(JSON.stringify({id:`obj-${postedObjectives}`}), {status:200});
    }
    if(url.includes('/comments')||url.match(/\/issues\/\d+$/)){
      return new Response(JSON.stringify({ok:true}), {status:200});
    }
    return new Response('{}', {status:404});
  };

  const result=await materializeGithubCodingIssues({
    pool:mockPool,
    fetchImpl:mockFetch,
    concurrencyCap:2
  });

  assert.strictEqual(fetchedIssues,true);
  // Task 101 and Task 102 are non-overlapping and should be admitted up to cap=2.
  // Task 103 overlaps with Task 101 and should be scope-blocked.
  assert.strictEqual(result.created,2);
  assert.strictEqual(result.scopeBlocked,1);
});
