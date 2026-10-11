import { describe, expect, it } from 'vitest';
import {
  parseQueueIssue, sanitizeRuntimePayload, attachCoreUiAssignmentReceipts,
} from '../api/live-status.mjs';

const issue=(number,body)=>({
  number,state:'open',title:'[P1] Bounded work',body,
  html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+number,
  updated_at:'2026-10-08T10:30:00Z',
});
const flags=[
  'PRIORITY=P1','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true',
  'AUTO_QUEUE=INCLUDED','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
].join('\n');

describe('P0 Core/GitHub runtime assignment truth',()=>{
  it('excludes stale queued work when canonical first state disables execution',()=>{
    const falseExecutable=flags.replace('TIGERIQ_EXECUTABLE=true','TIGERIQ_EXECUTABLE=false')
      +'\nTIGERIQ_EXECUTABLE=true';
    expect(parseQueueIssue(issue(3904,falseExecutable))).toBe(null);
    const excluded=flags.replace('AUTO_QUEUE=INCLUDED','AUTO_QUEUE=EXCLUDED_WAIT_DEPENDENCY_REAL_GATE')
      +'\nAUTO_QUEUE=INCLUDED';
    expect(parseQueueIssue(issue(2788,excluded))).toBe(null);
    expect(parseQueueIssue(issue(4578,flags))).toMatchObject({number:4578,status:'QUEUED'});
  });

  it('accepts a valid actual Core UI assigned receipt but does not invent a running worker',()=>{
    const base=sanitizeRuntimePayload({
      ok:true,generatedAt:'2026-10-08T10:30:00Z',workers:[],
      source:{core:true,coding:true,uiAutopilot:false},
      coreUiAssignments:[
        {issueNumber:3278,jobId:'GH-3278-R10b0547ec27a',employeeId:'NV03',
          status:'ui_assigned',startedAt:null,completedAt:null},
        {issueNumber:4457,jobId:'INVALID',employeeId:'NV03',status:'ui_running'},
        {issueNumber:4565,jobId:'GH-4565-R0123456789',employeeId:'NV02',status:'ui_assigned'},
      ],
    });
    expect(base.summary.working).toBe(0);
    expect(base.coreUiAssignments).toHaveLength(1);
    expect(base.coreUiAssignments[0]).toMatchObject({
      issueNumber:3278,employeeId:'NV03',status:'ui_assigned',startedAt:null,
    });
  });

  it('keeps GitHub phase unchanged while distinguishing a real UI assignment from no receipt',()=>{
    const rows=[{number:3278,status:'REVIEW',employeeId:'NONE',activeLease:false},
                {number:4457,status:'REVIEW',employeeId:null,activeLease:false}];
    const receipts=[{issueNumber:3278,jobId:'GH-3278-R10b0547ec27a',
      employeeId:'NV03',status:'ui_assigned',startedAt:null,completedAt:null}];
    attachCoreUiAssignmentReceipts(rows,receipts);
    expect(rows[0]).toMatchObject({
      status:'REVIEW',employeeId:'NONE',activeLease:false,
      coreAssignment:{employeeId:'NV03',status:'ui_assigned',startedAt:null},
    });
    expect(rows[1].coreAssignment).toBe(null);
    expect(rows).toHaveLength(2);
  });
});
