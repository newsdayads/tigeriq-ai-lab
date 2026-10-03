import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  assertShellCommandAllowed,
  assertTigerIQTaskName,
  trustedTigerIQTaskActionData,
  parseTaskListCsv,
  parseCompactTaskListCsv,
  assertWritePathAllowed,
  resolveOperatorPath,
  androidReleaseBuildFailureClass,
  assertTigerIQLive3150DeployRequest,
} from '../apps/openclaw-tigeriq-runtime/operator.mjs';
import { PAD_UI_ACTIONS, assertPadUiRequest, parsePadBrokerJson } from '../apps/openclaw-tigeriq-runtime/pad-ui.mjs';
import {
  AUTHORIZED_ISSUE,
  EXPECTED_BRANCH,
  EXPECTED_PROJECT_ID,
  EXPECTED_REPO,
  EXPECTED_TEAM_ID,
  classifyDeployFailure,
  validateReleaseContract,
} from '../scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs';
import {
  PAPERCLIP_LAB_ACTIONS,
  PAPERCLIP_LAB_IMAGE,
  PAPERCLIP_LAB_PORT,
  PAPERCLIP_LAB_RUNTIME_REVISION,
  PAPERCLIP_LAB_RELEASE,
  PAPERCLIP_LAB_RELEASE_SHA,
  PAPERCLIP_LAB_ROOT,
  PAPERCLIP_LAB_WSL_DISTRO,
  PAPERCLIP_LAB_WSL_ROOT,
  assertPaperclipLabRequest,
  paperclipDockerFailureClass,
  paperclipContainerLogClass,
  paperclipContainerLogDiagnostic,
  paperclipHealthFailureClass,
  paperclipOpenAiDeviceAuthFailureClass,
  parsePaperclipComposePsRows,
  paperclipLabBrokerOperationForDockerArgs,
  paperclipLabComposeYaml,
  paperclipLabWslDockerArgs,
  paperclipLabWslPath,
  resolvePaperclipLabPath,
  validatePaperclipLabEnvText,
  upgradeLegacyPaperclipLabEnvText,
} from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

