import crypto from 'node:crypto';

const persistedChildWork = new Map();
const activeChildOwners = new Map();

export function hashIdempotencyKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

export function handleTerminalCampaign(parentCampaign, aiResult = {}) {
  const parentId = parentCampaign?.id || parentCampaign?.objectiveId || 'OBJ-DEFAULT';
  const isMutation = Boolean(aiResult?.isMutation || aiResult?.sourceMutated || aiResult?.mutation);
  
  const title = String(aiResult?.title || parentCampaign?.title || 'Next Step Handoff').slice(0, 200);
  const objective = String(aiResult?.objective || parentCampaign?.objective || title).slice(0, 1000);
  const prompt = isMutation
    ? `Durable coding handoff entry for mutation: ${String(aiResult?.prompt || objective).slice(0, 4000)}`
    : String(aiResult?.prompt || objective).slice(0, 4000);
  
  const acceptance = String(aiResult?.acceptance || 'Verify handoff completion securely').slice(0, 1500);
  const capability = String(aiResult?.capability || 'standard').slice(0, 100);
  const resourceKey = String(aiResult?.resourceKey || parentId).slice(0, 200);
  
  const rawIdempotencyKey = `${parentId}:${title}:${resourceKey}`;
  const idempotencyKey = hashIdempotencyKey(rawIdempotencyKey);
  
  if (persistedChildWork.has(idempotencyKey)) {
    return persistedChildWork.get(idempotencyKey);
  }
  
  const childId = `CHILD-${crypto.randomUUID()}`;
  const authorityClass = isMutation ? 'durable-handoff-only' : String(aiResult?.authorityClass || 'standard');
  
  const childWork = {
    id: childId,
    parentId,
    objective,
    kind: isMutation ? 'durable-coding-handoff' : 'autonomous-task',
    title,
    prompt,
    acceptance,
    capability,
    scopeResourceKey: resourceKey,
    idempotencyKey,
    authorityClass,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  persistedChildWork.set(idempotencyKey, childWork);
  activeChildOwners.set(resourceKey, childId);
  
  return childWork;
}

export function loadPendingChildWork() {
  const results = [];
  for (const work of persistedChildWork.values()) {
    if (work.status === 'pending') {
      results.push(work);
    }
  }
  return results;
}

export function resumePendingChildWork() {
  const pending = loadPendingChildWork();
  const resumed = [];
  for (const work of pending) {
    const resourceKey = work.scopeResourceKey;
    if (activeChildOwners.get(resourceKey) === work.id) {
      resumed.push(work);
    } else if (!activeChildOwners.has(resourceKey)) {
      activeChildOwners.set(resourceKey, work.id);
      resumed.push(work);
    }
  }
  return resumed;
}

export function getCampaignRelationships(campaignId, childWorks = []) {
  const childIds = childWorks.filter(w => w.parentId === campaignId).map(w => w.id);
  return {
    parentId: campaignId,
    childIds
  };
}
