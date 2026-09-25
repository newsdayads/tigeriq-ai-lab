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

export function normalizeWorkItemLifecycle(item = {}) {
  const meta = item?.metadata || item || {};
  return {
    issueOrPr: String(meta.issueOrPr || meta.issue_or_pr || meta.pr || meta.issue || '').trim(),
    implementer: String(meta.implementer || meta.assignee || meta.employee_id || '').trim(),
    reviewer: String(meta.reviewer || meta.review_employee_id || '').trim(),
    stage: String(meta.stage || meta.status || item.status || 'coding_lane').trim(),
    timestamps: meta.timestamps || { updated: new Date().toISOString() },
    blocker: String(meta.blocker || meta.blocked_reason || '').trim(),
    nextAction: String(meta.nextAction || meta.next_action || meta.next || '').trim()
  };
}

export function evaluateWorkRoutingPolicy({ backlog = [], workers = [], activeLeases = new Map(), retryCounts = new Map() } = {}) {
  const dispatches = [];
  const releasedLeases = [];
  const faults = [];
  const maxRetries = 3;

  for (const [jobId, lease] of activeLeases.entries()) {
    if (lease && lease.faulty || lease && lease.error === 'ROUTING_FAULT') {
      const retries = (retryCounts.get(jobId) || 0) + 1;
      retryCounts.set(jobId, retries);
      if (retries > maxRetries) {
        faults.push({ jobId, error: 'ROUTING_FAULT', status: 'permanently_failed' });
        releasedLeases.push(jobId);
        activeLeases.delete(jobId);
      } else {
        faults.push({ jobId, error: 'ROUTING_FAULT', status: 'recovered', attempt: retries });
        releasedLeases.push(jobId);
        activeLeases.delete(jobId);
      }
    }
  }

  const availableWorkers = workers.filter(w => (w.status === 'ready' || w.status === 'idle') && w.employee_id !== 'P0');
  const unassignedBacklog = backlog.filter(job => !activeLeases.has(job.id));

  for (const job of unassignedBacklog) {
    if (availableWorkers.length === 0) break;
    const capability = job.capability || 'general';
    const workerIdx = availableWorkers.findIndex(w => !w.currentJob && (!w.capabilities || w.capabilities.includes(capability)));
    if (workerIdx !== -1) {
      const worker = availableWorkers.splice(workerIdx, 1)[0];
      if (worker.employee_id === 'P0') {
        faults.push({ jobId: job.id, error: 'ROUTING_FAULT', reason: 'P0 cannot auto take work' });
        continue;
      }
      activeLeases.set(job.id, { workerId: worker.employee_id, leasedAt: Date.now() });
      dispatches.push({ jobId: job.id, workerId: worker.employee_id, capability });
    }
  }

  return { dispatches, releasedLeases, faults, activeLeases, retryCounts };
}