describe('OpenClaw PC01 guarded local operator', () => {
  it('allows TigerIQ/OpenClaw work roots', () => {
    expect(resolveOperatorPath('D:\\TigerIQ\\Evidence\\x.json')).toBe('D:\\TigerIQ\\Evidence\\x.json');
    expect(resolveOperatorPath('D:\\OpenClaw\\npm-global')).toBe('D:\\OpenClaw\\npm-global');
    expect(resolveOperatorPath('D:\\TigerIQ-OpenClaw\\state')).toBe('D:\\TigerIQ-OpenClaw\\state');
  });

  it('blocks paths outside operator roots and sensitive stores', () => {
    expect(() => resolveOperatorPath('C:\\Windows\\System32')).toThrow('TIGERIQ_PC_PATH_NOT_ALLOWED');
    expect(() => resolveOperatorPath('D:\\TigerIQ\\Secrets\\x.txt')).toThrow('TIGERIQ_PC_SENSITIVE_PATH_BLOCKED');
  });

  it('blocks direct source/runtime-source writes while allowing state/evidence writes', () => {
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Workspace\\tigeriq-ai-lab\\x.txt')).toThrow('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Runtime\\CoreSource\\x.txt')).toThrow('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
    expect(() => assertWritePathAllowed('D:\\OpenClaw\\npm-global\\openclaw.cmd')).toThrow('TIGERIQ_PC_WRITE_PATH_NOT_ALLOWED');
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\State\\x.json')).not.toThrow();
    expect(() => assertWritePathAllowed('D:\\TigerIQ\\Evidence\\x.json')).not.toThrow();
  });

  it('allows only a narrow diagnostic shell command set', () => {
    expect(assertShellCommandAllowed('git status')).toBe('git status');
    expect(assertShellCommandAllowed('ollama ps')).toBe('ollama ps');
    expect(assertShellCommandAllowed('openclaw plugins inspect tigeriq-runtime --json')).toContain('tigeriq-runtime');
    for (const command of [
      'Get-Process | Select-Object -First 5',
      'Get-ChildItem C:\\',
      'echo $env:GH_TOKEN',
      'cmd /c whoami',
      'shutdown /s /t 0',
      'Remove-Item D:\\TigerIQ\\Workspace -Recurse -Force',
      'git push origin main',
      'vercel deploy --prod',
      'gh pr merge 123',
      'type D:\\TigerIQ\\Secrets\\github-command-center.token',
    ]) {
      expect(() => assertShellCommandAllowed(command)).toThrow('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');
    }
  });

  it('limits scheduled-task actions to TigerIQ task names', () => {
    expect(assertTigerIQTaskName('TigerIQ OpenClaw Gateway')).toBe('TigerIQ OpenClaw Gateway');
    expect(() => assertTigerIQTaskName('Microsoft\\Windows\\Defrag\\ScheduledDefrag')).toThrow('TIGERIQ_PC_TASK_NOT_ALLOWED');
  });

  it('trusts task-action data only with literal subprocess success and verified post-action state', () => {
    const taskName='TigerIQ Core 24x7';
    const ok={exitCode:0,timedOut:false,stdout:'',stderr:'',cwd:'D:\\TigerIQ'};
    const running={taskName,state:'Running',lastRun:'10/2/2026 6:00:00 AM',lastResult:'0',previousLastRun:'10/2/2026 5:55:00 AM'};
    const ready={taskName,state:'Ready',lastRun:'10/2/2026 6:00:00 AM',lastResult:'0',previousLastRun:'10/2/2026 5:55:00 AM'};
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok,verification:running})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok,verification:ready})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_stop',{taskName,...ok,verification:ready})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:ok,verification:running})).toBe(true);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:{...ok,exitCode:1},started:ok,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_restart',{taskName,stopped:ok,started:{...ok,timedOut:true},verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,exitCode:null,timedOut:false,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,exitCode:false,timedOut:false,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,exitCode:0,verification:running})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok,verification:{...ready,previousLastRun:ready.lastRun}})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName,...ok})).toBe(false);
    expect(trustedTigerIQTaskActionData('task_start',{taskName:'Not TigerIQ',...ok,verification:running})).toBe(false);
  });

  it('parses task_list CSV into a bounded TigerIQ-only inventory', () => {
    const csv = [
      String.raw`"PC01","\\TigerIQ Core 24x7","10/1/2026 12:00:00 AM","Ready","Interactive/Background","9/30/2026 5:00:00 PM","0","SYSTEM","node D:\\TigerIQ\\Runtime\\core.mjs","N/A","","Enabled","","","SYSTEM","","","Every 5 minutes","Minute","5:00:00 PM","9/30/2026"`,
      String.raw`"PC01","\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","N/A","Ready","Background","N/A","0","SYSTEM","defrag.exe","","","Enabled","","","SYSTEM","","","Weekly","Weekly","3:00:00 AM","9/30/2026"`,
      String.raw`"PC01","\\TigerIQ Quote Test","N/A","Disabled","Background","N/A","1","SYSTEM","cmd /c echo ""hello,world""","","","Disabled","","","SYSTEM","","","At startup","At system startup","",""`,
    ].join('\r\n');

    expect(parseTaskListCsv(csv)).toEqual([
      {
        taskName: 'TigerIQ Core 24x7',
        state: 'Ready',
        lastRun: '9/30/2026 5:00:00 PM',
        lastResult: '0',
        action: 'node D:\\TigerIQ\\Runtime\\core.mjs',
        trigger: 'Every 5 minutes | Minute | 5:00:00 PM | 9/30/2026',
      },
      {
        taskName: 'TigerIQ Quote Test',
        state: 'Disabled',
        lastRun: 'N/A',
        lastResult: '1',
        action: 'cmd /c echo "hello,world"',
        trigger: 'At startup | At system startup',
      },
    ]);
  });

  it('parses compact task_list CSV into TigerIQ task names only', () => {
    const csv = [
      String.raw`"\\TigerIQ Core 24x7","10/3/2026 2:00:00 PM","Ready"`,
      String.raw`"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","10/4/2026 3:00:00 AM","Ready"`,
      String.raw`"\\TigerIQ OpenClaw Gateway","N/A","Running"`,
    ].join('\r\n');

    expect(parseCompactTaskListCsv(csv)).toEqual([
      { taskName: 'TigerIQ Core 24x7' },
      { taskName: 'TigerIQ OpenClaw Gateway' },
    ]);
  });

  it('surfaces only allowlisted Android release failure classes', () => {
    expect(androidReleaseBuildFailureClass({ stderr: 'Exception: APKSIGNER_MISSING: Android SDK build-tools are required' })).toBe('APKSIGNER_MISSING');
    expect(androidReleaseBuildFailureClass({ stdout: 'ANDROID_RELEASE_BUILD_FAILED' })).toBe('ANDROID_RELEASE_BUILD_FAILED');
    expect(androidReleaseBuildFailureClass({ stderr: 'GRADLE_COMMAND_MISSING: no existing Gradle runtime' })).toBe('GRADLE_COMMAND_MISSING');
    expect(androidReleaseBuildFailureClass({ stderr: 'DPAPI_SIGNER_RECEIPT_INVALID' })).toBe('DPAPI_SIGNER_RECEIPT_INVALID');
    expect(androidReleaseBuildFailureClass({ stderr: 'password=secret unknown failure' })).toBe('UNCLASSIFIED');
  });

  it('keeps Android stable release build as one fixed typed local action', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_release_build'");
    expect(source).toContain("scripts\\\\pc-worker\\\\build-android-worker-release.ps1");
    expect(source).toContain("D:\\\\TigerIQ\\\\Runtime\\\\CoreSource");
    expect(source).toContain("D:\\\\TigerIQ\\\\State\\\\core-runtime-updater.json");
    expect(source).toContain("D:\\\\TigerIQ\\\\Secrets\\\\AndroidSigning");
    expect(source).toContain("ANDROID_WORKER_STABLE_RELEASE_READY");
    expect(source).toContain("63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293");
    expect(source).toContain("TIGERIQ_ANDROID_RELEASE_SIGNER_MISMATCH");
    expect(source).toContain("TIGERIQ_ANDROID_RELEASE_SOURCE_SHA_MISMATCH");
    expect(source).not.toContain("input?.script");
    expect(source).not.toContain("input?.secretsDir");
    expect(source).not.toContain("D:\\\\TigerIQ\\\\Workspace\\\\tigeriq-ai-lab");
  });

  it('keeps v0.20 CI artifact signing scoped to the reviewed artifact', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'android_worker_sign_v020_ci_artifact'");
    expect(source).toContain("runId: '37119358164'");
    expect(source).toContain("artifactId: '11273046069'");
    expect(source).toContain("artifactName: 'tigeriq-worker-unsigned-release-apk'");
    expect(source).toContain("sourceHead: '8364e79ef5a03d5d95663e511c076f5be4f5003a'");
    expect(source).toContain("expectedUnsignedSha256: 'BDC32789297BB5304AE423476D8C4170C9D17C0B9AC2D7C5533DA42FBA82F598'");
    expect(source).toContain("expectedApkSignerJarSha256: '00EF9948F843FE395D2440AE3EF41405B8040A6D5D46493BD1902AC0EE6DEAE7'");
    expect(source).toContain("expectedVersion: '0.20.0-update-lease-guard'");
    expect(source).toContain("process.env.TIGERIQ_GITHUB_TOKEN || process.env.GITHUB_TOKEN");
    expect(source).toContain("actions/artifacts/${spec.artifactId}/zip");
    expect(source).toContain("'x-github-api-version': '2022-11-28'");
    expect(source).toContain("redirect: 'follow'");
    expect(source).toContain("[\'504b0304\',\'504b0506\',\'504b0708\']");
    expect(source).toContain("param([string]$zip,[string]$dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force");
    expect(source).toContain("scripts\\\\pc-worker\\\\sign-v020-reviewed-artifact.ps1");
    expect(source).toContain("win.join(downloadDir, 'apksigner.jar')");
    expect(source).toContain("executePadUiAction({ action: 'pad_android_sign_v020' })");
    expect(source).toContain("TIGERIQ_V020_USER_SESSION_BROKER_UNAVAILABLE");
    expect(source).toContain("receipt.passwordTransport !== 'stdin-only'");
    expect(source).toContain("receipt.apksignerMode !== 'portable-pinned-jar'");
    expect(source).toContain("receipt.prealignedInput !== true");
    expect(source).toContain("TIGERIQ_ANDROID_RELEASE_SOURCE_ARTIFACT_MISMATCH");
    expect(source).not.toContain("extraEnvKeys: ['JAVA_HOME', 'TIGERIQ_JAVA']");
    expect(source).not.toContain("extraEnvKeys: ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'ANDROID_SDK_ROOT', 'ANDROID_HOME']");
    expect(source).not.toContain("gh auth login");
    expect(source).not.toContain("'gh.exe'");
  });

  it('surfaces only bounded Android build-tool discovery failure classes', async () => {
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_APKSIGNER_DISCOVERY_NO_SDK_ROOT' })).toBe('ANDROID_APKSIGNER_DISCOVERY_NO_SDK_ROOT');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_APKSIGNER_DISCOVERY_NO_BUILD_TOOLS_DIR' })).toBe('ANDROID_APKSIGNER_DISCOVERY_NO_BUILD_TOOLS_DIR');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_APKSIGNER_DISCOVERY_BINARY_MISSING' })).toBe('ANDROID_APKSIGNER_DISCOVERY_BINARY_MISSING');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_ZIPALIGN_DISCOVERY_NO_SDK_ROOT' })).toBe('ANDROID_ZIPALIGN_DISCOVERY_NO_SDK_ROOT');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_ZIPALIGN_DISCOVERY_NO_BUILD_TOOLS_DIR' })).toBe('ANDROID_ZIPALIGN_DISCOVERY_NO_BUILD_TOOLS_DIR');
    expect(androidReleaseBuildFailureClass({ stderr: 'ANDROID_ZIPALIGN_DISCOVERY_BINARY_MISSING' })).toBe('ANDROID_ZIPALIGN_DISCOVERY_BINARY_MISSING');
    expect(androidReleaseBuildFailureClass({ stderr: 'APKSIGNER_JAR_SHA256_REQUIRED' })).toBe('APKSIGNER_JAR_SHA256_REQUIRED');
    expect(androidReleaseBuildFailureClass({ stderr: 'APKSIGNER_JAR_SHA256_MISMATCH' })).toBe('APKSIGNER_JAR_SHA256_MISMATCH');
    expect(androidReleaseBuildFailureClass({ stderr: 'JAVA_RUNTIME_REQUIRED' })).toBe('JAVA_RUNTIME_REQUIRED');
  });

  it('keeps task_list as a fixed read-only schtasks query with no delete path', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');
    expect(source).toContain("action === 'task_list'");
    expect(source).toContain("['/Query', '/FO', 'CSV', '/NH']");
    expect(source).not.toContain("['/Query', '/FO', 'CSV', '/V', '/NH']");
    expect(source).toContain("scope: 'TigerIQ'");
    expect(source).toContain("taskNames: tasks.map((task) => task.taskName)");
    expect(source).toContain("releaseTaskNames: tasks.map((task) => task.taskName).filter");
    expect(source).not.toContain("['/Delete'");
  });
});


