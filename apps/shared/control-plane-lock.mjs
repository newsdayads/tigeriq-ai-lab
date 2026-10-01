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
const APP_CHROME_LOCAL_ONLY_PREFIXES=Object.freeze([
  'apps/chrome-controller/',
  'scripts/chrome-controller/',
]);
const APP_CHROME_LOCAL_ONLY_EXACT=Object.freeze(new Set([
  'scripts/tigeriq-core/appchrome-zero-touch.ps1',
]));

function normalizeRepoPath(path){
  return String(path||'').trim().replace(/^\.\//,'').replace(/\\/g,'/');
}
export function isAppChromeLocalOnlyPath(path){
  const p=normalizeRepoPath(path);
  if(!p)return false;
  if(APP_CHROME_LOCAL_ONLY_EXACT.has(p))return true;
  return APP_CHROME_LOCAL_ONLY_PREFIXES.some(prefix=>p===prefix.slice(0,-1)||p.startsWith(prefix));
}
function hasExactLine(text,line){
  return String(text||'').split(/\r?\n/).some(value=>value.trim()===line);
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

export function controlPlaneRepairIntent(text=''){
  const ownerProxy=hasExactLine(text,'OWNER_PROXY=NV02')?'NV02':null;
  const autoControlRepair=hasExactLine(text,'AUTO_CONTROL_REPAIR=true');
  const independentRepair=hasExactLine(text,'INDEPENDENT_REPAIR_REQUIRED=true');
  return {
    ownerProxy,
    autoControlRepair,
    independentRepair,
    delegated:Boolean(ownerProxy==='NV02'&&autoControlRepair&&independentRepair),
  };
}

export function assertExecutionPlaneMutationPaths(paths=[],context={}){
  const localOnly=(Array.isArray(paths)?paths:[]).map(normalizeRepoPath).filter(Boolean).filter(isAppChromeLocalOnlyPath);
  if(localOnly.length){
    const error=new Error(`APP_CHROME_EXTERNAL_LOCAL_ONLY:${localOnly.join(',')}`);
    error.code='APP_CHROME_EXTERNAL_LOCAL_ONLY';
    error.detail={
      code:'APP_CHROME_EXTERNAL_LOCAL_ONLY',
      offending:[...new Set(localOnly)],
      policy:'APP_CHROME_LOCAL_ONLY_V1',
      allowedEntrypoints:['OWNER_TO_VY_DIRECT_LOCAL_PC01'],
    };
    throw error;
  }
  const offending=protectedControlPlanePaths(paths);
  if(!offending.length)return true;
  const delegated=Boolean(
    context?.delegated===true&&
    context?.ownerProxy==='NV02'&&
    context?.independentRepair===true&&
    String(context?.executorClass||'').startsWith('CODING_LANE')
  );
  if(delegated)return true;
  const error=new Error(`DENY_CONTROL_PLANE_MUTATION:${offending.join(',')}`);
  error.code='DENY_CONTROL_PLANE_MUTATION';
  error.detail={
    code:'DENY_CONTROL_PLANE_MUTATION',
    offending,
    policy:'OWNER_PROXY_INDEPENDENT_REPAIR_V34',
    allowedEntrypoints:['NV02_OWNER_PROXY_TO_INDEPENDENT_CODING_LANE','PRIVATE_CHAT','00','01'],
  };
  throw error;
}
