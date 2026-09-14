import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const WORKER_IDS = ['NV05', 'NV03', 'NV04'] as const;
export type WorkerId = (typeof WORKER_IDS)[number];

export interface WorkerConfig {
  id: WorkerId;
  role: string;
  homeUrl: string;
  profileDirectory: string;
  enabled?: boolean;
  userDataDir?: string;
}
export interface LayoutConfig { width:number; height:number; gap:number; rightMargin:number; top:number; fallbackWorkAreaWidth:number; fallbackWorkAreaLeft:number }
export interface PacingConfig { betweenWorkerLaunchMs:number; postReadySettlingMs:number; minUiActionGapMs:number; commandTimeoutMs:number; workerReadyTimeoutMs:number; maxRetries:number; retryBackoffMs:number }
export interface AutopilotConfig { enabled:boolean; pollIntervalMs:number; stateUrl?:string; requestTimeoutMs:number }
export interface RecoveryConfig { heartbeatStaleMs:number; checkIntervalMs:number; maxReopenAttempts:number; reopenBackoffMs:number; startupReadyUrl?:string; startupReadyTimeoutMs:number }
export interface ControllerConfig { host:'127.0.0.1'; port:number; chromePath:string; userDataDir?:string; logDir:string; layout:LayoutConfig; pacing:PacingConfig; autopilot:AutopilotConfig; recovery:RecoveryConfig; workers:WorkerConfig[] }
export interface WorkArea { left:number; top:number; width:number; height:number }
export interface WindowPlacement { left:number; top:number; width:number; height:number }

const ALLOWED_HOSTS = new Set(['chatgpt.com','gemini.google.com']);
const DEFAULT_AUTOPILOT:AutopilotConfig={enabled:true,pollIntervalMs:15000,requestTimeoutMs:5000};
const DEFAULT_RECOVERY:RecoveryConfig={heartbeatStaleMs:45000,checkIntervalMs:10000,maxReopenAttempts:2,reopenBackoffMs:15000,startupReadyUrl:'http://127.0.0.1:8795/health',startupReadyTimeoutMs:120000};

export function isAllowedWorkerUrl(value:string):boolean { try { const u=new URL(value); return u.protocol==='https:' && ALLOWED_HOSTS.has(u.hostname) } catch { return false } }
export function isWorkerEnabled(worker:Pick<WorkerConfig,'enabled'>):boolean { return worker.enabled !== false }
export function expandEnv(value:string):string { return value.replace(/%([^%]+)%/g,(_m,n:string)=>process.env[n]??`%${n}%`) }
export function isLoopbackHttpUrl(value:string|undefined):boolean { if(!value) return true; try { const u=new URL(value); return u.protocol==='http:' && (u.hostname==='127.0.0.1'||u.hostname==='localhost'||u.hostname==='::1') } catch { return false } }

