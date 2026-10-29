import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {referencesFromSource,inspectR01} from './r01-preflight.mjs';

const gradle=readFileSync(new URL('../../apps/ultracarhcm-v2/app/build.gradle',import.meta.url),'utf8');
test('AGP Kotlin Java17 Compose and Maven Central UVC are configured',()=>{
  for(const token of ["id 'com.android.application'","id 'org.jetbrains.kotlin.android'",
    "namespace 'ai.tigeriq.ultracarhcm.v2'","applicationId 'ai.tigeriq.ultracarhcm.v2'",
    'compileSdk 34','minSdk 26',"jvmTarget = '17'",
    "kotlinCompilerExtensionVersion '1.5.4'","com.herohan:UVCAndroid:1.0.13"])
    assert.ok(gradle.includes(token),token);
});
test('resource reference scan includes image, raw video and XML',()=>{
  const refs=referencesFromSource('R.drawable.original_car R.raw.ultrabot R.string.app_name R.xml.device_filter');
  assert.deepEqual([...refs.get('drawable')],['original_car']);
  assert.deepEqual([...refs.get('raw')],['ultrabot']);
  assert.deepEqual([...refs.get('string')],['app_name']);
  assert.deepEqual([...refs.get('xml')],['device_filter']);
});
test('Android system drawables are not counted as missing original V1 assets',()=>{
  const refs=referencesFromSource('android.R.drawable.ic_menu_camera R.drawable.v2_road_city_day');
  assert.deepEqual([...refs.get('drawable')],['v2_road_city_day']);
});
test('missing V1 visuals or wrapper fail closed instead of false PASS',()=>{
  const root=mkdtempSync(join(tmpdir(),'gh5135-'));
  try{
    const dir=join(root,'apps/ultracarhcm-v2/app/src/main/java');
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'Home.kt'),'class Home { val car=R.drawable.original_car }');
    const result=inspectR01(root);
    assert.equal(result.ok,false);
    assert.ok(result.missingResources.includes('drawable/original_car'));
    assert.ok(result.missingFiles.some(f=>f.endsWith('gradle-wrapper.jar')));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('USB UVC controller releases Surface on close, unplug and preview failure (source guard only)',()=>{
  const controller = readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt',import.meta.url),'utf8');
  for (const handler of ['onCameraClose','onDeviceClose','onError']) {
    const start=controller.indexOf('override fun '+handler+'(');
    const end=controller.indexOf('\n    override fun ', start+13);
    assert.ok(start>=0,'missing '+handler);
    const body=controller.slice(start,end<0?controller.length:end);
    assert.match(body,/device == target/,'stale device guard in '+handler);
    assert.match(body,/releasePreview\(\)/,'Surface release missing in '+handler);
  }
  assert.match(controller,/catch \(t: Throwable\) \{\s*Log\.e\(logTag, "UVC preview failed", t\)\s*[\s\S]*?releasePreview\(\)/);
  assert.match(controller,/preview\.surfaceTextureListener === this/);
});

test('R01 lists every missing Gradle wrapper input, not just its JAR',()=>{
  const root=mkdtempSync(join(tmpdir(),'gh5135-wrapper-'));
  try{
    const result=inspectR01(root);
    const missing=result.missingFiles;
    for(const needed of [
      'apps/ultracarhcm-v2/gradlew',
      'apps/ultracarhcm-v2/gradle/wrapper/gradle-wrapper.properties',
      'apps/ultracarhcm-v2/gradle/wrapper/gradle-wrapper.jar',
      'apps/ultracarhcm-v2/app/src/main/res',
      'apps/ultracarhcm-v2/app/src/main/java'
    ]) assert.ok(missing.includes(needed),'must report '+needed);
    assert.equal(result.ok,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('R01 detects missing source resources even if Gradle entry files are present',()=>{
  const root=mkdtempSync(join(tmpdir(),'gh5135-assets-'));
  try{
    const base=join(root,'apps/ultracarhcm-v2');
    for(const p of ['settings.gradle','build.gradle','app/build.gradle',
      'app/src/main/AndroidManifest.xml','gradlew',
      'gradle/wrapper/gradle-wrapper.properties','gradle/wrapper/gradle-wrapper.jar']) {
      const full=join(base,p);
      mkdirSync(join(full,'..'),{recursive:true});
      writeFileSync(full,'fixture-only');
    }
    const source=join(base,'app/src/main/java/ai/tigeriq/Test.kt');
    mkdirSync(join(source,'..'),{recursive:true});
    writeFileSync(source,'val missing = R.drawable.v2_road_city_night');
    const result=inspectR01(root);
    assert.equal(result.ok,false);
    assert.ok(result.missingResources.includes('drawable/v2_road_city_night'));
    assert.ok(result.missingFiles.includes('apps/ultracarhcm-v2/app/src/main/res'));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('manifest scanner protects V2 app label and ignores Android framework symbols',async()=>{
  const xml='<application android:label="@string/app_name" android:icon="@android:drawable/ic_menu_camera" android:data="@xml/usb_filter"/>';
  const { referencesFromManifest } = await import('./r01-preflight.mjs');
  const found=referencesFromManifest(xml);
  assert.deepEqual([...found.get('string')],['app_name']);
  assert.deepEqual([...found.get('xml')],['usb_filter']);
  assert.equal(found.get('drawable').size,0);
});

test('V2 ships its own branded label and does not shadow library-generated R class',()=>{
  const app=readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/res/values/strings.xml',import.meta.url),'utf8');
  assert.match(app,/<string name="app_name">UltraCarHCM V2<\/string>/);
  const handWrittenR=new URL('../../apps/ultracarhcm-v2/app/src/main/java/com/serenegiant/uvccamera/R.java',import.meta.url);
  assert.equal(existsSync(handWrittenR),false,'AAR library R is generated by Android Gradle Plugin');
  assert.match(gradle,/com\.herohan:UVCAndroid:1\.0\.13/);
});

test('unrelated USB cancellation must never stop the selected UVC camera (source guard only)',()=>{
  const source=readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt',import.meta.url),'utf8');
  const handler=source.split('override fun onCancel(device: UsbDevice) {')[1]?.split('override fun onError(')[0];
  assert.ok(handler,'onCancel must exist');
  assert.match(handler,/if \(requested && device == target\)/);
  assert.match(handler,/stop\(\)/);
});

test('failed USB camera open and preview leave controller ready for a manual retry (source guard only)',()=>{
  const source=readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt',import.meta.url),'utf8');
  const open=source.split('override fun onDeviceOpen(')[1]?.split('override fun onCameraOpen(')[0];
  assert.ok(open);
  assert.match(open,/if \(requested && device == target\)/);
  assert.match(open,/main\.post/);
  assert.match(open,/stop\(\)/);
  const preview=source.split('private fun beginPreview() {')[1]?.split('override fun onAttach(')[0];
  assert.ok(preview);
  assert.match(preview,/UVC preview failed[\s\S]*?releasePreview\(\)[\s\S]*?stop\(\)/);
});

test('UVC error frees surface and keeps requested session ready for reconnect (source guard only)',()=>{
  const source=readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt',import.meta.url),'utf8');
  const handler=source.split('override fun onError(')[1]?.split('override fun onSurfaceTextureAvailable(')[0];
  assert.ok(handler);
  assert.match(handler,/if \(device == target && requested\)/);
  assert.match(handler,/releasePreview\(\)[\s\S]*?target = null[\s\S]*?đang chờ kết nối lại/);
  assert.doesNotMatch(handler,/stop\(\)/);
});

test('terminal USB failures stop while hot-plug and disconnect paths remain recoverable (source guard only)',()=>{
  const source=readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt',import.meta.url),'utf8');

  for (const [section,next,errorText] of [
    ['private fun beginPreview() {','override fun onAttach(', 'Lỗi hình Camera UVC'],
    ['override fun onDeviceOpen(', 'override fun onCameraOpen(', 'Không mở được Camera UVC'],
    ['override fun onCancel(', 'override fun onError(', 'Quyền USB bị từ chối']
  ]) {
    const sectionBody=source.split(section)[1]?.split(next)[0];
    assert.ok(sectionBody,'missing source section '+section);
    const errorIndex=sectionBody.indexOf(errorText);
    assert.ok(errorIndex>=0,'missing terminal report: '+errorText);
    assert.ok(sectionBody.slice(0,errorIndex).lastIndexOf('stop()') >= 0,
      'stop() must precede terminal UI report for '+errorText);
  }

  for (const [section,next,errorText] of [
    ['fun start() {','private fun beginPreview()', 'Đang chờ Camera UVC qua USB Host'],
    ['override fun onDetach(', 'override fun onCancel(', 'Đã rút Camera USB'],
    ['override fun onError(', 'override fun onSurfaceTextureAvailable(', 'Lỗi UVC:']
  ]) {
    const sectionBody=source.split(section)[1]?.split(next)[0];
    assert.ok(sectionBody,'missing source section '+section);
    const reportIndex=sectionBody.indexOf(errorText);
    assert.ok(reportIndex>=0,'missing recoverable report: '+errorText);
    assert.equal(sectionBody.slice(0,reportIndex).includes('stop()'),false,
      'recoverable path must not stop requested session for '+errorText);
  }
});

test('camera close and device close release preview and keep reconnect session active (source guard only)',()=>{
  const controller=readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt',import.meta.url),'utf8');
  for (const [name,next] of [
    ['onCameraClose','onDeviceClose'],
    ['onDeviceClose','onDetach']
  ]) {
    const body=controller.split('override fun '+name+'(')[1]?.split('override fun '+next+'(')[0];
    assert.ok(body,'missing '+name+' lifecycle callback');
    assert.match(body,/if \(device == target && requested\)/,'ignore stale '+name+' callbacks');
    const released=body.indexOf('releasePreview()');
    const cleared=body.indexOf('target = null');
    const reported=body.indexOf('report(');
    assert.ok(released>=0 && released<cleared && cleared<reported,
      name+': cleanup and target reset must happen before reconnect UI report');
    assert.equal(body.includes('stop()'),false,name+': recoverable close must keep requested session active');
  }
});
