const TASK_ACTIONS=new Set(['task_status','task_start','task_stop','task_restart']);
const MUTATING_TASK_ACTIONS=new Set(['task_start','task_stop','task_restart']);

function bool(value){return value===true||String(value).toLowerCase()==='true';}

export function parseTypedPcOperatorAction(prompt,metadata={}){
  const text=String(prompt||'');
  const re=/\btigeriq_pc\s+action=(task_status|task_start|task_stop|task_restart)\s+taskName=(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s\r\n]+))/gi;
  const matches=[...text.matchAll(re)];
  if(matches.length!==1)return null;
  const action=String(matches[0][1]||'').toLowerCase();
  const taskName=String(matches[0][2]||matches[0][3]||matches[0][4]||'').trim();
  if(!TASK_ACTIONS.has(action)||!/^TigerIQ [A-Za-z0-9 ._()#-]{1,100}$/.test(taskName))return null;
  const mutating=MUTATING_TASK_ACTIONS.has(action);
  if(mutating&&!(bool(metadata?.ownerDirect)&&bool(metadata?.ownerControlled)))return null;
  return {action,taskName,mutating,transport:'native_typed'};
}
