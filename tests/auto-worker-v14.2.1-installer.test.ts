import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const p=(x:string)=>path.resolve(x);
const read=(x:string)=>fs.readFileSync(p(x),'utf8');
const sha=(x:string)=>crypto.createHash('sha256').update(fs.readFileSync(p(x))).digest('hex');
const cmdPath='artifacts/auto-worker/v14.2.1/TigerIQ_AW_14.2.1.cmd';
const psPath='scripts/pc-worker/TigerIQ_AW_14.2.1_installer.ps1';
const libPath='scripts/pc-worker/TigerIQ_AW_14.2.1_installer_lib.ps1';
const wrapperPath='artifacts/auto-worker/v14.2.1/tigeriq_aw_v142_wrapper.js';
const guardPath='artifacts/auto-worker/v14.2.1/tigeriq_aw_v142_runtime_guard.js';
const regPath='artifacts/auto-worker/v14.2.1/registry_seed.json';

describe('TigerIQ Auto Worker V14.2.1 owner test candidate',()=>{
  it('pins exact installer source hash',()=>assert.equal(sha(psPath),'228f23fdf9e071644186792a4ebf6115a73a96a60cd17bf6ec0aadef584ceaf2'));
  it('cmd pins immutable installer commit',()=>{const s=read(cmdPath);assert.match(s,/387cfdfc8f7e4bb6f5d2171bf48bd5f58d07c63d/);assert.match(s,/228f23fdf9e071644186792a4ebf6115a73a96a60cd17bf6ec0aadef584ceaf2/)});
  it('forbids forced Chrome shutdown and uninstall',()=>{const s=[read(cmdPath),read(psPath),read(libPath)].join('\n').toLowerCase();for(const bad of ['taskkill','stop-process','uninstall','--disable-extensions']) assert.equal(s.includes(bad),false,bad)});
  it('preserves backup rollback and key guard',()=>{const s=read(psPath)+read(libPath);assert.match(s,/Backup-Extension/);assert.match(s,/Restore-Backup/);assert.match(s,/EXTENSION_KEY_CHANGED_ROLLBACK/)});
  it('does not launch Chrome when it was not already running',()=>{const s=read(libPath);assert.match(s,/if\(-not\$script:ChromeWasRunning\)\{return@\{Ok=\$true;Mode='CHROME_NOT_RUNNING_ON_DISK_ONLY'/);assert.match(s,/RELOAD_HANDSHAKE_BEGIN chrome_already_running=true/)});
  it('preactivation registry is NV02-only',()=>{const r=JSON.parse(read(regPath));const auto=r.employees.filter((e:any)=>e.active&&e.runtime_active&&e.background_auto_allowed&&e.activation_state==='ACTIVE'&&e.mode==='background_auto').map((e:any)=>e.employee_id);assert.deepEqual(auto,['NV02']);const n4=r.employees.find((e:any)=>e.employee_id==='NV04');const n5=r.employees.find((e:any)=>e.employee_id==='NV05');assert.equal(n4.runtime_active,false);assert.equal(n4.activation_state,'PENDING_OWNER_ACTIVATION');assert.equal(n5.runtime_active,false);assert.equal(n5.activation_state,'PENDING_OWNER_ACTIVATION')});
  it('wrapper parses and locks one 504x834 Top5 Right5 managed window',()=>{const s=read(wrapperPath);new Function(s.replace('__LEGACY_REL__','legacy.js'));assert.match(s,/width = 504, height = 834/);assert.match(s,/Number\(wa\.top\) \+ 5/);assert.match(s,/Number\(wa\.width\) - 5 - width/);assert.match(s,/PREACTIVATION_ONLY_NV02_WINDOW_ALLOWED/)});
  it('expected managed close is suppressed from legacy recovery',()=>{const s=read(wrapperPath);assert.match(s,/expectedWindows/);assert.match(s,/suppress legacy WINDOW_RECOVERY/);assert.match(s,/EXPECTED_CLOSE/)});
  it('routing guard exposes 4 nonbackground and 5 pending semantics',()=>{const s=read(wrapperPath);assert.match(s,/COMMAND_PENDING_ACTIVATION/);assert.match(s,/const background = !!\(profile\.registered/);const r=JSON.parse(read(regPath));assert.equal(r.employees.find((e:any)=>e.employee_id==='NV04').mode,'specialized')});
  it('runtime marker is factual only',()=>{const s=read(guardPath);assert.match(s,/does not fake heartbeat\/state/);assert.doesNotMatch(s,/heartbeat_at\s*=/)});
});
