import { describe,expect,it } from 'vitest';
import { parseBacklog,toControllerBody } from '../apps/autonomous-planner/src/core.js';

describe('Planner live Groq transport compatibility',()=>{
  it('preserves the already-live Groq work-order contract',()=>{
    const task=parseBacklog({version:1,tasks:[{
      taskId:'groq-live',title:'Groq',objective:'analyze',status:'pending',priority:'P0',route:'groq',
      payload:{prompt:'Return PASS'},requiredCapabilities:[],requiredPermissions:[],expectedEvidence:['json'],
      scopeKeys:['autonomy/groq'],dependencies:[],requiresAuthorization:false,enabled:true,maxAttempts:2
    }]}).tasks[0];
    const body=toControllerBody(task);
    expect(body.targetEmployeeId).toBe('NV02');
    expect(body.requiredCapabilities).toEqual(['groq','evidence']);
    expect(body.requiredPermissions).toEqual(['cloud_ai:execute','evidence:write']);
    expect(body.payload).toMatchObject({route:'groq',requireAssurance:true,requireJudge:true,prompt:'Return PASS'});
  });
});