export function validateConfig(raw:unknown):ControllerConfig {
  if(!raw||typeof raw!=='object') throw new Error('CONFIG_INVALID_OBJECT');
  const source=raw as Partial<ControllerConfig>;
  const config={...source,autopilot:{...DEFAULT_AUTOPILOT,...(source.autopilot??{})},recovery:{...DEFAULT_RECOVERY,...(source.recovery??{})}} as ControllerConfig;
  if(config.host!=='127.0.0.1') throw new Error('CONFIG_HOST_MUST_BE_LOOPBACK');
  if(!Number.isInteger(config.port)||config.port<1024||config.port>65535) throw new Error('CONFIG_INVALID_PORT');
  if(!config.chromePath) throw new Error('CONFIG_CHROME_PATH_REQUIRED');
  if(!config.logDir) throw new Error('CONFIG_LOG_DIR_REQUIRED');
  if(!Array.isArray(config.workers)||config.workers.length!==3) throw new Error('CONFIG_REQUIRES_3_WORKERS');
  const ids=config.workers.map(w=>w.id);
  if(ids.join('|')!==WORKER_IDS.join('|')) throw new Error('CONFIG_WORKER_ORDER_MUST_BE_NV05_NV03_NV04');
  const targets=new Set<string>();
  for(const worker of config.workers){
    if(worker.enabled!==undefined && typeof worker.enabled!=='boolean') throw new Error(`CONFIG_ENABLED_MUST_BE_BOOLEAN:${worker.id}`);
    if(!isAllowedWorkerUrl(worker.homeUrl)) throw new Error(`CONFIG_HOME_URL_NOT_ALLOWED:${worker.id}`);
    if(!worker.role.trim()) throw new Error(`CONFIG_ROLE_REQUIRED:${worker.id}`);
    const host=new URL(worker.homeUrl).hostname;
    const userData=worker.userDataDir??config.userDataDir??'';
    const target=`${userData}|${worker.profileDirectory}|${host}`.toLowerCase();
    if(targets.has(target)) throw new Error(`CONFIG_PROFILE_HOST_COLLISION:${worker.id}`);
    targets.add(target);
  }
  const {layout,pacing,autopilot,recovery}=config;
  if(!layout||layout.width<320||layout.height<480||layout.gap<0||layout.rightMargin<0) throw new Error('CONFIG_INVALID_LAYOUT');
  if(layout.fallbackWorkAreaWidth<layout.width*3) throw new Error('CONFIG_FALLBACK_WORK_AREA_TOO_SMALL');
  if(!pacing) throw new Error('CONFIG_PACING_REQUIRED');
  if(pacing.betweenWorkerLaunchMs<5000) throw new Error('CONFIG_STARTUP_GAP_MIN_5000MS');
  if(pacing.postReadySettlingMs<3000) throw new Error('CONFIG_SETTLE_MIN_3000MS');
  if(pacing.minUiActionGapMs<1500) throw new Error('CONFIG_UI_GAP_MIN_1500MS');
  if(pacing.commandTimeoutMs<10000||pacing.workerReadyTimeoutMs<30000) throw new Error('CONFIG_TIMEOUT_TOO_SMALL');
  if(!Number.isInteger(pacing.maxRetries)||pacing.maxRetries<0||pacing.maxRetries>2) throw new Error('CONFIG_MAX_RETRIES_0_TO_2');
  if(pacing.retryBackoffMs<3000) throw new Error('CONFIG_RETRY_BACKOFF_MIN_3000MS');
  if(typeof autopilot.enabled!=='boolean') throw new Error('CONFIG_AUTOPILOT_ENABLED_MUST_BE_BOOLEAN');
  if(autopilot.pollIntervalMs<5000||autopilot.requestTimeoutMs<1000||autopilot.requestTimeoutMs>30000) throw new Error('CONFIG_AUTOPILOT_PACING_INVALID');
  if(!isLoopbackHttpUrl(autopilot.stateUrl)) throw new Error('CONFIG_AUTOPILOT_STATE_URL_MUST_BE_LOOPBACK');
  if(recovery.heartbeatStaleMs<15000||recovery.checkIntervalMs<5000||recovery.reopenBackoffMs<5000) throw new Error('CONFIG_RECOVERY_PACING_INVALID');
  if(!Number.isInteger(recovery.maxReopenAttempts)||recovery.maxReopenAttempts<0||recovery.maxReopenAttempts>3) throw new Error('CONFIG_RECOVERY_ATTEMPTS_0_TO_3');
  if(recovery.startupReadyTimeoutMs<30000||recovery.startupReadyTimeoutMs>300000) throw new Error('CONFIG_RECOVERY_STARTUP_TIMEOUT_INVALID');
  if(!isLoopbackHttpUrl(recovery.startupReadyUrl)) throw new Error('CONFIG_RECOVERY_READY_URL_MUST_BE_LOOPBACK');
  return {...config,chromePath:expandEnv(config.chromePath),userDataDir:config.userDataDir?expandEnv(config.userDataDir):undefined,logDir:expandEnv(config.logDir),workers:config.workers.map(w=>({...w,enabled:isWorkerEnabled(w),userDataDir:w.userDataDir?expandEnv(w.userDataDir):undefined}))};
}
export function loadConfig(configPath?:string):ControllerConfig { const p=resolve(configPath??process.env.TIGERIQ_CHROME_CONFIG??'apps/chrome-controller/chrome-controller.config.json'); return validateConfig(JSON.parse(readFileSync(p,'utf8')) as unknown) }
export function computePlacements(config:ControllerConfig,workArea?:WorkArea):Record<WorkerId,WindowPlacement>{
  const area=workArea??{left:config.layout.fallbackWorkAreaLeft,top:0,width:config.layout.fallbackWorkAreaWidth,height:config.layout.height};
  const total=config.workers.length*config.layout.width+(config.workers.length-1)*config.layout.gap;
  const first=area.left+area.width-config.layout.rightMargin-total;
  if(first<area.left) throw new Error('LAYOUT_DOES_NOT_FIT_WORK_AREA');
  return Object.fromEntries(config.workers.map((w,i)=>[w.id,{left:first+i*(config.layout.width+config.layout.gap),top:area.top+config.layout.top,width:config.layout.width,height:config.layout.height}])) as Record<WorkerId,WindowPlacement>;
}
