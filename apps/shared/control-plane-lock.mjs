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

function hasExactLine(text,line){
  return String(text||'').split(/\r?\n/).some(x=>x.trim()===line);
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

export function controlPlaneRepairContext(text=''){
  const ownerProxy=hasExactLine(text,'OWNER_PROXY=NV02')?'NV02':null;
  const autonomous=hasExactLine(text,'AUTO_CONTROL_REPAIR=true');
  const independentRepair=hasExactLine(text,'INDEPENDENT_REPAIR_REQUIRED=true');
  return {
    ownerProxy,
    autonomous,
    independentRepair,
    allowProtectedControlPlane:ownerProxy==='NV02'&&autonomous&&independentRepair,
  };
}

export function assertExecutionPlaneMutationPaths(paths=[],context={}){
  const offending=protectedControlPlanePaths(paths);
  if(!offending.length)return true;
  if(context?.allowProtectedControlPlane===true&&context?.ownerProxy==='NV02'&&context?.independentRepair===true)return true;
  const error=new Error(`DENY_CONTROL_PLANE_MUTATION:${offending.join(',')}`);
  error.code='DENY_CONTROL_PLANE_MUTATION';
  error.detail={
    code:'DENY_CONTROL_PLANE_MUTATION',
    offending,
    policy:'OWNER_PROXY_AUTONOMOUS_REPAIR_WITH_RESERVED_OWNER_OVERRIDE',
    allowedEntrypoints:['NV02_OWNER_PROXY_INDEPENDENT_REPAIR','PRIVATE_CHAT','00','01'],
  };
  throw error;
}
