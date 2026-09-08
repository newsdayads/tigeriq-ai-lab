import { readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type Issue={number:number;title:string;body?:string|null;html_url:string;pull_request?:unknown};
type Backlog={version:1;tasks:Array<Record<string,unknown>>};
type PlannerState={version:1;tasks:Record<string,{stage?:string}>};
const repo=process.env.TIGERIQ_GITHUB_REPO??'newsdayads/tigeriq-ai-lab';
const backlogPath=process.env.TIGERIQ_AUTONOMY_BACKLOG??'D:\\TigerIQ\\Runtime\\autonomous-planner-v1\\backlog.json';
const statePath=process.env.TIGERIQ_AUTONOMY_STATE??'D:\\TigerIQ\\Runtime\\autonomous-planner-v1\\planner-state.json';
const intervalMs=Math.max(30_000,Number(process.env.TIGERIQ_GITHUB_QUEUE_INTERVAL_MS??60_000));
const maxNew=Math.max(1,Math.min(5,Number(process.env.TIGERIQ_GITHUB_QUEUE_MAX_NEW??3)));
const deny=/\b(vercel|web(?:\s*control)?|deploy|production|main|security|credential|billing|payment|reboot|destructive)\b/i;
const allow=/\[NV02\]/i;
let stopped=false;

export function eligible(issue:Issue):boolean{return !issue.pull_request&&allow.test(issue.title)&&!deny.test(issue.title);}
function baseId(issue:Issue):string{return `GH-NV02-${issue.number}`;}
function taskId(issue:Issue,retry=0):string{return retry?`${baseId(issue)}-R${retry}`:baseId(issue);}
function prompt(issue:Issue,retry=0):string{
  const body=String(issue.body??'').slice(0,6_000);
  return `You are NV02/Khoa. ANALYSIS-ONLY work for GitHub issue #${issue.number}: ${issue.title}. Retry=${retry}.\nIssue body:\n${body}\n\n`+
    `Return only JSON: status, diagnosis, concreteWork, verification, nextSafeAction. `+
    `You have NO code/file/system tools in this task. concreteWork must describe only analysis performed now; NEVER claim edits, tests, deploys, commands, or system changes. `+
    `verification must be an object with sourceClaims, verifiedNow, and gaps. Put source-only facts under sourceClaims; verifiedNow MUST be empty unless this task directly verified them. nextSafeAction is a recommendation, not an executed action. OFF-MAIN, zero-cost, no sensitive actions.`;
}
async function readJson(file:string):Promise<any>{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}
async function loadBacklog():Promise<Backlog>{const raw=await readJson(backlogPath);if(raw?.version!==1||!Array.isArray(raw.tasks))throw new Error('INVALID_BACKLOG');return raw;}
async function loadState():Promise<PlannerState>{try{const raw=await readJson(statePath);if(raw?.version===1&&raw.tasks&&typeof raw.tasks==='object')return raw;}catch{}return {version:1,tasks:{}};}
async function fetchIssues():Promise<Issue[]>{
  const url=`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`;
  const response=await fetch(url,{headers:{'user-agent':'TigerIQ-NV02-Queue/1.1','accept':'application/vnd.github+json'}});
  if(!response.ok)throw new Error(`GITHUB_${response.status}`);const rows=await response.json();if(!Array.isArray(rows))throw new Error('GITHUB_INVALID_RESPONSE');return rows as Issue[];
}
function nextRetry(issue:Issue,known:Set<string>,state:PlannerState):number|null{
  if(!known.has(baseId(issue)))return 0;
  for(let retry=0;retry<3;retry++){
    const currentId=taskId(issue,retry),nextId=taskId(issue,retry+1);
    if(state.tasks[currentId]?.stage==='failed'&&!known.has(nextId))return retry+1;
  }
  return null;
}
function makeTask(issue:Issue,retry:number):Record<string,unknown>{const id=taskId(issue,retry);return {
  taskId:id,title:`NV02 GitHub #${issue.number}${retry?` retry ${retry}`:''}: ${issue.title}`,objective:`Analyze safe NV02 issue #${issue.number}`,
  status:'pending',priority:'P0',route:'groq',actionClass:'LOCAL_AI',payload:{prompt:prompt(issue,retry),sourceIssueNumber:issue.number,sourceIssueUrl:issue.html_url,retry,analysisOnly:true,requireAssurance:true,requireJudge:true},
  requiredCapabilities:['groq','evidence'],requiredPermissions:['cloud_ai:execute','evidence:write'],expectedEvidence:['json'],scopeKeys:[`github/issue/${issue.number}`],dependencies:[],requiresAuthorization:false,enabled:true,maxAttempts:3
};}
export async function syncOnce():Promise<{added:number;ids:string[]}>{
  const [backlog,state,issues]=await Promise.all([loadBacklog(),loadState(),fetchIssues()]);const known=new Set(backlog.tasks.map(t=>String(t.taskId??'')));
  const picked:Array<{issue:Issue;retry:number}>=[];
  for(const issue of issues.filter(eligible)){const retry=nextRetry(issue,known,state);if(retry===null)continue;picked.push({issue,retry});if(picked.length>=maxNew)break;}
  if(!picked.length)return {added:0,ids:[]};backlog.tasks.push(...picked.map(x=>makeTask(x.issue,x.retry)));
  const tmp=`${backlogPath}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(backlog,null,2),'utf8');await rename(tmp,backlogPath);
  return {added:picked.length,ids:picked.map(x=>taskId(x.issue,x.retry))};
}
async function main():Promise<void>{
  console.log(JSON.stringify({event:'NV02_GITHUB_QUEUE_START',repo,backlogPath,statePath,intervalMs,maxNew}));
  while(!stopped){
    try{const result=await syncOnce();if(result.added)console.log(JSON.stringify({event:'NV02_GITHUB_QUEUE_ADDED',...result}));}
    catch(error){console.error(JSON.stringify({event:'NV02_GITHUB_QUEUE_ERROR',message:error instanceof Error?error.message:String(error)}));}
    for(let elapsed=0;elapsed<intervalMs&&!stopped;elapsed+=1000)await new Promise(r=>setTimeout(r,Math.min(1000,intervalMs-elapsed)));
  }
}
process.once('SIGINT',()=>{stopped=true});process.once('SIGTERM',()=>{stopped=true});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exit(1)});
