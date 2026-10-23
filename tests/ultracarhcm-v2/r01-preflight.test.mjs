import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
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
