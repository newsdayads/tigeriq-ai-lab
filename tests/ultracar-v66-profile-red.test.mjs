import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchVersion,patchSubtitle,patchProfileColor} from '../apps/ultracarhcm-v1/release/build-v66-profile-red-test.mjs';
test('v66 isolated only, 306->307',()=>{
 const input="versionCode: '306'\nversionName: 'TigerIQ_HCM_v1.0.65'";
 const out=patchVersion(input);
 assert.match(out,/versionCode: '307'/);assert.match(out,/versionName: 'TigerIQ_HCM_v1.0.66'/);
 assert.throws(()=>patchVersion(out),/BASELINE_VERSION_MISMATCH/);
});
test('existing subtitle resource, no floating version chip',()=>{
 const src='<string name="prof_subtitle">TIGERIQ HCM v1.0.65 (BUILD 306)</string>';
 assert.equal(patchSubtitle(src),'<string name="prof_subtitle">TIGERIQ HCM v1.0.66 (BUILD 307)</string>');
 assert.throws(()=>patchSubtitle('<string name="profile_chip">test</string>'),/ORIGINAL_PROFILE_SUBTITLE_MISMATCH/);
});
test('one exact original native Compose subtitle color callsite only',()=>{
 const source='move v2, v3\n\n    move-object v5, v4\n\n    invoke-static {v8}, Ll65;->f(Luo0;)J\n\n    move-result-wide v3\n\n    move-object v1, p1\n\n    invoke-static/range {v1 .. v23}, Lj55;->b(Ljava/lang/String;)V';
 const changed=patchProfileColor(source);
 assert.match(changed,/const-wide v3, 0xffff000000000000L/);
 assert.match(changed,/move-object v1, p1/);
 assert.doesNotMatch(changed,/invoke-static \{v8\}, Ll65;->f/);
 assert.throws(()=>patchProfileColor(changed),/CALLSITE_MISMATCH/);
 assert.throws(()=>patchProfileColor(source+source),/CALLSITE_MISMATCH:2/);
});
test('build command never includes credential, signing or Drive upload',()=>{
 const code=readFileSync(new URL('../apps/ultracarhcm-v1/release/build-v66-profile-red-test.mjs',import.meta.url),'utf8');
 for(const required of ['SIGNED_V65_BASELINE_SHA_MISMATCH','CAMERA_LIB_HASH_CHANGED','REFUSE_OVERWRITE','aapt2.exe','zipalign.exe','apktool.jar'])assert.ok(code.includes(required),required);
 assert.doesNotMatch(code,/--ks-pass|--key-pass|Start-ScheduledTask|Copy-Item|Remove-Item|Register-ScheduledTask/);
});
