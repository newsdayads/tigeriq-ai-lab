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
  PAPERCLIP_LAB_RELEASE,
  PAPERCLIP_LAB_RELEASE_SHA,
  PAPERCLIP_LAB_ROOT,
  PAPERCLIP_LAB_WSL_DISTRO,
  PAPERCLIP_LAB_WSL_ROOT,
  assertPaperclipLabRequest,
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
    expect(PAPERCLIP_LAB_RELEASE).toBe('v2026.916.1');
    expect(PAPERCLIP_LAB_RELEASE_SHA).toBe('d554c4789ed3930f8a53ac9fdf6503b3187097da');
    expect(PAPERCLIP_LAB_IMAGE).toBe('ghcr.io/paperclipai/paperclip:2026.916.1');
    const compose = paperclipLabComposeYaml();
    expect(compose).toContain('127.0.0.1:3210:3100');
    expect(compose).toContain('ghcr.io/paperclipai/paperclip:2026.916.1');
    expect(compose).not.toMatch(/:latest\b/);
    expect(compose).not.toContain('0.0.0.0:3210');
  });

  it('allows only the Paperclip Lab root and exact typed actions', () => {
    expect(resolvePaperclipLabPath('D:\\TigerIQ-Paperclip-Lab\\data')).toBe('D:\\TigerIQ-Paperclip-Lab\\data');
    expect(() => resolvePaperclipLabPath('D:\\TigerIQ\\State')).toThrow('TIGERIQ_PAPERCLIP_LAB_PATH_NOT_ALLOWED');
    expect(PAPERCLIP_LAB_ACTIONS).toEqual([
      'paperclip_lab_preflight',
      'paperclip_lab_install',
      'paperclip_lab_start',
      'paperclip_lab_stop',
      'paperclip_lab_health',
    ]);
    expect(assertPaperclipLabRequest({ action: 'paperclip_lab_health' })).toEqual({ action: 'paperclip_lab_health' });
    expect(() => assertPaperclipLabRequest({ action: 'paperclip_lab_health', port: 8795 })).toThrow('TIGERIQ_PAPERCLIP_LAB_ARGUMENT_NOT_ALLOWED');
    expect(() => assertPaperclipLabRequest({ action: 'shell_exec' })).toThrow('TIGERIQ_PAPERCLIP_LAB_ACTION_NOT_ALLOWED');
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
  });

  it('keeps the implementation fail-closed against shell/path escapes and false health', async () => {
    const source = await readFile(new URL('../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs', import.meta.url), 'utf8');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_SYMLINK_BLOCKED');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_REALPATH_ESCAPE_BLOCKED');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_IMAGE_REVISION_MISMATCH');
    expect(source).toContain("wsl.exe");
    expect(source).toContain("'--distribution', PAPERCLIP_LAB_WSL_DISTRO, '--exec', 'docker'");
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_DOCKER_PATH_NOT_ALLOWED');
    expect(source).toContain('imageDigest');
    expect(source).toContain('/api/health');
    expect(source).toContain('identityOk');
    expect(source).toContain('portBindingOk');
    expect(source).toContain('dataMountOk');
    expect(source).toContain('rollbackContainer');
    expect(source).toContain('TIGERIQ_PAPERCLIP_LAB_ABORTED');
    expect(source).not.toMatch(/shell_exec|powershell|cmd\.exe/i);
  });
});