describe('Power Automate Desktop guarded UI contract', () => {
  it('accepts Windows PowerShell UTF-8 BOM on broker JSON files', () => {
    expect(parsePadBrokerJson('\uFEFF{"available":true}')).toEqual({ available: true });
  });

  it('exposes only the bounded PAD action set', () => {
    expect(PAD_UI_ACTIONS).toEqual([
      'pad_health', 'pad_launch', 'pad_windows', 'pad_tree',
      'pad_invoke', 'pad_set_value', 'pad_click', 'pad_keys',
      'pad_android_sign_v020',
    ]);
  });

  it('keeps v0.20 signing fixed inside the existing interactive limited-user broker', async () => {
    expect(assertPadUiRequest({ action: 'pad_android_sign_v020' })).toEqual({ action: 'pad_android_sign_v020' });
    const broker = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    const installer = await readFile(new URL('../apps/openclaw-tigeriq-runtime/Install-PadUiBroker.ps1', import.meta.url), 'utf8');
    expect(broker).toContain("'pad_android_sign_v020' { return Invoke-V020Signer }");
    expect(broker).toContain("D:\\TigerIQ\\Runtime\\CoreSource\\scripts\\pc-worker\\sign-v020-reviewed-artifact.ps1");
    expect(broker).toContain("$psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"'");
    expect(broker).not.toContain('ArgumentList.Add');
    expect(broker).toContain("ANDROID_WORKER_STABLE_RELEASE_READY");
    expect(broker).toContain("DPAPI_PASSWORD_DECRYPT_FAILED");
    expect(broker).not.toContain('$Request.command');
    expect(broker).not.toContain('$Request.path');
    expect(broker).not.toMatch(/Password=|Credential=/);
    expect(installer).toContain("New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited");
  });

  it('requires selectors for PAD element mutations and bounds values', () => {
    expect(assertPadUiRequest({ action: 'pad_invoke', name: 'New flow' })).toMatchObject({ action: 'pad_invoke', name: 'New flow' });
    expect(assertPadUiRequest({ action: 'pad_set_value', automationId: 'NameBox', value: 'TigerIQ_CANARY_NOTEPAD' })).toMatchObject({ value: 'TigerIQ_CANARY_NOTEPAD' });
    expect(() => assertPadUiRequest({ action: 'pad_click' })).toThrow('TIGERIQ_PAD_SELECTOR_REQUIRED');
    expect(() => assertPadUiRequest({ action: 'pad_set_value', name: 'x' })).toThrow('TIGERIQ_PAD_VALUE_REQUIRED');
    expect(() => assertPadUiRequest({ action: 'pad_keys', key: 'ALT+F4' })).toThrow('TIGERIQ_PAD_KEY_NOT_ALLOWED');
  });

  it('does not accept coordinate-style fields through the typed PAD request', () => {
    const normalized = assertPadUiRequest({ action: 'pad_windows', x: 10, y: 20 });
    expect(normalized).toEqual({ action: 'pad_windows' });
  });

  it('dispatches PAD keys with native nonblocking key events', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('keybd_event');
    expect(source).toContain("Method='NativeKeyEvent'");
    expect(source).not.toContain('[System.Windows.Forms.SendKeys]::Send(');
    expect(source).not.toContain('[System.Windows.Forms.SendKeys]::SendWait(');
  });

  it('avoids unavailable LegacyIAccessiblePattern on PC01 UIAutomation runtime', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).not.toContain('LegacyIAccessiblePattern');
  });

  it('resolves only owned modal UI when a verified PAD designer is disabled', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('Get-PadOwnedModalWindow');
    expect(source).toContain('[TigerIQPadNative]::GetWindow($probe, 4)');
    expect(source).toContain("TIGERIQ_PAD_UI_OWNED_MODAL_AMBIGUOUS");
    expect(source).toContain("if (-not $window.Current.IsEnabled)");
  });

  it('sanitizes non-finite UIAutomation rectangle values before JSON serialization', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/pad-ui-broker.ps1', import.meta.url), 'utf8');
    expect(source).toContain('Convert-FiniteUiNumber');
    expect(source).toContain('[double]::IsInfinity($n)');
    expect(source).toContain('[double]::IsNaN($n)');
    expect(source).not.toContain('[math]::Round($r.');
    expect((source.match(/Convert-FiniteUiNumber \\$r\\./g) ?? []).length).toBe(8);
  });
});


