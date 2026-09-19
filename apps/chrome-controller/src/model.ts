import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const WORKER_IDS = ['NV02', 'NV03', 'NV04'] as const;
export type WorkerId = (typeof WORKER_IDS)[number];

export const CANONICAL_MODEL_PROFILE = {
  modelName: 'GPT-5.6 Sol',
  reasoningEffort: 'High',
} as const;

export interface ModelProfileVerificationResult {
  verified: boolean;
  profile?: { modelName: string; reasoningEffort: string };
  timestamp?: string;
  reason?: string;
}

export interface WorkerConfig { id:WorkerId; role:string; homeUrl:string; profileDirectory:string; enabled?:boolean; userDataDir?:string; debugPort?:number }
export interface LayoutConfig { width:number; height:number; gap:number; rightMargin:number; top:number; fallbackWorkAreaWidth:number; fallbackWorkAreaLeft:number }
export interface PacingConfig { betweenWorkerLaunchMs:number; postReadySettlingMs:number; minUiActionGapMs:number; commandTimeoutMs:number; workerReadyTimeoutMs:number; maxRetries:number; retryBackoffMs:number }
export interface AutopilotConfig { enabled:boolean; pollIntervalMs:number; stateUrl?:string; requestTimeoutMs:number; maxSnapshotAgeMs:number; dispatchLeaseTtlMs?:number }
export interface RecoveryConfig { heartbeatStaleMs:number; checkIntervalMs:number; maxReopenAttempts:number; reopenBackoffMs:number; startupReadyUrl?:string; startupReadyTimeoutMs:number; startupAttachGraceMs:number; launchBrokerUrl?:string; launchBrokerTimeoutMs?:number }
export interface ControllerConfig { host:'127.0.0.1'; port:number; chromePath:string; userDataDir?:string; logDir:string; trustedRuntimeHosts:string[]; layout:LayoutConfig; pacing:PacingConfig; autopilot:AutopilotConfig; recovery:RecoveryConfig; workers:WorkerConfig[] }
export interface WorkArea { left:number; top:number; width:number; height:number }
export interface WindowPlacement { left:number; top:number; width:number; height:number }

const ALLOWED_HOSTS=new Set(['chatgpt.com','gemini.google.com']);
const DEFAULT_AUTOPILOT:AutopilotConfig={enabled:true,pollIntervalMs:15000,requestTimeoutMs:5000,maxSnapshotAgeMs:300000,dispatchLeaseTtlMs:300000};
const DEFAULT_RECOVERY:RecoveryConfig={heartbeatStaleMs:90000,checkIntervalMs:15000,maxReopenAttempts:2,reopenBackoffMs:15000,startupReadyUrl:'http://127.0.0.1:8795/health',startupReadyTimeoutMs:120000,startupAttachGraceMs:20000,launchBrokerUrl:'http://127.0.0.1:8800',launchBrokerTimeoutMs:5000};

export function isAllowedWorkerUrl(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&ALLOWED_HOSTS.has(u.hostname)}catch{return false}}
export function isWorkerEnabled(worker:Pick<WorkerConfig,'enabled'>):boolean{return worker.enabled!==false}
export function expandEnv(value:string):string{return value.replace(/%([^%]+)%/g,(_m,n:string)=>process.env[n]??`%${n}%`)}
export function isLoopbackHost(hostname:string):boolean{return hostname==='127.0.0.1'||hostname==='localhost'||hostname==='::1'}
export function isTrustedRuntimeUrl(value:string|undefined,trustedRuntimeHosts:string[]=[]):boolean{
  if(!value)return true;
  try{
    const u=new URL(value);
    if(u.protocol!=='http:')return false;
    return isLoopbackHost(u.hostname)||trustedRuntimeHosts.includes(u.hostname);
  }catch{return false}
}
export function isInteractiveDesktopSession(
  platform=process.platform,
  sessionName=process.env.SESSIONNAME,
  windowsSessionId=process.env.TIGERIQ_WINDOWS_SESSION_ID,
):boolean{
  if(platform!=='win32')return true;
  const value=String(sessionName??'').trim().toLowerCase();
  if(value==='services')return false;
  if(value)return true;
  const sessionId=Number(windowsSessionId);
  return Number.isInteger(sessionId)&&sessionId>0;
}
export function reconcileWorkerUiStatus(status:string,uiBusy:boolean|null|undefined):string{
  if(uiBusy===true&&['READY','ONLINE','SUBMITTED','DISPATCHING','WORKING'].includes(status))return 'WORKING';
  if(uiBusy===false&&['SUBMITTED','DISPATCHING','WORKING','ONLINE'].includes(status))return 'READY';
  return status;
}
export function minimumLayoutWidth(config:Pick<ControllerConfig,'layout'|'workers'>):number{return config.workers.length*config.layout.width+(config.workers.length-1)*config.layout.gap+config.layout.rightMargin}
export function workAreaFitsLayout(config:Pick<ControllerConfig,'layout'|'workers'>,area:WorkArea):boolean{return area.width>=minimumLayoutWidth(config)&&area.height>=config.layout.top+config.layout.height}

