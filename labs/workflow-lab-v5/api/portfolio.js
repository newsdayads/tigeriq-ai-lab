// Isolated, public read-only data adapter. Each response scans at most eight
// GitHub pages; a timestamp cursor enables bounded continuation without page 11.
const START_SINCE='2000-01-01T00:00:00Z';
const PAGE_LIMIT=8;
export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
if(req.method!=='GET'){res.status(405).json({ok:false,reason:'METHOD_NOT_ALLOWED'});return}
const rawSince=req.query?.since;
if(rawSince!==undefined && (typeof rawSince!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(rawSince)||!Number.isFinite(Date.parse(rawSince))||Date.parse(rawSince)<Date.parse(START_SINCE)||Date.parse(rawSince)>Date.now()+86400000)){
res.status(400).json({ok:false,reason:'INVALID_SINCE_CURSOR'});return;
}
const since=rawSince||START_SINCE;
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),19000);
try{
const root='https://api.github.com/repos/newsdayads/tigeriq-ai-lab';
const issues=[];let complete=false;let pagesFetched=0;let stopReason=null;let nextSince=null;let lastTimestamp=null;
for(let page=1;page<=PAGE_LIMIT;page++){
const params=new URLSearchParams({state:'all',per_page:'100',sort:'updated',direction:'asc',since,page:String(page)});
let list;
try{
  const response=await fetch(root+'/issues?'+params.toString(),{headers:{Accept:'application/vnd.github+json','User-Agent':'TigerIQ-Workflow-Lab-ReadOnly'},signal:controller.signal});
  if(!response.ok)throw Error('GITHUB_HTTP_'+response.status+'_PAGE_'+page);
  list=await response.json();
  if(!Array.isArray(list))throw Error('GITHUB_SCHEMA_PAGE_'+page);
}catch(err){
  // Keep valid earlier pages on timeout/transport/schema failure; never assert complete.
  const reason=String(err?.message||err).startsWith('GITHUB_')?String(err.message):'GITHUB_FETCH_ERROR_PAGE_'+page;
  if(pagesFetched>0){stopReason=reason;break}
  throw Error(reason);
}
pagesFetched++;
for(const item of list)if(!item.pull_request)issues.push({number:item.number,title:item.title,body:String(item.body||'').slice(0,1500),state:item.state,state_reason:item.state_reason||null,updated_at:item.updated_at,created_at:item.created_at,closed_at:item.closed_at,html_url:item.html_url,assignee:item.assignee?.login||null,labels:(item.labels||[]).map(l=>l.name).filter(Boolean)});
if(list.length){lastTimestamp=list[list.length-1].updated_at;}
if(list.length<100){complete=true;break}
}
if(!complete&&!stopReason){
const lastMs=Date.parse(lastTimestamp||'');
const nextMs=lastMs-1000; // One-second overlap; client de-duplicates by issue number.
if(!Number.isFinite(lastMs)||nextMs<=Date.parse(since))stopReason='CURSOR_NO_PROGRESS';
else {nextSince=new Date(nextMs).toISOString();stopReason='NEXT_WINDOW_AVAILABLE';}
}
let core={connected:false,reason:'CORE_UNAVAILABLE',summary:null,mode:null,generatedAt:null,rows:[]};
try{const cr=await fetch('https://tigeriq-ai-lab.vercel.app/api/live-status',{headers:{Accept:'application/json'},signal:controller.signal});if(!cr.ok)throw Error('HTTP_'+cr.status);const raw=await cr.json();if(!raw?.ok)throw Error('CORE_NOT_OK');core={connected:true,mode:String(raw.mode||'unknown'),generatedAt:raw.generatedAt||null,stale:!!raw.staleAll||!raw.liveConnected,summary:raw.summary||null,rows:[...(raw.activeWork||[]),...(raw.openWork||[]),...(raw.recentWork||[])].slice(0,300).map(w=>({number:w.number||null,jobId:w.jobId||null,title:String(w.title||'').slice(0,180),status:w.status||null,employeeId:w.employeeId||null,projectId:w.projectId||null,projectName:w.projectName||null,dependencies:w.dependencies||[],parentNumber:w.parentNumber||null,nextStep:w.nextStep||null}))};}catch(err){core.reason=String(err.message||err).slice(0,110)}
res.status(200).json({ok:true,source:'GitHub API read-only + TigerIQ public read-only live-status',generatedAt:new Date().toISOString(),coverage:{scopeRepo:'newsdayads/tigeriq-ai-lab',externalRepoCoverage:false,issues:issues.length,complete,truncated:!complete,pagesLimit:PAGE_LIMIT,pagesFetched,stopReason,since,nextSince},issues,core})
}catch(err){res.status(503).json({ok:false,reason:String(err.message||err).slice(0,160),issues:[],core:{connected:false}})}finally{clearTimeout(timer)}
}