describe('Paperclip Lab bounded PC01 capability', () => {
  it('pins the exact approved release and loopback-only port', () => {
    expect(PAPERCLIP_LAB_ROOT).toBe('D:\\TigerIQ-Paperclip-Lab');
    expect(PAPERCLIP_LAB_PORT).toBe(3210);
    expect(PAPERCLIP_LAB_RUNTIME_REVISION).toBe('20260930_WSL_KEEPALIVE_2');
    expect(PAPERCLIP_LAB_RELEASE).toBe('v2026.916.1');
    expect(PAPERCLIP_LAB_RELEASE_SHA).toBe('d554c4789ed3930f8a53ac9fdf6503b3187097da');
    expect(PAPERCLIP_LAB_IMAGE).toBe('ghcr.io/paperclipai/paperclip:2026.916.1');
    const compose = paperclipLabComposeYaml();
    expect(compose).toContain('127.0.0.1:3210:3100');
    expect(compose).toContain('ghcr.io/paperclipai/paperclip:2026.916.1');
    expect(compose).toContain('image: postgres:17-alpine');
    expect(compose).toMatch(/  db:[\s\S]*restart: unless-stopped/);
    expect(compose).toMatch(/  paperclip:[\s\S]*restart: unless-stopped/);
    expect(compose).toMatch(/  secrets-init:[\s\S]*restart: "no"/);
    expect(compose).toMatch(/  migrate:[\s\S]*restart: "no"/);
    expect(compose).toContain('DATABASE_URL: postgres://paperclip:paperclip@db:5432/paperclip');
    expect(compose).toContain('  migrate:');
    expect(compose).toContain('command: ["pnpm", "db:migrate"]');
    expect(compose).toContain('condition: service_healthy');
    expect(compose.match(/condition: service_completed_successfully/g)?.length).toBeGreaterThanOrEqual(2);
    expect(compose).toContain('paperclip-db:/var/lib/postgresql/data');
    expect(compose).toContain('paperclip-db:');
    expect(compose).toContain('  secrets-init:');
    expect(compose).toContain('command: ["sh", "-c", "chmod 0700 /secrets"]');
    expect(compose).toContain('paperclip-secrets:/secrets');
    expect(compose).toContain('condition: service_completed_successfully');
    expect(compose).toContain('paperclip-secrets:/paperclip/instances/default/secrets');
    expect(compose).toContain('paperclip-secrets:');
    expect(compose).not.toMatch(/:latest\b/);
    expect(compose).not.toContain('0.0.0.0:3210');
    expect(compose).not.toMatch(/- ["']?5432:5432/);
    expect(compose).not.toMatch(/127\.0\.0\.1:5432:5432/);
  });

  it('keeps permission-sensitive Paperclip secrets off the Windows bind mount without deleting lab data', () => {
    const compose = paperclipLabComposeYaml();
    expect(compose).toContain('      - ../data:/paperclip');
    expect(compose).toContain('  secrets-init:');
    expect(compose).toContain('command: ["sh", "-c", "chmod 0700 /secrets"]');
    expect(compose).toContain('      - paperclip-secrets:/secrets');
    expect(compose).toContain('      - paperclip-secrets:/paperclip/instances/default/secrets');
    expect(compose).toContain('        condition: service_completed_successfully');
    expect(compose).not.toContain('rm -rf');
    expect(compose).not.toContain('down -v');
  });

  it('aligns runtime identity with the continuous-service restart policy', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url), 'utf8');
    expect(source).toContain("String(info?.HostConfig?.RestartPolicy?.Name || '') === 'unless-stopped'");
    expect(source).not.toContain("String(info?.HostConfig?.RestartPolicy?.Name || '') === 'no'");
  });

  it('recovers DB and app after Docker or WSL daemon restart without reviving one-shot jobs', () => {
    const compose = paperclipLabComposeYaml();
    const db = compose.slice(compose.indexOf('  db:'), compose.indexOf('  secrets-init:'));
    const secrets = compose.slice(compose.indexOf('  secrets-init:'), compose.indexOf('  migrate:'));
    const migrate = compose.slice(compose.indexOf('  migrate:'), compose.indexOf('  paperclip:'));
    const app = compose.slice(compose.indexOf('  paperclip:'), compose.lastIndexOf('\nvolumes:'));
    expect(db).toContain('restart: unless-stopped');
    expect(app).toContain('restart: unless-stopped');
    expect(secrets).toContain('restart: "no"');
    expect(migrate).toContain('restart: "no"');
  });

  it('keeps PostgreSQL running when app start/install rollback is needed', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url), 'utf8');
    const rollbackStart = source.indexOf('async function rollbackContainer');
    const rollbackEnd = source.indexOf('async function install', rollbackStart);
    const rollback = source.slice(rollbackStart, rollbackEnd);
    expect(rollback).toContain("['stop', PAPERCLIP_LAB_CONTAINER]");
    expect(rollback).not.toContain("composeArgs(['stop'])");
    expect(source).toContain("const down = await runDocker(docker.kind, composeArgs(['stop'])");
  });

  it('uses an isolated PostgreSQL sidecar without deleting or exposing database data', () => {
    const compose = paperclipLabComposeYaml();
    expect(compose).toContain('  db:');
    expect(compose).toContain('POSTGRES_USER: paperclip');
    expect(compose).toContain('POSTGRES_DB: paperclip');
    expect(compose).toContain('pg_isready -U paperclip -d paperclip');
    expect(compose).toContain('DATABASE_URL: postgres://paperclip:paperclip@db:5432/paperclip');
    expect(compose).toContain('  migrate:');
    expect(compose).toContain('command: ["pnpm", "db:migrate"]');
    expect(compose).toMatch(/migrate:[\s\S]*condition: service_healthy[\s\S]*command: \["pnpm", "db:migrate"\]/);
    expect(compose).toMatch(/paperclip:[\s\S]*migrate:[\s\S]*condition: service_completed_successfully/);
    expect(compose).toContain('      - ../data:/paperclip');
    expect(compose).toContain('      - paperclip-db:/var/lib/postgresql/data');
    expect(compose).toContain('      - paperclip-secrets:/paperclip/instances/default/secrets');
    expect(compose).toContain('      - paperclip-secrets:/secrets');
    expect(compose).not.toContain('down -v');
    expect(compose).not.toContain('volume rm');
  });

  it('allows only the Paperclip Lab root and exact typed actions', () => {
    expect(resolvePaperclipLabPath('D:\\TigerIQ-Paperclip-Lab\\data')).toBe('D:\\TigerIQ-Paperclip-Lab\\data');
    expect(() => resolvePaperclipLabPath('D:\\TigerIQ\\State')).toThrow('TIGERIQ_PAPERCLIP_LAB_PATH_NOT_ALLOWED');
    expect(PAPERCLIP_LAB_ACTIONS).toEqual([
      'paperclip_lab_preflight',
      'paperclip_lab_broker_install',
      'paperclip_openai_device_auth_start',
      'paperclip_lab_install',
      'paperclip_lab_start',
      'paperclip_lab_stop',
      'paperclip_lab_health',
    ]);
    expect(assertPaperclipLabRequest({ action: 'paperclip_lab_health' })).toEqual({ action: 'paperclip_lab_health' });
    expect(assertPaperclipLabRequest({ action: 'paperclip_lab_broker_install' })).toEqual({ action: 'paperclip_lab_broker_install' });
    expect(assertPaperclipLabRequest({ action: 'paperclip_openai_device_auth_start', sessionId: 'd780f0ee-b44c-41e1-830a-4aada9a68ceb' })).toEqual({ action: 'paperclip_openai_device_auth_start', sessionId: 'd780f0ee-b44c-41e1-830a-4aada9a68ceb' });
    expect(() => assertPaperclipLabRequest({ action: 'paperclip_openai_device_auth_start', sessionId: 'bad' })).toThrow('TIGERIQ_PAPERCLIP_OPENAI_SESSION_INVALID');
    expect(() => assertPaperclipLabRequest({ action: 'paperclip_lab_health', port: 8795 })).toThrow('TIGERIQ_PAPERCLIP_LAB_ARGUMENT_NOT_ALLOWED');
    expect(() => assertPaperclipLabRequest({ action: 'shell_exec' })).toThrow('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
  });

  it('classifies health timeout causes before rollback and prioritizes the Postgres sidecar', () => {
    const database = { present: true, running: true, healthStatus: 'healthy' };
    expect(paperclipHealthFailureClass({ reason: 'PIN_NOT_READY' })).toBe('PIN_NOT_READY');
    expect(paperclipHealthFailureClass({ database: { present: false } })).toBe('DATABASE_NOT_PRESENT');
    expect(paperclipHealthFailureClass({ database: { present: true, running: false, logClass: 'DB_ADMIN_STOP' } })).toBe('DATABASE_NOT_RUNNING_DB_ADMIN_STOP');
    expect(paperclipHealthFailureClass({ database: { present: true, running: true, healthStatus: 'starting' } })).toBe('DATABASE_HEALTH_STARTING');
    expect(paperclipHealthFailureClass({ database, container: { running: false } })).toBe('CONTAINER_NOT_RUNNING');
    expect(paperclipHealthFailureClass({ database, container: { running: false, logClass: 'PERMISSION' } })).toBe('CONTAINER_NOT_RUNNING_PERMISSION');
    expect(paperclipHealthFailureClass({ database, container: { running: false, stateErrorClass: 'MOUNT' } })).toBe('CONTAINER_NOT_RUNNING_STATE_MOUNT');
    expect(paperclipHealthFailureClass({ database, container: { running: true, portBindingOk: false } })).toBe('PORT_BINDING_MISMATCH');
    expect(paperclipHealthFailureClass({ database, container: { running: true, portBindingOk: true, dataMountOk: false } })).toBe('DATA_MOUNT_MISMATCH');
    expect(paperclipHealthFailureClass({ database, container: { running: true, portBindingOk: true, dataMountOk: true }, port: { reachable: false } })).toBe('PORT_UNREACHABLE');
    expect(paperclipHealthFailureClass({ database, container: { running: true, portBindingOk: true, dataMountOk: true }, port: { reachable: true }, http: { reachable: false } })).toBe('HTTP_UNREACHABLE');
    expect(paperclipHealthFailureClass({ database, container: { running: true, portBindingOk: true, dataMountOk: true }, port: { reachable: true }, http: { reachable: true, status: 503, appOk: false } })).toBe('HTTP_503');
    expect(paperclipHealthFailureClass({ database, container: { running: true, portBindingOk: true, dataMountOk: true, identityOk: true }, port: { reachable: true }, http: { reachable: true, status: 200, appOk: false } })).toBe('HTTP_STATUS_NOT_OK');
  });

  it('returns only bounded redacted container log diagnostics while preserving relevant root-cause lines', () => {
    const secret = 'super-secret-value';
    const input = [
      ...Array.from({ length: 40 }, (_, i) => 'noise-before-' + i),
      'ERROR database connect postgres://paperclip:' + secret + '@db:5432/paperclip refused',
      'FATAL BETTER_AUTH_SECRET=' + secret + ' database startup failed',
      'Authorization: Bearer abc.def.ghi database auth failed',
      ...Array.from({ length: 80 }, (_, i) => 'noise-after-' + i),
    ].join('\n');
    const out = paperclipContainerLogDiagnostic(input);
    expect(out.fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(out.excerpt.length).toBeLessThanOrEqual(900);
    expect(out.excerpt).toContain('ERROR database connect');
    expect(out.excerpt).toContain('database startup failed');
    expect(out.excerpt).toContain('[REDACTED]');
    expect(out.excerpt).not.toContain(secret);
    expect(out.excerpt).not.toContain('abc.def.ghi');
    expect(out.excerpt).not.toContain('noise-before-0');
    expect(out).toEqual(paperclipContainerLogDiagnostic(input));
  });

  it('preserves the DB_MIGRATION trigger in a bounded diagnostic even when later noise exceeds the cap', () => {
    const trigger = 'ERROR migration failed while applying pending migrations to stale schema';
    const input = [
      ...Array.from({ length: 20 }, (_, i) => 'noise-before-' + i),
      trigger,
      ...Array.from({ length: 40 }, (_, i) => 'ERROR database generic tail line ' + i + ' '.repeat(30)),
      'message=Failed query: select many columns from heartbeat_runs inner join agents',
      'generic database shutdown error tail',
    ].join('\n');
    expect(paperclipContainerLogClass(input)).toBe('DB_MIGRATION');
    const out = paperclipContainerLogDiagnostic(input);
    expect(out.excerpt.length).toBeLessThanOrEqual(900);
    expect(out.excerpt).toContain('migration failed');
    expect(out.excerpt).toContain('pending migrations');
    expect(out.excerpt).toContain('stale schema');
    expect(out).toEqual(paperclipContainerLogDiagnostic(input));
  });

  it('preserves the DB_CONNECTION trigger when a long failed-query tail would otherwise hide it', () => {
    const trigger = 'cause=ECONNREFUSED database connection failed to db:5432';
    const input = [
      ...Array.from({ length: 20 }, (_, i) => 'noise-before-' + i),
      trigger,
      ...Array.from({ length: 40 }, (_, i) => 'ERROR database generic tail line ' + i + ' '.repeat(30)),
      'message=Failed query: select id, endpoint_id, event_kind from chat_deliveries where state = $1',
      'generic database shutdown error tail',
    ].join('\n');
    expect(paperclipContainerLogClass(input)).toBe('DB_CONNECTION');
    const out = paperclipContainerLogDiagnostic(input);
    expect(out.excerpt.length).toBeLessThanOrEqual(900);
    expect(out.excerpt).toContain('ECONNREFUSED');
    expect(out.excerpt).toContain('database connection failed');
    expect(out).toEqual(paperclipContainerLogDiagnostic(input));
  });

  it('prioritizes structured nested DB error fields over long SQL query tails', () => {
    const line = JSON.stringify({
      level: 50,
      err: {
        type: 'DrizzleQueryError',
        message: 'Failed query: select many columns from heartbeat_runs inner join agents',
        cause: {
          severity: 'ERROR',
          code: '42703',
          message: 'column agents.runtime_state does not exist',
          detail: 'database password=secret-value',
          hint: 'Apply the pending migration',
        },
      },
      msg: 'query failed',
    });
    const out = paperclipContainerLogDiagnostic([
      line,
      'select a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z from heartbeat_runs inner join agents on heartbeat_runs.agent_id = agents.id',
    ].join('\n'));
    expect(out.excerpt).toContain('code=42703');
    expect(out.excerpt).toContain('message=column agents.runtime_state does not exist');
    expect(out.excerpt).toContain('hint=Apply the pending migration');
    expect(out.excerpt).toContain('[REDACTED]');
    expect(out.excerpt).not.toContain('secret-value');
    expect(out.excerpt.length).toBeLessThanOrEqual(900);
  });

  it('parses Docker Compose ps JSON for an exited Postgres sidecar', () => {
    const rows = parsePaperclipComposePsRows(JSON.stringify([{
      ID: 'abc123',
      Service: 'db',
      State: 'exited',
      Health: '',
      ExitCode: 137,
    }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].Service).toBe('db');
    expect(rows[0].State).toBe('exited');
    expect(rows[0].ExitCode).toBe(137);
  });

  it('includes bounded PostgreSQL sidecar diagnostics in typed health source', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url), 'utf8');
    expect(source).toContain("composeArgs(['ps', '--all', '--format', 'json', 'db'])");
    expect(source).toContain("composeArgs(['logs', '--no-color', '--tail', '120', 'db'])");
    expect(source).toContain("inspectComposeService(docker.kind, 'db', signal, options?.diagnostics === true)");
    expect(source).toContain('healthStatus: database?.healthStatus || null');
    expect(source).toContain('const databaseReady = databaseState.present === true');
    expect(source).toContain("String(databaseState.healthStatus || '').toLowerCase() === 'healthy'");
    expect(source).toContain('ok: databaseReady && port.reachable && http.appOk === true && identityOk');
    expect(source).toContain('restartCount: database?.restartCount ?? null');
    expect(source).toContain('logFingerprint: database?.logFingerprint || null');
    expect(source).toContain('logExcerpt: database?.logExcerpt || null');
  });

  it('classifies bounded container logs without exposing raw log text', () => {
    expect(paperclipContainerLogClass('Error: EACCES permission denied /paperclip')).toBe('PERMISSION');
    expect(paperclipContainerLogClass('Decision signing secrets directory at /paperclip/instances/default/secrets must have permissions 0700')).toBe('PERMISSION');
    expect(paperclipContainerLogClass('BETTER_AUTH_SECRET must be set')).toBe('CONFIG');
    expect(paperclipContainerLogClass('could not create shared memory segment')).toBe('DB_SHARED_MEMORY');
    expect(paperclipContainerLogClass('data directory has invalid permissions; Permissions should be u=rwx (0700)')).toBe('DB_DATA_PERMISSIONS');
    expect(paperclipContainerLogClass('data directory belongs to another instance')).toBe('DB_DATA_DIR_MISMATCH');
    expect(paperclipContainerLogClass('database files are incompatible with server; initialized by PostgreSQL version 17')).toBe('DB_VERSION_MISMATCH');
    expect(paperclipContainerLogClass('could not write file: No space left on device')).toBe('DB_STORAGE');
    expect(paperclipContainerLogClass('invalid locale setting; collation failed')).toBe('DB_LOCALE');
    expect(paperclipContainerLogClass('password authentication failed for user paperclip')).toBe('DB_AUTH');
    expect(paperclipContainerLogClass('Failed to initialize embedded PostgreSQL cluster')).toBe('DB_INIT');
    expect(paperclipContainerLogClass('Failed to start embedded PostgreSQL on port 54329')).toBe('DB_START');
    expect(paperclipContainerLogClass('PostgreSQL error 42703: column agents.runtime_state does not exist')).toBe('DB_SCHEMA_MISSING');
    expect(paperclipContainerLogClass('PostgreSQL error 42P01: relation heartbeat_runs does not exist')).toBe('DB_SCHEMA_MISSING');
    expect(paperclipContainerLogClass('Embedded PostgreSQL has pending migrations; refusing stale schema')).toBe('DB_MIGRATION');
    expect(paperclipContainerLogClass('DrizzleQueryError: migration failed while applying schema')).toBe('DB_MIGRATION');
    expect(paperclipContainerLogClass('drizzle query select * from heartbeat_runs')).not.toBe('DB_MIGRATION');
    expect(paperclipContainerLogClass('drizzle query select agents.error_reason, agents.last_heartbeat_at from heartbeat_runs inner join agents on heartbeat_runs.agent_id = agents.id')).not.toBe('DB_MIGRATION');
    expect(paperclipContainerLogClass('database connection refused')).toBe('DB_CONNECTION');
    expect(paperclipContainerLogClass('FATAL: terminating connection due to administrator command')).toBe('DB_ADMIN_STOP');
    expect(paperclipContainerLogClass('received fast shutdown request')).toBe('DB_ADMIN_STOP');
    expect(paperclipContainerLogClass('database checksum failed: corrupt page')).toBe('DB_CORRUPT');
    expect(paperclipContainerLogClass('database startup failed')).toBe('DATABASE');
    expect(paperclipContainerLogClass('EADDRINUSE address already in use')).toBe('PORT_CONFLICT');
    expect(paperclipContainerLogClass('heap out of memory')).toBe('OOM');
    expect(paperclipContainerLogClass('Cannot find module x')).toBe('ENTRYPOINT_OR_FILE');
    expect(paperclipContainerLogClass('fatal: startup failed')).toBe('APP_ERROR');
    expect(paperclipContainerLogClass('')).toBe('NO_LOGS');
    expect(paperclipContainerLogClass('normal startup banner')).toBe('UNCLASSIFIED');
  });

  it('uses only the fixed Ubuntu WSL Docker transport and lab-root path translation', () => {
    expect(PAPERCLIP_LAB_WSL_DISTRO).toBe('Ubuntu');
    expect(PAPERCLIP_LAB_WSL_ROOT).toBe('/mnt/d/TigerIQ-Paperclip-Lab');
    expect(paperclipLabWslPath('D:\\TigerIQ-Paperclip-Lab\\config\\docker-compose.lab.yml'))
      .toBe('/mnt/d/TigerIQ-Paperclip-Lab/config/docker-compose.lab.yml');
    expect(paperclipLabWslDockerArgs([
      'compose',
      '-f',
      'D:\\TigerIQ-Paperclip-Lab\\config\\docker-compose.lab.yml',
      'up',
      '-d',
    ])).toEqual([
      '--distribution',
      'Ubuntu',
      '--exec',
      'docker',
      'compose',
      '-f',
      '/mnt/d/TigerIQ-Paperclip-Lab/config/docker-compose.lab.yml',
      'up',
      '-d',
    ]);
    expect(() => paperclipLabWslPath('D:\\TigerIQ\\State')).toThrow('TIGERIQ_PAPERCLIP_LAB_PATH_NOT_ALLOWED');
    expect(() => paperclipLabWslDockerArgs(['compose', '-f', 'C:\\Temp\\evil.yml', 'up']))
      .toThrow('TIGERIQ_PAPERCLIP_LAB_DOCKER_PATH_NOT_ALLOWED');
  });

  it('maps broker requests only from exact fixed Paperclip Docker argv', () => {
    expect(paperclipLabBrokerOperationForDockerArgs(['version', '--format', '{{.Server.Version}}'])).toBe('version');
    expect(paperclipLabBrokerOperationForDockerArgs(['pull', PAPERCLIP_LAB_IMAGE])).toBe('pull_pinned_image');
    expect(paperclipLabBrokerOperationForDockerArgs([
      'compose', '-f', 'D:\\TigerIQ-Paperclip-Lab\\config\\docker-compose.lab.yml', 'up', '-d',
    ])).toBe('compose_up');
    expect(paperclipLabBrokerOperationForDockerArgs([
      'compose', '-f', 'D:\\TigerIQ-Paperclip-Lab\\config\\docker-compose.lab.yml', 'stop',
    ])).toBe('compose_stop');
    expect(paperclipLabBrokerOperationForDockerArgs([
      'compose', '-f', 'D:\\TigerIQ-Paperclip-Lab\\config\\docker-compose.lab.yml', 'ps', '--all', '--format', 'json', 'db',
    ])).toBe('compose_ps_all_db_json');
    expect(paperclipLabBrokerOperationForDockerArgs([
      'compose', '-f', 'D:\\TigerIQ-Paperclip-Lab\\config\\docker-compose.lab.yml', 'logs', '--no-color', '--tail', '120', 'db',
    ])).toBe('compose_db_logs_tail');
    expect(paperclipLabBrokerOperationForDockerArgs(['stop', 'tigeriq-paperclip-lab'])).toBe('stop_container');
    expect(paperclipLabBrokerOperationForDockerArgs(['logs', '--tail', '160', 'tigeriq-paperclip-lab'])).toBe('container_logs_tail');
    expect(paperclipLabBrokerOperationForDockerArgs(['ps'])).toBeNull();
    expect(paperclipLabBrokerOperationForDockerArgs(['compose', '-f', 'C:\\Temp\\evil.yml', 'up', '-d'])).toBeNull();
  });

  it('keeps the interactive WSL broker fixed to Ubuntu and exact operation allowlist', async () => {
    const broker = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-wsl-broker.ps1', import.meta.url), 'utf8');
    const installer = await readFile(new URL('../apps/openclaw-tigeriq-runtime/Install-PaperclipWslBroker.ps1', import.meta.url), 'utf8');
    expect(broker).toContain("$Distro = 'Ubuntu'");
    expect(broker).toContain("$LabRoot = 'D:\\TigerIQ-Paperclip-Lab'");
    expect(broker).toContain("'pull_pinned_image'");
    expect(broker).toContain("TimeoutSec=1200; IdleTimeoutSec=300");
    expect(broker).toContain("$timeoutKind = 'idle'");
    expect(broker).toContain("$timeoutKind = 'total'");
    expect(broker).toContain('function Write-BrokerHeartbeat');
    expect(broker).toContain('function Start-WslKeepalive');
    expect(broker).toContain('function Test-WslKeepaliveRunning');
    expect(broker).toContain("$KeepaliveExecutable = '/usr/bin/sleep'");
    expect(broker).toContain("$KeepaliveArgument = 'infinity'");
    expect(broker).toContain('wslKeepaliveRunning=[bool]$keepaliveRunning');
    expect(broker).toContain('wslKeepalivePid=if($keepaliveRunning)');
    expect((broker.match(/Write-BrokerHeartbeat/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(broker).toContain("'inspect_revision'");
    expect(broker).toContain("'inspect_repo_digests'");
    expect(broker).toContain("'compose_up'");
    expect(broker).toContain("'compose_stop'");
    expect(broker).toContain("'compose_ps_all_db_json'");
    expect(broker).toContain("'compose_db_logs_tail'");
    expect(broker).toContain("$BrokerVersion = '1.6-wsl-keepalive'");
    expect(broker).toContain("'stop_container'");
    expect(broker).toContain("'inspect_container'");
    expect(broker).toContain("'container_logs_tail'");
    expect(broker).toContain("'docker','logs','--tail','160',$Container");
    expect(broker).not.toContain('$Request.args');
    expect(broker).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|TIGERIQ_GITHUB_TOKEN|DATABASE_URL/);
    expect(installer).toContain("New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited");
    expect(installer).toContain("$TaskName='TigerIQ Paperclip WSL Broker'");
    expect(installer).toContain("$ExpectedBrokerVersion='1.6-wsl-keepalive'");
    expect(installer).toContain("[bool]$h.wslKeepaliveRunning -eq $true");
    expect(installer).toContain("[int]$h.wslKeepalivePid -gt 0");
    expect(installer).toContain("$ExpectedBrokerVersion='1.6-wsl-keepalive'");
    expect(installer).toContain('Stop-ScheduledTask -TaskName $TaskName');
    expect(installer).toContain('Remove-Item -LiteralPath $Heartbeat -Force');
    expect(installer).toContain("[string]$h.version -eq $ExpectedBrokerVersion");
    expect(installer).toContain("$heartbeatAt -ge $InstallStartedAt");
    expect(installer).not.toMatch(/Password|Credential|RunLevel Highest/);
  });

  it('classifies Docker pull failures without exposing raw registry output', () => {
    expect(paperclipDockerFailureClass({ timedOut: true, timeoutKind: 'idle', exitCode: -1, stderr: 'secret detail' })).toBe('IDLE_TIMEOUT');
    expect(paperclipDockerFailureClass({ timedOut: true, timeoutKind: 'total', exitCode: -1, stderr: 'secret detail' })).toBe('TOTAL_TIMEOUT');
    expect(paperclipDockerFailureClass({ timedOut: true, exitCode: -1, stderr: 'secret detail' })).toBe('TIMEOUT');
    expect(paperclipDockerFailureClass({ exitCode: 1, stderr: 'unauthorized: authentication required' })).toBe('AUTH');
    expect(paperclipDockerFailureClass({ exitCode: 1, stderr: 'manifest unknown: manifest not found' })).toBe('IMAGE_NOT_FOUND');
    expect(paperclipDockerFailureClass({ exitCode: 1, stderr: 'dial tcp: network is unreachable' })).toBe('NETWORK');
    expect(paperclipDockerFailureClass({ exitCode: 125, stderr: 'opaque provider text' })).toBe('EXIT_125');
  });

  it('classifies Paperclip OpenAI device auth failures without exposing raw output', () => {
    expect(paperclipOpenAiDeviceAuthFailureClass('TIGERIQ_PAPERCLIP_OPENAI_SESSION_NOT_FOUND', false)).toBe('SESSION_NOT_FOUND');
    expect(paperclipOpenAiDeviceAuthFailureClass('TIGERIQ_PAPERCLIP_OPENAI_DEVICE_AUTH_EARLY_EXIT', false)).toBe('CODEX_EARLY_EXIT');
    expect(paperclipOpenAiDeviceAuthFailureClass('TIGERIQ_PAPERCLIP_OPENAI_DEVICE_AUTH_PROMPT_TIMEOUT', false)).toBe('PROMPT_TIMEOUT');
    expect(paperclipOpenAiDeviceAuthFailureClass('unclassified provider output SECRET_VALUE', false)).toBe('BROKER_EXECUTION_FAILED');
    expect(paperclipOpenAiDeviceAuthFailureClass('', true)).toBe('BROKER_TIMEOUT');
  });

  it('pins immutable image refs and rejects mutable/foreign refs', () => {
    const digest = 'ghcr.io/paperclipai/paperclip@sha256:' + 'a'.repeat(64);
    expect(paperclipLabComposeYaml(digest)).toContain(`image: ${digest}`);
    expect(() => paperclipLabComposeYaml('ghcr.io/paperclipai/paperclip:latest')).toThrow('TIGERIQ_PAPERCLIP_LAB_IMAGE_REF_INVALID');
    expect(() => paperclipLabComposeYaml('ghcr.io/example/other@sha256:' + 'a'.repeat(64))).toThrow('TIGERIQ_PAPERCLIP_LAB_IMAGE_REF_INVALID');
  });

  it('rejects stale or credential-bearing Paperclip env files', () => {
    const safe = [
      'HOST=0.0.0.0',
      'PAPERCLIP_HOME=/paperclip',
      'PAPERCLIP_DEPLOYMENT_MODE=authenticated',
      'PAPERCLIP_DEPLOYMENT_EXPOSURE=private',
      'PAPERCLIP_PUBLIC_URL=http://localhost:3210',
      'PAPERCLIP_ALLOWED_HOSTNAMES=localhost,127.0.0.1',
      'BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3210',
      'BETTER_AUTH_SECRET=' + 'a'.repeat(64),
      'PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=' + 'b'.repeat(64),
      'OPENAI_API_KEY=',
      'ANTHROPIC_API_KEY=',
      '',
    ].join('\n');
    expect(validatePaperclipLabEnvText(safe)).toBe(true);
    expect(() => validatePaperclipLabEnvText(safe.replace('OPENAI_API_KEY=', 'OPENAI_API_KEY=not-allowed'))).toThrow('TIGERIQ_PAPERCLIP_LAB_ENV_UNSAFE');
    expect(() => validatePaperclipLabEnvText(safe + 'TIGERIQ_TOKEN=x\n')).toThrow('TIGERIQ_PAPERCLIP_LAB_ENV_NOT_ALLOWLISTED');
  });

  it('upgrades the legacy Paperclip env with the exact browser origin without rotating secrets', () => {
    const legacy = [
      'HOST=0.0.0.0',
      'PAPERCLIP_HOME=/paperclip',
      'PAPERCLIP_DEPLOYMENT_MODE=authenticated',
      'PAPERCLIP_DEPLOYMENT_EXPOSURE=private',
      'PAPERCLIP_PUBLIC_URL=http://localhost:3210',
      'PAPERCLIP_ALLOWED_HOSTNAMES=localhost,127.0.0.1',
      'BETTER_AUTH_SECRET=' + 'a'.repeat(64),
      'PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=' + 'b'.repeat(64),
      'OPENAI_API_KEY=',
      'ANTHROPIC_API_KEY=',
      '',
    ].join('\n');
    const upgraded = upgradeLegacyPaperclipLabEnvText(legacy);
    expect(upgraded).toContain('BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3210');
    expect(upgraded).toContain('BETTER_AUTH_SECRET=' + 'a'.repeat(64));
    expect(upgraded).toContain('PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=' + 'b'.repeat(64));
    expect(validatePaperclipLabEnvText(upgraded)).toBe(true);
    expect(upgradeLegacyPaperclipLabEnvText(upgraded)).toBeNull();
  });

  it('ships the Paperclip module in the packaged OpenClaw plugin', async () => {
    const pkg = JSON.parse(await readFile(new URL('../apps/openclaw-tigeriq-runtime/package.json', import.meta.url), 'utf8'));
    expect(pkg.files).toContain('paperclip-lab.mjs');
    expect(pkg.files).toContain('paperclip-wsl-broker.ps1');
    expect(pkg.files).toContain('Install-PaperclipWslBroker.ps1');
  });

  it('keeps the implementation fail-closed against shell/path escapes and false health', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url), 'utf8');
    expect(source).toContain('runtimeRevision: PAPERCLIP_LAB_RUNTIME_REVISION');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_SYMLINK_BLOCKED');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_REALPATH_ESCAPE_BLOCKED');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_IMAGE_REVISION_MISMATCH');
    expect(source).toContain("wsl.exe");
    expect(source).toContain("'--distribution', PAPERCLIP_LAB_WSL_DISTRO, '--exec', 'docker'");
    expect(source).toContain('wsl-ubuntu-interactive-broker');
    expect(source).toContain("BROKER_EXPECTED_VERSION = '1.6-wsl-keepalive'");
    expect(source).toContain("String(heartbeat?.version || '') === BROKER_EXPECTED_VERSION");
    expect(source).toContain("heartbeat?.wslKeepaliveRunning === true");
    expect(source).toContain("Number(heartbeat?.wslKeepalivePid || 0) > 0");
    expect(source).toContain("$KeepaliveExecutable = '/usr/bin/sleep'");
    expect(source).toContain("$KeepaliveArgument = 'infinity'");
    expect(source).toContain("paperclip_lab_broker_install");
    expect(source).toContain("TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_SOURCE_INVALID");
    expect(source).toContain("C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe");
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_BROKER_DOCKER_ARGS_NOT_ALLOWED');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_DOCKER_PATH_NOT_ALLOWED');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_PULL_FAILED_${paperclipDockerFailureClass(pull)}');
    expect(source).toContain('PAPERCLIP_LAB_PULL_TIMEOUT_MS = 1200000');
    expect(source).toContain('PAPERCLIP_LAB_HEALTH_READY_TIMEOUT_MS = 90000');
    expect(source).toContain('PAPERCLIP_LAB_HEALTH_POLL_MS = 1500');
    expect(source).toContain('const deadline = Date.now() + PAPERCLIP_LAB_HEALTH_READY_TIMEOUT_MS');
    expect(source).toContain('await sleepWithSignal(PAPERCLIP_LAB_HEALTH_POLL_MS, signal)');
    expect(source).toContain('PAPERCLIP_LAB_BROKER_MAX_WAIT_MS = 1210000');
    expect(source).toContain("timeoutMs: PAPERCLIP_LAB_PULL_TIMEOUT_MS");
    expect(source).toContain('timeoutKind: response?.timeoutKind || null');
    expect(source).toContain('imageDigest');
    expect(source).toContain('/api/health');
    expect(source).toContain('identityOk');
    expect(source).toContain('portBindingOk');
    expect(source).toContain('dataMountOk');
    expect(source).toContain('rollbackContainer');
    expect(source).toContain("runDocker(resolved, ['stop', PAPERCLIP_LAB_CONTAINER]");
    expect(source).toContain("composeArgs(['stop'])");
    expect(source).toContain("info?.State?.Running !== true || http?.reachable !== true || http?.appOk !== true");
    expect(source).toContain("['logs', '--tail', '160', PAPERCLIP_LAB_CONTAINER]");
    expect(source).toContain('paperclipContainerLogClass');
    expect(source).toContain('state.result = {');
    expect(source).toContain('healthFailureClass: paperclipHealthFailureClass(state)');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_ABORTED');
    expect(source).not.toMatch(/shell_exec|cmd\.exe/i);
    expect((source.match(/WindowsPowerShell\\\\v1\.0\\\\powershell\.exe/g) ?? []).length).toBe(1);
  });
});