export function validateConfig(raw:unknown):ControllerConfig{
  if(!raw||typeof raw!=='object')throw new Error('CONFIG_INVALID_OBJECT');
  const source=raw as Partial<ControllerConfig>;
  const trustedRuntimeHosts=Array.isArray(source.trustedRuntimeHosts)?source.trustedRuntimeHosts.map(String):[];
  if(trustedRuntimeHosts.some(host=>!host.trim()||/[/:\\\s]/.test(host)))throw new Error('CONFIG_TRUSTED_RUNTIME_HOST_INVALID');
  const config={...source,trustedRuntimeHosts,autopilot:{...DEFAULT_AUTOPILOT,...(source.autopilot??{})},recovery:{...DEFAULT_RECOVERY,...(source.recovery??{})}} as ControllerConfig;
  if(config.host!=='127.0.0.1')throw new Error('CONFIG_HOST_MUST_BE_LOOPBACK');
  if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw new Error('CONFIG_INVALID_PORT');
  if(!config.chromePath)throw new Error('CONFIG_CHROME_PATH_REQUIRED');
  if(!config.logDir)throw new Error('CONFIG_LOG_DIR_REQUIRED');
  if(!Array.isArray(config.workers)||config.workers.length!==3)throw new Error('CONFIG_REQUIRES_3_WORKERS');
  const ids=config.workers.map(w=>w.id);if(ids.join('|')!==WORKER_IDS.join('|'))throw new Error('CONFIG_WORKER_ORDER_MUST_BE_NV02_NV03_NV04');
  const targets=new Set<string>();
  const debugPorts=new Set<number>();
  for(const worker of config.workers){
    if(worker.enabled!==undefined&&typeof worker.enabled!=='boolean')throw new Error(`CONFIG_ENABLED_MUST_BE_BOOLEAN:${worker.id}`);
    if(!isAllowedWorkerUrl(worker.homeUrl))throw new Error(`CONFIG_HOME_URL_NOT_ALLOWED:${worker.id}`);
    if(!worker.role.trim())throw new Error(`CONFIG_ROLE_REQUIRED:${worker.id}`);
    if(worker.debugPort!==undefined){if(!Number.isInteger(worker.debugPort)||worker.debugPort<1024||worker.debugPort>65535)throw new Error(`CONFIG_DEBUG_PORT_INVALID:${worker.id}`);if(debugPorts.has(worker.debugPort))throw new Error(`CONFIG_DEBUG_PORT_COLLISION:${worker.id}`);debugPorts.add(worker.debugPort);}
    const host=new URL(worker.homeUrl).hostname;const userData=worker.userDataDir??config.userDataDir??'';const target=`${userData}|${worker.profileDirectory}|${host}`.toLowerCase();
    if(targets.has(target))throw new Error(`CONFIG_PROFILE_HOST_COLLISION:${worker.id}`);targets.add(target);
  }
  const{layout,pacing,autopilot,recovery}=config;
  if(!layout||layout.width<320||layout.height<480||layout.gap<0||layout.rightMargin<0)throw new Error('CONFIG_INVALID_LAYOUT');
  const fallbackArea:WorkArea={left:layout.fallbackWorkAreaLeft,top:0,width:layout.fallbackWorkAreaWidth,height:layout.top+layout.height};
  if(!workAreaFitsLayout(config,fallbackArea))throw new Error('CONFIG_FALLBACK_WORK_AREA_TOO_SMALL');
  if(!pacing)throw new Error('CONFIG_PACING_REQUIRED');
  if(pacing.betweenWorkerLaunchMs<5000)throw new Error('CONFIG_STARTUP_GAP_MIN_5000MS');
  if(pacing.postReadySettlingMs<3000)throw new Error('CONFIG_SETTLE_MIN_3000MS');
  if(pacing.minUiActionGapMs<1500)throw new Error('CONFIG_UI_GAP_MIN_1500MS');
  if(pacing.commandTimeoutMs<10000||pacing.workerReadyTimeoutMs<30000)throw new Error('CONFIG_TIMEOUT_TOO_SMALL');
  if(!Number.isInteger(pacing.maxRetries)||pacing.maxRetries<0||pacing.maxRetries>2)throw new Error('CONFIG_MAX_RETRIES_0_TO_2');
  if(pacing.retryBackoffMs<3000)throw new Error('CONFIG_RETRY_BACKOFF_MIN_3000MS');
  if(typeof autopilot.enabled!=='boolean')throw new Error('CONFIG_AUTOPILOT_ENABLED_MUST_BE_BOOLEAN');
  if(autopilot.pollIntervalMs<5000||autopilot.requestTimeoutMs<1000||autopilot.requestTimeoutMs>30000||autopilot.maxSnapshotAgeMs<60000||(autopilot.dispatchLeaseTtlMs??300000)<Math.max(60000,pacing.commandTimeoutMs+30000))throw new Error('CONFIG_AUTOPILOT_PACING_INVALID');
  if(!isTrustedRuntimeUrl(autopilot.stateUrl,trustedRuntimeHosts))throw new Error('CONFIG_AUTOPILOT_STATE_URL_NOT_TRUSTED');
  if(recovery.heartbeatStaleMs<30000||recovery.checkIntervalMs<5000||recovery.reopenBackoffMs<5000||recovery.startupAttachGraceMs<5000)throw new Error('CONFIG_RECOVERY_PACING_INVALID');
  if(!Number.isInteger(recovery.maxReopenAttempts)||recovery.maxReopenAttempts<0||recovery.maxReopenAttempts>3)throw new Error('CONFIG_RECOVERY_ATTEMPTS_0_TO_3');
  if(recovery.startupReadyTimeoutMs<30000||recovery.startupReadyTimeoutMs>300000)throw new Error('CONFIG_RECOVERY_STARTUP_TIMEOUT_INVALID');
  if(!isTrustedRuntimeUrl(recovery.startupReadyUrl,trustedRuntimeHosts))throw new Error('CONFIG_RECOVERY_READY_URL_NOT_TRUSTED');
  if((recovery.launchBrokerTimeoutMs??5000)<1000||(recovery.launchBrokerTimeoutMs??5000)>30000)throw new Error('CONFIG_LAUNCH_BROKER_TIMEOUT_INVALID');
  if(recovery.launchBrokerUrl){try{const u=new URL(recovery.launchBrokerUrl);if(u.protocol!=='http:'||!isLoopbackHost(u.hostname))throw new Error();}catch{throw new Error('CONFIG_LAUNCH_BROKER_URL_MUST_BE_LOOPBACK');}}
  return{...config,chromePath:expandEnv(config.chromePath),userDataDir:config.userDataDir?expandEnv(config.userDataDir):undefined,logDir:expandEnv(config.logDir),workers:config.workers.map(w=>({...w,enabled:isWorkerEnabled(w),userDataDir:w.userDataDir?expandEnv(w.userDataDir):undefined}))};
}
export function loadConfig(configPath?:string):ControllerConfig{
  const p=resolve(configPath??process.env.TIGERIQ_CHROME_CONFIG??'apps/chrome-controller/chrome-controller.config.json');
  const text=readFileSync(p,'utf8').replace(/^\uFEFF/,'');
  return validateConfig(JSON.parse(text) as unknown);
}
export function computePlacements(config:ControllerConfig,workArea?:WorkArea):Record<WorkerId,WindowPlacement>{const fallback:WorkArea={left:config.layout.fallbackWorkAreaLeft,top:0,width:config.layout.fallbackWorkAreaWidth,height:config.layout.top+config.layout.height};const area=workArea&&workAreaFitsLayout(config,workArea)?workArea:fallback;if(!workAreaFitsLayout(config,area))throw new Error('LAYOUT_DOES_NOT_FIT_WORK_AREA');const total=config.workers.length*config.layout.width+(config.workers.length-1)*config.layout.gap;const first=area.left+area.width-config.layout.rightMargin-total;return Object.fromEntries(config.workers.map((w,i)=>[w.id,{left:first+i*(config.layout.width+config.layout.gap),top:area.top+config.layout.top,width:config.layout.width,height:config.layout.height}]))as Record<WorkerId,WindowPlacement>}
