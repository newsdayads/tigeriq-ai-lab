import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BacklogTask, PlannerBacklog, PlannerRuntimeState } from './core.js';

export type GithubIssue={number:number;title:string;body?:string|null;html_url:string;state:string;pull_request?:unknown};
export type PriorityRef={rank:number;issueNumber:number;description:string};
type ReportState={version:1;reportedJobIds:string[]};

export interface CentralSourceConfig {
  repo:string;
  centralIssue:number;
  backlogPath:string;
  plannerStatePath:string;
  reportStatePath:string;
  githubTokenPath:string;
  ingressTokenPath:string;
  controllerUrl:string;
}

export const centralDefaults:CentralSourceConfig={
  repo:process.env.TIGERIQ_GITHUB_REPO??'newsdayads/tigeriq-ai-lab',
  centralIssue:Number(process.env.TIGERIQ_CENTRAL_ISSUE??280),
  backlogPath:process.env.TIGERIQ_AUTONOMY_BACKLOG??'D:\\TigerIQ\\Runtime\\autonomous-planner-v1\\backlog.json',
  plannerStatePath:process.env.TIGERIQ_AUTONOMY_STATE??'D:\\TigerIQ\\Runtime\\autonomous-planner-v1\\planner-state.json',
  reportStatePath:process.env.TIGERIQ_CENTRAL_REPORT_STATE??'D:\\TigerIQ\\Runtime\\autonomous-planner-v1\\central-report-state.json',
  githubTokenPath:process.env.TIGERIQ_GITHUB_TOKEN_FILE??'D:\\TigerIQ\\Secrets\\github-command-center.token',
  ingressTokenPath:process.env.TIGERIQ_INGRESS_TOKEN_FILE??'D:\\TigerIQ\\Secrets\\pc01-primary-node.ingress-token',
  controllerUrl:(process.env.TIGERIQ_CONTROLLER_URL??'http://100.97.23.87:8790').replace(/\/$/,''),
};

