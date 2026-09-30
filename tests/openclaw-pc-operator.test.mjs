import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  assertShellCommandAllowed,
  assertTigerIQTaskName,
  assertWritePathAllowed,
  resolveOperatorPath,
} from '../apps/openclaw-tigeriq-runtime/operator.mjs';
import { PAD_UI_ACTIONS, assertPadUiRequest, parsePadBrokerJson } from '../apps/openclaw-tigeriq-runtime/pad-ui.mjs';
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
  paperclipLabBrokerOperationForDockerArgs,
  paperclipLabComposeYaml,
  paperclipLabWslDockerArgs,
  paperclipLabWslPath,
  resolvePaperclipLabPath,
  validatePaperclipLabEnvText,
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
});


describe('Power Automate Desktop guarded UI contract', () => {
  it('accepts Windows PowerShell UTF-8 BOM on broker JSON files', () => {
    expect(parsePadBrokerJson('\uFEFF{"available":true}')).toEqual({ available: true });
  });

  it('exposes only the bounded PAD action set', () => {
    expect(PAD_UI_ACTIONS).toEqual([
      'pad_health', 'pad_launch', 'pad_windows', 'pad_tree',
      'pad_invoke', 'pad_set_value', 'pad_click', 'pad_keys',
    ]);
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
    expect(PAPERCLIP_LAB_RUNTIME_REVISION).toBe('20260930_DB_CONNECTION_DIAGNOSTIC_1');
    expect(PAPERCLIP_LAB_RELEASE).toBe('v2026.916.1');
    expect(PAPERCLIP_LAB_RELEASE_SHA).toBe('d554c4789ed3930f8a53ac9fdf6503b3187097da');
    expect(PAPERCLIP_LAB_IMAGE).toBe('ghcr.io/paperclipai/paperclip:2026.916.1');
    const compose = paperclipLabComposeYaml();
    expect(compose).toContain('127.0.0.1:3210:3100');
    expect(compose).toContain('ghcr.io/paperclipai/paperclip:2026.916.1');
    expect(compose).toContain('image: postgres:17-alpine');
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
      'paperclip_lab_install',
      'paperclip_lab_start',
      'paperclip_lab_stop',
      'paperclip_lab_health',
    ]);
    expect(assertPaperclipLabRequest({ action: 'paperclip_lab_health' })).toEqual({ action: 'paperclip_lab_health' });
    expect(assertPaperclipLabRequest({ action: 'paperclip_lab_broker_install' })).toEqual({ action: 'paperclip_lab_broker_install' });
    expect(() => assertPaperclipLabRequest({ action: 'paperclip_lab_health', port: 8795 })).toThrow('TIGERIQ_PAPERCLIP_LAB_ARGUMENT_NOT_ALLOWED');
    expect(() => assertPaperclipLabRequest({ action: 'shell_exec' })).toThrow('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
  });

  it('classifies health timeout causes before rollback', () => {
    expect(paperclipHealthFailureClass({ reason: 'PIN_NOT_READY' })).toBe('PIN_NOT_READY');
    expect(paperclipHealthFailureClass({ container: { running: false } })).toBe('CONTAINER_NOT_RUNNING');
    expect(paperclipHealthFailureClass({ container: { running: false, logClass: 'PERMISSION' } })).toBe('CONTAINER_NOT_RUNNING_PERMISSION');
    expect(paperclipHealthFailureClass({ container: { running: false, stateErrorClass: 'MOUNT' } })).toBe('CONTAINER_NOT_RUNNING_STATE_MOUNT');
    expect(paperclipHealthFailureClass({ container: { running: true, portBindingOk: false } })).toBe('PORT_BINDING_MISMATCH');
    expect(paperclipHealthFailureClass({ container: { running: true, portBindingOk: true, dataMountOk: false } })).toBe('DATA_MOUNT_MISMATCH');
    expect(paperclipHealthFailureClass({ container: { running: true, portBindingOk: true, dataMountOk: true }, port: { reachable: false } })).toBe('PORT_UNREACHABLE');
    expect(paperclipHealthFailureClass({ container: { running: true, portBindingOk: true, dataMountOk: true }, port: { reachable: true }, http: { reachable: false } })).toBe('HTTP_UNREACHABLE');
    expect(paperclipHealthFailureClass({ container: { running: true, portBindingOk: true, dataMountOk: true }, port: { reachable: true }, http: { reachable: true, status: 503, appOk: false } })).toBe('HTTP_503');
    expect(paperclipHealthFailureClass({ container: { running: true, portBindingOk: true, dataMountOk: true, identityOk: true }, port: { reachable: true }, http: { reachable: true, status: 200, appOk: false } })).toBe('HTTP_STATUS_NOT_OK');
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
    expect(paperclipLabBrokerOperationForDockerArgs(['stop', 'tigeriq-paperclip-lab'])).toBe('stop_container');
    expect(paperclipLabBrokerOperationForDockerArgs(['logs', '--tail', '160', 'tigeriq-paperclip-lab'])).toBe('container_logs_tail');
    expect(paperclipLabBrokerOperationForDockerArgs(['ps'])).toBeNull();
    expect(paperclipLabBrokerOperationForDockerArgs(['compose', '-f', 'C:\\Temp\\evil.yml', 'up', '-d'])).toBeNull();
  });

  it('keeps the interactive WSL broker fixed to Ubuntu and exact operation allowlist', async () => {
    const broker = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-wsl-broker.ps1', import.meta.url), 'utf8');
    const installer = await readFile(new URL('../apps/openclaw-tigeriq-runtime/Install-PaperclipWslBroker.ps1', import.meta.url), 'utf8');
    expect(broker).toContain("$Distro = 'Ubuntu'");
    expect(broker).toContain("$BrokerVersion = '1.4-postgres-sidecar'");
    expect(broker).toContain("$LabRoot = 'D:\\TigerIQ-Paperclip-Lab'");
    expect(broker).toContain("'pull_pinned_image'");
    expect(broker).toContain("TimeoutSec=1200; IdleTimeoutSec=300");
    expect(broker).toContain("$timeoutKind = 'idle'");
    expect(broker).toContain("$timeoutKind = 'total'");
    expect(broker).toContain('function Write-BrokerHeartbeat');
    expect((broker.match(/Write-BrokerHeartbeat/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(broker).toContain("'inspect_revision'");
    expect(broker).toContain("'inspect_repo_digests'");
    expect(broker).toContain("'compose_up'");
    expect(broker).toContain("'compose_stop'");
    expect(broker).toContain("'stop_container'");
    expect(broker).toContain("'inspect_container'");
    expect(broker).toContain("'container_logs_tail'");
    expect(broker).toContain("'docker','logs','--tail','160',$Container");
    expect(broker).not.toContain('$Request.args');
    expect(broker).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|TIGERIQ_GITHUB_TOKEN|DATABASE_URL/);
    expect(installer).toContain("New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited");
    expect(installer).toContain("$TaskName='TigerIQ Paperclip WSL Broker'");
    expect(installer).toContain("$ExpectedBrokerVersion='1.4-postgres-sidecar'");
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
    expect(source).toContain("BROKER_EXPECTED_VERSION = '1.4-postgres-sidecar'");
    expect(source).toContain("String(heartbeat?.version || '') === BROKER_EXPECTED_VERSION");
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
    expect(source).toContain("composeArgs(['stop'])");
    expect(source).toContain("['logs', '--tail', '160', PAPERCLIP_LAB_CONTAINER]");
    expect(source).toContain('paperclipContainerLogClass');
    expect(source).toContain('state.result = {');
    expect(source).toContain('healthFailureClass: paperclipHealthFailureClass(state)');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_ABORTED');
    expect(source).not.toMatch(/shell_exec|cmd\.exe/i);
    expect((source.match(/WindowsPowerShell\\\\v1\.0\\\\powershell\.exe/g) ?? []).length).toBe(1);
  });
});
