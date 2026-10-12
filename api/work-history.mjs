/* GitHub read-only per-work-order history, no authentication secrets leave server. */
import {buildWorkHistory,recentCommentPages,latestComments} from '../apps/shared/work-center-history.mjs';
const BASE='https://api.github.com/repos/newsdayads/tigeriq-ai-lab';
const CACHE=new Map();
async function gh(path){
 const token=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim();
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),4500);
 try{
  const r=await fetch(BASE+path,{cache:'no-store',headers:{'accept':'application/vnd.github+json','user-agent':'TigerIQ-Work-Center-ReadOnly',...(token?{authorization:'Bearer '+token}:{})},signal:ctrl.signal});
  if(!r.ok)throw Error('GITHUB_HTTP_'+r.status);return await r.json();
 }finally{clearTimeout(timer)}
}
export default async function handler(req,res){
 res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
 if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({ok:false,error:'METHOD_NOT_ALLOWED'}))}
 const n=String(req.query?.number||'');
 if(!/^[1-9]\d{0,7}$/.test(n)){res.statusCode=400;return res.end(JSON.stringify({ok:false,error:'INVALID_NUMBER'}))}
 const number=Number(n),old=CACHE.get(number),now=Date.now();
 if(old&&now-old.at<60000){res.statusCode=200;return res.end(JSON.stringify(old.value))}
 try{
  const issue=await gh('/issues/'+number);
  const pages=recentCommentPages(issue.comments);
  const recent=await Promise.all(pages.map(p=>gh('/issues/'+number+'/comments?per_page=100&page='+p)));
  const comments=latestComments(recent);
  if(issue.pull_request)throw Error('NOT_WORK_ORDER');
  const value=buildWorkHistory(issue,comments);
  if(CACHE.size>100)CACHE.clear();CACHE.set(number,{at:now,value});
  res.statusCode=200;return res.end(JSON.stringify(value));
 }catch(error){res.statusCode=503;return res.end(JSON.stringify({ok:false,error:'WORK_HISTORY_UNAVAILABLE'}))}
}
