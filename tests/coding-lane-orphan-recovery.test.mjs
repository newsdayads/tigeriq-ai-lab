import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGithubIssueNumber,recoveryDecision,recoverOrphanedJobs} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

test('orphan recovery decisions are fail-closed and restart-safe',()=>{
  assert.equal(extractGithubIssueNumber('GitHub bootstrap coding issue #925: done'),925);
  assert.equal(extractGithubIssueNumber('https://github.com/newsdayads/tigeriq-ai-lab/issues/937'),937);
  assert.deepEqual(recoveryDecision({pr:{merged:true,state:'closed'}}),{action:'complete',reason:'PR_MERGED'});
  assert.deepEqual(recoveryDecision({job:{branch:'existing'},pr:{merged:false,state:'open'}}),{action:'resume',reason:'PR_OPEN'});
  assert.deepEqual(recoveryDecision({job:{branch:null},pr:{merged:false,state:'open'}}),{action:'block',reason:'PR_OPEN_WITHOUT_BRANCH'});
  assert.deepEqual(recoveryDecision({pr:{merged:false,state:'closed'}}),{action:'block',reason:'PR_CLOSED_UNMERGED'});
  assert.deepEqual(recoveryDecision({issue:{state:'closed',state_reason:'completed'}}),{action:'complete',reason:'ISSUE_COMPLETED'});
  assert.deepEqual(recoveryDecision({job:{branch:null},issue:{state:'open'}}),{action:'resume',reason:'ISSUE_OPEN_NO_MUTATION'});
  assert.deepEqual(recoveryDecision({job:{branch:'existing'},issue:{state:'open'}}),{action:'block',reason:'BRANCH_WITHOUT_PR'});
  assert.deepEqual(recoveryDecision({lookupError:'offline'}),{action:'defer',reason:'GITHUB_LOOKUP_FAILED'});
});

function fakeDb(seed){
  const jobs=seed.map(x=>({...x}));
  const objectiveUpdates=[];
  return {
    jobs,objectiveUpdates,
    async query(sql,args=[]){
      if(sql.startsWith('select j.*,o.objective')){
        return {rows:jobs.filter(j=>['running','review','waiting_ci'].includes(j.status)).map(j=>({...j}))};
      }
      const job=jobs.find(j=>j.id===args[0]);
      if(sql.includes("set status='done'")) job.status='done';
      else if(sql.includes("set status='queued'")) job.status='queued';
      else if(sql.includes("set status='waiting_resource'")) job.status='waiting_resource';
      else if(sql.includes("set status='failed'")) job.status='failed';
      else if(sql.startsWith('update tigeriq_coding_objectives')) objectiveUpdates.push({id:args[0],summary:args[1],sql});
      return {rows:[],rowCount:1};
    }
  };
}

test('startup recovery completes finished truth, resumes safe work, blocks ambiguous mutation, then becomes idempotent',async()=>{
  const db=fakeDb([
    {id:'J925',objective_id:'O925',status:'running',branch:null,pr_number:null,objective:'GitHub bootstrap coding issue #925: already complete'},
    {id:'JOPEN',objective_id:'OOPEN',status:'waiting_ci',branch:'tigeriq/nv12/open',pr_number:222,objective:'GitHub autonomous coding issue #937: open PR'},
    {id:'JORPHAN',objective_id:'OORPHAN',status:'review',branch:'tigeriq/nv12/orphan',pr_number:null,objective:'GitHub autonomous coding issue #937: orphan branch'}
  ]);
  const github=async path=>{
    if(path==='/issues/925')return {state:'closed',state_reason:'completed'};
    if(path==='/pulls/222')return {number:222,state:'open',merged:false};
    if(path==='/issues/937')return {state:'open',state_reason:null};
    throw new Error('unexpected '+path);
  };
  const first=await recoverOrphanedJobs({db,github});
  assert.deepEqual(first.map(x=>[x.jobId,x.action,x.reason]),[
    ['J925','complete','ISSUE_COMPLETED'],
    ['JOPEN','resume','PR_OPEN'],
    ['JORPHAN','block','BRANCH_WITHOUT_PR']
  ]);
  assert.deepEqual(db.jobs.map(x=>x.status),['done','queued','failed']);
  const second=await recoverOrphanedJobs({db,github});
  assert.deepEqual(second,[]);
});

test('GitHub lookup failure defers without inventing completion',async()=>{
  const db=fakeDb([{id:'J1',objective_id:'O1',status:'running',branch:'b',pr_number:7,objective:'GitHub autonomous coding issue #937'}]);
  const actions=await recoverOrphanedJobs({db,github:async()=>{throw new Error('network')}});
  assert.equal(actions[0].action,'defer');
  assert.equal(db.jobs[0].status,'waiting_resource');
});
