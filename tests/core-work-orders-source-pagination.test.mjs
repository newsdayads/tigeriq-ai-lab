import test from 'node:test';
import assert from 'node:assert/strict';
import {collectGithubWorkOrderIssues,closedWorkOrderBucket} from '../apps/tigeriq-core/github-work-orders-pages.mjs';

const issue=(n,state='open')=>({number:n,state,title:'Issue '+n,updated_at:new Date(1780000000000+n*1000).toISOString()});
const pr=(n,state='open')=>({...issue(n,state),pull_request:{url:'https://api.github.com/repos/acme/test/pulls/'+n}});
const feed=pages=>async(state,page)=>pages[state]?.[page-1]||[];

test('Work Center does not lose open Issue beyond first 100 GitHub items dominated by PRs',async()=>{
  const first=[...Array.from({length:99},(_,i)=>pr(1000+i)),issue(4783)];
  const pages={open:[first,[issue(4902),issue(4780)]],closed:[[issue(4702,'closed')]]};
  const result=await collectGithubWorkOrderIssues({fetchPage:feed(pages)});
  assert.deepEqual(result.items.filter(x=>x.state==='open').map(x=>x.number),[4902,4783,4780]);
  assert.equal(result.sourceScope.openComplete,true);
  assert.equal(result.sourceScope.openIssues,3);
  assert.equal(result.sourceScope.openPages,2);
  assert.equal(result.sourceScope.closedHistoryLimit,50);
});

test('Open pages with more than 100 real issues are fully traversed',async()=>{
  const open=Array.from({length:125},(_,i)=>issue(i+1));
  const out=await collectGithubWorkOrderIssues({fetchPage:feed({open:[open.slice(0,100),open.slice(100)],closed:[[]]})});
  assert.equal(out.sourceScope.openIssues,125);
  assert.equal(out.sourceScope.openComplete,true);
  assert.equal(out.items.filter(x=>x.state==='open').length,125);
});

test('Closed history skips PR entries and obtains 50 real closed issues across pages',async()=>{
  const c1=[...Array.from({length:90},(_,i)=>pr(i+100,'closed')),...Array.from({length:10},(_,i)=>issue(i+500,'closed'))];
  const c2=Array.from({length:45},(_,i)=>issue(i+600,'closed'));
  const out=await collectGithubWorkOrderIssues({fetchPage:feed({open:[[]],closed:[c1,c2]})});
  assert.equal(out.sourceScope.recentClosedIssues,50);
  assert.equal(out.sourceScope.closedHistoryBounded,true);
  assert.equal(out.sourceScope.closedPages,2);
  assert.equal(out.items.some(x=>x.pull_request),false);
});

test('Page cap never claims open-source completeness',async()=>{
  const out=await collectGithubWorkOrderIssues({fetchPage:feed({open:[Array.from({length:100},(_,i)=>issue(i+1))],closed:[[]]}),maxOpenPages:1});
  assert.equal(out.sourceScope.openComplete,false);
  assert.equal(out.sourceScope.openIssues,100);
});

test('Duplicate records across GitHub page boundaries do not duplicate cards',async()=>{
  const page1=Array.from({length:100},(_,i)=>issue(i+1));
  const page2=[issue(100),issue(101)];
  const out=await collectGithubWorkOrderIssues({fetchPage:feed({open:[page1,page2],closed:[[]]})});
  assert.equal(out.sourceScope.openIssues,101);
  assert.equal(new Set(out.items.map(x=>x.number)).size,101);
});

test('Invalid paged GitHub response fails closed instead of showing complete data',async()=>{
  await assert.rejects(collectGithubWorkOrderIssues({fetchPage:async()=>({message:'API rate limit exceeded'})}),/PAGE_NOT_ARRAY/);
});

test('Closed != completed: source false-DONE and missing receipts show ĐÓNG KHÁC',()=>{
  const base={...issue(4870,'closed'),state_reason:'completed',body:[
    'DONE=false','FINISHED_AT=2026-10-16T11:00:00Z',
    'FINISH_RECEIPT_URL=https://github.com/newsdayads/tigeriq-ai-lab/issues/4870'
  ].join('\n')};
  const steps=[{checked:true,evidenceUrls:['https://github.com/newsdayads/tigeriq-ai-lab/issues/4870']}];
  assert.equal(closedWorkOrderBucket(base,steps),'ĐÓNG KHÁC');
  assert.equal(closedWorkOrderBucket({...base,body:base.body.replace('DONE=false','DONE=true').replace('FINISH_RECEIPT_URL=https:','FINISH_RECEIPT_URL=missing')},steps),'ĐÓNG KHÁC');
});

test('Completed requires GitHub finish receipt and evidence for every checked step',()=>{
  const base={...issue(4702,'closed'),state_reason:'completed',body:[
    'DONE=true','FINISHED_AT=2026-10-12T15:16:50Z',
    'FINISH_RECEIPT_URL=https://github.com/newsdayads/tigeriq-ai-lab/issues/4702#issuecomment-123'
  ].join('\n')};
  const checked=[{checked:true,evidenceUrls:['https://github.com/newsdayads/tigeriq-ai-lab/pull/4704']}];
  assert.equal(closedWorkOrderBucket(base,checked),'HOÀN THÀNH');
  assert.equal(closedWorkOrderBucket(base,[...checked,{checked:false,evidenceUrls:[]}]),'ĐÓNG KHÁC');
  assert.equal(closedWorkOrderBucket(base,[]),'ĐÓNG KHÁC');
});
