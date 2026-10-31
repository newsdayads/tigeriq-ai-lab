// UltraCar TEST 66, 307: owner-requested red ORIGINAL Profile subtitle.
// Engineering source lives on GitHub; this is scoped device-bound APK assembly.
// No production APK, old stage, release script, Drive task or keystore is changed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const OLD='v1.0.65', NEXT='v1.0.66', OLD_CODE=306, CODE=307;
const SOURCE_STAGE='Staged_v1_0_65_CockpitFullFix_306';
const TARGET_STAGE='Staged_v1_0_66_ProfileOriginalSubtitleRed_307';
const EXPECTED_BASELINE='FA7FB76F9E9FF034E66FC134DEEE65690E2C9BCBB8D37C9E15C08BE8F1F7132B';

export function patchVersion(source){
  const code="versionCode: '"+OLD_CODE+"'";
  const name="versionName: 'TigerIQ_HCM_"+OLD+"'";
  if(source.split(code).length!==2||source.split(name).length!==2)throw Error('BASELINE_VERSION_MISMATCH');
  return source.replace(code,"versionCode: '"+CODE+"'").replace(name,"versionName: 'TigerIQ_HCM_"+NEXT+"'");
}
export function patchSubtitle(source){
  const old='<string name="prof_subtitle">TIGERIQ HCM '+OLD+' (BUILD '+OLD_CODE+')</string>';
  const newer='<string name="prof_subtitle">TIGERIQ HCM '+NEXT+' (BUILD '+CODE+')</string>';
  if(source.split(old).length!==2)throw Error('ORIGINAL_PROFILE_SUBTITLE_MISMATCH');
  return source.replace(old,newer);
}
export function patchProfileColor(source){
  // ORIGINAL profile header passes subtitle p1 into the FIRST Compose Text.
  // That text's v3/v4 COLOR argument currently comes from dynamic theme Ll65.f.
  // Replace ONLY this anchored instruction pair; Compose Color.Red is 0xFFFF000000000000L.
  // Do NOT touch title, other Text calls or Float registers.
  const target=/(move v2, v3\r?\n\s*\r?\n\s*move-object v5, v4\r?\n\s*\r?\n\s*)invoke-static \{v8\}, Ll65;->f\(Luo0;\)J\r?\n\s*\r?\n\s*move-result-wide v3/g;
  const matches=[...source.matchAll(target)];
  if(matches.length!==1)throw Error('PROFILE_SUBTITLE_COLOR_CALLSITE_MISMATCH:'+matches.length);
  return source.replace(target,(_,prefix)=>prefix+'const-wide v3, 0xffff000000000000L');
}
function sha(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()}
function command(file,args){
  const out=spawnSync(file,args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:3e6});
  if(out.stdout)process.stdout.write(out.stdout.slice(-2600));
  if(out.stderr)process.stderr.write(out.stderr.slice(-2600));
  if(out.error||out.status!==0)throw Error('TOOL_FAILED:'+file+':'+out.status+':'+String(out.error||''));
}
function assertNoFile(p){if(fs.existsSync(p))throw Error('REFUSE_OVERWRITE:'+p)}
function checkLibs(baseline,stage){
  function libs(root){const results=[];function walk(folder){if(!fs.existsSync(folder))return;for(const x of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,x.name);if(x.isDirectory())walk(p);else if(x.isFile()&&x.name.endsWith('.so'))results.push(path.relative(root,p));}}walk(path.join(root,'lib'));return results.sort()}
  const a=libs(baseline),b=libs(stage);
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error('CAMERA_LIB_FILESET_CHANGED');
  for(const f of a)if(sha(path.join(baseline,f))!==sha(path.join(stage,f)))throw Error('CAMERA_LIB_HASH_CHANGED:'+f);
  return a.length;
}
export function assemble({version='v1.0.66',code=307,root='D:\\TigerIQ\\Apps\\DeXCamPersonal',tools='D:\\TigerIQ\\Tools'}={}){
  if(version!==NEXT||Number(code)!==CODE)throw Error('TEST_66_307_ONLY');
  const source=path.join(root,SOURCE_STAGE),stage=path.join(root,TARGET_STAGE),build=path.join(root,'build');
  const baselineApk=path.join(build,'UltraCar_'+OLD+'_'+OLD_CODE+'_signed_TEST.apk');
  const unsigned=path.join(build,'UltraCar_'+NEXT+'_'+CODE+'_unsigned_TEST.apk');
  const aligned=path.join(build,'UltraCar_'+NEXT+'_'+CODE+'_aligned_TEST.apk');
  const signed=path.join(build,'UltraCar_'+NEXT+'_'+CODE+'_signed_TEST.apk');
  if(!fs.existsSync(source)||sha(baselineApk)!==EXPECTED_BASELINE)throw Error('SIGNED_V65_BASELINE_SHA_MISMATCH');
  for(const f of [stage,unsigned,aligned,signed])assertNoFile(f);
  const yml=path.join(source,'apktool.yml'),strings=path.join(source,'res','values','strings.xml'),smali=path.join(source,'smali','jv2.smali');
  const transformed=[
    [yml,patchVersion(fs.readFileSync(yml,'utf8'))],
    [strings,patchSubtitle(fs.readFileSync(strings,'utf8'))],
    [smali,patchProfileColor(fs.readFileSync(smali,'utf8'))]
  ];
  fs.cpSync(source,stage,{recursive:true,errorOnExist:true,force:false});
  for(const [src,data] of transformed)fs.writeFileSync(path.join(stage,path.relative(source,src)),data,'utf8');
  const libs=checkLibs(source,stage);
  command('java',['-jar',path.join(tools,'apktool.jar'),'b',stage,'-o',unsigned]);
  command(path.join(tools,'AndroidBuildTools35','unpacked','android-15','zipalign.exe'),['-v','4',unsigned,aligned]);
  command(path.join(tools,'AndroidBuildTools35','unpacked','android-15','zipalign.exe'),['-c','-v','4',aligned]);
  const badging=spawnSync(path.join(tools,'AndroidBuildTools35','unpacked','android-15','aapt2.exe'),['dump','badging',aligned],{encoding:'utf8',timeout:30000,maxBuffer:3e6});
  const identity="package: name='com.tigeriq.dexsplit' versionCode='307' versionName='TigerIQ_HCM_v1.0.66'";
  if(badging.status!==0||!String(badging.stdout).includes(identity))throw Error('ALIGNED_APK_VERSION_OR_PACKAGE_INVALID');
  const result={status:'UNSIGNED_ALIGNED_APK_PASS',version:NEXT,code:CODE,aligned,alignedBytes:fs.statSync(aligned).size,alignedSha256:sha(aligned),libsPreserved:libs,redSubtitleSource:true,signing:'NOT_EXECUTED',cloud:'UNVERIFIED',device:'UNVERIFIED'};
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='-Version'||args[2]!=='-VersionCode')throw Error('USAGE: -Version v66 -VersionCode 307');
  const version=args[1]==='v66'?'v1.0.66':args[1];
  assemble({version,code:Number(args[3])});
 }catch(e){process.stderr.write('BUILD_TEST_BLOCKED:'+e.message+'\n');process.exitCode=1;}
}
