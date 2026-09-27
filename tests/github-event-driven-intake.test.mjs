import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {githubRequestJson,githubTransportSnapshot,invalidateGithubCache} from '../apps/tigeriq-core/github-shared-client.mjs';
import {githubEventIssue,githubEventNumber,subscribeGithubEvents,publishGithubEvent} from '../apps/tigeriq-core/github-event-bus.mjs';
import {validateGithubActionsClaims} from '../apps/tigeriq-core/github-actions-oidc.mjs';
import {GITHUB_RECONCILE_INTERVAL_MS} from '../apps/tigeriq-core/github-intake.mjs';
import {GITHUB_CODING_RECONCILE_INTERVAL_MS} from '../apps/tigeriq-core/github-coding-intake.mjs';

function headers(values={}){const map=new Map(Object.entries(values).map(([k,v])=>[k.toLowerCase(),String(v)]));return {get:key=>map.get(String(key).toLowerCase())??null}}
function response(status,body,hs={}){return {status,ok:status>=200&&status<300,headers:headers(hs),text:async()=>status===304?'':JSON.stringify(body)}}

test('GitHub reconciliation fallback is five minutes, not hot polling',()=>{
  assert.equal(GITHUB_RECONCILE_INTERVAL_MS,300000);
  assert.equal(GITHUB_CODING_RECONCILE_INTERVAL_MS,300000);
});

test('shared GitHub client uses memory cache then ETag conditional request',async()=>{
  invalidateGithubCache();
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    calls.push({url,headers:init.headers});
    if(calls.length===1)return response(200,{value:1},{etag:'"abc"','x-ratelimit-remaining':'4999'});
    assert.equal(init.headers['if-none-match'],'"abc"');
    return response(304,null,{etag:'"abc"','x-ratelimit-remaining':'4999'});
  };
  const url='https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues?state=open';
  const first=await githubRequestJson(fetchImpl,url,'fake',{freshMs:0});
  const second=await githubRequestJson(fetchImpl,url,'fake',{freshMs:0});
  assert.deepEqual(first,{value:1});
  assert.deepEqual(second,{value:1});
  assert.equal(calls.length,2);
  assert.ok(githubTransportSnapshot().notModified>=1);
});

test('event bus extracts Work Order and wakes subscribers without inventing UI routing',async()=>{
  const seen=[];
  const unsubscribe=subscribeGithubEvents(event=>seen.push(event));
  const payload={repository:{full_name:'newsdayads/tigeriq-ai-lab'},issue:{number:2186,state:'open'}};
  const out=publishGithubEvent({eventName:'issues',deliveryId:'123:1',payload});
  await new Promise(resolve=>setImmediate(resolve));
  unsubscribe();
  assert.equal(githubEventIssue(payload).number,2186);
  assert.equal(githubEventNumber(payload),2186);
  assert.equal(out.issueNumber,2186);
  assert.equal(seen.length,1);
});

test('OIDC claims are bound to canonical repo, workflow, audience and main',()=>{
  const now=Date.now();
  const claims={
    iss:'https://token.actions.githubusercontent.com',
    aud:'tigeriq-core',
    repository:'newsdayads/tigeriq-ai-lab',
    repository_owner:'newsdayads',
    workflow_ref:'newsdayads/tigeriq-ai-lab/.github/workflows/tigeriq-core-event-dispatch.yml@refs/heads/main',
    ref:'refs/heads/main',
    exp:Math.floor(now/1000)+300,
    nbf:Math.floor(now/1000)-30,
    run_id:'42',
    actor:'newsdayads',
  };
  assert.equal(validateGithubActionsClaims(claims,now).repository,'newsdayads/tigeriq-ai-lab');
  assert.throws(()=>validateGithubActionsClaims({...claims,aud:'wrong'},now),/AUDIENCE_INVALID/);
  assert.throws(()=>validateGithubActionsClaims({...claims,repository:'other/repo'},now),/REPOSITORY_INVALID/);
  assert.throws(()=>validateGithubActionsClaims({...claims,ref:'refs/heads/dev'},now),/REF_INVALID/);
});

test('Core endpoint durably dedupes GitHub deliveries before publishing',()=>{
  const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
  assert.match(core,/POST'&&url\.pathname==='\/api\/github-event'/);
  assert.match(core,/verifyGithubActionsOidc/);
  assert.match(core,/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(core,/GITHUB_EVENT_RECEIVED/);
  assert.match(core,/publishGithubEvent/);
});

test('GitHub workflow is event-driven with OIDC and no persistent dispatch secret',()=>{
  const workflow=readFileSync('.github/workflows/tigeriq-core-event-dispatch.yml','utf8');
  assert.match(workflow,/issues:/);
  assert.match(workflow,/issue_comment:/);
  assert.match(workflow,/pull_request_target:/);
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/audience=tigeriq-core/);
  assert.match(workflow,/X-TigerIQ-Delivery/);
  assert.doesNotMatch(workflow,/WEBHOOK_SECRET|TIGERIQ_CORE_TOKEN/);
});

test('canonical bridge relays signed events while preserving read-only status API',()=>{
  const bridge=readFileSync('apps/tigeriq-live-bridge/server.mjs','utf8');
  assert.match(bridge,/POST'&&req\.url==='\/github-event'/);
  assert.match(bridge,/authorization/);
  assert.match(bridge,/x-github-event/);
  assert.match(bridge,/x-tigeriq-delivery/);
  assert.match(bridge,/CORE_EVENT/);
  assert.match(bridge,/req\.url==='\/health'/);
  assert.match(bridge,/req\.url!=='\/status'/);
});

test('runtime updater reconciles bridge by health, not scheduled-task Running state',()=>{
  const updater=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
  const start=updater.indexOf('function Invoke-LiveStatusBridgeReconcile');
  const end=updater.indexOf('function Test-TcpPort',start);
  const block=updater.slice(start,end);
  assert.match(block,/CANONICAL_SOURCE_UPDATED/);
  assert.match(block,/Test-TcpPort '127\.0\.0\.1' 8801/);
  assert.match(block,/LOCAL_PORT_HEALTHY/);
  assert.ok(block.indexOf("LOCAL_PORT_HEALTHY")<block.indexOf('Start-ScheduledTask'));
});
