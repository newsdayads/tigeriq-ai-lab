import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {completeRoster,parseRegistryBody} from '../apps/tigeriq-core/workforce-registry.mjs';

describe('#1600 full API Health workforce roster',()=>{
  it('keeps all canonical slots NV00 through NV20, including retired slots',()=>{
    const assignments=new Map([
      ['NV00',{employee_id:'NV00',name:'Vy (Trợ lý)',admin_state:'CHIEF_OF_STAFF / PRIMARY_UI / OWNER_INTERFACE'}],
      ['NV09',{employee_id:'NV09',name:'Qwen3-Coder Local',admin_state:'IDLE_ON_DEMAND / LOCAL_OLLAMA_11434'}],
    ]);
    const roster=completeRoster(assignments,new Set(['NV05','NV07','NV08']));
    expect(roster).toHaveLength(21);
    expect(roster[0]).toMatchObject({employee_id:'NV00',name:'Vy (Trợ lý)',assigned:true});
    expect(roster[9]).toMatchObject({employee_id:'NV09',name:'Qwen3-Coder Local',assigned:true});
    expect(roster.find(x=>x.employee_id==='NV05')).toMatchObject({retired:true,admin_state:'RETIRED'});
    expect(roster.at(-1)?.employee_id).toBe('NV20');
  });

  it('parses NV00 from Registry #335 instead of dropping it',()=>{
    const parsed=parseRegistryBody([
      'REGISTRY_ROOT_VERSION=52',
      '| mã | tên chuẩn | trạng thái quản trị |',
      '|---|---|---|',
      '| `NV00` | Vy (Trợ lý) | `CHIEF_OF_STAFF / PRIMARY_UI / OWNER_INTERFACE` |',
      '| `NV09` | Qwen3-Coder Local | `PROVISIONING / LOCAL_CODER / IDLE_ON_DEMAND_AFTER_PASS` |',
      '5,7,8 RETIRED'
    ].join('\n'));
    expect(parsed.version).toBe('52');
    expect(parsed.workforce.find(x=>x.employee_id==='NV00')?.name).toBe('Vy (Trợ lý)');
    expect(parsed.workforce.find(x=>x.employee_id==='NV09')?.name).toBe('Qwen3-Coder Local');
  });

  it('keeps NV00 in the backend roster but hides it from API Health cards and sorts operational groups deterministically',()=>{
    const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
    expect(dashboard).toContain("function visibleResource(x){return String(x?.employee_id||'').toUpperCase()!=='NV00'}");
    expect(dashboard).toContain("if(s==='BUSY')return{group:'working',label:'ĐANG LÀM',rank:0}");
    expect(dashboard).toContain("group:'ready',label:'RẢNH',rank:1");
    expect(dashboard).toContain("if(s==='ON_DEMAND')return{group:'ondemand',label:'ON-DEMAND',rank:2}");
    expect(dashboard).toContain("group:'waiting',label:'ĐANG CHỜ',rank:3");
    expect(dashboard).toContain("if(s==='UNKNOWN')return{group:'unknown',label:'CHƯA XÁC MINH',rank:4");
    expect(dashboard).toContain("['waiting','unknown','attention'].includes(simpleState(x).group)");
    expect(dashboard).toContain("Rảnh · có thể nhận việc ngay");
    expect(dashboard).toContain("Rảnh · chỉ khởi chạy khi được giao việc");
    expect(dashboard).toContain("chưa xác minh ·");
    expect(dashboard).toContain("metric('NV on-demand',onDemandNow");
    expect(dashboard).toContain("group:'attention',label:'LỖI',rank:5");
    expect(dashboard).toContain('simpleState(a).rank-simpleState(b).rank||operationalRank(a)-operationalRank(b)||nvNum(a)-nvNum(b)');
    expect(dashboard).toContain("String(job?.status||'').toLowerCase()!=='running'");
    expect(dashboard).toContain("status:'BUSY',current_job_id:job.id");
    expect(dashboard).toContain('applyCoreJobs(applyLiveWorkforce(');
    expect(dashboard).toContain('let list=allResources.filter(visibleResource)');
    expect(dashboard).toContain('name:reg.name||r.name');
    expect(dashboard).toContain('grid-template-columns:repeat(4,minmax(0,1fr))!important');
    expect(dashboard).toContain('@media(max-width:720px){.workers{grid-template-columns:repeat(2,minmax(0,1fr))!important}}');
    expect(dashboard).toContain('employee-avatar');
    expect(dashboard).toContain("NV02:'💬'");
    expect(dashboard).toContain("NV03:'🔎'");
    expect(dashboard).toContain('employee-state');
    expect(dashboard).toContain('employee-task');
    expect(dashboard).toContain('employee-card-head');
    expect(dashboard).toContain('employee-identity');
    expect(dashboard).toContain("NV02:'💬'");
    expect(dashboard).toContain("const STATE_ICON={working:'▶',ready:'✓',waiting:'◷',attention:'!',paused:'Ⅱ'}");
    expect(dashboard).toContain('color:#e0c6ff;background:#2b1d4f');
    expect(dashboard).toContain('tech-popover');
    expect(dashboard).toContain("matchMedia('(hover:hover) and (pointer:fine)').matches");
    expect(dashboard).toContain("detailModal.className='detail-modal state-'+state.group");
    expect(dashboard).toContain("if(state.group==='attention')return error||detail||job||jobId||'';");
    expect(dashboard).toContain("if(state.group==='waiting')return detail||job||jobId||'';");
    expect(dashboard).toContain("if(state.group==='paused')return detail||'';");
    expect(dashboard).toContain("if(jobId&&job&&job!==jobId)return jobId+' · '+job;");

    expect(dashboard).toContain('id="topLive"');
    expect(dashboard).toContain('id="topIssueCount"');
    expect(dashboard).not.toContain('<h1>TigerIQ API Health');
    expect(dashboard.indexOf('id="workers"')).toBeLessThan(dashboard.indexOf('id="metrics"'));
    expect(dashboard).toContain('detail-backdrop');
    expect(dashboard).toContain('openEmployeeDetail');
    expect(dashboard).toContain('workers.addEventListener(\'click\'');
    expect(dashboard).not.toContain('title="${esc(techTitle(x))}"');
    expect(dashboard).toContain('white-space:normal;overflow:visible;text-overflow:clip');
    expect(dashboard).toContain("${activity?`<div class=\"employee-task\">${esc(activity)}</div>`:''}");
    expect(dashboard).toContain('detailJob.hidden=!activity');
    expect(dashboard).not.toContain("return'Sẵn sàng nhận việc'");
    expect(dashboard).not.toContain("return'Đang chờ'");
    expect(dashboard).not.toContain("return'Cần hệ thống xử lý lỗi'");
    expect(dashboard).toContain('syshealth.addEventListener(\'click\'');

    expect(dashboard).not.toContain("workers.style.setProperty('--worker-cols'");
    expect(dashboard).toContain("blocker=String(x.blocker||x.waitReason||'').trim()");
    expect(dashboard).toContain('Blocker:</b> ${esc(blocker)}');
  });

  it('exposes workforce in Core status and renders full roster filters in API Health',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    const dashboard=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
    expect(core).toContain("refreshRegistryWorkforce, normalizeRuntimeResources");
    expect(core).toContain("const {workforce,workforceMeta}=await refreshRegistryWorkforce()");
    expect(core).toContain("resources:rr,workforce,workforceMeta");
    expect(dashboard).toContain('NV00→NV20 theo Registry #335');
    expect(dashboard).toContain("function mergeWorkforce(workforce,resources)");
    expect(dashboard).toContain("data-filter=\"manual\">UI/Manual");
    expect(dashboard).toContain("id==='NV09'?'ollama'");
    expect(dashboard).toContain("qwen3-coder:30b");
    expect(dashboard).toContain("RETIRED:'ĐÃ NGỪNG'");
    expect(dashboard).toContain("function shortRole(x)");
    expect(dashboard).toContain("Gateway ONLINE");
    expect(dashboard).toContain("WORKER TẠM DỪNG");
    expect(dashboard).toContain("Registry #335");
    expect(dashboard).toContain("if(!x.live_resource)");
    expect(dashboard).not.toContain("Registry: ${esc(x.admin_state)}");
  });
});
