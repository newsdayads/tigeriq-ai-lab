import { describe, expect, it } from 'vitest';
import { buildCentralTask, parseCentralPriorities, parseCentralVersion, type GithubIssue } from '../apps/autonomous-planner/src/central-source.js';
import { parseBacklog, toControllerBody } from '../apps/autonomous-planner/src/core.js';

const central=`# CENTRAL
\`CENTRAL_VERSION=16\`
## ƯU TIÊN HIỆN HÀNH — 2026-09-10
1. **#556 — Nguồn Sự Thật + tự chuyển P0 thành JOB thật**: P0 cao nhất.
2. **#478 — cơ chế tự cập nhật toàn hệ thống**: P0 kế tiếp.
## CON TRỎ LỆNH
Registry #335`;
const issue:GithubIssue={number:556,title:'[P0] auto materialization',body:'safe source',html_url:'https://github.com/x/y/issues/556',state:'open'};

describe('CENTRAL P0 source materializer',()=>{
  it('parses current CENTRAL version and ordered priorities',()=>{
    expect(parseCentralVersion(central)).toBe(16);
    expect(parseCentralPriorities(central).map(x=>x.issueNumber)).toEqual([556,478]);
  });
  it('builds one deterministic zero-cost AI-resource task',()=>{
    const task=buildCentralTask(issue,16,{rank:1,issueNumber:556,description:'current P0'});
    expect(task.taskId).toBe('CENTRAL-P0-556-V16');
    expect(task.route).toBe('ai_auto');
    expect(task.requiredCapabilities).toContain('ai_resource');
    expect(task.payload.providerPolicy).toEqual({zeroCostOnly:true});
  });
  it('maps ai_auto to the canonical AI resource capability without pinning an employee',()=>{
    const task=buildCentralTask(issue,16,{rank:1,issueNumber:556,description:'current P0'});
    const parsed=parseBacklog({version:1,tasks:[task]});
    const body=toControllerBody(parsed.tasks[0]);
    expect(body.requiredCapabilities).toContain('ai_resource');
    expect(body.targetEmployeeId).toBeUndefined();
    expect((body.payload as Record<string,unknown>).route).toBe('ai_auto');
  });
});