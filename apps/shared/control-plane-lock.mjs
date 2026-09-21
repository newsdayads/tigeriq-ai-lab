const PROTECTED_PREFIXES=Object.freeze([
  'apps/tigeriq-core/',
  'apps/tigeriq-coding-lane/',
  'apps/chrome-controller/',
  'apps/worker-utility/',
  '.github/workflows/',
  'scripts/tigeriq-core/',
  'scripts/chrome-controller/',
  'scripts/worker-utility/',
  'scripts/nv02/',
]);
const PROTECTED_EXACT=Object.freeze(new Set([
  'apps/shared/control-plane-lock.mjs',
  'docs/EXECUTION_BOUNDARY.md',
]));

function normalizeRepoPath(path){
  return String(path||'').trim().replace(/^\.\//,'').replace(/\\/g,'/');
}

export function isProtectedControlPlanePath(path){
  const p=normalizeRepoPath(path);
  if(!p)return false;
  if(PROTECTED_EXACT.has(p))return true;
  return PROTECTED_PREFIXES.some(prefix=>p===prefix.slice(0,-1)||p.startsWith(prefix));
}

export function protectedControlPlanePaths(paths=[]){
  return [...new Set((Array.isArray(paths)?paths:[]).map(normalizeRepoPath).filter(Boolean).filter(isProtectedControlPlanePath))];
}

export function assertExecutionPlaneMutationPaths(paths=[]){
  const offending=protectedControlPlanePaths(paths);
  if(!offending.length)return true;
  const error=new Error(`DENY_CONTROL_PLANE_MUTATION:${offending.join(',')}`);
  error.code='DENY_CONTROL_PLANE_MUTATION';
  error.detail={
    code:'DENY_CONTROL_PLANE_MUTATION',
    offending,
    policy:'INTERACTION_V33_CONTROL_PLANE_MAINTENANCE_LOCK',
    allowedEntrypoints:['PRIVATE_CHAT','00','01'],
  };
  throw error;
}
