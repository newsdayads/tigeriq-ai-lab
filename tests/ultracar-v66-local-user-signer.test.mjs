import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL('../apps/ultracarhcm-v1/release/'+name,import.meta.url),'utf8');
const boot=read('Initialize-UltraCarSignerLocal.ps1');
const task=read('Sign-UltraCarV66LocalTask.ps1');

test('interactive local user enrollment, never SYSTEM or noninteractive',()=>{
 assert.match(boot,/WindowsIdentity\]::GetCurrent\(\)\.Name/);
 assert.match(boot,/PC01\\wdragons12x/);
 assert.match(boot,/UserInteractive/);
 assert.match(boot,/LOCAL_INTERACTIVE_USER_REQUIRED/);
 assert.match(boot,/LOCAL_INTERACTIVE_CONSOLE_REQUIRED/);
 assert.match(boot,/Read-Host[\s\S]*-AsSecureString/g);
});
test('local DPAPI encryption, no overwrite, never sends passwords to chat',()=>{
 assert.match(boot,/ConvertFrom-SecureString/);
 assert.match(boot,/SECURE_STORE_ALREADY_ENROLLED_NO_OVERWRITE/);
 assert.doesNotMatch(boot,/Send-MailMessage|Invoke-RestMethod|Invoke-WebRequest|Start-ScheduledTask|Register-ScheduledTask|--ks-pass|--key-pass/i);
});
test('signer pinned to exact v66 307 aligned sha with user identity and v2 v3 verification',()=>{
 for(const v of [
   'PC01\\wdragons12x',
   'UltraCar_v1.0.66_307_aligned_TEST.apk',
   'UltraCar_v1.0.66_307_signed_TEST.apk',
   'C68CFC6C4FF9F1C7E341C441B6E94154CB2F04CB26688E6F5900EE5539757D47',
   'ALIGNED_V66_PINNED_SHA_MISMATCH',
   'Invoke-UltraCarTestApk.ps1',
   '-Version v66 -VersionCode 307 -Mode Sign',
   '-Mode VerifyOnly'
 ])assert.ok(task.includes(v),v);
});
test('signer uses only local DPAPI and cleans ephemeral process variables',()=>{
 assert.match(task,/ConvertTo-SecureString/);
 assert.match(task,/ZeroFreeBSTR/);
 assert.match(task,/Remove-Item Env:\\TIGERIQ_ULTRACAR_KS_PASS/);
 assert.match(task,/Remove-Item Env:\\TIGERIQ_ULTRACAR_KEY_PASS/);
 assert.doesNotMatch(task,/--ks-pass\s+pass:|--key-pass\s+pass:|Read-Host|Register-ScheduledTask|schtasks \/create/i);
});
test('Drive exact signed TEST name, CreateNew no overwrite, local receipt is not cloud acceptance',()=>{
 assert.match(task,/UltraCar_v1.0.66_TEST.apk/);
 assert.match(task,/FileMode\]::CreateNew/);
 assert.match(task,/DRIVE_NAME_COLLISION_NO_OVERWRITE/);
 assert.match(task,/DRIVE_LOCAL_MIRROR_HASH_MISMATCH/);
 assert.match(task,/CLOUD_API_UNVERIFIED/);
 assert.doesNotMatch(task,/Get-ChildItem.*signed_TEST\.apk|Copy-Item -Force|Remove-Item.*signed|production/i);
});
