const WORKERS=Object.freeze(['NV02','NV03','NV04']);

function bindings(){
  return Object.fromEntries(WORKERS.map(workerId=>[workerId,{workerId,state:'EXTERNAL_TO_CORE',currentWorkOrder:null}]));
}

export function selectCoreUiWorker(_capability='general'){
  return null;
}

export function parseCoreUiIssue(_issue){
  return null;
}

export function buildCoreUiPrompt(){
  throw new Error('CORE_UI_ASSIGNMENT_DISABLED');
}

export function readyUnassignedCoreUiSnapshot({
  observedAt=new Date().toISOString(),
  revision='core-ui-disabled-v1',
  previousJob,
  reason='UI_WORKERS_EXTERNAL_TO_CORE',
}={}){
  return {
    source:'CORE',
    authority:'NONE',
    observedAt,
    revision,
    assignmentState:'EXTERNAL_TO_CORE',
    previousJob,
    nextJob:undefined,
    nextJobs:[],
    requiredWorkers:[],
    workerBindings:bindings(),
    reason,
  };
}

export async function buildCoreUiAssignmentSnapshot({previousJobId}={}){
  return readyUnassignedCoreUiSnapshot({
    revision:'core-ui-disabled-v1:'+(previousJobId||'none'),
    reason:'NV02_NV03_NV04_NOT_CORE_ROUTED',
  });
}
