import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRuntimeResources, parseRegistryBody } from '../apps/tigeriq-core/workforce-registry.mjs';

const workforceJs=readFileSync(resolve('apps/tigeriq-core/web-control-workforce.js'),'utf8');
const workforceCss=readFileSync(resolve('apps/tigeriq-core/web-control-workforce.css'),'utf8');
const server=readFileSync(resolve('apps/tigeriq-core/web-control-server.mjs'),'utf8');

describe('Web Control workforce projection',()=>{
  it('completes Registry identity into NV01 through NV20 without inventing missing employees',()=>{
    const body=`REGISTRY_ROOT_VERSION=49\n| mã | tên chuẩn | trạng thái quản trị |\n|---|---|---|\n| \`NV01\` | Minh | \`MANUAL_ONLY / READY\` |\n| \`NV02\` | ChatGPT Plus | \`AVAILABLE_MANUAL / PRIMARY_UI_EXECUTOR\` |\n| \`NV03\` | ChatGPT Go | \`AVAILABLE_MANUAL / SECOND_REVIEW\` |\n| \`NV04\` | Gemini Pro | \`AVAILABLE_MANUAL / DEEP_RESEARCH\` |\n| \`NV06\` | OpenClaw | \`PAUSED\` |\n| \`NV10\` | Ollama | \`ACTIVE_CORE_RESOURCE / ONLINE_IDLE / LOCAL_AI\` |\n| \`NV11\` | Groq | \`LIVE_PASS / CORE_RESOURCE\` |\n| \`NV20\` | NVIDIA NIM | \`WAIT_KEY / CORE_OFFLINE\` |\n\`5\`,\`7\`,\`8\` RETIRED.`;
    const parsed=parseRegistryBody(body);
    expect(parsed.version).toBe('49');
    expect(parsed.workforce).toHaveLength(20);
    expect(parsed.workforce.map(x=>x.employee_id)).toEqual(Array.from({length:20},(_,i)=>`NV${String(i+1).padStart(2,'0')}`));
    expect(parsed.workforce.find(x=>x.employee_id==='NV01')?.name).toBe('Minh');
    expect(parsed.workforce.find(x=>x.employee_id==='NV05')?.admin_state).toBe('RETIRED');
    expect(parsed.workforce.find(x=>x.employee_id==='NV09')?.admin_state).toBe('UNASSIGNED');
  });

  it('projects stale Core NV02 Ollama identity onto canonical NV10 without contaminating ChatGPT Plus',()=>{
    const workforce=[
      {employee_id:'NV02',name:'ChatGPT Plus'},
      {employee_id:'NV10',name:'Ollama'},
    ];
    const result=normalizeRuntimeResources([{employee_id:'NV02',name:'Ollama',provider:'ollama',status:'IDLE'}],workforce as any);
    expect(result).toHaveLength(1);
    expect(result[0].employee_id).toBe('NV10');
    expect(result[0].runtime_source_employee_id).toBe('NV02');
    expect(result[0].identity_migrated).toBe(true);
  });

  it('renders all workforce slots even when no runtime/API resource exists',()=>{
    expect(workforceJs).toContain('Array.from({length:20}');
    expect(workforceJs).toContain("MANUAL:'THỦ CÔNG'");
    expect(workforceJs).toContain("PAUSED:'TẠM DỪNG'");
    expect(workforceJs).toContain("NO_API:'KHÔNG CÓ API'");
    expect(workforceJs).toContain("RETIRED:'ĐÃ NGỪNG'");
    expect(workforceJs).toContain("UNASSIGNED:'CHƯA CẤP'");
    expect(workforceJs).toContain("Runtime/API: không có");
  });

  it('locks the employee strip to exactly two fixed rows with horizontal scrolling',()=>{
    expect(workforceCss).toContain('grid-template-rows:repeat(2,82px)!important');
    expect(workforceCss).toContain('grid-auto-flow:column!important');
    expect(workforceCss).toContain('overflow-x:auto!important');
    expect(workforceCss).toContain('overflow-y:hidden!important');
    expect(workforceCss).toContain('grid-template-rows:repeat(2,78px)!important');
  });

  it('keeps technical details out of the compact card body and available by hover tooltip',()=>{
    expect(workforceJs).toContain('title="${safe(techTitle(person))}"');
    expect(workforceJs).toContain('workforce-card-role');
    expect(workforceJs).not.toContain('<div class="kv"><span>Độ trễ');
  });

  it('serves workforce assets and injects canonical roster into same-origin status',()=>{
    expect(server).toContain("from './workforce-registry.mjs'");
    expect(server).toContain("url.pathname === '/web-control-workforce.js'");
    expect(server).toContain("url.pathname === '/web-control-workforce.css'");
    expect(server).toContain('workforceSnapshot()');
    expect(server).toContain('normalizeRuntimeResources(core.resources,workforce)');
    expect(server).toContain('workforceMeta');
  });
});