describe('TigerIQ Live #3150 typed Vercel production deploy', () => {
  const sha='a'.repeat(40);
  const valid={
    projectLink:{projectId:EXPECTED_PROJECT_ID,orgId:EXPECTED_TEAM_ID},
    expectedSha:sha,
    actualSha:sha,
    branch:EXPECTED_BRANCH,
    remote:'https://github.com/'+EXPECTED_REPO+'.git',
    config:{git:{deploymentEnabled:false}},
    issue:AUTHORIZED_ISSUE,
    uiHtml:'<div>JOB TRỌNG TÂM</div>',
  };

  it('accepts only an exact 40-hex deployment SHA', () => {
    expect(assertTigerIQLive3150DeployRequest({expectedSha:sha})).toEqual({expectedSha:sha});
    expect(() => assertTigerIQLive3150DeployRequest({expectedSha:'abc'})).toThrow('TIGERIQ_VERCEL_EXPECTED_SHA_INVALID');
    expect(() => assertTigerIQLive3150DeployRequest({expectedSha:'g'.repeat(40)})).toThrow('TIGERIQ_VERCEL_EXPECTED_SHA_INVALID');
  });

  it('hard-locks project/team/repo/main/SHA/owner scope and UI marker', () => {
    expect(validateReleaseContract(valid)).toMatchObject({
      projectId:EXPECTED_PROJECT_ID,
      teamId:EXPECTED_TEAM_ID,
      repo:EXPECTED_REPO,
      branch:'main',
      target:'production',
      exactSha:sha,
      issue:'3185',
      maxAttempts:1,
    });
    expect(() => validateReleaseContract({...valid,projectLink:{projectId:'prj_wrong',orgId:EXPECTED_TEAM_ID}})).toThrow('VERCEL_PROJECT_SCOPE_MISMATCH');
    expect(() => validateReleaseContract({...valid,expectedSha:'b'.repeat(40)})).toThrow('VERCEL_EXACT_SHA_MISMATCH');
    expect(() => validateReleaseContract({...valid,branch:'feature/unsafe'})).toThrow('VERCEL_GIT_BRANCH_MISMATCH');
    expect(() => validateReleaseContract({...valid,remote:'https://github.com/newsdayads/other.git'})).toThrow('VERCEL_GIT_REPO_MISMATCH');
    expect(() => validateReleaseContract({...valid,config:{git:{deploymentEnabled:true}}})).toThrow('VERCEL_AUTO_DEPLOY_POLICY_MISMATCH');
    expect(() => validateReleaseContract({...valid,issue:'999'})).toThrow('VERCEL_OWNER_AUTH_SCOPE_MISMATCH');
    expect(() => validateReleaseContract({...valid,uiHtml:'no marker'})).toThrow('VERCEL_UI_MARKER_MISSING');
  });

  it('keeps deployment one-shot, typed, and outside arbitrary shell allowlist', async () => {
    const operatorSource=await readFile(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs',import.meta.url),'utf8');
    const deploySource=await readFile(new URL('../scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs',import.meta.url),'utf8');
    expect(operatorSource).toContain("action === 'tigeriq_live_3150_production_deploy'");
    expect(operatorSource).toContain("scripts\\\\pc-worker\\\\vercel-tigeriq-live-3150-deploy.mjs");
    expect(operatorSource).toContain("'--issue', '3185'");
    expect(operatorSource).toContain("extraEnvKeys: ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']");
    expect(operatorSource).toContain("productionMutationScope: action === 'tigeriq_live_3150_production_deploy'");
    expect(operatorSource).not.toContain("input?.command");
    expect(() => assertShellCommandAllowed('vercel deploy --prod')).toThrow('TIGERIQ_PC_COMMAND_NOT_ALLOWLISTED');

    expect(deploySource).toContain("AUTHORIZED_ISSUE = '3185'");
    expect(deploySource).toContain("EXPECTED_PROJECT_ID = 'prj_gg7AuV6y62TALzEpby8XUAFisLKw'");
    expect(deploySource).toContain("EXPECTED_TEAM_ID = 'team_K8HIG7zmwu0ZjCINX1VhlGiT'");
    expect(deploySource).toContain("EXPECTED_REPO = 'newsdayads/tigeriq-ai-lab'");
    expect(deploySource).toContain("EXPECTED_BRANCH = 'main'");
    expect(deploySource).toContain("REQUIRED_UI_MARKER = 'JOB TRỌNG TÂM'");
    expect((deploySource.match(/vercel\.cmd deploy --prod --yes/g)||[]).length).toBe(1);
    expect(deploySource).not.toContain('VERCEL_TOKEN');
    expect(deploySource).not.toContain('retry');
  });

  it('classifies bounded deploy failures without leaking raw output', () => {
    expect(classifyDeployFailure('Deployment rate limited')).toBe('VERCEL_RATE_LIMIT_WAIT');
    expect(classifyDeployFailure('Please log in to Vercel')).toBe('VERCEL_AUTH_REQUIRED');
    expect(classifyDeployFailure('vercel is not recognized')).toBe('VERCEL_CLI_MISSING');
    expect(classifyDeployFailure('unexpected failure')).toBe('VERCEL_DEPLOY_FAILED');
  });
});
