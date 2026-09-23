import {createHash} from 'node:crypto';

const ASSIGNMENT_HEADINGS=[
  'SINGLE ASSIGNED JOB',
  'ASSIGNED_ACTION',
  'ASSIGNED ACTION',
  'ASSIGNED JOB',
];

export function extractPcOperatorAssignment(body){
  const text=String(body||'').replace(/\r\n/g,'\n');
  for(const heading of ASSIGNMENT_HEADINGS){
    const escaped=heading.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
    const re=new RegExp(`(?:^|\\n)(?:##\\s*)?${escaped}\\s*\\n([\\s\\S]*?)(?=\\n(?:##\\s*)?(?:ACCEPTANCE|EVIDENCE|RECOVERY_RULE|STOP_CONDITIONS)\\s*\\n|$)`,'i');
    const m=text.match(re);
    if(m?.[1]?.trim())return m[1].trim();
  }
  return '';
}

export function directOpenClawGithubJobId(issueNumber){
  const n=Number(issueNumber);
  if(!Number.isInteger(n)||n<=0)throw new Error('OPENCLAW_GITHUB_ISSUE_NUMBER_INVALID');
  return `JOB-OC-GH-${n}`;
}

export function buildDirectOpenClawGithubPrompt(spec={}){
  const assignment=extractPcOperatorAssignment(spec.body);
  if(!assignment)throw new Error('OPENCLAW_GITHUB_ASSIGNMENT_MISSING');
  const issueNumber=Number(spec.number);
  return [
    'OWNER_ASSIGNED_BOUNDED_PC_OPERATOR=true',
    `SOURCE_ISSUE=#${issueNumber}`,
    'Execute only the assigned bounded action below through approved tigeriq_runtime/tigeriq_pc tools.',
    'Do not inspect or choose backlog, P0, or any new work.',
    'Do not edit repository source. Do not deploy or release to Production.',
    'Never push, merge, or commit to main or master.',
    'Do not purchase anything or use paid actions. Do not change or rotate credentials or passwords.',
    'Never reboot or shutdown. Do not delete repositories, databases, or volumes. Do not format disks or drives.',
    'Return structured terminal JSON with status, evidence, and blocker. Never claim success without tool evidence.',
    '',
    assignment,
  ].join('\n').slice(0,12000);
}

export function boundedOpenClawObjectiveState(jobs=[]){
  const rows=Array.isArray(jobs)?jobs.filter(Boolean):[];
  if(rows.length===0)return {terminal:true,status:'blocked',reason:'missing_job',summary:'bounded OpenClaw objective missing direct job'};
  if(rows.length!==1)return {terminal:true,status:'blocked',reason:'unexpected_job_count',summary:`bounded OpenClaw objective expected 1 job but found ${rows.length}`};
  const row=rows[0];
  const status=String(row.status||'').toLowerCase();
  if(['queued','dispatching','running','waiting_resource'].includes(status)){
    return {terminal:false,status:'active',reason:'job_nonterminal',summary:`bounded OpenClaw job ${row.id||''} is ${status}`};
  }
  if(status==='done'){
    return {terminal:true,status:'completed',reason:'job_done',summary:`bounded OpenClaw job ${row.id||''} completed with evidence`};
  }
  return {terminal:true,status:'blocked',reason:`job_${status||'unknown'}`,summary:`bounded OpenClaw job ${row.id||''} ended ${status||'unknown'}`};
}

export function directOpenClawEnvelopeKey(issueNumber,jobId){
  return createHash('sha256').update(`${Number(issueNumber)}:${String(jobId||'')}`).digest('hex').slice(0,24);
}
