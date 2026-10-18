import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFile,stat} from 'node:fs/promises';
import {safeEvidenceDir,driveWorkCard} from '../scripts/verify-core-ui-sandbox.mjs';

const work={number:2054,title:'Fixture only',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2054'};
const diagnostic={origin:'http://127.0.0.1:4315',issueNumber:2054,work};
function sandboxCase(parentLink=false){
 const root=mkdtempSync(join(tmpdir(),'pstack-t03-test-'));
 const cwd=join(root,'repo'),outside=join(root,'outside');
 mkdirSync(join(cwd,'artifacts'),{recursive:true});mkdirSync(outside);
 if(parentLink)symlinkSync(outside,join(cwd,'artifacts','pstack-verification'),'dir');
 else {mkdirSync(join(cwd,'artifacts','pstack-verification'));symlinkSync(outside,join(cwd,'artifacts','pstack-verification','indirect'),'dir');}
 return {root,cwd};
}
test('T03: existing symlink in evidence root is blocked before creation',()=>{
 const {root,cwd}=sandboxCase(true);
 try {assert.throws(()=>safeEvidenceDir('artifacts/pstack-verification/job42',cwd),{code:'EVIDENCE_SYMLINK_FORBIDDEN'});}
 finally {rmSync(root,{recursive:true,force:true})}
});
test('T03: nested symlink below evidence root is blocked',()=>{
 const {root,cwd}=sandboxCase(false);
 try {assert.throws(()=>safeEvidenceDir('artifacts/pstack-verification/indirect/job42',cwd),{code:'EVIDENCE_SYMLINK_FORBIDDEN'});}
 finally {rmSync(root,{recursive:true,force:true})}
});
function browserFixture({destination='http://127.0.0.1:4315/',requestUrls=[],webSocketRouteSupported=true}={}){
 let closed=false,handler,visited=false,aborted=0;
 const row={count:async()=>1,isVisible:async()=>true,innerText:async()=> 'fixture row',click:async()=>{}};
 const page={
  goto:async()=>{visited=true; for(const url of requestUrls){await handler({request:()=>({url:()=>url}),continue:async()=>{},abort:async()=>{aborted++;}});}},
  url:()=>destination,
  locator:sel=>({'.work-row[data-work-number="2054"]':row,'#workDetailBackdrop':{count:async()=>1,getAttribute:async()=> 'open'},'#workDetailModal':{innerText:async()=> 'fixture detail'},'#workDetailGithub':{getAttribute:async()=>work.url}})[sel]
 };
 return {factory:async()=>({newContext:async()=>{
  const context={newPage:async()=>page,route:async(_glob,cb)=>{handler=cb;}};
  if(webSocketRouteSupported)context.routeWebSocket=async()=>{};
  return context;
 },close:async()=>{closed=true}}),observed:()=>({closed,visited,aborted})};
}
test('T03: redirected browser page outside sandbox must not be accepted',async()=>{
 const b=browserFixture({destination:'http://127.0.0.1:3210/'});
 await assert.rejects(driveWorkCard({diagnostic,browserFactory:b.factory}),{code:'UI_NAVIGATION_OUT_OF_SCOPE'});
 assert.equal(b.observed().closed,true);
});
test('T03: external document resource is denied and cannot produce a PASS',async()=>{
 const b=browserFixture({requestUrls:['https://outside.invalid/resource']});
 await assert.rejects(driveWorkCard({diagnostic,browserFactory:b.factory}),{code:'UI_NETWORK_OUT_OF_SCOPE'});
 assert.equal(b.observed().aborted,1);assert.equal(b.observed().closed,true);
});
test('T03: local-only browser requests may proceed without claiming product acceptance',async()=>{
 const b=browserFixture({requestUrls:['http://127.0.0.1:4315/work-ui.css']});
 const res=await driveWorkCard({diagnostic,browserFactory:b.factory});
 assert.equal(res.action,'OPEN_WORK_CARD');assert.equal(b.observed().closed,true);
});
test('T03: missing browser request guard is a blocker, not a degraded PASS',async()=>{
 let closed=false;
 const factory=async()=>({newContext:async()=>({newPage:async()=>({})}),close:async()=>{closed=true}});
 await assert.rejects(driveWorkCard({diagnostic,browserFactory:factory}),{code:'UI_NETWORK_GUARD_UNAVAILABLE'});
 assert.equal(closed,true);
});
test('T03: changing location after card click blocks evidence acceptance',async()=>{
 let redirected=false,closed=false;
 const target={count:async()=>1,isVisible:async()=>true,innerText:async()=> 'fixture',click:async()=>{redirected=true}};
 const page={goto:async()=>{},url:()=>redirected?'http://127.0.0.1:3150/':'http://127.0.0.1:4315/',
   locator:sel=>({'.work-row[data-work-number="2054"]':target})[sel]};
 const factory=async()=>({newContext:async()=>({route:async()=>{},routeWebSocket:async()=>{},newPage:async()=>page}),close:async()=>{closed=true}});
 await assert.rejects(driveWorkCard({diagnostic,browserFactory:factory}),{code:'UI_NAVIGATION_OUT_OF_SCOPE'});
 assert.equal(closed,true);
});

test('T04: WebSocket route guard is required before any browser navigation',async()=>{
 const b=browserFixture({webSocketRouteSupported:false});
 await assert.rejects(driveWorkCard({diagnostic,browserFactory:b.factory}),
   {code:'UI_WEBSOCKET_GUARD_UNAVAILABLE'});
 assert.equal(b.observed().visited,false,'navigation must not begin without WebSocket interception');
 assert.equal(b.observed().closed,true);
});
test('T04: unsolicited WebSocket is denied without connecting outside the sandbox',async()=>{
 const b=browserFixture();let webSocketHandler,closedSockets=0;
 const factory=async()=>{
   const browser=await b.factory(),createContext=browser.newContext;
   browser.newContext=async()=> {
     const context=await createContext(),createPage=context.newPage;
     context.routeWebSocket=async(_pattern,handler)=>{webSocketHandler=handler};
     context.newPage=async()=>{
       const page=await createPage(),navigate=page.goto;
       page.goto=async(...args)=>{
         await navigate(...args);
         if(webSocketHandler)
           await webSocketHandler({close:async()=>{closedSockets++}});
       };
       return page;
     };
     return context;
   };
   return browser;
 };
 await assert.rejects(driveWorkCard({diagnostic,browserFactory:factory}),
   {code:'UI_NETWORK_OUT_OF_SCOPE'});
 assert.equal(closedSockets,1,'WebSocket must close without a server connection');
 assert.equal(b.observed().closed,true);
});

function evidenceTestRoot(){
 const root=join(process.cwd(),'artifacts','pstack-verification');
 mkdirSync(root,{recursive:true});
 return root;
}
test('T06: evidence output requires a real trace capability before browser navigation',async()=>{
 const dir=mkdtempSync(join(evidenceTestRoot(),'pstack-t06-trace-gate-'));
 const b=browserFixture();
 try{
  await assert.rejects(driveWorkCard({diagnostic,browserFactory:b.factory,outputDir:dir}),
    {code:'UI_TRACE_UNAVAILABLE'});
  assert.equal(b.observed().visited,false,'no navigation before trace capability verification');
  assert.equal(b.observed().closed,true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('T06: successful evidence records must include nonempty screenshot and trace files',async()=>{
 const dir=mkdtempSync(join(evidenceTestRoot(),'pstack-t06-trace-positive-'));
 const b=browserFixture(),steps=[];
 const factory=async()=>{
  const browser=await b.factory(),originalContext=browser.newContext;
  browser.newContext=async()=>{
   const context=await originalContext(),originalPage=context.newPage;
   context.tracing={
    start:async()=>{steps.push('trace-start');},
    stop:async({path})=>{steps.push('trace-stop');await writeFile(path,Buffer.from('playwright trace evidence'));}
   };
   context.newPage=async()=>{
    const page=await originalPage();
    page.screenshot=async({path})=>{steps.push('screenshot');await writeFile(path,Buffer.from('PNG evidence'));};
    return page;
   };
   return context;
  };
  return browser;
 };
 try{
  const r=await driveWorkCard({diagnostic,browserFactory:factory,outputDir:dir});
  assert.deepEqual(steps,['trace-start','screenshot','trace-stop']);
  assert.equal(r.trace,join(dir,'core-ui-work-card-trace.zip'));
  assert.equal(r.screenshot,join(dir,'core-ui-work-card.png'));
  assert.equal((await stat(r.trace)).size>0,true);
  assert.equal((await stat(r.screenshot)).size>0,true);
  assert.equal(b.observed().closed,true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('T06: missing trace bytes cannot produce a successful verification packet',async()=>{
 const dir=mkdtempSync(join(evidenceTestRoot(),'pstack-t06-trace-empty-'));
 const b=browserFixture();
 const factory=async()=>{
  const browser=await b.factory(),originalContext=browser.newContext;
  browser.newContext=async()=>{
   const context=await originalContext(),originalPage=context.newPage;
   context.tracing={start:async()=>{},stop:async()=>{}};
   context.newPage=async()=>{
    const page=await originalPage();
    page.screenshot=async({path})=>writeFile(path,Buffer.from('PNG evidence'));
    return page;
   };
   return context;
  };
  return browser;
 };
 try{
  await assert.rejects(driveWorkCard({diagnostic,browserFactory:factory,outputDir:dir}),
    {code:'UI_TRACE_NOT_RECORDED'});
  assert.equal(existsSync(join(dir,'core-ui-work-card-trace.zip')),false);
  assert.equal(b.observed().closed,true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('T03: exported drive rejects evidence outside the scoped artifacts root before browser factory',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pstack-t03-outside-direct-'));
 let calls=0;
 try{
  await assert.rejects(driveWorkCard({diagnostic,outputDir:dir,browserFactory:async()=>{
    calls++;throw Error('BROWSER_MUST_NOT_OPEN_FOR_OUTSIDE_EVIDENCE');
  }}),{code:'EVIDENCE_SCOPE_INVALID'});
  assert.equal(calls,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('T03: exported drive cannot overwrite an existing evidence receipt in a scoped directory',async()=>{
 const root=join(process.cwd(),'artifacts','pstack-verification');
 mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'t03-preexisting-direct-'));
 let calls=0;
 try{
  await writeFile(join(dir,'core-ui-work-card.png'),'protected receipt');
  await assert.rejects(driveWorkCard({diagnostic,outputDir:dir,browserFactory:async()=>{
    calls++;throw Error('BROWSER_MUST_NOT_OPEN_FOR_OLD_EVIDENCE');
  }}),{code:'EVIDENCE_DIR_NOT_EMPTY'});
  assert.equal(calls,0);
  assert.equal((await stat(join(dir,'core-ui-work-card.png'))).size>0,true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
