/**
 * GH-5135 R01 — native compilation of the EXACT PR head from an unmodified
 * clean checkout. Optional governed V1 media is intentionally absent here;
 * runtime fallbacks must keep the source buildable without inventing rights.
 * This is compile/lint/unit evidence plus a narrowly scoped unsigned release
 * handoff for exact-head build provenance. It is never V1 asset parity, device
 * QA, a signed TEST release, or Production publication.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import {
  shouldPublishGh5135Artifact,
  uploadActionsArtifactArchive,
} from './actions-artifact-runtime.js';

const execFileAsync = promisify(execFile);
const ANDROID_GRADLE_TIMEOUT_MS = 600_000;
const NATIVE_GATE_TEST_TIMEOUT_MS = 720_000;
const run = (cmd: string, args: string[], cwd: string, timeout: number, env = process.env) =>
  spawnSync(cmd, args, { cwd, timeout, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

const requireSuccess = (result: {status: number | null; stdout: string | null; stderr: string | null}, what: string) => {
  expect(result.status, what + '\n' + (result.stdout || '').slice(-4500) + '\n' +
    (result.stderr || '').slice(-4500)).toBe(0);
};

describe('GH-5135 native Android clean-clone compile gate (not a release)',()=>{
  const eventName = process.env.GITHUB_EVENT_NAME;
  const ci = process.env.GITHUB_ACTIONS === 'true' && (eventName === 'pull_request' || eventName === 'push');
  (ci ? it : it.skip)('builds/lints/unit-tests exact GitHub event source using Android SDK without redistributing V1 media', async ()=>{
    const eventFile=process.env.GITHUB_EVENT_PATH;
    expect(eventFile).toBeTruthy();
    const event=JSON.parse(readFileSync(eventFile!,'utf8'));
    const expected = eventName === 'pull_request'
      ? event.pull_request?.head?.sha
      : process.env.GITHUB_SHA;
    expect(expected).toMatch(/^[0-9a-f]{40}$/);
    const sdk=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    expect(sdk, 'Android SDK must exist on the hosted runner').toBeTruthy();
    const workRoot=mkdtempSync(join(tmpdir(),'tigeriq-gh5135-native-'));
    const worktree=join(workRoot,'head');
    const checkout=resolve('.');
    const env: NodeJS.ProcessEnv={...process.env,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk};
    if (env.JAVA_HOME_17_X64) {
      env.JAVA_HOME=env.JAVA_HOME_17_X64;
      env.PATH=join(env.JAVA_HOME_17_X64,'bin')+':'+env.PATH;
    }
    try {
      requireSuccess(run('git',['fetch','--depth=1','origin',expected],checkout,90000,env),'Fetch exact PR HEAD');
      requireSuccess(run('git',['worktree','add','--detach',worktree,expected],checkout,90000,env),'Check out exact PR HEAD');
      const observed=run('git',['rev-parse','HEAD'],worktree,10000,env);
      requireSuccess(observed,'Git revision readback');
      expect(observed.stdout.trim()).toBe(expected);
      const app=join(worktree,'apps/ultracarhcm-v2');
      // Gradle can run for minutes. A synchronous spawn blocks the Vitest RPC
      // heartbeat and falsely fails CI even when Android compilation passed.
      let built: {status: number; stdout: string; stderr: string};
      try {
        const output = await execFileAsync('bash',[
          './gradlew','--no-daemon',':app:assembleDebug',':app:assembleRelease',':app:lintDebug',':app:testDebugUnitTest'
        ], {cwd:app,timeout:ANDROID_GRADLE_TIMEOUT_MS,env,encoding:'utf8',maxBuffer:8*1024*1024});
        built={status:0,stdout:output.stdout,stderr:output.stderr};
      } catch (error) {
        const failure=error as Error & {stdout?:string;stderr?:string;code?:number};
        built={status:typeof failure.code==='number'?failure.code:1,
          stdout:failure.stdout||'',stderr:failure.stderr||failure.message};
      }
      if (built.status !== 0) {
        const lint = join(app,'app/build/intermediates/lint_intermediate_text_report/debug/lint-results-debug.txt');
        if (existsSync(lint)) console.error('ANDROID_LINT_FULL_REPORT:\n'+readFileSync(lint,'utf8').slice(0,14000));
      }
      requireSuccess(built,'Android SDK compile/lint/unit at '+expected);
      const apk=join(app,'app/build/outputs/apk/debug/app-debug.apk');
      expect(existsSync(apk),'Debug APK missing after Gradle passed').toBe(true);

      const unsignedRelease=join(app,'app/build/outputs/apk/release/app-release-unsigned.apk');
      expect(existsSync(unsignedRelease),'Unsigned release APK missing after Gradle passed').toBe(true);
      const buildTools=join(sdk!,'build-tools','35.0.0');
      const apksigner=join(buildTools,'apksigner');
      const zipalign=join(buildTools,'zipalign');
      const aapt2=join(buildTools,'aapt2');
      for (const tool of [apksigner,zipalign,aapt2]) {
        expect(existsSync(tool),'Required Android build tool missing: '+tool).toBe(true);
      }
      const unsignedVerify=run(apksigner,['verify','--verbose',unsignedRelease],app,30000,env);
      expect(unsignedVerify.status,'Release APK must remain unsigned before handoff').not.toBe(0);

      const shortSha=expected.slice(0,12);
      const handoffName='UltraCarHCM_V2_2.0.0_dev11_MAIN_'+shortSha+'_UNSIGNED_ALIGNED_HANDOFF.apk';
      const alignedRelease=join(workRoot,handoffName);
      requireSuccess(
        run(zipalign,['-f','4',unsignedRelease,alignedRelease],app,30000,env),
        'Align exact-head unsigned release APK',
      );
      requireSuccess(
        run(zipalign,['-c','-v','4',alignedRelease],app,30000,env),
        'Verify exact-head release APK alignment',
      );
      const alignedVerify=run(apksigner,['verify','--verbose',alignedRelease],app,30000,env);
      expect(alignedVerify.status,'Aligned handoff must remain unsigned').not.toBe(0);
      const badging=run(aapt2,['dump','badging',alignedRelease],app,30000,env);
      requireSuccess(badging,'Read exact-head release APK identity');
      expect(badging.stdout).toContain(
        "package: name='ai.tigeriq.ultracarhcm.v2' versionCode='11' versionName='2.0.0-dev.11'",
      );

      const junitSuites = [
        ['HomeConfigRulesTest', 5],
        ['SavedLayoutShortcutRulesTest', 4],
        ['HomeBackupRulesTest', 5],
        ['QuickSlotRulesTest', 5],
        ['GuideTrackModelTest', 5],
        ['OverlayPositionRulesTest', 4],
        ['CameraDisplayRulesTest', 4],
        ['UvcRecoveryRulesTest', 5],
        ['DexDockRulesTest', 8],
        ['TelemetryRulesTest', 2],
        ['ObdProtocolTest', 3],
        ['TaxiMeterRulesTest', 8],
        ['ProfileRulesTest', 3],
        ['UpdateRulesTest', 12],
        ['ReportRulesTest', 6],
        ['ProfileLayoutRulesTest', 3],
        ['AppearanceRulesTest', 4],
        ['VehicleRulesTest', 4],
        ['PrivacyRulesTest', 2],
        ['NotificationRulesTest', 5],
        ['RecoveryRulesTest', 5],
      ] as const;
      let assertedJvmTests = 0;
      for (const [suite, expectedTests] of junitSuites) {
        const junit = join(
          app,
          'app/build/test-results/testDebugUnitTest/TEST-ai.tigeriq.ultracarhcm.v2.' + suite + '.xml',
        );
        expect(existsSync(junit), 'Real JVM unit test result XML is required: ' + suite).toBe(true);
        const report = readFileSync(junit, 'utf8');
        expect(report).toMatch(new RegExp('tests="' + expectedTests + '"'));
        expect(report).toMatch(/failures="0"/);
        expect(report).toMatch(/errors="0"/);
        assertedJvmTests += expectedTests;
      }
      const digest=createHash('sha256').update(readFileSync(apk)).digest('hex');
      const handoffDigest=createHash('sha256').update(readFileSync(alignedRelease)).digest('hex');
      console.log('ANDROID_JUNIT_ULTRACAR_RULES=' + assertedJvmTests + '_OF_' + assertedJvmTests + '_PASS');
      console.log('ANDROID_EXACT_HEAD='+expected);
      console.log('ANDROID_CLEAN_CLONE_DEBUG_APK_SHA256='+digest);
      console.log('ANDROID_UNSIGNED_ALIGNED_HANDOFF_SHA256='+handoffDigest);
      console.log('ANDROID_UNSIGNED_ALIGNED_HANDOFF_BYTES='+readFileSync(alignedRelease).length);

      if (shouldPublishGh5135Artifact(eventName, event, process.env.GITHUB_HEAD_REF)) {
        const artifactName=
          'ultracarhcm-v2-unsigned-release-'+shortSha+'-attempt-'+
          (process.env.GITHUB_RUN_ATTEMPT || '1');
        const archive=join(workRoot,artifactName+'.zip');
        let archived=run('zip',['-j','-q',archive,alignedRelease],checkout,30000,env);
        if (archived.status !== 0) {
          archived=run(
            'jar',
            ['--create','--file',archive,'-C',dirname(alignedRelease),basename(alignedRelease)],
            checkout,
            30000,
            env,
          );
        }
        requireSuccess(archived,'Create GitHub Actions artifact archive');
        const uploaded=await uploadActionsArtifactArchive(archive,artifactName,env);
        console.log('ANDROID_UNSIGNED_ARTIFACT_NAME='+artifactName);
        console.log('ANDROID_UNSIGNED_ARTIFACT_ID='+uploaded.artifactId);
        console.log('ANDROID_UNSIGNED_ARTIFACT_ARCHIVE_SHA256='+uploaded.archiveSha256);
        console.log('ANDROID_UNSIGNED_ARTIFACT_UPLOAD_PASS_NOT_SIGNED_NOT_RELEASED');
      } else {
        console.log('ANDROID_UNSIGNED_ARTIFACT_UPLOAD_SKIPPED_SCOPE');
      }
      console.log('ANDROID_R01_CLEAN_CLONE_NATIVE_BUILD_PASS_NOT_FOR_RELEASE');
    } finally {
      // Remove the isolated build after any scoped artifact upload completes.
      run('git',['worktree','remove','--force',worktree],checkout,20000,env);
      rmSync(workRoot,{recursive:true,force:true});
    }
  },NATIVE_GATE_TEST_TIMEOUT_MS);
});
