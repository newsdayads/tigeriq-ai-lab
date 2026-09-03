import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { buildLiveWebControlSnapshot,type LiveWebControlPaths } from '../apps/web-control/src/live-source.js';

async function json(file:string,value:unknown){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2),'utf8');}

describe('Web Control live PC01 source',()=>{
  it('projects goals, planner tasks, registries and runtime-loop freshness from source files',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-web-live-'));
    try{
      const paths:LiveWebControlPaths={
        continuousState:path.join(root,'continuous','state.json'),
        plannerBacklog:path.join(root,'planner','backlog.json'),
        plannerState:path.join(root,'planner','state.json'),
        missionState:path.join(root,'mission','state.json'),
        providers:path.join(root,'config','providers.json'),
        models:path.join(root,'config','models.json'),
        employees:path.join(root,'config','employees.json'),
        snapshot:path.join(root,'web','snapshot.json')
      };
      const now=new Date('2026-09-04T03:00:00.000Z');
      await json(paths.continuousState,{version:1,goals:{'G-1':{stage:'running',updatedAt:now.toISOString(),missionId:'mission-1'}},paused:false,lastCycleAt:now.toISOString()});
      await json(paths.plannerBacklog,{version:1,tasks:[{taskId:'mission-1-analysis',title:'Analyze',objective:'Analyze mission',status:'pending',priority:'P0',route:'local_ai',payload:{prompt:'analyze'},requiredCapabilities:['reasoning'],requiredPermissions:[],expectedEvidence:['json'],scopeKeys:['mission/1'],dependencies:[],requiresAuthorization:false,actionClass:'LOCAL_AI',enabled:true,maxAttempts:2}]});
      await json(paths.plannerState,{version:1,tasks:{'mission-1-analysis':{stage:'dispatched',controllerJobId:'job-1',updatedAt:now.toISOString()}},lastCycleAt:now.toISOString()});
      await json(paths.missionState,{version:1,missions:{'mission-1':{stage:'running',updatedAt:now.toISOString(),childTaskIds:['mission-1-analysis'],model:'qwen3:8b'}},lastCycleAt:now.toISOString()});
      await json(paths.providers,{version:1,providers:[{providerId:'ollama',kind:'local',enabled:true,healthy:true,costClass:'free',maxConcurrency:2,latencyMs:20}]});
      await json(paths.models,{version:1,models:[{modelId:'qwen3:8b',providerId:'ollama',enabled:true,capabilities:['reasoning','review'],quality:80,speed:70,contextTokens:32768,costWeight:0}]});
      await json(paths.employees,{version:1,employees:[{employeeId:'NV01',role:'coder',enabled:true,requiredCapabilities:['reasoning'],preferredModels:['qwen3:8b']}]});

      const snapshot=await buildLiveWebControlSnapshot(paths,now,60_000);
      expect(snapshot.goals.running).toBe(1);
      expect(snapshot.goalRows[0]).toMatchObject({goalId:'G-1',stage:'running',missionId:'mission-1'});
      expect(snapshot.tasks.running).toBe(1);
      expect(snapshot.taskRows[0]).toMatchObject({taskId:'mission-1-analysis',goalId:'G-1',stage:'running',priority:'P0'});
      expect(snapshot.providers).toEqual([expect.objectContaining({providerId:'ollama',enabled:true,healthy:true})]);
      expect(snapshot.employees).toEqual([{employeeId:'NV01',role:'coder',enabled:true}]);
      expect(snapshot.workers.busy).toBe(3);
      expect(snapshot.workerRows.find(row=>row.workerId==='runtime.autonomous-planner')).toMatchObject({status:'busy',currentTaskId:'mission-1-analysis'});
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
