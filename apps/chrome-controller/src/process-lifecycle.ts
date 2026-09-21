import { spawn, type SpawnOptions } from 'node:child_process';

export interface DetachedProcessReceipt { pid:number|null; detached:true }

export function spawnDetachedProcess(executable:string,args:string[],options:Pick<SpawnOptions,'windowsHide'>={}):DetachedProcessReceipt{
  const child=spawn(executable,args,{detached:true,windowsHide:options.windowsHide??false,stdio:'ignore'});
  child.unref();
  return{pid:child.pid??null,detached:true};
}

export function boundedRestartProcess(executable:string, args:string[], currentRestarts:number, maxRestarts:number=3): { success: boolean; restarts: number; receipt?: DetachedProcessReceipt; rolledBack?: boolean } {
  if (currentRestarts >= maxRestarts) {
    return { success: false, restarts: currentRestarts, rolledBack: true };
  }
  const receipt = spawnDetachedProcess(executable, args);
  return { success: true, restarts: currentRestarts + 1, receipt, rolledBack: false };
}
