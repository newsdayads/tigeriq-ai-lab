import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const lease=readFileSync(new URL('./github-scope-lease.mjs',import.meta.url),'utf8');
const core=readFileSync(new URL('./core.mjs',import.meta.url),'utf8');
const intake=readFileSync(new URL('./github-intake.mjs',import.meta.url),'utf8');
const coreUi=readFileSync(new URL('./core-ui-assignment.mjs',import.meta.url),'utf8');

test('Core initializes the shared database table before any server listening',()=>{
  assert.ok(core.indexOf('await ensureGithubScopeLeases(pool)')>core.indexOf('await initDb()'));
  assert.ok(core.indexOf('await ensureGithubScopeLeases(pool)')<core.indexOf("await new Promise((resolve,reject)=>{server.once('error'"));
});
test('both Core admission lanes acquire the same scope lock, then check live worker lease',()=>{
  for(const src of [intake,coreUi]){
    const start=src.indexOf("async function insert"+(src===intake?"GithubObjectiveIfScopeFree":"ObjectiveIfScopeFree"));
    const body=src.slice(start,src.indexOf('\n}',start)+2);
    assert.match(body,/await client.query\('begin'\)/);
    assert.match(body,/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    assert.match(body,/scopeHasLiveGithubLease\(client,scope\)/);
    assert.ok(body.indexOf('pg_advisory_xact_lock')<body.indexOf('scopeHasLiveGithubLease'));
    assert.match(body,/rollback/);
  }
});
test('lease acquire is a single DB upsert and never relies on GitHub comment settle delay',()=>{
  assert.match(lease,/on conflict\(resource_scope\) do update/);
  assert.match(lease,/where tigeriq_github_scope_leases\.lease_until<=now\(\)/);
  assert.doesNotMatch(lease,/claimSettleMs|postComment/);
});
