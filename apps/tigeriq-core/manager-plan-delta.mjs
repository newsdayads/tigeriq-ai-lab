const PLAN_SCHEMA='TIGERIQ_PLAN_DELTA_V1';
const PLAN_STATES=new Set(['continue','complete','blocked']);
const TASK_ACTIONS=new Set(['create','update','cancel']);
const CAPABILITIES=new Set(['general','reasoning','research','review','coding','pc_operator']);
const PRIORITIES=new Set(['P1','P2','P3','P4','P5']);
const EFFORT_CLASSES=new Set(['XS','S','M','L']);
const TOP_KEYS=new Set(['schema','objectiveId','sourceRevision','assessment','tasks','criticalPath','parallelGroups','replanTriggers']);
const ASSESSMENT_KEYS=new Set(['state','summary','blocker']);
const TASK_KEYS=new Set(['id','title','action','capability','priority','resourceScope','dependencies','acceptance','evidenceRequired','concurrencyGroup','estimatedEffortClass','preferredSkills','effects','implementerResourceId','reviewerResourceId']);
const EFFECT_KEYS=new Set(['repoMutation','productionRelease','paidCost','credentialChange','securityBoundaryChange','destructive']);
const GROUP_KEYS=new Set(['id','tasks']);

function fail(code,detail=''){
  const error=new Error(detail?code+':'+detail:code);
  error.code=code;
  throw error;
}
function plainObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function exactKeys(value,allowed,code){
  for(const key of Object.keys(value||{}))if(!allowed.has(key))fail(code,key);
}
function stringValue(value,code,{max=500,pattern=null}={}){
  if(typeof value!=='string'||!value.trim()||value.length>max)fail(code);
  const out=value.trim();
  if(pattern&&!pattern.test(out))fail(code);
  return out;
}
function stringArray(value,code,{maxItems=20,maxLength=300}={}){
  if(!Array.isArray(value)||value.length>maxItems)fail(code);
  const out=value.map(item=>stringValue(item,code,{max:maxLength}));
  if(new Set(out).size!==out.length)fail(code+ '_DUPLICATE');
  return out;
}
function boolEffects(value){
  if(!plainObject(value))fail('PLAN_EFFECTS_INVALID');
  exactKeys(value,EFFECT_KEYS,'PLAN_EFFECTS_UNKNOWN_KEY');
  const out={};
  for(const key of EFFECT_KEYS){
    if(typeof value[key]!=='boolean')fail('PLAN_EFFECTS_INVALID',key);
    out[key]=value[key];
  }
  return out;
}
function assertAcyclic(tasks){
  const byId=new Map(tasks.map(task=>[task.id,task]));
  const visiting=new Set(),visited=new Set();
  const visit=(id)=>{
    if(visited.has(id))return;
    if(visiting.has(id))fail('PLAN_DAG_CYCLE',id);
    visiting.add(id);
    for(const dep of byId.get(id)?.dependencies||[])visit(dep);
    visiting.delete(id);visited.add(id);
  };
  for(const task of tasks)visit(task.id);
}
function topoTasks(tasks){
  const byId=new Map(tasks.map(task=>[task.id,task]));
  const visited=new Set(),out=[];
  const visit=(id)=>{
    if(visited.has(id))return;
    for(const dep of byId.get(id)?.dependencies||[])visit(dep);
    visited.add(id);out.push(byId.get(id));
  };
  for(const task of tasks)visit(task.id);
  return out;
}

