export const ACTION_CLASSES = [
  'LOCAL_AI',
  'WORKSPACE_READ',
  'WORKSPACE_WRITE',
  'FEATURE_BRANCH',
  'TEST_BUILD',
  'LOCAL_CONTROL_READ',
  'LOCAL_CONTROL_WRITE',
  'SCRIPT_EXECUTION',
  'EXTERNAL_WRITE',
  'MAIN_PRODUCTION',
  'FINANCIAL',
  'SECURITY_SENSITIVE',
  'DESTRUCTIVE',
  'IRREVERSIBLE',
] as const;

export type ActionClass=(typeof ACTION_CLASSES)[number];
export type RiskLevel='GREEN'|'YELLOW'|'RED';
export type PolicyDecisionKind='AUTO_DISPATCH'|'HELD_AUTHORIZATION';

export interface AuthorizationGrant {
  grantId:string;
  taskId:string;
  actionClass:ActionClass;
  approvedBy:'OWNER';
  issuedAt:string;
  expiresAt:string;
  revoked:boolean;
  reason?:string;
}
export interface AuthorizationStore {version:1;grants:AuthorizationGrant[];}
export interface PolicySubject {
  taskId:string;
  route:'local_ai'|'tool'|'deterministic';
  payload:Record<string,unknown>;
  requiresAuthorization:boolean;
  actionClass?:ActionClass;
}
export interface PolicyDecision {
  actionClass:ActionClass|'UNCLASSIFIED';
  riskLevel:RiskLevel;
  decision:PolicyDecisionKind;
  reason:string;
  grantId?:string;
}

const risk:Record<ActionClass,RiskLevel>={
  LOCAL_AI:'GREEN',WORKSPACE_READ:'GREEN',WORKSPACE_WRITE:'GREEN',FEATURE_BRANCH:'GREEN',TEST_BUILD:'GREEN',LOCAL_CONTROL_READ:'GREEN',
  LOCAL_CONTROL_WRITE:'YELLOW',SCRIPT_EXECUTION:'YELLOW',EXTERNAL_WRITE:'YELLOW',
  MAIN_PRODUCTION:'RED',FINANCIAL:'RED',SECURITY_SENSITIVE:'RED',DESTRUCTIVE:'RED',IRREVERSIBLE:'RED',
};
const rank:Record<RiskLevel,number>={GREEN:0,YELLOW:1,RED:2};
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export function isActionClass(value:unknown):value is ActionClass{return typeof value==='string'&&(ACTION_CLASSES as readonly string[]).includes(value);}
export function actionRisk(value:ActionClass):RiskLevel{return risk[value];}

function toolClass(value:unknown):ActionClass|'UNCLASSIFIED'{
  if(!value||typeof value!=='object'||Array.isArray(value))return 'UNCLASSIFIED';
  const row=value as Record<string,unknown>,op=typeof row.operation==='string'?row.operation:'';
  if(op==='read_file')return 'WORKSPACE_READ';
  if(op==='write_file')return 'WORKSPACE_WRITE';
  if(op==='npm')return 'TEST_BUILD';
  if(op==='git')return String(row.action??'')==='checkout'?'FEATURE_BRANCH':'WORKSPACE_READ';
  if(op==='node'||op==='python')return 'SCRIPT_EXECUTION';
  if(op==='http')return String(row.method??'GET').toUpperCase()==='POST'?'LOCAL_CONTROL_WRITE':'LOCAL_CONTROL_READ';
  return 'UNCLASSIFIED';
}
function inferred(subject:PolicySubject):ActionClass|'UNCLASSIFIED'{
  if(subject.route==='local_ai')return 'LOCAL_AI';
  if(subject.route==='deterministic')return subject.payload.action==='resource_snapshot'?'WORKSPACE_READ':'UNCLASSIFIED';
  const requests=Array.isArray(subject.payload.toolRequests)?subject.payload.toolRequests:[subject.payload.toolRequest];
  let selected:ActionClass|'UNCLASSIFIED'='UNCLASSIFIED',selectedRank=-1;
  for(const request of requests){const cls=toolClass(request);if(cls==='UNCLASSIFIED')return cls;const r=rank[risk[cls]];if(r>selectedRank){selected=cls;selectedRank=r;}}
  return selected;
}

function iso(value:unknown,name:string):string{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error(`INVALID_${name.toUpperCase()}`);
  return new Date(value).toISOString();
}
export function parseAuthorizationStore(raw:unknown):AuthorizationStore{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('INVALID_AUTHORIZATION_STORE');
  const root=raw as Record<string,unknown>;if(root.version!==1||!Array.isArray(root.grants)||root.grants.length>512)throw new Error('INVALID_AUTHORIZATION_STORE_VERSION');
  const seen=new Set<string>();const grants=root.grants.map((value,index)=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`INVALID_GRANT_${index}`);const row=value as Record<string,unknown>;
    const grantId=String(row.grantId??''),taskId=String(row.taskId??'');if(!id.test(grantId)||seen.has(grantId))throw new Error('INVALID_OR_DUPLICATE_GRANT_ID');seen.add(grantId);if(!id.test(taskId))throw new Error('INVALID_GRANT_TASK_ID');
    if(!isActionClass(row.actionClass))throw new Error('INVALID_GRANT_ACTION_CLASS');if(row.approvedBy!=='OWNER')throw new Error('INVALID_GRANT_APPROVER');
    const issuedAt=iso(row.issuedAt,'grant_issued_at'),expiresAt=iso(row.expiresAt,'grant_expires_at');if(Date.parse(expiresAt)<=Date.parse(issuedAt))throw new Error('INVALID_GRANT_WINDOW');
    const reason=typeof row.reason==='string'&&row.reason.trim()?row.reason.trim().slice(0,512):undefined;
    return {grantId,taskId,actionClass:row.actionClass,approvedBy:'OWNER' as const,issuedAt,expiresAt,revoked:Boolean(row.revoked),reason};
  });return {version:1,grants};
}

export function evaluatePolicy(subject:PolicySubject,store:AuthorizationStore,now=new Date().toISOString()):PolicyDecision{
  const inferredClass=inferred(subject);if(inferredClass==='UNCLASSIFIED')return {actionClass:'UNCLASSIFIED',riskLevel:'RED',decision:'HELD_AUTHORIZATION',reason:'unclassified_fail_closed'};
  let effective=inferredClass;
  if(subject.actionClass){
    if(rank[risk[subject.actionClass]]<rank[risk[inferredClass]])throw new Error(`POLICY_DOWNGRADE_DENIED:${subject.taskId}:${inferredClass}->${subject.actionClass}`);
    effective=subject.actionClass;
  }
  let level=risk[effective];if(subject.requiresAuthorization&&level==='GREEN')level='YELLOW';
  if(level==='GREEN')return {actionClass:effective,riskLevel:level,decision:'AUTO_DISPATCH',reason:'green_auto'};
  const at=Date.parse(now);const grant=store.grants.find(item=>!item.revoked&&item.taskId===subject.taskId&&item.actionClass===effective&&Date.parse(item.issuedAt)<=at&&Date.parse(item.expiresAt)>at);
  if(grant)return {actionClass:effective,riskLevel:level,decision:'AUTO_DISPATCH',reason:'owner_grant',grantId:grant.grantId};
  return {actionClass:effective,riskLevel:level,decision:'HELD_AUTHORIZATION',reason:level==='RED'?'red_owner_authorization_required':'yellow_owner_authorization_required'};
}
