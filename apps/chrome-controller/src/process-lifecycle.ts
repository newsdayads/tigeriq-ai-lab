import { spawn, type SpawnOptions } from 'node:child_process';

export interface DetachedProcessReceipt { pid:number|null; detached:true }

export function spawnDetachedProcess(executable:string,args:string[],options:Pick<SpawnOptions,'windowsHide'>={}):DetachedProcessReceipt{
  const child=spawn(executable,args,{detached:true,windowsHide:options.windowsHide??false,stdio:'ignore'});
  child.unref();
  return{pid:child.pid??null,detached:true};
}