export function validatePlanDelta(raw,{expectedObjectiveId='',expectedSourceRevision=''}={}){
  if(!plainObject(raw))fail('PLAN_DELTA_INVALID');
  exactKeys(raw,TOP_KEYS,'PLAN_DELTA_UNKNOWN_KEY');
  if(raw.schema!==PLAN_SCHEMA)fail('PLAN_SCHEMA_INVALID');
  const objectiveId=stringValue(raw.objectiveId,'PLAN_OBJECTIVE_ID_INVALID',{max:180,pattern:/^[A-Za-z0-9._:#-]+$/});
  const sourceRevision=stringValue(raw.sourceRevision,'PLAN_SOURCE_REVISION_INVALID',{max:160,pattern:/^[A-Za-z0-9._:-]+$/});
  if(expectedObjectiveId&&objectiveId!==String(expectedObjectiveId))fail('PLAN_OBJECTIVE_MISMATCH');
  if(expectedSourceRevision&&sourceRevision!==String(expectedSourceRevision))fail('PLAN_STALE_SOURCE_REVISION');

  if(!plainObject(raw.assessment))fail('PLAN_ASSESSMENT_INVALID');
  exactKeys(raw.assessment,ASSESSMENT_KEYS,'PLAN_ASSESSMENT_UNKNOWN_KEY');
  const state=String(raw.assessment.state||'');
  if(!PLAN_STATES.has(state))fail('PLAN_ASSESSMENT_STATE_INVALID');
  const assessment={state,summary:stringValue(raw.assessment.summary,'PLAN_ASSESSMENT_SUMMARY_INVALID',{max:1000})};
  if(raw.assessment.blocker!==undefined)assessment.blocker=stringValue(raw.assessment.blocker,'PLAN_ASSESSMENT_BLOCKER_INVALID',{max:500});

  if(!Array.isArray(raw.tasks)||raw.tasks.length>20)fail('PLAN_TASKS_INVALID');
  if(state==='continue'&&raw.tasks.length===0)fail('PLAN_TASKS_REQUIRED');
  if(state!=='continue'&&raw.tasks.length!==0)fail('PLAN_TERMINAL_TASKS_FORBIDDEN');
  const tasks=raw.tasks.map((task,index)=>{
    if(!plainObject(task))fail('PLAN_TASK_INVALID',String(index));
    exactKeys(task,TASK_KEYS,'PLAN_TASK_UNKNOWN_KEY');
    const id=stringValue(task.id,'PLAN_TASK_ID_INVALID',{max:100,pattern:/^[A-Za-z0-9._:-]+$/});
    const action=String(task.action||'');
    const capability=String(task.capability||'');
    const priority=String(task.priority||'').toUpperCase();
    if(!TASK_ACTIONS.has(action))fail('PLAN_TASK_ACTION_INVALID',id);
    if(!CAPABILITIES.has(capability))fail('PLAN_TASK_CAPABILITY_INVALID',id);
    if(!PRIORITIES.has(priority))fail('PLAN_TASK_PRIORITY_INVALID',id);
    const estimatedEffortClass=String(task.estimatedEffortClass||'').toUpperCase();
    if(!EFFORT_CLASSES.has(estimatedEffortClass))fail('PLAN_TASK_EFFORT_INVALID',id);
    return {
      id,
      title:stringValue(task.title,'PLAN_TASK_TITLE_INVALID',{max:240}),
      action,
      capability,
      priority,
      resourceScope:stringValue(task.resourceScope,'PLAN_TASK_SCOPE_INVALID',{max:200,pattern:/^[A-Za-z0-9._:/-]+$/}),
      dependencies:stringArray(task.dependencies,'PLAN_TASK_DEPENDENCIES_INVALID',{maxItems:20,maxLength:100}),
      acceptance:stringArray(task.acceptance,'PLAN_TASK_ACCEPTANCE_INVALID',{maxItems:12,maxLength:500}),
      evidenceRequired:stringArray(task.evidenceRequired,'PLAN_TASK_EVIDENCE_INVALID',{maxItems:12,maxLength:300}),
      concurrencyGroup:task.concurrencyGroup==null?null:stringValue(task.concurrencyGroup,'PLAN_TASK_CONCURRENCY_GROUP_INVALID',{max:100,pattern:/^[A-Za-z0-9._:-]+$/}),
      estimatedEffortClass,
      preferredSkills:stringArray(task.preferredSkills,'PLAN_TASK_SKILLS_INVALID',{maxItems:12,maxLength:120}),
      effects:boolEffects(task.effects),
      implementerResourceId:task.implementerResourceId==null?null:stringValue(task.implementerResourceId,'PLAN_IMPLEMENTER_RESOURCE_INVALID',{max:180}),
      reviewerResourceId:task.reviewerResourceId==null?null:stringValue(task.reviewerResourceId,'PLAN_REVIEWER_RESOURCE_INVALID',{max:180}),
    };
  });
  const ids=tasks.map(task=>task.id);
  if(new Set(ids).size!==ids.length)fail('PLAN_TASK_ID_DUPLICATE');
  const idSet=new Set(ids);
  for(const task of tasks){
    for(const dep of task.dependencies)if(!idSet.has(dep))fail('PLAN_DEPENDENCY_UNKNOWN',task.id+':'+dep);
    if(task.dependencies.includes(task.id))fail('PLAN_SELF_DEPENDENCY',task.id);
  }
  assertAcyclic(tasks);

  const criticalPath=stringArray(raw.criticalPath,'PLAN_CRITICAL_PATH_INVALID',{maxItems:20,maxLength:100});
  for(const id of criticalPath)if(!idSet.has(id))fail('PLAN_CRITICAL_PATH_UNKNOWN',id);

  if(!Array.isArray(raw.parallelGroups)||raw.parallelGroups.length>12)fail('PLAN_PARALLEL_GROUPS_INVALID');
  const groupIds=new Set(),groupMembership=new Set();
  const parallelGroups=raw.parallelGroups.map(group=>{
    if(!plainObject(group))fail('PLAN_PARALLEL_GROUP_INVALID');
    exactKeys(group,GROUP_KEYS,'PLAN_PARALLEL_GROUP_UNKNOWN_KEY');
    const id=stringValue(group.id,'PLAN_PARALLEL_GROUP_ID_INVALID',{max:100,pattern:/^[A-Za-z0-9._:-]+$/});
    if(groupIds.has(id))fail('PLAN_PARALLEL_GROUP_ID_DUPLICATE',id);groupIds.add(id);
    const groupTasks=stringArray(group.tasks,'PLAN_PARALLEL_GROUP_TASKS_INVALID',{maxItems:20,maxLength:100});
    for(const taskId of groupTasks){
      if(!idSet.has(taskId))fail('PLAN_PARALLEL_GROUP_TASK_UNKNOWN',taskId);
      if(groupMembership.has(taskId))fail('PLAN_PARALLEL_GROUP_TASK_DUPLICATE',taskId);
      groupMembership.add(taskId);
    }
    return {id,tasks:groupTasks};
  });

  const replanTriggers=stringArray(raw.replanTriggers,'PLAN_REPLAN_TRIGGERS_INVALID',{maxItems:16,maxLength:300});
  return {schema:PLAN_SCHEMA,objectiveId,sourceRevision,assessment,tasks,criticalPath,parallelGroups,replanTriggers};
}

export function governPlanDelta(raw,{
  expectedObjectiveId='',
  expectedSourceRevision='',
  maxTasks=8,
  activeResourceScopes=[],
  reviewerResourceIds=[],
}={}){
  let plan;
  try{plan=validatePlanDelta(raw,{expectedObjectiveId,expectedSourceRevision});}
  catch(error){return {decision:'reject',reason:error.code||'PLAN_INVALID',detail:String(error.message||error)};}

  const forbiddenEffectKeys=['productionRelease','paidCost','credentialChange','securityBoundaryChange','destructive'];
  for(const task of plan.tasks){
    for(const key of forbiddenEffectKeys)if(task.effects[key]===true)return {decision:'reject',reason:'UNSAFE_PLAN_EFFECT',taskId:task.id,effect:key};
    if(task.implementerResourceId&&task.reviewerResourceId&&task.implementerResourceId===task.reviewerResourceId){
      return {decision:'reject',reason:'REVIEWER_CONFLICT',taskId:task.id};
    }
  }
  const reviewerExclusions=new Set((Array.isArray(reviewerResourceIds)?reviewerResourceIds:[]).map(String));
  for(const task of plan.tasks){
    if(task.capability==='review'&&task.reviewerResourceId&&reviewerExclusions.has(task.reviewerResourceId)){
      return {decision:'reject',reason:'REVIEWER_CONFLICT',taskId:task.id};
    }
  }
  const activeScopes=new Set((Array.isArray(activeResourceScopes)?activeResourceScopes:[]).map(String));
  for(const task of plan.tasks){
    if(task.effects.repoMutation&&activeScopes.has(task.resourceScope))return {decision:'reject',reason:'RESOURCE_SCOPE_BUSY',taskId:task.id,resourceScope:task.resourceScope};
  }

  const bounded=Math.max(1,Math.min(20,Number(maxTasks)||8));
  if(plan.tasks.length<=bounded)return {decision:'accept',reason:'PLAN_SAFE',plan,trimmedTaskIds:[]};
  const ordered=topoTasks(plan.tasks);
  const selected=ordered.slice(0,bounded);
  const selectedIds=new Set(selected.map(task=>task.id));
  const trimmedTaskIds=ordered.filter(task=>!selectedIds.has(task.id)).map(task=>task.id);
  const adjusted={
    ...plan,
    tasks:selected,
    criticalPath:plan.criticalPath.filter(id=>selectedIds.has(id)),
    parallelGroups:plan.parallelGroups.map(group=>({...group,tasks:group.tasks.filter(id=>selectedIds.has(id))})).filter(group=>group.tasks.length),
  };
  return {decision:'trim',reason:'PLAN_TASK_LIMIT',plan:adjusted,trimmedTaskIds};
}

export const PLAN_DELTA_SCHEMA=PLAN_SCHEMA;
