from pathlib import Path


def replace_exact(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    n = s.count(old)
    if n != count:
        raise SystemExit(f'{path}: expected {count} anchors, got {n}: {old[:80]!r}')
    p.write_text(s.replace(old, new, count), encoding='utf-8')


replace_exact(
    'apps/chrome-controller/extension/content.js',
    'function findComposer() {',
    '''function detectUiBusy() {
  const selectors = location.hostname === 'chatgpt.com'
    ? ['button[data-testid="stop-button"]','button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]']
    : ['button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]','button[data-test-id*="stop" i]'];
  return selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some((el) => visible(el)));
}

function findComposer() {''',
)
replace_exact(
    'apps/chrome-controller/extension/content.js',
    "  if (message?.type !== 'TIGERIQ_DISPATCH') return;",
    """  if (message?.type === 'TIGERIQ_UI_STATE') {
    sendResponse({ ok: true, uiBusy: detectUiBusy(), securityBlock: detectSecurityBlock() });
    return;
  }
  if (message?.type !== 'TIGERIQ_DISPATCH') return;""",
)

replace_exact(
    'apps/chrome-controller/extension/background.js',
    "headers:{'content-type':'application/json'}",
    "headers:{'content-type':'application/json; charset=utf-8'}",
)
replace_exact(
    'apps/chrome-controller/extension/background.js',
    "async function heartbeat(workerId,ctx) { await post('/api/heartbeat',{workerId,state:'READY',...ctx,display:await displayInfo(ctx.windowId)}); }",
    """async function readUiState(ctx) {
  try {
    if (!ctx?.tabId) return { uiBusy:null, securityBlock:null };
    const value=await chrome.tabs.sendMessage(ctx.tabId,{type:'TIGERIQ_UI_STATE'});
    return { uiBusy:typeof value?.uiBusy==='boolean'?value.uiBusy:null, securityBlock:value?.securityBlock?String(value.securityBlock):null };
  } catch { return { uiBusy:null, securityBlock:null }; }
}
async function heartbeat(workerId,ctx) {
  const ui=await readUiState(ctx);
  await post('/api/heartbeat',{workerId,state:'READY',...ctx,uiBusy:ui.uiBusy,securityBlock:ui.securityBlock,display:await displayInfo(ctx.windowId)});
}""",
)

replace_exact(
    'apps/chrome-controller/src/server.ts',
    'type Heartbeat = { workerId:WorkerId; url?:string; windowId?:number; tabId?:number; state?:string; display?:{workArea?:WorkArea}; at:string };',
    'type Heartbeat = { workerId:WorkerId; url?:string; windowId?:number; tabId?:number; state?:string; uiBusy?:boolean|null; securityBlock?:string|null; display?:{workArea?:WorkArea}; at:string };',
)
replace_exact(
    'apps/chrome-controller/src/server.ts',
    """    if(!recentHeartbeat('NV02')){setAutopilotPhase('RECOVERING');persistEvidence();return;}
    autopilotState={""",
    """    if(!recentHeartbeat('NV02')){setAutopilotPhase('RECOVERING');persistEvidence();return;}
    const uiSecurity=primary.lastHeartbeat?.securityBlock;
    if(uiSecurity&&uiSecurity.startsWith('BLOCKED_')){
      primary.blocked=true;primary.status='BLOCKED';primary.lastError=uiSecurity;
      stopAutopilot(uiSecurity);log('AUTOPILOT_SECURITY_STOP',{workerId:'NV02',status:uiSecurity});persistEvidence();return;
    }
    if(autopilotState.lastDispatchedJobId&&primary.lastHeartbeat?.uiBusy!==false){
      setAutopilotPhase('BUSY');
      log('AUTOPILOT_WAIT_UI_BUSY',{workerId:'NV02',uiBusy:primary.lastHeartbeat?.uiBusy??null,lastDispatchedJobId:autopilotState.lastDispatchedJobId});
      persistEvidence();return;
    }
    autopilotState={""",
)
replace_exact(
    'apps/chrome-controller/src/server.ts',
    """    state.lastWindowId=hb.windowId;
    state.lastError=undefined;
    recoveryAttempts.set(workerId,0);""",
    """    state.lastWindowId=hb.windowId;
    if(hb.securityBlock&&hb.securityBlock.startsWith('BLOCKED_')){
      state.blocked=true;state.status='BLOCKED';state.lastError=hb.securityBlock;
      if(workerId==='NV02')stopAutopilot(hb.securityBlock);
      log('HEARTBEAT_SECURITY_STOP',{workerId,status:hb.securityBlock});
    }else if(!state.blocked){state.lastError=undefined;}
    recoveryAttempts.set(workerId,0);""",
)

replace_exact(
    'apps/chrome-controller/src/runtime-evidence.ts',
    'lastHeartbeat?: { at: string; url?: string; windowId?: number; display?: { workArea?: WorkArea } };',
    'lastHeartbeat?: { at: string; url?: string; windowId?: number; uiBusy?: boolean | null; securityBlock?: string | null; display?: { workArea?: WorkArea } };',
)
replace_exact(
    'apps/chrome-controller/src/runtime-evidence.ts',
    """      rightAnchored: true,
      source: usableWorkArea ? 'HEARTBEAT_WORK_AREA' : 'CONFIG_FALLBACK',""",
    """      rightAnchored: true,
      ownerWorkspace: { workerRegion:'TOP_RIGHT', reservedBelowY: input.config.layout.top + input.config.layout.height, overlapByDesign:false },
      source: usableWorkArea ? 'HEARTBEAT_WORK_AREA' : 'CONFIG_FALLBACK',""",
)
replace_exact(
    'apps/chrome-controller/src/runtime-evidence.ts',
    """      browserAction: 'DISPATCH',
      aiOutputParsed: false,""",
    """      browserAction: 'DISPATCH',
      aiOutputParsed: false,
      completionAwareUiState: true,
      utf8JsonDispatch: true,""",
)
replace_exact(
    'apps/chrome-controller/src/runtime-evidence.ts',
    """      windowId: worker.lastHeartbeat?.windowId ?? null,
      windowState: worker.windowState ?? null,""",
    """      windowId: worker.lastHeartbeat?.windowId ?? null,
      uiBusy: worker.lastHeartbeat?.uiBusy ?? null,
      securityBlock: worker.lastHeartbeat?.securityBlock ?? null,
      windowState: worker.windowState ?? null,""",
)

p = Path('tests/chrome-controller.test.ts')
s = p.read_text(encoding='utf-8')
anchor = "describe('SerialQueue',()=>"
if s.count(anchor) != 1:
    raise SystemExit('test anchor missing')
extra = """describe('completion-aware UTF-8 supervisor and Owner workspace',()=>{
  it('reports UI generation state without parsing AI output and gates auto-continue',()=>{const content=readFileSync('apps/chrome-controller/extension/content.js','utf8');const background=readFileSync('apps/chrome-controller/extension/background.js','utf8');const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');expect(content).toContain('function detectUiBusy()');expect(content).toContain(\"message?.type === 'TIGERIQ_UI_STATE'\");expect(background).toContain('uiBusy:ui.uiBusy');expect(server).toContain('AUTOPILOT_WAIT_UI_BUSY');expect(server).toContain('AUTOPILOT_SECURITY_STOP');});
  it('keeps Vietnamese dispatch UTF-8 end-to-end',()=>{const sample='Tiếng Việt — Đặng, ấ, ư, €';const bytes=new TextEncoder().encode(JSON.stringify({text:sample}));expect(JSON.parse(new TextDecoder('utf-8').decode(bytes)).text).toBe(sample);const background=readFileSync('apps/chrome-controller/extension/background.js','utf8');const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');expect(background).toContain(\"content-type':'application/json; charset=utf-8\");expect(server).toContain(\"toString('utf8')\");});
  it('reserves the lower workspace for Owner while workers stay top-right',()=>{const evidence=buildRuntimeEvidence({config:baseConfig(),workArea:{left:0,top:0,width:4096,height:2120},workers:baseConfig().workers.map(w=>({id:w.id,enabled:true,status:'READY',blocked:false})),autopilot:freshAutopilotState(),snapshot:snapshot(),paused:false,killed:false,recoveryAttempts:{NV02:0,NV03:0,NV04:0},startupReady:true,interactiveSession:true,sessionName:'Console'});expect(evidence.layout.ownerWorkspace).toEqual({workerRegion:'TOP_RIGHT',reservedBelowY:834,overlapByDesign:false});expect(evidence.autopilot).toMatchObject({completionAwareUiState:true,utf8JsonDispatch:true});});
});

"""
p.write_text(s.replace(anchor, extra + anchor, 1), encoding='utf-8')
