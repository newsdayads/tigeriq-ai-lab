import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error Canonical runtime module is JavaScript and intentionally ships without a .d.ts.
// Vitest executes the real module; this suppresses only TypeScript's declaration-file warning.
import { completionProof as sharedCompletionProof } from '../apps/shared/work-center-history.mjs';
// @ts-expect-error Bundled runtime module is JavaScript and intentionally ships without a .d.ts.
import { completionProof as bundledCompletionProof } from '../apps/tigeriq-core/web-control-completion-proof.mjs';

const web = readFileSync(resolve('apps/tigeriq-core/web-control.html'), 'utf8');
const server = readFileSync(resolve('apps/tigeriq-core/web-control-server.mjs'), 'utf8');
const healthModel = readFileSync(resolve('apps/tigeriq-core/web-control-health-model.js'), 'utf8');
const truth = readFileSync(resolve('apps/tigeriq-core/web-control-truth.js'), 'utf8');
const unified = readFileSync(resolve('apps/tigeriq-core/web-control-unified.js'), 'utf8');
const unifiedCss = readFileSync(resolve('apps/tigeriq-core/web-control-unified.css'), 'utf8');
const mobileCss = readFileSync(resolve('apps/tigeriq-core/web-control-mobile.css'), 'utf8');
const launcher = readFileSync(resolve('scripts/tigeriq-core/run-web-control.ps1'), 'utf8');
const bundleLauncher = readFileSync(resolve('scripts/tigeriq-core/run-web-control-bundle.ps1'), 'utf8');
const apiHealth = readFileSync(resolve('apps/tigeriq-core/dashboard.html'), 'utf8');
const workforceCss = readFileSync(resolve('public/work-ui.css'), 'utf8');
const visualCss = readFileSync(resolve('public/work-center-visual.css'), 'utf8');
const core = readFileSync(resolve('apps/tigeriq-core/core.mjs'), 'utf8');

