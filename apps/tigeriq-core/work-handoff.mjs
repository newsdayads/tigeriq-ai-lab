import { createHash } from 'node:crypto';

const CAPABILITIES=new Set(['general','reasoning','review']);
const CODING_PREFIX=/^\s*\[(?:CODING|SOURCE_MUTATION|SOURCE)\]\s*/i;

function hash(value){return createHash('sha256').update(String(value||'')).digest('hex');}
function clip(value,max){return String(value||'').trim().slice(0,max);}
function taggedLine(prompt,label){
  const match=String(prompt||'').match(new RegExp('^\\s*'+label+'\\s*:\\s*(.+)$','im'));
  return match?clip(match[1],2000):'';
}
function scopeFallback(title){
  return clip(title,160).toLowerCase().replace(/[^a-z0-9._/-]+/g,'-').replace(/^-+|-+$/g,'')||'general';
}

export function normalizeTerminalWorkItems(parentObjectiveId,jobs=[]){
  const parentId=clip(parentObjectiveId,200);
  if(!parentId)throw new Error('HANDOFF_PARENT_REQUIRED');
  const seenScopes=new Set();
  const out=[];
  for(const raw of Array.isArray(jobs)?jobs.slice(0,3):[]){
    if(!raw||!raw.title||!raw.prompt)continue;
    const originalTitle=clip(raw.title,200);
    const coding=CODING_PREFIX.test(originalTitle);
    const title=clip(originalTitle.replace(CODING_PREFIX,''),200)||'Next work';
    const prompt=clip(raw.prompt,12000);
    const capability=CAPABILITIES.has(raw.capability)?raw.capability:'general';
    const kind=coding?'source_mutation':(capability==='review'?'review':capability==='reasoning'?'research':'general');
    const acceptance=taggedLine(prompt,'ACCEPTANCE')||'Produce concrete evidence that this work is complete.';
    const scopeResourceKey=taggedLine(prompt,'SCOPE')||scopeFallback(title);
    if(seenScopes.has(scopeResourceKey))continue;
    seenScopes.add(scopeResourceKey);
    const idempotencyKey=hash([parentId,kind,scopeResourceKey,title,prompt].join('\n'));
    out.push({
      parentObjectiveId:parentId,
      kind,title,prompt,acceptance,capability,scopeResourceKey,
      idempotencyKey,
      authorityClass:coding?'coding_handoff_only':'api_auto',
      childObjectiveId:coding?null:`OBJ-CHILD-${idempotencyKey.slice(0,24)}`,
    });
  }
  return out;
}

export function handoffGenerationKey(items=[]){
  return hash((Array.isArray(items)?items:[]).map(x=>x.idempotencyKey).filter(Boolean).sort().join('|'));
}

export function evaluateChildObjectiveStates(expectedChildIds=[],rows=[]){
  const ids=[...new Set((Array.isArray(expectedChildIds)?expectedChildIds:[]).map(String).filter(Boolean))];
  const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row.id),row]));
  if(!ids.length)return {state:'completed',pending:[],blocked:[],completed:[],results:[]};
  const pending=[],blocked=[],completed=[],results=[];
  for(const id of ids){
    const row=byId.get(id);
    if(!row){pending.push(id);continue;}
    if(row.status==='blocked'){blocked.push(id);continue;}
    if(row.status==='completed'){
      completed.push(id);
      results.push({id,status:'completed',summary:clip(row.summary,1000)});
      continue;
    }
    pending.push(id);
  }
  return {
    state:blocked.length?'blocked':pending.length?'waiting':'completed',
    pending,blocked,completed,results,
  };
}

export function isCodingHandoff(item){return item?.kind==='source_mutation'||item?.kind==='coding';}

