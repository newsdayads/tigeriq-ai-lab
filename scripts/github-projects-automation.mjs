// P0 #4640: one-way Projects automation. No secrets, Core mutations, dispatch, or paid services.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const owner='newsdayads',base='https://github.com/newsdayads/';
const titles=['','TIGERIQ — MASTER PORTFOLIO','TIGERIQ AI','TIGERIQ NEWS / MEDIA','PAPERCLIP VNEXT','REVENUE LAB','TIGERIQ DRIVER','DEXCAM PERSONAL','TIGERIQ COIN'];
const repoGroup={drivetrack:6,'tigeriq-media':3,'tigeriq-media-content':3,derophone:8,derophone_BK:8,derobizfly:8,zephyr:8};
const codes={'CORE':2,'TIGERIQ AI':2,'TIGERIQ LIVE':2,'WORKFLOW LAB':2,'APP CHROME':2,'MOBILE WORKER':2,'TIGERIQ NEWS':3,'TIGERIQ MEDIA':3,'PAPERCLIP':4,'PAPERCLIP VNEXT':4,'REVENUE LAB':5,'TIGERIQ DRIVER':6,'DRIVER':6,'DEXCAM':7,'DEXCAM PERSONAL':7,'TIGERIQ COIN':8};
const coreProjectOwner={
 'tigeriq-platform':2,'tigeriq-mobile-worker':2,'tigeriq-live':2,'tigeriq-workflow-lab':2,'tigeriq-app-chrome':2,
 'tigeriq-news':3,'tigeriq-media':3,'paperclip-vnext':4,'revenue-lab':5,'tigeriq-driver':6,
 'dexcam-personal':7,'tigeriq-dexcam-personal':7,'tigeriq-coin':8
};
const repos=['tigeriq-ai-lab',...Object.keys(repoGroup)];
const labels=['','', 'TigerIQ AI','TigerIQ News / Media','Paperclip vNext','Revenue Lab','TigerIQ Driver','DeXCam Personal','TigerIQ Coin'];
const gh=(args)=>{const r=spawnSync('gh',args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4e6});if(r.status!==0||r.error)throw Error('GH_API_BLOCKED');return r.stdout.trim()};
const graph=(q,vars={})=>{let a=['api','graphql','-f','query='+q];for(const [k,v] of Object.entries(vars))a.push('-f',k+'='+String(v));const z=JSON.parse(gh(a));if(!z.data||z.errors)throw Error('GRAPHQL_BLOCKED');return z.data};
function readProjects(){
 const root=graph(QUERY,{owner});if(!root.user)throw Error('OWNER_MISMATCH');
 for(let n=1;n<=8;n++){
  const first=root.user['p'+n];if(!first)throw Error('PROJECT_MISSING');
  let rounds=0;
  while(first.items?.pageInfo?.hasNextPage){
   if(++rounds>20||first.items.nodes.length>=1000||!first.items.pageInfo.endCursor)throw Error('PROJECT_PAGINATION_LIMIT_'+n);
   const block=invBlock(n).replace(/items\(first:\d+\)/,'items(first:50,after:$after)');
   const q='query($owner:String!,$after:String){user(login:$owner){'+block+'}}';
   const next=graph(q,{owner,after:first.items.pageInfo.endCursor}).user?.['p'+n];
   if(!next||next.id!==first.id||next.public!==false||!next.items)throw Error('PROJECT_PAGE_ID_CHANGED');
   first.items.nodes.push(...next.items.nodes);
   first.items.pageInfo=next.items.pageInfo;
  }
 }
 return validateInventory(root);
}
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
const canonical=url=>/^https:\/\/github\.com\/newsdayads\/(?:tigeriq-ai-lab|tigeriq-media|tigeriq-media-content|drivetrack|derophone|derophone_BK|derobizfly|zephyr)\/(?:issues|pull)\/[1-9]\d*$/.test(url||'');
export function route(row){
 if(!canonical(row.url))return {reason:'INVALID_URL'};
 if(row.url===base+'drivetrack/issues/366')return {reason:'SENSITIVE_EXCLUDED'};
 const repo=row.url.split('/')[4];if(repoGroup[repo])return {project:repoGroup[repo],reason:'REPO'};
 const matches=[...(row.title||'').matchAll(/\[([^\]]{1,64})\]/g)].filter(m=>m.index<110).map(m=>norm(m[1]));
 const labelCodes=(row.labels||[]).map(norm).filter(s=>s.startsWith('PROJECT:')).map(s=>s.slice(8).trim());
 const groupIds=[...new Set([...matches,...labelCodes].map(s=>codes[s]).filter(Boolean))];
 if(groupIds.length!==1)return {reason:groupIds.length?'CONFLICT':'NO_EXPLICIT_CODE'};
 const subs={CORE:'Nền tảng TigerIQ','TIGERIQ LIVE':'TigerIQ Live','WORKFLOW LAB':'Workflow Lab','APP CHROME':'App Chrome','MOBILE WORKER':'TigerIQ Mobile Worker'};
 const sub=[...new Set(matches.map(x=>subs[x]).filter(Boolean))];
 return {project:groupIds[0],subproject:groupIds[0]===2&&sub.length===1?sub[0]:null,reason:'EXPLICIT_CODE'};
}
const invBlock=n=>'p'+n+':projectV2(number:'+n+'){id number title public url viewerCanUpdate fields(first:30){nodes{... on ProjectV2SingleSelectField{id name options{id name}} ... on ProjectV2Field{id name}}pageInfo{hasNextPage}}items(first:'+(n===1?70:n===2?50:n===3?15:10)+'){nodes{id content{... on Issue{id url number repository{nameWithOwner}} ... on PullRequest{id url number repository{nameWithOwner}}}fieldValues(first:10){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}}pageInfo{hasNextPage endCursor}}}';
const QUERY='query($owner:String!){user(login:$owner){'+[1,2,3,4,5,6,7,8].map(invBlock).join(' ')+'}}';
export function validateInventory(response){
 const u=response?.user;if(!u)throw Error('OWNER_MISMATCH');
 const ps=new Map(),single=new Set();
 for(let n=1;n<=8;n++){const p=u['p'+n];if(!p||p.number!==n||p.title!==titles[n]||p.public!==false||!p.viewerCanUpdate||p.items.pageInfo.hasNextPage||p.fields.pageInfo.hasNextPage)throw Error('PROJECT_SCHEMA_'+n);
 const items=new Map();for(const i of p.items.nodes){const url=i.content?.url;if(!canonical(url)||items.has(url)||!i.content?.id)throw Error('INVALID_PROJECT_ITEM_'+n);items.set(url,i);if(n>1){if(single.has(url))throw Error('CROSS_PROJECT_DUPLICATE');single.add(url)}}
 ps.set(n,{...p,items});
 }return ps;
}
export function verifyCore(c,now=Date.now()){
 const p=c?.workProjection;if(c?.ok!==true||c.liveConnected!==true||c.mode!=='pc01-live'||c.authority!=='PC01 live runtime'||c.source?.core!==true||p?.mode!=='pc01-live+github'||p.stale!==false||p.openIssueEnumerationComplete!==true)throw Error('CORE_NOT_VERIFIED');
 for(const t of [c.generatedAt,p.verifiedAt]){const age=now-Date.parse(t);if(!Number.isFinite(age)||age<0||age>120000)throw Error('CORE_STALE')}
}
const states={'CHUA XAC MINH':'CHƯA XÁC MINH','BI CHAN':'BỊ CHẶN','HOAN TAT':'HOÀN TẤT','RA SOAT':'RÀ SOÁT',REVIEW:'RÀ SOÁT',VERIFY:'RÀ SOÁT',CHO:'CHỜ',QUEUED:'CHỜ',READY:'CHỜ',OPEN:'CHƯA XÁC MINH',BLOCKED:'BỊ CHẶN',OWNER_GATE:'BỊ CHẶN',WORKING:'ĐANG XỬ LÝ',RUNNING:'ĐANG XỬ LÝ','DANG XU LY':'ĐANG XỬ LÝ',DONE:'HOÀN TẤT',PASS:'HOÀN TẤT',COMPLETED:'HOÀN TẤT'};
export function coreStates(c){
 const active=new Map((c.activeWork||[]).filter(x=>canonical(x.url)&&x.live===true).map(x=>[x.url,x]));
 const map=new Map();
 for(const arr of [c.recentWork||[],c.openWork||[],c.activeWork||[]])for(const x of arr){
 if(!canonical(x.url)||x.portfolioHidden===true||x.workKind&&x.workKind!=='WORK')continue;
 const state=states[norm(x.status)]||states[norm(x.displayState)];if(!state)continue;
 if(state==='ĐANG XỬ LÝ'&&!active.has(x.url))continue;
 const prior=map.get(x.url);
 const projectId=x.projectId||prior?.projectId;
 if(projectId)map.set(x.url,{state,projectId});
 }return map;
}
const field=(p,name)=>p.fields.nodes.find(x=>x.name===name);
const fieldValue=(row,name)=>row.fieldValues.nodes.find(x=>x.field?.name===name)?.name;
export function proposals(ps,rows,statesByUrl){
 const actions=[],quarantine=[];
 const master=ps.get(1);for(const row of rows){
 if(!canonical(row.url))continue;
 if(row.url===base+'drivetrack/issues/366'){quarantine.push({reason:'SENSITIVE_EXCLUDED'});continue}
 const owners=[2,3,4,5,6,7,8].filter(n=>ps.get(n).items.has(row.url));
 if(owners.length>1)throw Error('CROSS_PROJECT_DUPLICATE');
 let target;
 if(owners.length===1)target=owners[0];
 else if(master.items.has(row.url)){const group=fieldValue(master.items.get(row.url),'PROJECT');target=labels.indexOf(group);if(target<2)target=null;}
 else target=route(row).project;
 if(!target){quarantine.push({reason:'AMBIGUOUS'});continue}
 const needsMaster=!master.items.has(row.url),needsTarget=!ps.get(target).items.has(row.url);
 if(needsMaster||needsTarget)actions.push({kind:'add',url:row.url,number:target,needsMaster,needsTarget});
 }
 for(let n=2;n<=8;n++){const p=ps.get(n);const f=field(p,'Status'),fm=field(master,'Status');if(!f?.options||!fm?.options)throw Error('STATUS_SCHEMA_'+n);
 for(const [url,item] of p.items){const record=statesByUrl.get(url);if(!record||!master.items.has(url))continue;
 if(fieldValue(master.items.get(url),'PROJECT')!==labels[n]){quarantine.push({reason:'MASTER_TARGET_MISMATCH',url});continue}
 if(coreProjectOwner[record.projectId]!==n){quarantine.push({reason:'CORE_PROJECT_MISMATCH',url});continue}
 const target=record.state;
 for(const [proj,r,ff] of [[p,item,f],[master,master.items.get(url),fm]]){
 if(fieldValue(r,'Status')===target)continue;const opts=ff.options.filter(o=>o.name===target);if(opts.length!==1)throw Error('INVALID_STATUS_OPTION');
 actions.push({kind:'status',number:proj.number,url,projectId:proj.id,itemId:r.id,fieldId:ff.id,optionId:opts[0].id});
 }}}
 return {actions,quarantine};
}
const statusMutation='mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}';
const addMutation='mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}';
function sourceNode(url){const bits=url.split('/');const repo=bits[4],number=bits[6],kind=bits[5]==='pull'?'pulls':'issues';const x=JSON.parse(gh(['api','repos/'+owner+'/'+repo+'/'+kind+'/'+number]));if(!x.node_id)throw Error('MISSING_CONTENT_ID');return x.node_id;}
function readRows(){const out=[],seen=new Set(),failures=[];for(const repo of repos){
 try{const result=JSON.parse(gh(['api','repos/'+owner+'/'+repo+'/issues?state=open&per_page=100']));if(!Array.isArray(result)||result.length>=100)throw Error('INCOMPLETE_ISSUES');
 for(const r of result){const url=r.pull_request?.html_url||r.html_url;if(!canonical(url)||seen.has(url))continue;seen.add(url);out.push({url,title:r.title,labels:(r.labels||[]).map(x=>x.name)})}}
 catch(e){failures.push({repo,error:String(e.message).slice(0,60)})}
 }return {out,failures};
}
async function getCore(){const r=await fetch('https://tigeriq-ai-lab.vercel.app/api/live-status',{redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('CORE_HTTP_FAILED');const c=await r.json();verifyCore(c);return c;}
export function isolateActions(actions,apply){const result={applied:0,failures:[]};for(const a of actions){try{result.applied+=apply(a)}catch(e){result.failures.push({project:a.number,operation:a.kind,error:String(e.message).slice(0,100)})}}return result;}
export async function main({write=false}={}){
 const report={time:new Date().toISOString(),mode:write?'write':'dry-run',status:'BLOCKED',actions:0,applied:0,quarantine:0,failures:[]};
 try{
 const ps=readProjects(),issues=readRows();
 for(const f of issues.failures)report.failures.push({operation:'repo_read',project:f.repo,error:f.error});
 let statesByUrl=new Map();
 try{statesByUrl=coreStates(await getCore())}catch(e){report.failures.push({operation:'core_sync',error:String(e.message).slice(0,90)})}
 const plan=proposals(ps,issues.out,statesByUrl);
 report.actions=plan.actions.length;report.quarantine=plan.quarantine.length;report.itemCounts=[...ps].map(([n,p])=>[n,p.items.size]);
 report.proposed=plan.actions.map(a=>({kind:a.kind,number:a.number,url:a.url,needsMaster:a.needsMaster,needsTarget:a.needsTarget}));
 report.quarantineReasons=plan.quarantine.map(x=>x.reason);
 // Default dry-run; writes never change Core or Issue/PR, never create duplicate items.
 if(write){if(plan.actions.length>100)throw Error('WRITE_PLAN_TOO_LARGE');
 const effects=isolateActions(plan.actions.slice(0,40),a=>{
 if(a.kind==='add'){const content=ps.get(1).items.get(a.url)?.content.id||sourceNode(a.url);let count=0;
 if(a.needsMaster){const result=graph(addMutation,{project:ps.get(1).id,content});count++;
 const projectField=field(ps.get(1),'PROJECT'),option=projectField?.options?.find(o=>o.name===labels[a.number]);
 if(!result.addProjectV2ItemById?.item?.id||!option)throw Error('MASTER_PROJECT_FIELD_INVALID');
 graph(statusMutation,{project:ps.get(1).id,item:result.addProjectV2ItemById.item.id,field:projectField.id,option:option.id});count++}
 if(a.needsTarget){graph(addMutation,{project:ps.get(a.number).id,content});count++}
 return count;
 }else{graph(statusMutation,{project:a.projectId,item:a.itemId,field:a.fieldId,option:a.optionId});return 1}
 });report.applied=effects.applied;report.failures.push(...effects.failures);}
 if(write&&plan.actions.length>40)report.failures.push({operation:'bounded_batch',error:'PENDING_NEXT_CYCLE'});
 report.status=report.failures.length?'PARTIAL_FAIL':'PASS';
 }catch(e){report.failures.push({operation:'preflight',error:String(e.message).slice(0,100)});}
 try{writeFileSync(new URL('../latest-portfolio-report.json',import.meta.url),JSON.stringify(report,null,2))}catch{}
 return report;
}
if(process.argv[1]&&process.argv[1].toLowerCase()===new URL(import.meta.url).pathname.replace(/^\//,'').toLowerCase().replace(/\//g,'\\')){
 const allowed=process.argv.slice(2).every(x=>['--write','--dry-run'].includes(x));
 if(!allowed)process.exitCode=2;
 else main({write:process.argv.includes('--write')}).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.status==='PASS'?0:2;});
}
