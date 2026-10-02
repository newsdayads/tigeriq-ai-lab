export const CONTINUOUS_VERIFY_CADENCE_MS = 5 * 60 * 1000;

const text = value => String(value ?? '').trim();

export function githubContinuousVerifyTrigger(envelope = {}) {
  const eventName = text(envelope.eventName).toLowerCase();
  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};

  if (eventName === 'pull_request') {
    const pr = payload.pull_request || {};
    const action = text(payload.action).toLowerCase();
    const base = text(pr?.base?.ref);
    if (action !== 'closed' || pr.merged !== true || base !== 'main') {
      return { trigger:false, kind:'GITHUB_UNRELATED' };
    }
    const sourceSha = text(pr.merge_commit_sha || pr?.head?.sha);
    return {
      trigger:true,
      kind:'GITHUB_MAIN_MERGE',
      key:`github-main:${sourceSha || text(envelope.deliveryId)}`,
      sourceSha:sourceSha || null,
    };
  }

  if (eventName === 'push') {
    const ref = text(payload.ref);
    if (ref !== 'refs/heads/main') return { trigger:false, kind:'GITHUB_UNRELATED' };
    const sourceSha = text(payload.after || payload?.head_commit?.id);
    return {
      trigger:true,
      kind:'GITHUB_MAIN_PUSH',
      key:`github-main:${sourceSha || text(envelope.deliveryId)}`,
      sourceSha:sourceSha || null,
    };
  }

  return { trigger:false, kind:'GITHUB_UNRELATED' };
}

export function runtimeContinuousVerifyTrigger(previousSha = '', currentSha = '') {
  const previous = text(previousSha);
  const current = text(currentSha);
  if (!previous || !current || previous === current) {
    return { trigger:false, kind:'RUNTIME_UNCHANGED', previousSha:previous || null, currentSha:current || null };
  }
  return {
    trigger:true,
    kind:'RUNTIME_SHA_CHANGE',
    key:`runtime:${current}`,
    previousSha:previous,
    currentSha:current,
  };
}

export function shouldQueueContinuousVerify(trigger, { pendingKey='', runningKey='', lastRunKey='' } = {}) {
  if (!trigger?.trigger) return false;
  const key = text(trigger.key);
  if (!key) return false;
  return key !== text(pendingKey) && key !== text(runningKey) && key !== text(lastRunKey);
}

export function cadenceContinuousVerifyDue({
  nowMs=Date.now(),
  lastRunMs=0,
  cadenceMs=CONTINUOUS_VERIFY_CADENCE_MS,
} = {}) {
  const interval = Math.max(60_000, Number(cadenceMs) || CONTINUOUS_VERIFY_CADENCE_MS);
  const last = Number(lastRunMs) || 0;
  return !last || Number(nowMs) - last >= interval;
}
