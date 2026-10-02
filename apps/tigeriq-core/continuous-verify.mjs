export const CONTINUOUS_VERIFY_RELEVANT_PREFIXES = Object.freeze([
  'apps/tigeriq-core/',
  'api/',
  'bootstrap/',
  'scripts/',
  '.github/workflows/',
]);
export const CONTINUOUS_VERIFY_RELEVANT_FILES = Object.freeze(new Set([
  'package.json',
  'package-lock.json',
  'vitest.config.ts',
  'vercel.json',
]));

export const CONTINUOUS_VERIFY_CADENCE_MS = 5 * 60 * 1000;

const text = value => String(value ?? '').trim();

export function continuousVerifyRelevantPath(path='') {
  const normalized=text(path).replaceAll('\\','/').replace(/^\.\//,'');
  if (!normalized) return false;
  if (CONTINUOUS_VERIFY_RELEVANT_FILES.has(normalized)) return true;
  if (/^tsconfig(?:\.[^/]+)?\.json$/i.test(normalized)) return true;
  return CONTINUOUS_VERIFY_RELEVANT_PREFIXES.some(prefix=>normalized.startsWith(prefix));
}

export function githubChangedPaths(payload={}) {
  const paths=new Set();
  const add=value=>{ const p=text(value).replaceAll('\\','/').replace(/^\.\//,''); if(p) paths.add(p); };
  for (const p of Array.isArray(payload?.changedPaths)?payload.changedPaths:[]) add(p);
  const commits=[
    ...(Array.isArray(payload?.commits)?payload.commits:[]),
    ...(payload?.head_commit?[payload.head_commit]:[]),
  ];
  for (const commit of commits) {
    for (const key of ['added','modified','removed']) {
      for (const p of Array.isArray(commit?.[key])?commit[key]:[]) add(p);
    }
  }
  return [...paths];
}

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
    const changedPaths=githubChangedPaths(payload);
    if(!changedPaths.length)return {trigger:false,kind:'GITHUB_CHANGE_SCOPE_UNKNOWN',changedPaths:[]};
    const relevantPaths=changedPaths.filter(continuousVerifyRelevantPath);
    if(!relevantPaths.length)return {trigger:false,kind:'GITHUB_CHANGE_UNRELATED',changedPaths};
    const sourceSha = text(pr.merge_commit_sha || pr?.head?.sha);
    return {
      trigger:true,
      kind:'GITHUB_MAIN_MERGE',
      key:`github-main:${sourceSha || text(envelope.deliveryId)}`,
      sourceSha:sourceSha || null,
      changedPaths,
      relevantPaths,
    };
  }

  if (eventName === 'push') {
    const ref = text(payload.ref);
    if (ref !== 'refs/heads/main') return { trigger:false, kind:'GITHUB_UNRELATED' };
    const changedPaths=githubChangedPaths(payload);
    if(!changedPaths.length)return {trigger:false,kind:'GITHUB_CHANGE_SCOPE_UNKNOWN',changedPaths:[]};
    const relevantPaths=changedPaths.filter(continuousVerifyRelevantPath);
    if(!relevantPaths.length)return {trigger:false,kind:'GITHUB_CHANGE_UNRELATED',changedPaths};
    const sourceSha = text(payload.after || payload?.head_commit?.id);
    return {
      trigger:true,
      kind:'GITHUB_MAIN_PUSH',
      key:`github-main:${sourceSha || text(envelope.deliveryId)}`,
      sourceSha:sourceSha || null,
      changedPaths,
      relevantPaths,
    };
  }

  return { trigger:false, kind:'GITHUB_UNRELATED' };
}

export function runtimeContinuousVerifyTrigger(previousSha = '', currentSha = '', {installedSha='', coreImpact=null} = {}) {
  const previous = text(previousSha);
  const current = text(currentSha);
  const installed = text(installedSha);
  if (!previous || !current || previous === current) {
    return { trigger:false, kind:'RUNTIME_UNCHANGED', previousSha:previous || null, currentSha:current || null };
  }
  if (!installed || installed !== current) {
    return { trigger:false, kind:'RUNTIME_INSTALL_PENDING', previousSha:previous, currentSha:current, installedSha:installed || null };
  }
  if (coreImpact !== true) {
    return { trigger:false, kind:'RUNTIME_CHANGE_UNRELATED', previousSha:previous, currentSha:current, installedSha:installed, coreImpact:coreImpact===true };
  }
  return {
    trigger:true,
    kind:'RUNTIME_SHA_CHANGE',
    key:`runtime:${current}`,
    previousSha:previous,
    currentSha:current,
    installedSha:installed,
    coreImpact:true,
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