async function readText(file:string):Promise<string>{return (await readFile(file,'utf8')).replace(/^\uFEFF/,'').trim();}
async function readJson<T>(file:string):Promise<T>{return JSON.parse(await readText(file)) as T;}
async function writeJsonAtomic(file:string,value:unknown):Promise<void>{
  await mkdir(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  await writeFile(temp,JSON.stringify(value,null,2),'utf8');
  await copyFile(temp,file);
  await unlink(temp).catch(()=>undefined);
}
async function optionalToken(file:string):Promise<string>{try{return await readText(file);}catch{return '';}}
function githubHeaders(token:string):Record<string,string>{
  return {'accept':'application/vnd.github+json','user-agent':'TigerIQ-Central-P0/1.0',...(token?{authorization:`Bearer ${token}`}:{})};
}

export function parseCentralVersion(body:string):number{
  const match=/`CENTRAL_VERSION=(\d+)`/.exec(body);
  if(!match)throw new Error('CENTRAL_VERSION_MISSING');
  return Number(match[1]);
}
export function parseCentralPriorities(body:string):PriorityRef[]{
  const section=body.split(/##\s+ƯU TIÊN HIỆN HÀNH[^\n]*\n/i)[1]?.split(/\n##\s+/)[0]??'';
  const refs:PriorityRef[]=[];
  for(const line of section.split(/\r?\n/)){
    const match=/^\s*(\d+)\.\s+\*\*#(\d+)\s+[—-]\s+(.+?)\*\*/.exec(line);
    if(match)refs.push({rank:Number(match[1]),issueNumber:Number(match[2]),description:match[3].trim()});
  }
  return refs.sort((a,b)=>a.rank-b.rank);
}
function explicitlyHeld(issue:GithubIssue):boolean{
  const body=String(issue.body??'');
  return /(?:^|\n)\s*(?:STATE|STATUS)\s*[:=]\s*(?:OWNER_HOLD|BLOCKED)\b/im.test(body);
}
async function fetchIssue(repo:string,number:number,token:string):Promise<GithubIssue>{
  const response=await fetch(`https://api.github.com/repos/${repo}/issues/${number}`,{headers:githubHeaders(token)});
  if(!response.ok)throw new Error(`GITHUB_ISSUE_${number}_${response.status}`);
  return await response.json() as GithubIssue;
}
function sourcePrompt(issue:GithubIssue,centralVersion:number,priority:PriorityRef):string{
  const sourceBody=String(issue.body??'').slice(0,10_000);
  return `TigerIQ CENTRAL v${centralVersion} has selected current priority #${issue.number}: ${issue.title}. `+
    `Logical owner remains the authoritative employee assigned by CENTRAL/Registry; you are an AI resource, not the owner. `+
    `Analyze the source and produce the highest-value safe next executable step, respecting all holds/gates. `+
    `Do not claim edits/tests/runtime actions you did not execute. Return concise JSON with status, diagnosis, nextSafeAction, acceptanceEvidence.\n`+
    `CENTRAL priority description: ${priority.description}\nSOURCE ISSUE BODY:\n${sourceBody}`;
}
export function buildCentralTask(issue:GithubIssue,centralVersion:number,priority:PriorityRef):BacklogTask{
  return {
    taskId:`CENTRAL-P0-${issue.number}-V${centralVersion}`,
    title:`CENTRAL P0 #${issue.number}: ${issue.title}`,
    objective:`Materialize CENTRAL priority #${issue.number} into the canonical execution queue without manual chat dispatch.`,
    status:'pending',priority:'P0',route:'ai_auto',actionClass:'LOCAL_AI',
    payload:{prompt:sourcePrompt(issue,centralVersion,priority),kind:'analysis',risk:'low',sourceIssueNumber:issue.number,sourceIssueUrl:issue.html_url,centralVersion,priorityRank:priority.rank,logicalOwner:'CENTRAL_REGISTRY',providerPolicy:{zeroCostOnly:true}},
    requiredCapabilities:['ai_resource','evidence'],requiredPermissions:['local_ai:execute','evidence:write'],expectedEvidence:['json'],
    scopeKeys:[`central/p0/issue-${issue.number}/v${centralVersion}`],dependencies:[],requiresAuthorization:false,enabled:true,maxAttempts:3,
  };
}

export function shouldAdvanceCompletedTopPriority(priority:PriorityRef,task:BacklogTask,state:PlannerRuntimeState):boolean{
  return priority.rank===1&&state.tasks[task.taskId]?.stage==='done';
}
async function loadPlannerState(file:string):Promise<PlannerRuntimeState>{
  try{
    const state=await readJson<PlannerRuntimeState>(file);
    if(state?.version===1&&state.tasks&&typeof state.tasks==='object')return state;
  }catch{}
  return {version:1,tasks:{}};
}

export async function materializeCentralPriority(config:CentralSourceConfig=centralDefaults):Promise<{added:number;taskId?:string;issueNumber?:number;centralVersion:number;reason?:string}>{
  const token=await optionalToken(config.githubTokenPath);
  const central=await fetchIssue(config.repo,config.centralIssue,token);
  const centralVersion=parseCentralVersion(String(central.body??''));
  const priorities=parseCentralPriorities(String(central.body??''));
  if(!priorities.length)return {added:0,centralVersion,reason:'NO_CENTRAL_PRIORITIES'};
  const backlog=await readJson<PlannerBacklog>(config.backlogPath);
  const plannerState=await loadPlannerState(config.plannerStatePath);
  const known=new Set(backlog.tasks.map(task=>task.taskId));
  for(const priority of priorities){
    const issue=await fetchIssue(config.repo,priority.issueNumber,token);
    if(issue.pull_request||issue.state!=='open'||explicitlyHeld(issue))continue;
    const task=buildCentralTask(issue,centralVersion,priority);
    if(known.has(task.taskId)){
      if(shouldAdvanceCompletedTopPriority(priority,task,plannerState))continue;
      return {added:0,taskId:task.taskId,issueNumber:issue.number,centralVersion,reason:'ALREADY_MATERIALIZED'};
    }
    backlog.tasks.push(task);
    await writeJsonAtomic(config.backlogPath,backlog);
    return {added:1,taskId:task.taskId,issueNumber:issue.number,centralVersion};
  }
  return {added:0,centralVersion,reason:'NO_ELIGIBLE_PRIORITY'};
}

async function loadReportState(file:string):Promise<ReportState>{
  try{const state=await readJson<ReportState>(file);if(state.version===1&&Array.isArray(state.reportedJobIds))return state;}catch{}
  return {version:1,reportedJobIds:[]};
}
async function controllerJob(config:CentralSourceConfig,jobId:string,ingress:string):Promise<any>{
  const response=await fetch(`${config.controllerUrl}/api/v1/work-orders/${encodeURIComponent(jobId)}`,{headers:{authorization:`Bearer ${ingress}`}});
  if(!response.ok)throw new Error(`CONTROLLER_JOB_${response.status}`);
  return await response.json();
}
export async function reportCompletedCentralTasks(backlog:PlannerBacklog,state:PlannerRuntimeState,config:CentralSourceConfig=centralDefaults):Promise<{reported:number;jobIds:string[]}>{
  const githubToken=await optionalToken(config.githubTokenPath),ingress=await optionalToken(config.ingressTokenPath);
  if(!githubToken||!ingress)return {reported:0,jobIds:[]};
  const reportState=await loadReportState(config.reportStatePath),reported=new Set(reportState.reportedJobIds),jobIds:string[]=[];
  for(const task of backlog.tasks){
    if(!task.taskId.startsWith('CENTRAL-P0-'))continue;
    const runtime=state.tasks[task.taskId],jobId=runtime?.controllerJobId;
    if(runtime?.stage!=='done'||!jobId||reported.has(jobId))continue;
    const sourceIssue=Number(task.payload.sourceIssueNumber);if(!Number.isInteger(sourceIssue))continue;
    const snapshot=await controllerJob(config,jobId,ingress),result=snapshot?.state?.result;
    const evidence=Array.isArray(result?.evidence)?result.evidence.map((row:any)=>String(row?.ref??'')).filter(Boolean).slice(0,5):[];
    const output=result?.output??{},provider=String(output.provider??output.route??'unknown'),model=String(output.model??'unknown');
    const marker=`<!-- TIGERIQ_CENTRAL_JOB:${jobId} -->`;
    const body=`${marker}\nAUTO EVIDENCE — CENTRAL P0 materialization\n- task: \`${task.taskId}\`\n- job: \`${jobId}\`\n- state: DONE\n- AI resource: \`${provider}/${model}\`\n- evidence: ${evidence.length?evidence.map((x:string)=>`\`${x}\``).join(', '):'controller result recorded'}\n- source: CENTRAL v${String(task.payload.centralVersion??'?')}\n`;
    const response=await fetch(`https://api.github.com/repos/${config.repo}/issues/${sourceIssue}/comments`,{method:'POST',headers:{...githubHeaders(githubToken),'content-type':'application/json'},body:JSON.stringify({body})});
    if(!response.ok)throw new Error(`GITHUB_COMMENT_${sourceIssue}_${response.status}`);
    reported.add(jobId);jobIds.push(jobId);
  }
  if(jobIds.length)await writeJsonAtomic(config.reportStatePath,{version:1,reportedJobIds:[...reported]});
  return {reported:jobIds.length,jobIds};
}