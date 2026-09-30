import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App Chrome Master Contract 3 UI V1',()=>{
  const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
  const continuity=readFileSync('apps/chrome-controller/extension/continuity.js','utf8');
  const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
  const doc=readFileSync('docs/app-chrome/APP_CHROME_MASTER_CONTRACT_3UI_V1.md','utf8');

  it('locks the exact 21-command content pool and immutable worker prefixes',()=>{
    const poolStart=bridge.indexOf('const NV02_CONTINUE_PROMPTS=Object.freeze([');
    const poolEnd=bridge.indexOf(']);',poolStart);
    const pool=bridge.slice(poolStart,poolEnd);
    const commands=[
      'Tiếp tục','Làm tiếp','Tiếp đi','Xử lý tiếp','Thực hiện tiếp',
      'Tiếp tục công việc hiện tại','Làm tiếp công việc hiện tại','Tiếp tục việc đang làm',
      'Làm tiếp phần đang dở','Tiếp tục từ chỗ hiện tại','Tiếp tục đúng việc này',
      'Xử lý tiếp việc hiện tại','Thực hiện tiếp việc đang làm','Tiếp tục phần còn dở',
      'Tiếp tục từ trạng thái hiện tại','Tiếp tục xử lý việc đang dở',
      'Tiếp tục công việc đang dang dở','Thực thi tiếp việc hiện tại',
      'Làm tiếp nhiệm vụ đang thực hiện','Tiếp tục đúng việc đang được giao','Làm tiếp, không đổi việc'
    ];
    expect(poolStart).toBeGreaterThan(-1);
    for(const command of commands)expect(pool).toContain(`'${command}'`);
    expect((pool.match(/^\s*'.+',?$/gm)||[])).toHaveLength(21);
    expect(bridge).toContain('return `02 - ${base}`;');
    expect(continuity).toContain("return code?code+' - '+base:base");
    expect(bridge).not.toContain('NV02_ROTATION_INSTRUCTION');
    expect(bridge).not.toContain('NV02_SELF_PULL_WAKE_PROMPT');
  });

  it('never auto-rotates a healthy/idle/terminal chat by count, age, or boot',()=>{
    const loop=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    for(const forbidden of ['SAFETY_CONTEXT_LIMIT','JOB_TERMINAL_DURABLE_CHECKPOINT',"rotateNv02ToFreshChat(target,state,'READY_NO_ELIGIBLE_WORK'","rotateNv02ToFreshChat(target,state,'BOOT_FRESH_CHAT'"]){
      expect(loop).not.toContain(forbidden);
    }
    expect(bridge).not.toContain('NV02_MAX_DISPATCHES_PER_CHAT');
    expect(bridge).not.toContain('NV02_MAX_CHAT_AGE_MS');
    expect(loop).toContain('BOOT_CONTEXT_PRESERVED_OR_RECOVERED');
  });

  it('archives only by explicit command or after bounded genuine chat-load recovery',()=>{
    expect(bridge).toContain("if(action==='ARCHIVE_CHAT')");
    const recovery=bridge.slice(bridge.indexOf('async function maybeRecoverChatLoadError'),bridge.indexOf('const MODEL_SELECTOR_POINT_EXPR'));
    expect(recovery).toContain('CHAT_LOAD_RETRY_EXHAUSTED');
    expect(recovery).toContain('CHAT_LOAD_F5_EXHAUSTED');
    expect(recovery).toContain('CHAT_LOAD_DURABLE_CHECKPOINT');
    expect(recovery).toContain("rotateNv02ToFreshChat(target,checkpoint,'CHAT_LOAD_ERROR'");
    expect(bridge).toContain('ARCHIVE_NOT_CONFIRMED_LEFT_CURRENT_CONVERSATION');
  });

  it('defers F5/reset while WORKING and preserves valid chat on idle reset',()=>{
    const nv02=bridge.slice(bridge.indexOf('async function maybeNv02Continuity'),bridge.indexOf('async function handleCommand'));
    expect(nv02).toContain("if(phase==='WORKING'&&now>=Number(state.nextPeriodicF5At||0))");
    expect(nv02).toContain('PERIODIC_F5_DEFERRED_WORKING');
    const reset=bridge.slice(bridge.indexOf('async function reopenNv02PeriodicWorker'),bridge.indexOf('async function maybeNv02Continuity'));
    expect(reset).toContain("if(phase==='WORKING')return{ok:false,status:'NV02_PERIODIC_REOPEN_DEFERRED_WORKING'}");
    expect(reset).toContain("const resumeUrl=isRestorableNv02Chat(prepared.url)?String(prepared.url):NV02_HOME_URL");
    const prep=bridge.slice(bridge.indexOf('async function prepareWorkerForPlannedRestart'),bridge.indexOf('function archiveMenuPointExpr'));
    expect(prep).not.toContain('archiveChat(target)');
  });

  it('keeps NV03/NV04 lifecycle alive while Core assignment gates prompt dispatch only',()=>{
    const generic=bridge.slice(bridge.indexOf('async function maybeWorkerContinuity'),bridge.indexOf('\nfunction log('));
    expect(generic).toContain('const activeAssignment=activeLocalAssignment(controller,w.id)');
    expect(generic).toContain("'NO_ACTIVE_ASSIGNMENT_IDLE'");
    expect(generic).toContain("if(phase==='WORKING'&&Number(state.nextPeriodicF5At||0)<=now)");
    expect(generic).toContain("if(phase==='READY'){");
    expect(generic).toContain('if(!activeAssignment){');
    expect(generic).toContain("reopenWorker(w,target,state,now,'PERIODIC_2_4H_RESET',activeAssignment&&isAssignedWorkerChat(w,prepared?.url)?prepared.url:'')");
    expect(generic).not.toContain('PERIODIC_RESET_DEFERRED_ACTIVE_ASSIGNMENT');
  });

  it('keeps routing authority split: NV02 external, NV03/NV04 Core-routed',()=>{
    expect(server).toContain("const CORE_UI_TRANSPORT_WORKERS:WorkerId[]=['NV03','NV04']");
    expect(server).not.toContain("CORE_UI_TRANSPORT_WORKERS:WorkerId[]=['NV02'");
    expect(server).toContain('const coreUiTransportEnabled=true');
    expect(server).toContain('const externalWorkAutopilotEnabled=false');
    expect(doc).toContain('NV02 itself self-pulls eligible P1-P5');
    expect(doc).toContain('Core-routed only; no self-pull');
  });

  it('requires NV02 visible model verification and keeps generic model preservation',()=>{
    expect(bridge).toContain("modelName:'GPT-5.6 Sol'");
    expect(bridge).toContain("reasoningEffort:'High'");
    expect(bridge).toContain('ensureNv02ModelProfile');
    expect(bridge).toContain("if(w.id!=='NV02'&&state.modelCheckAttempted!==true)");
    expect(bridge).toContain('BOOT_MODEL_PROFILE_PRESERVED');
  });
});