describe('TigerIQ Web Control owner dashboard', () => {
  it('distinguishes NV03/NV04 live UI response from Core job, with fresh-only evidence',()=>{
    expect(apiHealth).toContain("const map={working:'UI_BUSY',idle:'READY'");
    expect(apiHealth).toContain("current_job_id:fresh?w.currentJobId||null:null");
    expect(apiHealth).toContain("live_job:fresh?w.job||null:null");
    expect(apiHealth).toContain("ui_session_state:fresh?w.uiSessionState||w.state||null:null");
    expect(apiHealth).toContain("if(rawStatus==='UI_BUSY')return'ChatGPT đang phản hồi");
    expect(apiHealth).toContain('function applyPendingQa(rows,projection)');
    expect(apiHealth).toContain("t?.claimState==='NOT_CLAIMED'");
    expect(apiHealth).toContain("1 yêu cầu QA chờ nhận".replace('1',''));
    expect(apiHealth).toContain("pending_qa_count");
    expect(apiHealth).toContain("let activeFilter='working'");
    expect(apiHealth).toContain('data-filter="ready">Rảnh</button>');
    expect(apiHealth).toContain("else if(activeFilter==='ready')list=list.filter(x=>simpleState(x).group==='ready')");
  });

  it('matches workforce filter colors to card semantics, without provider-color false signals',()=>{
    expect(apiHealth).toContain('data-filter="all">Tất cả</button>');
    expect(apiHealth).toContain('data-filter="problem">Cần kiểm tra</button>');
    expect(apiHealth).toContain('filter-divider');
    expect(visualCss).toContain('data-filter="working"]{color:#22c55e!important;');
    expect(visualCss).toContain('data-filter="ready"]{color:#3b82f6!important;');
    expect(workforceCss).toContain('NV filters match card semantics');
    expect(workforceCss).toContain('data-filter="cloud"],.api-health .workforce-panel');
  });

  it('uses muted NV cards and evidence-based V6 status colors on both surfaces', () => {
    expect(apiHealth).toContain('--tiq-working:#22C55E;--tiq-ready:#3B82F6');
    expect(apiHealth).toContain('--tiq-done:#4ADE80');
    expect(apiHealth).toContain("if(s==='MOBILE_OFFLINE')return{group:'unknown',label:'CHƯA CÓ HEARTBEAT',rank:4}");
    expect(apiHealth).toContain('function stateBadge(state){return esc(state.label)}');
    expect(visualCss).toContain('.worker.employee-card.state-ready{--state-color:#3b82f6;}');
    expect(visualCss).toContain('.worker.employee-card.state-working{--state-color:#22c55e;}');
    expect(visualCss).toContain('background:#101c2e!important;border:1px solid #344257!important;');
    expect(apiHealth).not.toContain('const STATE_ICON=');
    expect(workforceCss).toContain('/* Owner interaction V6: workforce cards are neutral;');
    expect(workforceCss).toContain('.api-health .worker.employee-card.state-ready,');
    expect(workforceCss).toContain('background:#101c2e!important;');
    expect(workforceCss).toContain('.api-health .worker.employee-card.state-working{--state-color:#22c55e;}');
    expect(workforceCss).toContain('.api-health .worker.employee-card.state-attention{--state-color:#fb7185;}');
  });

  it('shows NV102 Mobile Core presence without registering a fake generic AI resource',()=>{
    expect(core).toContain('projectMobileWorkerPresence');
    expect(core).toContain('resources:rr,mobileWorkers,workforce');
    expect(core).toContain("from tigeriq_mobile_devices where revoked=false");
    expect(apiHealth).toContain('function applyMobileWorkers(rows,mobileWorkers)');
    expect(apiHealth).toContain("d.mobileWorkers||[]");
    expect(apiHealth).toContain("status:fresh?'MOBILE_ONLINE':'MOBILE_OFFLINE'");
    expect(apiHealth).toContain("resource_class:'mobile_worker'");
    expect(apiHealth).toContain("Chờ nghiệm thu 20 tác vụ");
    expect(apiHealth).toContain("if(x.resource_class==='mobile_worker')return'MOBILE'");
    expect(apiHealth).not.toContain("NV102','ollama'");
  });

  it('categorizes PC01 NV06 OpenClaw in Local without changing its operator role', () => {
    expect(apiHealth).toContain("['ollama','openclaw'].includes(String(live?.provider||'').toLowerCase())");
    expect(apiHealth).toContain("['NV06','NV09','NV10'].includes(id)");
    expect(apiHealth).toContain("if(x.employee_id==='NV06')return'AUTO'");
    expect(truth).toContain("['ollama','openclaw'].includes(provider)");
    expect(core).toContain("provider:OPENCLAW_PROVIDER");
  });

  it('uses API Health as the visual/function reference without iframe duplication', () => {
    expect(apiHealth).toContain('<title>TigerIQ AI</title>');
    expect(core).toContain('dashboard()');
    expect(server).toContain('web-control-unified.js');
    expect(server).toContain('web-control-unified.css');
    expect(server).toContain('web-control-mobile.css');
    expect(unified).toContain('API Health is the visual/function reference');
    expect(web + unified).not.toMatch(/<iframe\b/i);
  });

  it('ports API Health live UI affordances into Web Control', () => {
    for (const label of ['NV đang làm','NV sẵn sàng','Công việc đang mở','Jobs đang chạy','Cảnh báo','Hết hạn mức','Tỷ lệ thành công','Độ trễ TB','Hiệu suất API 24 giờ','Cảnh báo hiện tại','Hoạt động gần đây','Hoạt động Core gần nhất','Đang làm','Cloud API','Có vấn đề']) expect(unified).toContain(label);
    for (const bucket of ['CẦN XỬ LÝ','CHỜ ANH SƠN','ĐANG LÀM','RÀ SOÁT','BLOCKED','HỆ THỐNG','HOÀN THÀNH']) expect(truth).toContain(bucket);
    expect(healthModel).toContain('resourceHealthTruth');
    expect(healthModel).toContain('performanceRows24h');
    expect(server).toContain('/web-control-health-model.js');
    expect(server).toContain('githubWorkOrders');
    expect(server).toContain('workOrdersMeta');
    expect(server).toContain('parseWebControlOwnerOrder');
    expect(server).toContain('sortWebControlWorkOrders');
    expect(server).toContain('ownerBacklogOrderVerified');
    expect(bundleLauncher).toContain("'owner-backlog-order.mjs'");
    expect(bundleLauncher).toContain("'web-control-*.mjs'");
    expect(truth).toContain('d?.workOrders');
    expect(truth).toContain("s === 'working' && status === 'BUSY'");
    expect(unified).toContain('__tigerIqApplyOwnerHealth');
    expect(unified).toContain("latestWebHealth?.ok!==true");
    expect(unified).toContain('PROVIDER_MARK');
    expect(unified).toContain('tq-logo');
    expect(unified).toContain('tq-spark');
    expect(unified).toContain('LIVE · 2s');
    expect(web).toContain('setInterval(refresh,2000)');
  });

  it('uses the approved Roboto Flex UI stack and monospace stack for code only', () => {
    expect(unifiedCss).toContain('--tq-font:"Roboto Flex","Segoe UI Variable Text","Segoe UI",Arial,sans-serif');
    expect(unifiedCss).toContain('font-size:14px!important;line-height:1.5!important');
    expect(unifiedCss).toContain('-webkit-font-smoothing:antialiased');
    expect(unifiedCss).toContain('-moz-osx-font-smoothing:grayscale');
    expect(unifiedCss).toContain('--tq-mono:"SFMono-Regular",Consolas,"Roboto Mono","Liberation Mono",Menlo,monospace');
    expect(unifiedCss).toContain('code,pre,.terminal-log');
    expect(unifiedCss).toContain('font-size:13px!important');
  });

  it('restores the approved global left navigation on desktop', () => {
    expect(web).toContain('<body class="layout-sidebar-v2">');
    expect(unifiedCss).toContain('#826 Layout 2');
    expect(unifiedCss).toContain('body.layout-sidebar-v2 .shell');
    expect(unifiedCss).toContain('grid-template-columns:190px minmax(0,1fr)!important');
    expect(unifiedCss).toContain('body.layout-sidebar-v2 .sidebar');
    expect(unifiedCss).toContain('flex-direction:column!important');
    expect(unifiedCss).toContain('body.layout-sidebar-v2 .nav{');
    expect(unifiedCss).toContain('display:grid!important');
    expect(unifiedCss).toContain('body.layout-sidebar-v2 .side-bottom');
    expect(mobileCss).toContain('@media(max-width:720px)');
  });

  it('uses runtime truth and keeps Coding Lane stages without fake progress', () => {
    expect(web).toContain("fetch('/api/status'");
    expect(server).toContain('codingLane');
    expect(server).toContain('TIGERIQ_CODING_LANE_URL');
    expect(truth).toContain("['Intake'");
    expect(truth).toContain("['Review'");
    expect(truth).toContain("['CI'");
    expect(unified).toContain('Work Order');
    expect(unified).toContain('Thời lượng');
    expect(truth).toContain('Không bịa %');
    expect(unified).toContain('calls_success_24h');
    expect(unified).toContain('last_latency_ms');
    expect(unified).toContain('last_error');
    expect(unified).toContain('cooldown_until');
    expect(unified).toContain('resourceHealthTruth');
    expect(healthModel).toContain('currentAlertRows');
    expect(unified).toContain("STALE_ERROR:'LỖI CŨ'");
    expect(unified).toContain('Lỗi trước đó:');
    expect(unified).toContain('Chỉ tính rate-limit hiện hành');
    expect(unified).toContain('lỗi cũ · không tính cảnh báo');
    expect(unified).toContain('Usage 24h');
    expect(unified).toContain('Quota provider chưa trả số dư');
  });

  it('keeps desktop/tablet/mobile layouts bounded', () => {
    expect(unifiedCss).toContain('@media(max-width:1450px)');
    expect(unifiedCss).toContain('@media(max-width:1050px)');
    expect(mobileCss).toContain('@media(max-width:720px)');
    expect(mobileCss).toContain('@media(max-width:460px)');
    expect(mobileCss).toContain('overflow-x:hidden');
    expect(mobileCss).toContain('.workers{grid-template-columns:1fr!important}');
    expect(mobileCss).toContain('.board-controls{width:100%!important');
  });

  it('keeps bundled Lifecycle V2 completion verification in exact parity with the shared source verifier', () => {
    const receipt='https://github.com/newsdayads/tigeriq-ai-lab/issues/5338#issuecomment-6412441362';
    const baseBody=[
      'TIGERIQ_JOB_V1','WORK_ORDER_LIFECYCLE=V2','PROJECT_ID=tigeriq-platform',
      'WORKSTREAM_ID=web-control-v2-parity','PRIORITY=P1','TIGERIQ_EXECUTABLE=true',
      'CURRENT_STATE=DONE_ACCEPTED','CURRENT_STEP=S09','NEXT_ACTION=NONE',
      'LAST_COMPLETED_STEP=S09','BLOCKER=NONE',
      'RESOURCE_SCOPE=TIGERIQ_DASHBOARD_OWNER_PRIORITY_ORDER_CROSS_LEVEL',
      'MUTATION_OWNER=GITHUB_AUTHORIZED_USER_ACTIONS_ONLY','ETA_STATUS=NOT_APPLICABLE',
      'STARTED_AT=2026-10-26T08:44:09Z','FINISHED_AT=2026-10-26T15:10:00Z',
      'START_RECEIPT_URL='+receipt,'FINISH_RECEIPT_URL='+receipt,
      'SAME_FAILURE_RETRY_COUNT=0','SAME_FAILURE_RETRY_MAX=2',
      'VERIFICATION_COUNT_CURRENT_HEAD=1','VERIFICATION_MAX_PER_HEAD=2',
      'LAST_FAILURE_SIGNATURE=NONE','RETRY_RESUME_TRIGGER=NEW_SOURCE_HEAD',
      'PROGRESS_SOURCE=STRUCTURED_PROGRESS_CHECKLIST','PROGRESS_COMPLETED=2','PROGRESS_TOTAL=2',
      'DONE=true','## ACCEPTANCE','V2 accepted.','## STOP_CONDITIONS','DONE_WITH_EVIDENCE',
      '## STRUCTURED_PROGRESS_CHECKLIST',
      '- [x] S08 — runtime ['+receipt+']('+receipt+')',
      '- [x] S09 — completion ['+receipt+']('+receipt+')'
    ].join('\n');
    const fixtures=[
      {number:5338,title:'[P1][CORE][NV02] parity',created_at:'2026-10-26T08:44:09Z',state:'closed',state_reason:'completed',body:baseBody},
      {number:5338,title:'[P1][CORE][NV02] parity',created_at:'2026-10-26T08:44:09Z',state:'open',state_reason:null,body:baseBody.replace('FINISHED_AT=2026-10-26T15:10:00Z','FINISHED_AT=NOT_FINISHED')},
      {number:5338,title:'[P1][CORE][NV02] parity',created_at:'2026-10-26T08:44:09Z',state:'closed',state_reason:'completed',body:baseBody.replace('PROGRESS_COMPLETED=2','PROGRESS_COMPLETED=1')},
      {number:5338,title:'[P1][CORE][NV02] parity',created_at:'2026-10-26T08:44:09Z',state:'closed',state_reason:'completed',body:baseBody.replace('FINISH_RECEIPT_URL='+receipt,'FINISH_RECEIPT_URL=NOT_FINISHED')},
    ];
    for(const fixture of fixtures) expect(bundledCompletionProof(fixture)).toEqual(sharedCompletionProof(fixture));
    expect(bundledCompletionProof(fixtures[0]).verified).toBe(true);
    expect(bundledCompletionProof(fixtures[1]).verified).toBe(false);
    expect(bundledCompletionProof(fixtures[2]).verified).toBe(false);
    expect(bundledCompletionProof(fixtures[3]).verified).toBe(false);
    expect(server).toContain("from './web-control-completion-proof.mjs'");
    expect(server).not.toContain("import('../shared/work-center-history.mjs')");
    expect(bundleLauncher).toContain("'work-order-lifecycle-v2.mjs'");
  });

  it('runs as the read-only Web Control service', () => {
    expect(server).toContain("TIGERIQ_WEB_CONTROL_PORT || 8796");
    expect(server).toContain("url.pathname === '/api/status'");
    expect(server).toContain("url.pathname === '/health'");
    expect(server).toContain("url.pathname === '/web-control-unified.js'");
    expect(server).toContain("url.pathname === '/web-control-unified.css'");
    expect(server).toContain("url.pathname === '/web-control-mobile.css'");
    expect(server).not.toMatch(/req\.method\s*===\s*['\"]POST['\"]/);
    expect(server).not.toMatch(/req\.method\s*===\s*['\"]DELETE['\"]/);
    expect(launcher).toContain("$env:TIGERIQ_WEB_CONTROL_PORT='8796'");
  });

  it('does not expose destructive or credential controls', () => {
    expect(web).not.toMatch(/type=["']password["']/i);
    expect(web).not.toMatch(/delete credential|reboot|shutdown/i);
    expect(web).toContain('Chỉ đọc');
  });
});
