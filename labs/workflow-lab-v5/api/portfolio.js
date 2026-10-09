export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
if(req.method!=='GET'){res.status(405).json({ok:false,reason:'METHOD_NOT_ALLOWED'});return}
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),19000);
try{
const root='https://api.github.com/repos/newsdayads/tigeriq-ai-lab';
const issues=[];let complete=false;let truncated=false;
for(let page=1;page<=12;page++){
const r=await fetch(root+'/issues?state=all&per_page=100&sort=updated&direction=desc&page='+page,{headers:{Accept:'application/vnd.github+json','User-Agent':'TigerIQ-Workflow-Lab-ReadOnly'},signal:controller.signal});
if(!r.ok)throw Error('GITHUB_HTTP_'+r.status);
const list=await r.json();if(!Array.isArray(list))throw Error('GITHUB_SCHEMA');
for(const item of list)if(!item.pull_request)issues.push({number:item.number,title:item.title,body:String(item.body||'').slice(0,4000),state:item.state,updated_at:item.updated_at,created_at:item.created_at,closed_at:item.closed_at,html_url:item.html_url,assignee:item.assignee?.login||null,labels:(item.labels||[]).map(l=>l.name).filter(Boolean)});
if(list.length<100){complete=true;break}
}
if(!complete)truncated=true;
let core={connected:false,reason:'CORE_UNAVAILABLE',summary:null,mode:null,generatedAt:null,rows:[]};
try{const cr=await fetch('https://tigeriq-ai-lab.vercel.app/api/live-status',{headers:{Accept:'application/json'},signal:controller.signal});if(!cr.ok)throw Error('HTTP_'+cr.status);const raw=await cr.json();if(!raw?.ok)throw Error('CORE_NOT_OK');core={connected:true,mode:String(raw.mode||'unknown'),generatedAt:raw.generatedAt||null,stale:!!raw.staleAll||!raw.liveConnected,summary:raw.summary||null,rows:[...(raw.activeWork||[]),...(raw.openWork||[]),...(raw.recentWork||[])].slice(0,300).map(w=>({number:w.number||null,jobId:w.jobId||null,title:String(w.title||'').slice(0,180),status:w.status||null,employeeId:w.employeeId||null,projectId:w.projectId||null,projectName:w.projectName||null,dependencies:w.dependencies||[],parentNumber:w.parentNumber||null,nextStep:w.nextStep||null}))};}catch(err){core.reason=String(err.message||err).slice(0,110)}
res.status(200).json({ok:true,source:'GitHub API read-only + TigerIQ public read-only live-status',generatedAt:new Date().toISOString(),coverage:{issues:issues.length,complete,truncated,pagesLimit:12},issues,core})
}catch(err){res.status(503).json({ok:false,reason:String(err.message||err).slice(0,160),issues:[],core:{connected:false}})}finally{clearTimeout(timer)}
}