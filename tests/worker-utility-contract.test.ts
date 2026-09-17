import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
const client=readFileSync('apps/worker-utility/ControllerClient.cs','utf8');
const context=readFileSync('apps/worker-utility/UtilityContext.cs','utf8');
const popup=readFileSync('apps/worker-utility/PopupForm.cs','utf8');
const watchdog=readFileSync('apps/worker-utility/Watchdog.cs','utf8');
const store=readFileSync('apps/worker-utility/StateStore.cs','utf8');
describe('Worker Utility V1 contract',()=>{
 it('uses Controller 8798 and bridge 8799',()=>{expect(client).toContain('http://127.0.0.1:8798');expect(server).toContain("http://127.0.0.1:8799/health");expect(bridge).toContain("const CONTROLLER='http://127.0.0.1:8798'");});
 it('uses independent launch broker',()=>{expect(server).not.toContain('spawn(config.chromePath');expect(server).toContain('CHROME_LAUNCH_REQUESTED_VIA_BROKER');});
 it('does not embed worker credential',()=>{expect(bridge).toContain('TIGERIQ_NV02_WORKER_TOKEN');expect(bridge).not.toMatch(/NV02_TOKEN='[0-9a-f]{24,}'/i);});
 it('has required V1 controls',()=>{for(const x of ['run','pause','focus','fix','lock','open','health','save','save-archive','close','recover','schedule-10','schedule-30','schedule-60','schedule-120','schedule-custom','schedule-cancel','advanced'])expect(context).toContain(`case \"${x}\"`);expect(popup).toContain('Không làm phiền');});
 it('persists schedules and autostart',()=>{expect(store).toContain('state.json');expect(store).toContain('CurrentVersion');expect(store).toContain('Run');expect(context).toContain('NextCheckAt');});
 it('implements watchdog bands and thresholds',()=>{for(const x of ['Healthy','Slow','Stalled','Recovering','Blocked'])expect(watchdog).toContain(x);expect(watchdog).toContain('FromSeconds(30)');expect(watchdog).toContain('FromMinutes(2)');expect(watchdog).toContain('FromMinutes(5)');});
 it('fail-closes save and close active mutation',()=>{expect(client).toContain('SAVE_ACTIVE_MUTATION_FORBIDDEN');expect(client).toContain('SAFE_CLOSE_ACTIVE_JOB_FORBIDDEN');expect(client).toContain('SAVE_NOT_DURABLE');});
});