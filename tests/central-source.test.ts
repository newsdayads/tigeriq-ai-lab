import { describe, expect, it } from 'vitest';
import { buildCentralTask, parseCentralPriorities, parseCentralVersion, shouldAdvanceCompletedTopPriority, type GithubIssue } from '../apps/autonomous-planner/src/central-source.js';
import { parseBacklog, toControllerBody, type PlannerRuntimeState } from '../apps/autonomous-planner/src/core.js';

const central=`# CENTRAL
\`CENTRAL_VERSION=18\`
## ƯU TIÊN HIỆN HÀNH — BACKLOG THỰC TẾ ĐÃ DEDUPE
1. **#478 — [P0] Zero-touch self-update** — current.
2. **#318 — [P0] PC01 autonomy** — next.
3. **#561 — [P1] Web Registry sync** — after P0.
4. **#515 — [P2] n8n Docker migration** — later.
5. **#999 — [P3] Housekeeping** — lowest.
## CON TRỎ LỆNH
Registry #335`;
const issue:GithubIssue={number:478,title:'[P0] zero touch',body:'safe source',html_url:'https://github.com/x/y/issues/478',state:'open'};

describe('CENTRAL P0-P3 source materializer',()=>{
  it('parses current CENTRAL version, ordered priorities and levels',()=>{
    expect(parseCentralVersion(central)).toBe(18);
    const refs=parseCentralPriorities(central);
    expect(refs.map(x=>x.issueNumber)).toEqual([478,318,561,515,999]);
    expect(refs.map(x=>x.priority)).toEqual(['P0','P0','P1','P2','P3']);
  });
  it('builds deterministic zero-cost tasks with the actual priority',()=>{
    const p0=buildCentralTask(issue,18,{rank:1,issueNumber:478,description:'[P0] Zero-touch',priority:'P0'});
    const p2=buildCentralTask({...issue,number:515,title:'n8n'},18,{rank:4,issueNumber:515,description:'[P2] n8n',priority:'P2'});
    expect(p0.taskId).toBe('CENTRAL-P0-478-V18');
    expect(p0.priority).toBe('P0');
    expect(p2.taskId).toBe('CENTRAL-P2-515-V18');
    expect(p2.priority).toBe('P2');
    expect(p2.payload.logicalOwner).toBe('NV02');
    expect(p2.route).toBe('ai_auto');
    expect(p2.requiredCapabilities).toContain('ai_resource');
    expect(p2.payload.providerPolicy).toEqual({zeroCostOnly:true});
  });
  it('maps ai_auto to the canonical AI resource capability without pinning a target employee',()=>{
    const task=buildCentralTask(issue,18,{rank:1,issueNumber:478,description:'[P0] Zero-touch',priority:'P0'});
    const parsed=parseBacklog({version:1,tasks:[task]});
    const body=toControllerBody(parsed.tasks[0]);
    expect(body.requiredCapabilities).toContain('ai_resource');
    expect(body.targetEmployeeId).toBeUndefined();
    expect((body.payload as Record<string,unknown>).route).toBe('ai_auto');
  });
  it('advances past any completed CENTRAL rank, not only rank 1',()=>{
    const first=buildCentralTask(issue,18,{rank:1,issueNumber:478,description:'[P0] Zero-touch',priority:'P0'});
    const second=buildCentralTask({...issue,number:318},18,{rank:2,issueNumber:318,description:'[P0] PC01',priority:'P0'});
    const third=buildCentralTask({...issue,number:561},18,{rank:3,issueNumber:561,description:'[P1] Web',priority:'P1'});
    const state:PlannerRuntimeState={version:1,tasks:{
      [first.taskId]:{stage:'done',updatedAt:'2026-09-10T00:00:00.000Z'},
      [second.taskId]:{stage:'done',updatedAt:'2026-09-10T00:00:01.000Z'},
      [third.taskId]:{stage:'dispatched',updatedAt:'2026-09-10T00:00:02.000Z'},
    }};
    expect(shouldAdvanceCompletedTopPriority({rank:1,issueNumber:478,description:'[P0] Zero-touch',priority:'P0'},first,state)).toBe(true);
    expect(shouldAdvanceCompletedTopPriority({rank:2,issueNumber:318,description:'[P0] PC01',priority:'P0'},second,state)).toBe(true);
    expect(shouldAdvanceCompletedTopPriority({rank:3,issueNumber:561,description:'[P1] Web',priority:'P1'},third,state)).toBe(false);
  });
  it('keeps legacy untagged CENTRAL rows compatible as P0',()=>{
    const legacy=`# CENTRAL\n\`CENTRAL_VERSION=16\`\n## ƯU TIÊN HIỆN HÀNH\n1. **#478 — cơ chế tự cập nhật toàn hệ thống**: P0.\n## END`;
    expect(parseCentralPriorities(legacy)[0]?.priority).toBe('P0');
  });
});