export function normalizeCoreWorkItemV1({ objective = null, jobs = [], events = [] } = {}) {
  const obj = objective || {};
  const objId = clip(obj.id || obj.objective_id, 200) || 'OBJ-UNKNOWN';
  const rawStatus = String(obj.status || 'pending').toLowerCase();
  const metadata = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {};
  const handoff = metadata.handoff || {};

  const jobList = Array.isArray(jobs) ? jobs : [];
  const eventList = Array.isArray(events) ? events : [];

  const issueRef = clip(obj.issue_ref || metadata.issueRef || metadata.sourceRef || '', 200) || null;
  const sourceRef = issueRef || clip(obj.source_ref || '', 200) || null;
  const kind = clip(obj.kind || metadata.kind || 'general', 50);
  const assignedExecutor = clip(obj.assigned_executor || obj.employee_id || '', 100) || null;
  const priority = Number.isInteger(obj.priority) ? obj.priority : (Number.isInteger(metadata.priority) ? metadata.priority : 0);

  const scopeLease = {
    resourceKey: clip(obj.scope_resource_key || metadata.scopeResourceKey || metadata.scope || '', 100) || null,
    leaseUntil: obj.lease_until || metadata.leaseUntil || null,
    authorityClass: clip(metadata.authorityClass || (isCodingHandoff({kind}) ? 'coding_handoff_only' : 'api_auto'), 50)
  };

  const blockers = [];
  if (rawStatus === 'blocked') {
    blockers.push({
      reason: clip(obj.summary || obj.failure || 'Objective is blocked', 500),
      at: obj.updated_at || obj.created_at || new Date().toISOString()
    });
  }
  for (const j of jobList) {
    if (j.status === 'failed') {
      let failMsg = 'Job failed';
      try {
        const parsed = typeof j.failure === 'string' ? JSON.parse(j.failure) : j.failure;
        failMsg = parsed?.message || JSON.stringify(parsed);
      } catch {
        failMsg = String(j.failure || 'Job failed');
      }
      blockers.push({
        reason: clip(`Job ${j.id} failed: ${failMsg}`, 500),
        at: j.completed_at || j.updated_at || new Date().toISOString()
      });
    }
  }

  const evidenceRefs = [];
  for (const j of jobList) {
    if (j.status === 'done') {
      evidenceRefs.push({
        type: 'job_result',
        id: clip(j.id, 100),
        summary: clip(j.summary || (j.result ? (typeof j.result === 'string' ? j.result : JSON.stringify(j.result)) : 'Job completed successfully'), 1000),
        completedAt: j.completed_at || j.updated_at || null
      });
    }
  }
  for (const ev of eventList) {
    if (ev.type && (ev.type.includes('EVIDENCE') || ev.type.includes('DONE') || ev.type.includes('SUCCESS'))) {
      evidenceRefs.push({
        type: 'event',
        id: clip(ev.id || ev.type, 100),
        summary: clip(ev.summary || JSON.stringify(ev.payload || {}), 1000),
        completedAt: ev.created_at || null
      });
    }
  }

  let stage = 'QUEUED';
  if (rawStatus === 'completed' || rawStatus === 'done') {
    stage = 'DONE';
  } else if (blockers.length > 0 || rawStatus === 'blocked') {
    stage = 'BLOCKED';
  } else {
    const hasDoneJobs = jobList.some(j => j.status === 'done');
    const hasRunningJobs = jobList.some(j => j.status === 'running' || j.status === 'claimed');
    const hasEvidence = evidenceRefs.length > 0;

    if (hasEvidence || (handoff.state && handoff.state !== '')) {
      stage = 'EVIDENCE';
    } else if (hasRunningJobs) {
      stage = 'WORKING';
    } else if (assignedExecutor) {
      stage = 'CLAIMED';
    } else if (rawStatus === 'in_progress' || jobList.length > 0) {
      stage = 'WORKING';
    } else {
      stage = 'QUEUED';
    }
  }

  let nextAction = clip(obj.summary || obj.prompt || '', 500);
  if (stage === 'DONE') {
    nextAction = 'WorkItem is fully completed.';
  } else if (stage === 'BLOCKED') {
    nextAction = blockers[0]?.reason || 'Resolve blocking condition.';
  } else if (stage === 'WORKING') {
    nextAction = 'Monitor active execution jobs.';
  } else if (stage === 'CLAIMED') {
    nextAction = 'Initialize execution for claimed WorkItem.';
  } else if (stage === 'EVIDENCE') {
    nextAction = 'Review accumulated evidence and verify completion.';
  } else {
    nextAction = 'Awaiting queue dispatch.';
  }

  return {
    workItemId: objId,
    sourceRef,
    issueRef,
    kind,
    assignedExecutor,
    stage,
    priority,
    scopeLease,
    blockers,
    evidenceRefs,
    nextAction
  };
}
